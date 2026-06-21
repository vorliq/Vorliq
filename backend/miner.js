const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { logError, logInfo } = require("./logger");

const MIN_INTERVAL_MS = 15_000;

function minerConfig(overrides = {}) {
  return {
    enabled: overrides.enabled ?? process.env.VORLIQ_PUBLIC_MINER_ENABLED === "true",
    minerAddress: overrides.minerAddress ?? process.env.VORLIQ_PUBLIC_MINER_ADDRESS ?? "",
    apiUrl: String(
      overrides.apiUrl || process.env.PUBLIC_MINER_API_URL || process.env.BACKEND_URL || "http://127.0.0.1:5000"
    ).replace(/\/+$/, ""),
    intervalMs: Math.max(
      Number(overrides.intervalMs ?? process.env.VORLIQ_PUBLIC_MINER_INTERVAL_MS ?? 30_000) || 30_000,
      MIN_INTERVAL_MS
    ),
    statusFile:
      overrides.statusFile || process.env.VORLIQ_MINER_STATUS_FILE || path.join(os.tmpdir(), "vorliq-miner-status.json"),
  };
}

function safeText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(password|token|private[_-]?key|secret)=?[^\s]*/gi, "$1=[redacted]")
    .slice(0, 500);
}

function writeMinerState(config, state) {
  const safeState = {
    last_mining_attempt_timestamp: state.last_mining_attempt_timestamp || new Date().toISOString(),
    last_mining_result: state.last_mining_result ? safeText(state.last_mining_result) : null,
    last_mining_error: state.last_mining_error ? safeText(state.last_mining_error) : null,
  };
  try {
    fs.mkdirSync(path.dirname(config.statusFile), { recursive: true });
    fs.writeFileSync(config.statusFile, `${JSON.stringify(safeState, null, 2)}\n`, "utf8");
  } catch (error) {
    logError(`Public miner could not write status: ${safeText(error.message)}`);
  }
  return safeState;
}

async function mineOnce(overrides = {}) {
  const config = minerConfig(overrides);
  const attemptedAt = new Date().toISOString();

  if (!config.enabled) {
    const result = "Public miner is disabled.";
    writeMinerState(config, { last_mining_attempt_timestamp: attemptedAt, last_mining_result: result });
    return { mined: false, reason: "disabled" };
  }

  if (!config.minerAddress) {
    const result = "Public miner address is not configured.";
    writeMinerState(config, { last_mining_attempt_timestamp: attemptedAt, last_mining_result: result });
    return { mined: false, reason: "missing miner address" };
  }

  try {
    const statusResponse = await axios.get(`${config.apiUrl}/api/mining/status`, { timeout: 10_000 });
    const status = statusResponse.data?.status || {};

    if (!status.chain_valid) {
      const result = "Chain is not valid; mining skipped.";
      writeMinerState(config, { last_mining_attempt_timestamp: attemptedAt, last_mining_result: result });
      return { mined: false, reason: "chain invalid" };
    }

    if (!status.can_mine_now) {
      const result = status.reason_if_not || "Mining is not allowed yet.";
      writeMinerState(config, { last_mining_attempt_timestamp: attemptedAt, last_mining_result: result });
      return { mined: false, reason: result };
    }

    // Note: we no longer skip permanently when this address mined the latest
    // block. The core enforces a soft, time-bounded anti-monopoly cooldown
    // (SAME_MINER_MIN_GAP), so attempting again is safe: a different miner gets
    // first claim on the next block, but a lone miner is allowed once the gap
    // elapses (the core returns a "wait N seconds" rejection until then, which is
    // handled gracefully below). This keeps a single-miner network alive instead
    // of letting it halt with transactions stuck in the mempool.
    const mineResponse = await axios.post(
      `${config.apiUrl}/api/mine`,
      { miner_address: config.minerAddress },
      { timeout: 120_000 }
    );
    const block = mineResponse.data?.block || {};
    const result = `Mined block ${block.index ?? "unknown"} with hash ${block.hash ?? "unknown"}.`;
    writeMinerState(config, { last_mining_attempt_timestamp: attemptedAt, last_mining_result: result });
    return { mined: true, block };
  } catch (error) {
    const message = error.response?.data?.message || error.response?.data?.error || error.message;
    writeMinerState(config, { last_mining_attempt_timestamp: attemptedAt, last_mining_error: message });
    logError(`Public miner attempt failed: ${safeText(message)}`);
    return { mined: false, reason: safeText(message), error: true };
  }
}

function startMiner(overrides = {}) {
  const config = minerConfig(overrides);
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    const result = await mineOnce(config);
    logInfo(`Public miner check: ${result.mined ? "mined" : result.reason}`);
    if (!stopped) {
      timer = setTimeout(tick, config.intervalMs);
    }
  }

  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

if (require.main === module) {
  const stop = startMiner();
  process.on("SIGTERM", () => {
    logInfo("Public miner stopping after SIGTERM.");
    stop();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    logInfo("Public miner stopping after SIGINT.");
    stop();
    process.exit(0);
  });
}

module.exports = {
  MIN_INTERVAL_MS,
  minerConfig,
  mineOnce,
  safeText,
  startMiner,
  writeMinerState,
};
