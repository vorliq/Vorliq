const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const { atomicWriteJson, safeReadJson } = require("./jsonStore");
const { logInfo, logError } = require("./logger");

// Server-side production monitoring. Three lightweight checks run as cron-style
// timers inside the existing Node process (nothing new to deploy or manage):
//   - chain health every 2 minutes (stuck mempool / dead chain)
//   - Flask backend reachability every 2 minutes
//   - free disk space every hour (so a full disk never silently breaks a deploy)
// Each fires an email alert through the SAME transactional provider used for user
// notifications (VORLIQ_EMAIL_API_URL / _KEY / _FROM); if no provider is
// configured it appends to a dedicated alerts log file instead. Alerts are
// edge-triggered (one email when a condition starts, one "resolved" record when
// it clears) so a persistent fault never floods the inbox. The last events are
// kept for GET /api/admin/alerts.

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const MAX_ALERTS = 50;
const ONE_GB = 1024 * 1024 * 1024;
const TWO_MINUTES = 2 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const DEAD_CHAIN_SECONDS = 10 * 60;

function dataDir() {
  return process.env.VORLIQ_BACKEND_DATA_DIR || path.join(__dirname, "data");
}
function alertsFile() {
  return process.env.VORLIQ_ALERTS_FILE || path.join(dataDir(), "alerts.json");
}
function alertsLogFile() {
  return process.env.VORLIQ_ALERTS_LOG || path.join(dataDir(), "alerts.log");
}

function readAlerts() {
  const parsed = safeReadJson(alertsFile(), { events: [] });
  return { events: Array.isArray(parsed.events) ? parsed.events : [] };
}
function writeAlerts(events) {
  atomicWriteJson(alertsFile(), { events: (events || []).slice(-MAX_ALERTS) });
}

// --- email / log delivery -------------------------------------------------
function emailProvider() {
  return {
    apiUrl: String(process.env.VORLIQ_EMAIL_API_URL || "").trim(),
    apiKey: String(process.env.VORLIQ_EMAIL_API_KEY || "").trim(),
    from: String(process.env.VORLIQ_EMAIL_FROM || "").trim(),
  };
}
function providerConfigured(provider) {
  return Boolean(provider.apiUrl && provider.apiKey && provider.from);
}
function alertRecipient() {
  return String(process.env.VORLIQ_ALERT_EMAIL || process.env.ADMIN_ALERT_EMAIL || "").trim();
}

function appendAlertLog(line) {
  try {
    fs.mkdirSync(path.dirname(alertsLogFile()), { recursive: true });
    fs.appendFileSync(alertsLogFile(), `${new Date().toISOString()} ${line}\n`);
  } catch (error) {
    logError(`[monitors] could not write alerts log: ${error.message}`);
  }
}

