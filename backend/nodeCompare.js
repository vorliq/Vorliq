const ACTIVE_WINDOW_SECONDS = 30 * 60;
const RECENT_WINDOW_SECONDS = 6 * 60 * 60;
const { classifyNodeLifecycle } = require("./nodeLifecycle");

const FORBIDDEN_PUBLIC_PATTERNS = [
  /PRIVATE KEY/i,
  /BEGIN [A-Z ]*PRIVATE KEY/i,
  /ADMIN_TOKEN/i,
  /VORLIQ_SNAPSHOT_PRIVATE_KEY/i,
  /SERVER_SSH_KEY/i,
  /password/i,
  /admin[_-]?token/i,
  /private[_-]?key/i,
  /raw[_-]?ip/i,
  /ip_address/i,
  /server[_-]?path/i,
  /user[_-]?agent/i,
  /\/home\/vorliq/i,
  /[A-Za-z]:\\Users\\/i,
  /ssh-(rsa|ed25519)/i,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
];

function hasForbiddenPublicMarker(value) {
  let text = "";
  try {
    text = JSON.stringify(value || {});
  } catch (error) {
    return true;
  }
  return FORBIDDEN_PUBLIC_PATTERNS.some((pattern) => pattern.test(text));
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolOrNull(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).toLowerCase();
  if (["true", "1", "yes", "valid"].includes(text)) return true;
  if (["false", "0", "no", "invalid"].includes(text)) return false;
  return null;
}

function textOrEmpty(value, limit = 240) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\u0000/g, "").trim().slice(0, limit);
}

function latestHistoryValue(node = {}, key) {
  const history = Array.isArray(node.status_history) ? node.status_history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.[key] !== undefined && history[index]?.[key] !== null && history[index]?.[key] !== "") {
      return history[index][key];
    }
  }
  return null;
}

function normalizedNode(node = {}) {
  const lifecycle = classifyNodeLifecycle(node);
  return {
    node_url: textOrEmpty(node.node_url || node.nodeUrl, 240),
    display_name: textOrEmpty(node.display_name || node.displayName || "Vorliq Node", 64),
    region: textOrEmpty(node.region, 80),
    country: textOrEmpty(node.country, 80),
    last_seen: numberOrNull(node.last_seen ?? node.lastSeen),
    active: typeof node.active === "boolean" ? node.active : null,
    chain_height: numberOrNull(node.chain_height ?? node.chainHeight ?? node.last_chain_height ?? latestHistoryValue(node, "chain_height")),
    latest_block_hash: textOrEmpty(
      node.latest_block_hash || node.latestBlockHash || node.last_block_hash || latestHistoryValue(node, "last_block_hash"),
      160
    ),
    chain_valid: boolOrNull(node.chain_valid ?? node.chainValid ?? (node.last_diagnostics_status === "valid" ? true : node.last_diagnostics_status === "invalid" ? false : null)),
    response_time_ms: numberOrNull(node.response_time_ms ?? node.responseTimeMs ?? latestHistoryValue(node, "response_time_ms")),
    reachable: boolOrNull(node.reachable ?? node.diagnostics_reachable ?? node.diagnosticsReachable),
    last_probe_status: textOrEmpty(node.last_probe_status || node.lastProbeStatus, 32),
    probe_served_height: numberOrNull(node.probe_served_height ?? node.probeServedHeight),
    last_diagnostics_status: textOrEmpty(node.last_diagnostics_status || node.lastDiagnosticsStatus, 32),
    heartbeat_sync_status: textOrEmpty(node.sync_status || node.syncStatus, 32),
    snapshot_hash: textOrEmpty(node.snapshot_hash || node.snapshotHash, 160),
    snapshot_signature_verified: boolOrNull(node.snapshot_signature_verified ?? node.snapshotSignatureVerified),
    status_history: Array.isArray(node.status_history) ? node.status_history : [],
    lifecycle_status: lifecycle.lifecycle_status,
    lifecycle_reason: lifecycle.lifecycle_reason,
  };
}

function activeFromLastSeen(node, trustedState = {}) {
  if (typeof node.active === "boolean") return node.active;
  if (node.last_seen === null) return false;
  const nowSeconds = numberOrNull(trustedState.now_seconds) || Math.floor(Date.now() / 1000);
  const activeWindowSeconds = numberOrNull(trustedState.active_window_seconds) || ACTIVE_WINDOW_SECONDS;
  return node.last_seen >= nowSeconds - activeWindowSeconds;
}

function recentlySeen(node, trustedState = {}) {
  if (node.last_seen === null) return false;
  const nowSeconds = numberOrNull(trustedState.now_seconds) || Math.floor(Date.now() / 1000);
  const recentWindowSeconds = numberOrNull(trustedState.recent_window_seconds) || RECENT_WINDOW_SECONDS;
  return node.last_seen >= nowSeconds - recentWindowSeconds;
}

