const axios = require("axios");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";
const apiUrl = (process.env.HEARTBEAT_API_URL || process.env.BACKEND_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const flaskUrl = (process.env.FLASK_URL || "http://127.0.0.1:5001").replace(/\/+$/, "");
const localNodeUrl =
  process.env.VORLIQ_NODE_URL ||
  process.env.LOCAL_NODE_URL ||
  (isProduction ? "https://node.vorliq.org" : "http://localhost:5001");
const displayName =
  process.env.VORLIQ_NODE_DISPLAY_NAME ||
  process.env.VORLIQ_NODE_NAME ||
  process.env.NODE_DISPLAY_NAME ||
  (isProduction ? "Vorliq Public Node" : "Local Vorliq Node");
const region = process.env.VORLIQ_NODE_REGION || (isProduction ? "London" : "");
const country = process.env.VORLIQ_NODE_COUNTRY || (isProduction ? "United Kingdom" : "");
const operatorWallet = process.env.VORLIQ_NODE_OPERATOR_WALLET || process.env.VORLIQ_OPERATOR_WALLET || "";
const commit = process.env.GITHUB_SHA || process.env.VORLIQ_COMMIT || "";
const packageVersion = process.env.npm_package_version || "1.0.0";
const softwareVersion = process.env.VORLIQ_SOFTWARE_VERSION || (commit ? commit.slice(0, 7) : `backend-${packageVersion}`);
const configuredHeartbeatIntervalMs = Number(process.env.VORLIQ_HEARTBEAT_INTERVAL_MS || 5 * 60 * 1000);
const heartbeatIntervalMs =
  Number.isFinite(configuredHeartbeatIntervalMs) && configuredHeartbeatIntervalMs >= 30_000
    ? configuredHeartbeatIntervalMs
    : 5 * 60 * 1000;

function safeError(error) {
  return error.response?.data?.message || error.response?.data?.error || error.message;
}

function basePayload() {
  return {
    node_url: localNodeUrl,
    display_name: displayName,
    region,
    country,
    operator_wallet_address: operatorWallet,
    software_version: softwareVersion,
    is_public: true,
  };
}

async function getDiagnostics({ diagnosticsUrl = `${flaskUrl}/diagnostics` } = {}) {
  try {
    const started = Date.now();
    const response = await axios.get(diagnosticsUrl, { timeout: 8000 });
    return {
      chain_height: response.data.block_height,
      latest_block_hash: response.data.last_block_hash,
      last_block_hash: response.data.last_block_hash,
      chain_valid: Boolean(response.data.chain_valid),
      response_time_ms: Date.now() - started,
    };
  } catch (error) {
    console.log(`Diagnostics check failed before heartbeat: ${safeError(error)}`);
    return {
      chain_valid: false,
      response_time_ms: null,
    };
  }
}

async function getSnapshotDiagnostics({ snapshotVerifyUrl = `${apiUrl}/api/snapshot/verify` } = {}) {
  try {
    const response = await axios.get(snapshotVerifyUrl, { timeout: 8000 });
    return {
      snapshot_hash: response.data.snapshot?.signature?.snapshot_hash || null,
      snapshot_signature_verified: response.data.signature_verified === true,
    };
  } catch (error) {
    console.log(`Snapshot check skipped before heartbeat: ${safeError(error)}`);
    return {};
  }
}

async function registerLocalNode({ registryApiUrl = apiUrl } = {}) {
  try {
    const response = await axios.post(`${registryApiUrl}/api/registry/register`, basePayload(), { timeout: 8000 });
    console.log(`Registered ${localNodeUrl} in the Vorliq public node registry.`);
    return response.data;
  } catch (error) {
    console.log(`Registry registration failed: ${safeError(error)}`);
    return null;
  }
}

async function postHeartbeat(payload, { registryApiUrl = apiUrl } = {}) {
  return axios.post(`${registryApiUrl}/api/registry/heartbeat`, payload, { timeout: 8000 });
}

async function sendHeartbeat(options = {}) {
  const registryApiUrl = options.registryApiUrl || apiUrl;
  try {
    const [diagnostics, snapshotDiagnostics] = await Promise.all([
      getDiagnostics(options),
      getSnapshotDiagnostics(options),
    ]);
    const payload = {
      ...basePayload(),
      ...diagnostics,
      ...snapshotDiagnostics,
    };
    let response;
    try {
      response = await postHeartbeat(payload, { registryApiUrl });
    } catch (error) {
      const status = error.response?.status;
      const message = safeError(error);
      if (status === 404 || /not found/i.test(message)) {
        await registerLocalNode({ registryApiUrl });
        response = await postHeartbeat(payload, { registryApiUrl });
      } else {
        throw error;
      }
    }
    console.log(`Heartbeat sent for ${localNodeUrl} at ${new Date().toLocaleString()}.`);
    return response.data;
  } catch (error) {
    console.log(`Heartbeat failed: ${safeError(error)}`);
    return null;
  }
}

async function startHeartbeatLoop() {
  await registerLocalNode();
  await sendHeartbeat();
  setInterval(() => {
    sendHeartbeat().catch((error) => {
      console.log(`Heartbeat loop error: ${safeError(error)}`);
    });
  }, heartbeatIntervalMs);
  console.log(`Vorliq heartbeat loop running every ${Math.round(heartbeatIntervalMs / 1000)} seconds for ${localNodeUrl}.`);
}

if (require.main === module) {
  if (process.argv.includes("--once")) {
    sendHeartbeat().then((result) => {
      process.exit(result?.success ? 0 : 1);
    });
  } else {
    startHeartbeatLoop();
  }
}

module.exports = {
  basePayload,
  getDiagnostics,
  getSnapshotDiagnostics,
  registerLocalNode,
  sendHeartbeat,
  startHeartbeatLoop,
};