// Deliver an alert. Returns the delivery channel used. Never throws — a mail
// outage must not crash the monitor loop.
async function deliverAlert(subject, text) {
  const provider = emailProvider();
  const to = alertRecipient();
  if (providerConfigured(provider) && to) {
    try {
      await axios.post(
        provider.apiUrl,
        { from: provider.from, to, subject, text },
        { headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` }, timeout: 10000 }
      );
      return "emailed";
    } catch (error) {
      // Fall back to the log so the alert is never lost.
      appendAlertLog(`EMAIL DELIVERY FAILED (${error.message}) :: ${subject} :: ${text}`);
      return "email_failed_logged";
    }
  }
  appendAlertLog(`${subject} :: ${text}`);
  return "logged";
}

function recordAlert(event) {
  const store = readAlerts();
  const full = {
    id: crypto.randomUUID(),
    monitor: event.monitor,
    severity: event.severity || "critical",
    status: event.status || "firing",
    message: event.message,
    detail: event.detail || null,
    created_at: new Date().toISOString(),
  };
  store.events.push(full);
  writeAlerts(store.events);
  return full;
}

function getRecentAlerts(limit = 10) {
  const { events } = readAlerts();
  return events.slice(-limit).reverse();
}

// Per-monitor health so alerts are edge-triggered, not sent every poll.
const monitorState = { chain: "ok", backend: "ok", disk: "ok" };

async function fireOrResolve(monitor, isBad, { severity, message, detail }) {
  const previous = monitorState[monitor];
  if (isBad && previous !== "bad") {
    monitorState[monitor] = "bad";
    recordAlert({ monitor, severity, status: "firing", message, detail });
    const channel = await deliverAlert(`[Vorliq alert] ${message}`, `${message}\n\n${detail || ""}`.trim());
    logError(`[monitors] ALERT ${monitor}: ${message} (delivery: ${channel})`);
  } else if (!isBad && previous === "bad") {
    monitorState[monitor] = "ok";
    recordAlert({ monitor, severity: "info", status: "resolved", message: `${monitor} monitor recovered`, detail });
    logInfo(`[monitors] ${monitor} recovered`);
  }
}

// --- the three checks -----------------------------------------------------

// Chain liveness. Degraded when the mempool has stuck transactions (older than
// two mining cycles) or the chain tip is older than ten minutes. Reads Flask's
// /health, which already computes both. If Flask is unreachable this check is a
// no-op — the backend monitor owns the "unreachable" alert.
async function checkChain() {
  let health;
  try {
    const response = await axios.get(`${flaskUrl}/health`, { timeout: 8000 });
    health = response.data || {};
  } catch (error) {
    return;
  }
  const stuck = Number(health.stuck_pending_count || 0);
  const blockAge = Number(health.last_block_age_seconds || 0);
  const isBad = stuck > 0 || blockAge > DEAD_CHAIN_SECONDS;
  const reasons = [];
  if (stuck > 0) reasons.push(`${stuck} stuck pending transaction(s)`);
  if (blockAge > DEAD_CHAIN_SECONDS) reasons.push(`last block is ${Math.round(blockAge / 60)} min old`);
  await fireOrResolve("chain", isBad, {
    severity: "critical",
    message: isBad ? `Chain degraded: ${reasons.join("; ")}` : "chain healthy",
    detail: JSON.stringify({ stuck_pending_count: stuck, last_block_age_seconds: blockAge }),
  });
}

// Flask backend reachability/health. Alerts when Flask cannot be reached from the
// Node layer at all, or when it reports a degraded chain_health.
async function checkBackend() {
  try {
    const response = await axios.get(`${flaskUrl}/health`, { timeout: 8000 });
    const data = response.data || {};
    const degraded = data.chain_health === "degraded" || (data.status && data.status !== "ok");
    await fireOrResolve("backend", Boolean(degraded), {
      severity: "critical",
      message: degraded ? "Flask backend reports degraded status" : "backend healthy",
      detail: JSON.stringify({ status: data.status || null, chain_health: data.chain_health || null }),
    });
  } catch (error) {
    await fireOrResolve("backend", true, {
      severity: "critical",
      message: "Flask blockchain service is unreachable from the Node backend",
      detail: error.message,
    });
  }
}

function freeDiskBytes() {
  const target = process.env.VORLIQ_DISK_PATH || dataDir();
  try {
    const stats = fs.statfsSync(target);
    return stats.bavail * stats.bsize;
  } catch (error) {
    return null;
  }
}

// Disk headroom. Alerts when free space on the app's filesystem drops below 1GB,
// so the disk-full deploy failure can never happen silently again.
async function checkDisk() {
  const free = freeDiskBytes();
  if (free == null) return; // platform could not report; skip rather than false-alarm
  const isBad = free < ONE_GB;
  await fireOrResolve("disk", isBad, {
    severity: "critical",
    message: isBad
      ? `Low disk space: ${(free / ONE_GB).toFixed(2)} GB free (below the 1 GB threshold)`
      : "disk healthy",
    detail: JSON.stringify({ free_bytes: free, free_gb: Number((free / ONE_GB).toFixed(2)) }),
  });
}

function startMonitors() {
  const run = (fn, name) => fn().catch((error) => logError(`[monitors] ${name} check failed: ${error.message}`));
  // First sweep shortly after boot so services have settled.
  setTimeout(() => {
    run(checkChain, "chain");
    run(checkBackend, "backend");
    run(checkDisk, "disk");
  }, 15000);
  const timers = [
    setInterval(() => run(checkChain, "chain"), TWO_MINUTES),
    setInterval(() => run(checkBackend, "backend"), TWO_MINUTES),
    setInterval(() => run(checkDisk, "disk"), ONE_HOUR),
  ];
  // Don't keep the event loop alive purely for the monitors.
  timers.forEach((timer) => timer.unref && timer.unref());
  logInfo("Production monitors started: chain (2m), Flask backend (2m), disk (1h).");
  return timers;
}

function _resetMonitorStateForTests() {
  monitorState.chain = "ok";
  monitorState.backend = "ok";
  monitorState.disk = "ok";
}

module.exports = {
  startMonitors,
  getRecentAlerts,
  recordAlert,
  checkChain,
  checkBackend,
  checkDisk,
  freeDiskBytes,
  deliverAlert,
  alertsFile,
  alertsLogFile,
  _resetMonitorStateForTests,
};
