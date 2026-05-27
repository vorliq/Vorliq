const ACTIVE_WINDOW_SECONDS = 30 * 60;
const STALE_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const LIFECYCLE_HISTORY_LIMIT = 100;
const LIFECYCLE_STATUSES = new Set(["active", "stale", "inactive", "archived", "retired"]);
const EXPLICIT_LIFECYCLE_STATUSES = new Set(["archived", "retired"]);

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value, limit = 240) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\u0000/g, "").replace(/[<>]/g, "").trim().slice(0, limit);
}

function normalizeStatus(value) {
  const status = text(value, 40).toLowerCase();
  return LIFECYCLE_STATUSES.has(status) ? status : "";
}

function safeHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-LIFECYCLE_HISTORY_LIMIT).map((entry = {}) => ({
    timestamp: text(entry.timestamp || entry.changed_at || new Date().toISOString(), 80),
    from_status: normalizeStatus(entry.from_status || entry.fromStatus) || "",
    to_status: normalizeStatus(entry.to_status || entry.toStatus || entry.lifecycle_status) || "inactive",
    reason: text(entry.reason || entry.lifecycle_reason, 300),
    changed_by: text(entry.changed_by || entry.changedBy || "system", 80),
  }));
}

function classifyNodeLifecycle(node = {}, now = Math.floor(Date.now() / 1000), options = {}) {
  const storedStatus = normalizeStatus(node.lifecycle_status || node.lifecycleStatus);
  const lifecycleHistory = safeHistory(node.lifecycle_history || node.lifecycleHistory);
  const base = {
    lifecycle_reason: text(node.lifecycle_reason || node.lifecycleReason, 300),
    archived_at: text(node.archived_at || node.archivedAt, 80),
    archived_by: text(node.archived_by || node.archivedBy, 80),
    retired_at: text(node.retired_at || node.retiredAt, 80),
    retired_by: text(node.retired_by || node.retiredBy, 80),
    last_lifecycle_change: text(node.last_lifecycle_change || node.lastLifecycleChange, 80),
    lifecycle_history: lifecycleHistory,
  };

  if (EXPLICIT_LIFECYCLE_STATUSES.has(storedStatus)) {
    return {
      lifecycle_status: storedStatus,
      ...base,
      active: false,
    };
  }

  const lastSeen = numberOrNull(node.last_seen ?? node.lastSeen);
  const activeWindowSeconds = numberOrNull(options.activeWindowSeconds ?? options.active_window_seconds) || ACTIVE_WINDOW_SECONDS;
  const staleWindowSeconds = numberOrNull(options.staleWindowSeconds ?? options.stale_window_seconds) || STALE_WINDOW_SECONDS;
  let lifecycleStatus = "inactive";

  if (lastSeen !== null && lastSeen >= now - activeWindowSeconds) lifecycleStatus = "active";
  else if (lastSeen !== null && lastSeen >= now - staleWindowSeconds) lifecycleStatus = "stale";

  return {
    lifecycle_status: lifecycleStatus,
    ...base,
    active: lifecycleStatus === "active",
  };
}

function applyNodeLifecycle(node = {}, lifecycleUpdate = {}) {
  const nowIso = lifecycleUpdate.timestamp || new Date().toISOString();
  const nextStatus = normalizeStatus(lifecycleUpdate.lifecycle_status || lifecycleUpdate.lifecycleStatus);
  if (!nextStatus) {
    throw new Error("lifecycle_status is required.");
  }

  const previous = classifyNodeLifecycle(node, Math.floor(Date.now() / 1000), lifecycleUpdate.options || {});
  const changedBy = text(lifecycleUpdate.changed_by || lifecycleUpdate.changedBy || "admin", 80);
  const reason = text(lifecycleUpdate.reason || lifecycleUpdate.lifecycle_reason || lifecycleUpdate.lifecycleReason, 300);
  const history = safeHistory(node.lifecycle_history || node.lifecycleHistory);
  history.push({
    timestamp: text(nowIso, 80),
    from_status: previous.lifecycle_status,
    to_status: nextStatus,
    reason,
    changed_by: changedBy,
  });

  const updated = {
    ...node,
    lifecycle_status: EXPLICIT_LIFECYCLE_STATUSES.has(nextStatus) ? nextStatus : "",
    lifecycle_reason: reason,
    last_lifecycle_change: text(nowIso, 80),
    lifecycle_history: history.slice(-LIFECYCLE_HISTORY_LIMIT),
  };

  if (nextStatus === "archived") {
    updated.archived_at = text(nowIso, 80);
    updated.archived_by = changedBy;
  } else if (nextStatus !== "archived") {
    updated.archived_at = "";
    updated.archived_by = "";
  }

  if (nextStatus === "retired") {
    updated.retired_at = text(nowIso, 80);
    updated.retired_by = changedBy;
  } else if (nextStatus !== "retired") {
    updated.retired_at = "";
    updated.retired_by = "";
  }

  return updated;
}

function summarizeNodeLifecycle(nodes = [], now = Math.floor(Date.now() / 1000), options = {}) {
  const summary = {
    active_count: 0,
    stale_count: 0,
    inactive_count: 0,
    archived_count: 0,
    retired_count: 0,
    visible_public_count: 0,
    total_count: Array.isArray(nodes) ? nodes.length : 0,
  };

  for (const node of Array.isArray(nodes) ? nodes : []) {
    const lifecycle = classifyNodeLifecycle(node, now, options);
    const key = `${lifecycle.lifecycle_status}_count`;
    if (Object.prototype.hasOwnProperty.call(summary, key)) summary[key] += 1;
    if (!["archived", "retired"].includes(lifecycle.lifecycle_status)) summary.visible_public_count += 1;
  }

  return summary;
}

module.exports = {
  ACTIVE_WINDOW_SECONDS,
  STALE_WINDOW_SECONDS,
  LIFECYCLE_STATUSES,
  applyNodeLifecycle,
  classifyNodeLifecycle,
  summarizeNodeLifecycle,
};