function statusDetails(syncStatus, node, trustedState) {
  const trustedHeight = numberOrNull(trustedState.trusted_chain_height);
  const height = node.chain_height;
  const difference = height !== null && trustedHeight !== null ? height - trustedHeight : null;

  const labels = {
    synced: "Synced",
    behind: "Behind",
    ahead: "Ahead",
    forked: "Forked",
    stale: "Stale",
    unreachable: "Unreachable",
    unknown: "Unknown",
  };

  const messages = {
    synced: "Node is active, reports a valid chain, and matches the trusted public chain height and latest hash.",
    behind: "Node reports a valid chain but is behind the trusted public chain height.",
    ahead: "Node reports a higher height than the trusted public chain. Treat this as a signal until signed snapshot and audit paths verify it.",
    forked: "Node latest hash does not match the trusted public chain at the comparable height. Do not sync from it without recovery checks.",
    stale: "Node heartbeat is outside the active window.",
    unreachable: "Node heartbeat indicates diagnostics could not be checked.",
    unknown: "Node is missing enough safe heartbeat data to compare confidently.",
  };

  const risk = {
    synced: "low",
    behind: "warning",
    ahead: "warning",
    forked: "high",
    stale: "warning",
    unreachable: "warning",
    unknown: "unknown",
  };

  return {
    sync_status: syncStatus,
    sync_label: labels[syncStatus] || labels.unknown,
    sync_message: messages[syncStatus] || messages.unknown,
    height_difference: difference,
    risk_level: risk[syncStatus] || "unknown",
  };
}

function classifySyncStatus(nodeInput, trustedState = {}) {
  const node = normalizedNode(nodeInput);
  const trustedHeight = numberOrNull(trustedState.trusted_chain_height);
  const trustedHash = textOrEmpty(trustedState.trusted_latest_hash || trustedState.latest_block_hash, 160);
  const active = activeFromLastSeen(node, trustedState);
  const recent = recentlySeen(node, trustedState);
  const height = node.chain_height;
  const latestHash = node.latest_block_hash;
  const chainValid = node.chain_valid;
  const sameHeight = height !== null && trustedHeight !== null && height === trustedHeight;
  const sameLatestHash = Boolean(latestHash && trustedHash && latestHash === trustedHash);
  const lastHistoryStatus = textOrEmpty(latestHistoryValue(node, "status"), 32);

  if (!node.node_url) return "unknown";

  if (sameHeight && latestHash && trustedHash && latestHash !== trustedHash && (active || recent)) {
    return "forked";
  }

  if (!active && node.last_seen !== null) {
    return "stale";
  }

  if (
    node.reachable === false ||
    node.last_diagnostics_status === "unreachable" ||
    lastHistoryStatus === "offline" ||
    (chainValid === false && height === null && !latestHash)
  ) {
    return "unreachable";
  }

  if (height === null || trustedHeight === null || !latestHash || !trustedHash || chainValid !== true) {
    return "unknown";
  }

  if (sameHeight && sameLatestHash && active) return "synced";
  if (height < trustedHeight) return "behind";
  if (height > trustedHeight) return "ahead";
  if (sameHeight && !sameLatestHash && (active || recent)) return "forked";

  return "unknown";
}

function compareNodeToTrustedState(nodeInput, trustedState = {}) {
  const node = normalizedNode(nodeInput);
  const trustedHash = textOrEmpty(trustedState.trusted_latest_hash || trustedState.latest_block_hash, 160);
  const syncStatus = classifySyncStatus(nodeInput, trustedState);
  const details = statusDetails(syncStatus, node, trustedState);
  const active = activeFromLastSeen(node, trustedState);

  return {
    node_url: node.node_url,
    display_name: node.display_name,
    region: node.region,
    country: node.country,
    last_seen: node.last_seen,
    active,
    chain_height: node.chain_height,
    latest_block_hash: node.latest_block_hash,
    chain_valid: node.chain_valid === true,
    response_time_ms: node.response_time_ms,
    reachable: node.reachable,
    last_probe_status: node.last_probe_status,
    probe_served_height: node.probe_served_height,
    lifecycle_status: node.lifecycle_status,
    lifecycle_reason: node.lifecycle_reason,
    ...details,
    same_latest_hash: Boolean(node.latest_block_hash && trustedHash && node.latest_block_hash === trustedHash),
  };
}

function summarizeNetworkSync(nodes = []) {
  const summary = {
    total_node_count: nodes.length,
    active_node_count: nodes.filter((node) => node.active === true).length,
    synced_count: 0,
    behind_count: 0,
    ahead_count: 0,
    forked_count: 0,
    stale_count: 0,
    inactive_count: 0,
    archived_count: 0,
    retired_count: 0,
    visible_public_count: nodes.filter((node) => !["archived", "retired"].includes(node.lifecycle_status)).length,
    unreachable_count: 0,
    unknown_count: 0,
    warning_count: 0,
    high_risk_count: 0,
    overall_status: "unknown",
  };

  for (const node of nodes) {
    const key = `${node.sync_status || "unknown"}_count`;
    if (Object.prototype.hasOwnProperty.call(summary, key)) summary[key] += 1;
    const lifecycleKey = `${node.lifecycle_status || "inactive"}_count`;
    if (["inactive_count", "archived_count", "retired_count"].includes(lifecycleKey)) summary[lifecycleKey] += 1;
    if (node.risk_level === "warning") summary.warning_count += 1;
    if (node.risk_level === "high") summary.high_risk_count += 1;
  }

  if (summary.high_risk_count > 0) summary.overall_status = "high_risk";
  else if (summary.warning_count > 0 || summary.active_node_count === 0) summary.overall_status = "warning";
  else if (summary.synced_count > 0) summary.overall_status = "synced";
  return summary;
}

module.exports = {
  ACTIVE_WINDOW_SECONDS,
  FORBIDDEN_PUBLIC_PATTERNS,
  classifySyncStatus,
  compareNodeToTrustedState,
  hasForbiddenPublicMarker,
  summarizeNetworkSync,
};
