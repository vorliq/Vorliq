#!/usr/bin/env node

const axios = require("axios");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  INCIDENT_CRITICAL_CODES,
  alertKey,
  markAlerted,
  shouldSendOperatorAlert,
  updateAlertState,
} = require("./nodeMonitor");
const { atomicWriteJson, safeReadJson } = require("./jsonStore");

const apiUrl = (process.env.MAINTENANCE_API_URL || process.env.PUBLIC_MINER_API_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const logFile = process.env.VORLIQ_MAINTENANCE_LOG || "/var/log/vorliq-maintenance.log";
const adminToken = process.env.ADMIN_TOKEN || "";
const alertScript = process.env.VORLIQ_ALERT_SCRIPT || "/home/vorliq/alert.sh";
const nodeMonitorStateFile = process.env.NODE_MONITOR_STATE_FILE || path.join(__dirname, "data", "node-monitor-state.json");
const alertSuppressionSeconds = Number(process.env.NODE_MONITOR_ALERT_SUPPRESSION_SECONDS || 1800);
const warningThreshold = Number(process.env.NODE_MONITOR_WARNING_THRESHOLD || 3);
const autoArchiveInactiveNodes = String(process.env.VORLIQ_AUTO_ARCHIVE_INACTIVE_NODES || "").toLowerCase() === "true";
const inactiveArchiveSeconds = Number(process.env.VORLIQ_INACTIVE_ARCHIVE_SECONDS || 30 * 24 * 60 * 60);
const trustedPublicNodeUrl = String(process.env.VORLIQ_NODE_URL || "https://node.vorliq.org").replace(/\/+$/, "");

function sanitize(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/ADMIN_TOKEN=[^\s]+/gi, "ADMIN_TOKEN=[redacted]")
    .replace(/(password|token|private[_-]?key|secret)=?[^\s]*/gi, "$1=[redacted]")
    .replace(/\/home\/vorliq\/[^\s'"]*/g, "[server-path]")
    .slice(0, 500);
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function writeLog(level, message, metadata = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitize(message),
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, typeof value === "string" ? sanitize(value) : value])
    ),
  };
  const line = `${JSON.stringify(record)}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
  } catch (error) {
    process.stdout.write(line);
  }
}

async function get(pathname) {
  const response = await axios.get(`${apiUrl}${pathname}`, { timeout: 10000 });
  return response.data || {};
}

async function postAdmin(pathname) {
  if (!adminToken) {
    return { skipped: true, reason: "admin token is not configured" };
  }
  const response = await axios.post(
    `${apiUrl}${pathname}`,
    {},
    { timeout: 30000, headers: { Authorization: `Bearer ${adminToken}` } }
  );
  return response.data || {};
}

async function postAdminJson(pathname, body = {}) {
  if (!adminToken) {
    return { skipped: true, reason: "admin token is not configured" };
  }
  const response = await axios.post(
    `${apiUrl}${pathname}`,
    body,
    { timeout: 30000, headers: { Authorization: `Bearer ${adminToken}` } }
  );
  return response.data || {};
}

async function patchAdminJson(pathname, body = {}) {
  if (!adminToken) {
    return { skipped: true, reason: "admin token is not configured" };
  }
  const response = await axios.patch(
    `${apiUrl}${pathname}`,
    body,
    { timeout: 30000, headers: { Authorization: `Bearer ${adminToken}` } }
  );
  return response.data || {};
}

function readNodeMonitorState() {
  return safeReadJson(nodeMonitorStateFile, { alerts: [] });
}

function writeNodeMonitorState(state) {
  fs.mkdirSync(path.dirname(nodeMonitorStateFile), { recursive: true });
  atomicWriteJson(nodeMonitorStateFile, {
    alerts: (Array.isArray(state.alerts) ? state.alerts : []).map((item) => ({
      code: item.code || "",
      node_url: item.node_url || "",
      first_seen: item.first_seen || null,
      last_seen: item.last_seen || null,
      count: Number(item.count) || 0,
      last_alerted_at: item.last_alerted_at || null,
      status: item.status || "warning",
    })),
  });
}

function runAlertScript(severity, title, message) {
  return new Promise((resolve) => {
    if (!fs.existsSync(alertScript)) {
      writeLog("warning", "node monitor alert script unavailable", { severity, title });
      resolve({ skipped: true });
      return;
    }
    execFile(alertScript, [severity, title, message], { timeout: 30000 }, (error) => {
      if (error) {
        writeLog("warning", "node monitor alert script failed", { severity, title, error: sanitize(error.message) });
      }
      resolve({ skipped: false, error: error ? sanitize(error.message) : null });
    });
  });
}

function incidentTitleFor(alert) {
  return `Network integrity alert: ${alert.code}`;
}

function incidentCodesFromActive(incidents = []) {
  return incidents
    .map((incident) => String(incident.title || "").match(/^Network integrity alert: ([a-z0-9_]+)/i)?.[1])
    .filter(Boolean);
}

function shouldCreateIncident(alert) {
  return alert.severity === "critical" && INCIDENT_CRITICAL_CODES.has(alert.code);
}

async function listActiveIncidents() {
  try {
    const data = await get("/api/incidents/active");
    return Array.isArray(data.incidents) ? data.incidents : [];
  } catch (error) {
    writeLog("warning", "active incidents unavailable during node monitor check", { error: sanitize(error.message) });
    return [];
  }
}

async function reconcileNetworkIncidents(alerts = []) {
  const incidentAlerts = alerts.filter(shouldCreateIncident);
  const activeIncidents = await listActiveIncidents();
  const activeByTitle = new Map(activeIncidents.map((incident) => [incident.title, incident]));
  const activeCodes = new Set(incidentCodesFromActive(activeIncidents));
  const currentCodes = new Set(incidentAlerts.map((item) => item.code));

  for (const item of incidentAlerts) {
    const title = incidentTitleFor(item);
    const body = {
      title,
      message: `${item.message} Operator action: ${item.operator_action}`,
      severity: item.code === "active_forked_node" ? "major" : "critical",
      affected_services: ["node-network"],
    };
    const existing = activeByTitle.get(title);
    if (existing) {
      const result = await patchAdminJson(`/api/incidents/${encodeURIComponent(existing.id)}`, {
        description: body.message,
        status: "identified",
        severity: body.severity,
        affected_services: body.affected_services,
      });
      writeLog(result.skipped ? "warning" : "info", "network incident updated", { code: item.code, skipped: Boolean(result.skipped) });
    } else {
      const result = await postAdminJson("/api/incidents", body);
      writeLog(result.skipped ? "warning" : "info", "network incident created", { code: item.code, skipped: Boolean(result.skipped) });
    }
  }

  for (const code of activeCodes) {
    if (currentCodes.has(code)) continue;
    const incident = activeIncidents.find((item) => String(item.title || "") === `Network integrity alert: ${code}`);
    if (!incident) continue;
    const result = await postAdminJson(`/api/incidents/${encodeURIComponent(incident.id)}/resolve`, {});
    writeLog(result.skipped ? "warning" : "info", "network incident resolved", { code, skipped: Boolean(result.skipped) });
  }
}

async function checkNodeMonitor() {
  const monitor = await get("/api/nodes/monitor");
  const alerts = Array.isArray(monitor.alerts) ? monitor.alerts : [];
  const checkedAt = monitor.checked_at || new Date().toISOString();
  let state = updateAlertState(readNodeMonitorState(), alerts, checkedAt);
  const stateByKey = new Map((state.alerts || []).map((item) => [alertKey(item), item]));

  writeLog(monitor.overall_status === "critical" ? "error" : monitor.overall_status === "warning" ? "warning" : "info", "node monitor snapshot", {
    overall_status: monitor.overall_status || "unknown",
    active_node_count: monitor.active_node_count,
    warning_count: monitor.warning_count,
    critical_count: monitor.critical_count,
  });

  for (const item of alerts) {
    const stateAlert = stateByKey.get(alertKey(item));
    writeLog(item.severity === "critical" ? "error" : "warning", "node monitor alert", {
      severity: item.severity,
      code: item.code,
      node_url: item.node_url || "",
      count: stateAlert?.count || 0,
      operator_action: item.operator_action,
    });

    if (stateAlert && shouldSendOperatorAlert(stateAlert, new Date(checkedAt), alertSuppressionSeconds, warningThreshold)) {
      await runAlertScript(item.severity, item.title, item.message);
      state = markAlerted(state, item, checkedAt);
    }
  }

  await reconcileNetworkIncidents(alerts);
  await checkRegistryLifecycleSuggestions();
  writeNodeMonitorState(state);
  return monitor;
}

async function checkRegistryLifecycleSuggestions() {
  try {
    const lifecycle = await get("/api/registry/lifecycle?include_archived=true");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const nodes = Array.isArray(lifecycle.nodes) ? lifecycle.nodes : [];
    for (const node of nodes) {
      const lastSeen = Number(node.last_seen || 0);
      const inactiveLongEnough =
        node.lifecycle_status === "inactive" &&
        Number.isFinite(lastSeen) &&
        nowSeconds - lastSeen >= inactiveArchiveSeconds;
      const trusted = normalizeUrl(node.node_url) === normalizeUrl(trustedPublicNodeUrl);
      if (!inactiveLongEnough || trusted || ["archived", "retired"].includes(node.lifecycle_status)) continue;

      if (!autoArchiveInactiveNodes) {
        writeLog("warning", "registry lifecycle archival suggested", {
          node_url: node.node_url || "",
          lifecycle_status: node.lifecycle_status,
          recommendation: "Archive old test node through protected admin flow, or restart heartbeat if this is a real node.",
        });
        continue;
      }

      const result = await postAdminJson("/api/admin/registry/archive", {
        node_url: node.node_url,
        reason: "Auto-archived after more than 30 days inactive by maintenance lifecycle policy.",
      });
      writeLog(result.skipped ? "warning" : "info", "registry lifecycle auto-archive checked", {
        node_url: node.node_url || "",
        skipped: Boolean(result.skipped),
      });
    }
  } catch (error) {
    writeLog("warning", "registry lifecycle suggestions unavailable", { error: sanitize(error.message) });
  }
}

async function run() {
  writeLog("info", "maintenance check started");
  const [health, readiness, storage, indexes, backup, nodeMonitor] = await Promise.allSettled([
    get("/api/health"),
    get("/api/readiness"),
    get("/api/storage/health"),
    get("/api/indexes/health"),
    get("/api/backup/status"),
    checkNodeMonitor(),
  ]);

  const indexData = indexes.status === "fulfilled" ? indexes.value : null;
  const rebuildNeeded = Boolean(indexData?.rebuild_needed);

  writeLog("info", "maintenance health snapshot", {
    backend_ok: health.status === "fulfilled" && health.value.success === true,
    readiness_status: readiness.status === "fulfilled" ? readiness.value.overall_status : "unavailable",
    storage_status: storage.status === "fulfilled" ? storage.value.overall_status : "unavailable",
    index_status: indexData?.status || "unavailable",
    index_rebuild_needed: rebuildNeeded,
    backup_visible: backup.status === "fulfilled" ? Boolean(backup.value.latest_backup) : false,
    node_monitor_status: nodeMonitor.status === "fulfilled" ? nodeMonitor.value.overall_status : "unavailable",
  });

  if (rebuildNeeded) {
    const rebuild = await postAdmin("/api/admin/indexes/rebuild");
    writeLog(rebuild.skipped ? "warning" : "info", "index rebuild checked", {
      rebuild_skipped: Boolean(rebuild.skipped),
      rebuild_status: rebuild.status || "unknown",
      rebuild_needed_after: Boolean(rebuild.rebuild_needed),
    });
  }

  writeLog("info", "maintenance check completed");
}

run().catch((error) => {
  writeLog("error", "maintenance check failed", { error: sanitize(error.message) });
  process.exitCode = 1;
});
