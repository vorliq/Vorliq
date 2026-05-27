const { hasForbiddenPublicMarker } = require("./nodeCompare");

const MONITOR_STATUSES = new Set(["ok", "warning", "critical"]);
const INCIDENT_CRITICAL_CODES = new Set([
  "active_forked_node",
  "trusted_public_node_forked",
  "trusted_public_node_unreachable",
  "trusted_snapshot_signature_invalid",
  "trusted_state_unavailable",
]);

function text(value, limit = 240) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\u0000/g, "").replace(/[<>]/g, "").trim().slice(0, limit);
}

function normalizeUrl(value) {
  return text(value, 240).replace(/\/+$/, "").toLowerCase();
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeNodeUrl(node = {}) {
  return text(node.node_url, 240);
}

function alert(severity, code, title, message, node, operatorAction) {
  return {
    severity,
    code,
    title: text(title, 160),
    message: text(message, 500),
    ...(node ? { node_url: safeNodeUrl(node) } : {}),
    operator_action: text(operatorAction, 500),
    public_safe: true,
  };
}

function recommendedActionsFor(alerts) {
  const actions = new Set();
  for (const item of alerts) {
    if (item.operator_action) actions.add(item.operator_action);
  }
  if (!actions.size) actions.add("Continue normal monitoring.");
  return Array.from(actions);
}

function trustedPublicNode(comparison = {}, options = {}) {
  const nodes = Array.isArray(comparison.nodes) ? comparison.nodes : [];
  const configuredUrl = normalizeUrl(
    options.trustedPublicNodeUrl ||
      comparison.trusted_public_node_url ||
      process.env.VORLIQ_NODE_URL ||
      "https://node.vorliq.org"
  );
  return (
    nodes.find((node) => normalizeUrl(node.node_url) === configuredUrl) ||
    nodes.find((node) => /vorliq public node/i.test(node.display_name || "")) ||
    nodes.find((node) => normalizeUrl(node.node_url) === normalizeUrl(comparison.trusted_node_url)) ||
    null
  );
}

function buildNetworkMonitor(comparison = {}, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString();
  const nodes = Array.isArray(comparison.nodes) ? comparison.nodes : [];
  const trustedNode = trustedPublicNode(comparison, options);
  const trustedStatus = trustedNode?.sync_status || "unknown";
  const alerts = [];

  if (comparison.success !== true || comparison.trusted_chain_height === null || !comparison.trusted_latest_hash) {
    alerts.push(
      alert(
        "critical",
        "trusted_state_unavailable",
        "Trusted chain state unavailable",
        "The node comparison endpoint could not determine the trusted public chain state.",
        null,
        "Check snapshot verification, backend health, and the trusted public node before syncing from peers."
      )
    );
  }

  if (comparison.trusted_signature_verified === false) {
    alerts.push(
      alert(
        "critical",
        "trusted_snapshot_signature_invalid",
        "Trusted snapshot signature did not verify",
        "The trusted public snapshot signature verification is false.",
        null,
        "Stop treating new peer state as trusted until signed snapshot verification is restored."
      )
    );
  }

  if (trustedNode?.sync_status === "forked") {
    alerts.push(
      alert(
        "critical",
        "trusted_public_node_forked",
        "Trusted public node appears forked",
        "The registered trusted public node latest hash does not match the trusted chain comparison.",
        trustedNode,
        "Run node doctor locally, verify signed snapshots, then use verified bootstrap dry-run before recovery."
      )
    );
  }

  if (trustedNode?.sync_status === "unreachable") {
    alerts.push(
      alert(
        "critical",
        "trusted_public_node_unreachable",
        "Trusted public node is unreachable",
        "The registered trusted public node cannot be checked by heartbeat diagnostics.",
        trustedNode,
        "Restart heartbeat and backend services, then check DNS and HTTPS for the public node."
      )
    );
  }

  if (!trustedNode) {
    alerts.push(
      alert(
        "warning",
        "trusted_public_node_missing",
        "Trusted public node heartbeat is missing",
        "The monitor could not find a registered heartbeat for the configured trusted public node.",
        null,
        "Restart heartbeat and confirm the configured public node URL matches the registry record."
      )
    );
  } else if (["stale", "unknown"].includes(trustedNode.sync_status)) {
    alerts.push(
      alert(
        "warning",
        "trusted_public_node_not_synced",
        "Trusted public node is not reporting synced",
        "The configured trusted public node is present but is not reporting a synced status.",
        trustedNode,
        "Restart heartbeat, check diagnostics, then run node doctor locally."
      )
    );
  }

  for (const node of nodes) {
    const isTrusted = trustedNode && normalizeUrl(node.node_url) === normalizeUrl(trustedNode.node_url);
    if (node.active === true && node.sync_status === "forked") {
      alerts.push(
        alert(
          "critical",
          "active_forked_node",
          "Active node appears forked",
          "An active registered node reports a latest hash that does not match the trusted public chain at the comparable height.",
          node,
          "Do not sync from this node. Run verified bootstrap dry-run and compare audit exports before recovery."
        )
      );
      continue;
    }

    if (node.sync_status === "stale" && !isTrusted) {
      alerts.push(
        alert(
          "warning",
          "stale_node",
          "Registered node heartbeat is stale",
          "A non-critical registered node has not sent a heartbeat inside the active window.",
          node,
          "Restart heartbeat, check DNS and HTTPS, then run node doctor locally."
        )
      );
    }

    if (node.sync_status === "behind") {
      alerts.push(
        alert(
          "warning",
          "behind_node",
          "Registered node is behind",
          "A registered node reports a valid chain height lower than the trusted public chain.",
          node,
          "Wait for sync or run verified bootstrap dry-run before changing local chain state."
        )
      );
    }

    if (node.sync_status === "ahead") {
      alerts.push(
        alert(
          "warning",
          "ahead_node",
          "Registered node is ahead",
          "A registered node reports a higher height than the trusted public chain. This is a signal, not automatic trust.",
          node,
          "Verify signed snapshots and audit exports before trusting or syncing from this node."
        )
      );
    }

    if (node.sync_status === "unreachable" && !isTrusted) {
      alerts.push(
        alert(
          "warning",
          "unreachable_node",
          "Registered node is unreachable",
          "A non-critical registered node cannot be checked by heartbeat diagnostics.",
          node,
          "Restart heartbeat, check DNS and HTTPS, then run node doctor locally."
        )
      );
    }

    if (!isTrusted && node.active === true && !node.snapshot_hash && node.snapshot_signature_verified !== true) {
      alerts.push(
        alert(
          "warning",
          "node_snapshot_metadata_missing",
          "Node snapshot metadata missing",
          "An active non-critical node did not report signed snapshot metadata in its heartbeat.",
          node,
          "Update the node heartbeat and verify snapshot signing configuration."
        )
      );
    }
  }

  const warningCount = alerts.filter((item) => item.severity === "warning").length;
  const criticalCount = alerts.filter((item) => item.severity === "critical").length;
  const overallStatus = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "ok";
  const summary = comparison.summary || {};
  const payload = {
    success: true,
    overall_status: MONITOR_STATUSES.has(overallStatus) ? overallStatus : "critical",
    checked_at: checkedAt,
    trusted_node_url: comparison.trusted_node_url || "",
    trusted_public_node_status: trustedStatus,
    active_node_count: numberValue(comparison.active_node_count ?? summary.active_node_count),
    synced_count: numberValue(summary.synced_count),
    behind_count: numberValue(summary.behind_count),
    ahead_count: numberValue(summary.ahead_count),
    forked_count: numberValue(summary.forked_count),
    stale_count: numberValue(summary.stale_count),
    unreachable_count: numberValue(summary.unreachable_count),
    warning_count: warningCount,
    critical_count: criticalCount,
    recommended_actions: recommendedActionsFor(alerts),
    alerts,
  };

  if (hasForbiddenPublicMarker(payload)) {
    const error = new Error("Node monitor response contains forbidden public markers.");
    error.statusCode = 500;
    throw error;
  }

  return payload;
}

function alertKey(item = {}) {
  return `${text(item.code, 80)}|${text(item.node_url, 240)}`;
}

function updateAlertState(existingState = {}, alerts = [], checkedAt = new Date().toISOString()) {
  const previousAlerts = Array.isArray(existingState.alerts) ? existingState.alerts : [];
  const previousByKey = new Map(previousAlerts.map((item) => [alertKey(item), item]));
  const currentKeys = new Set();
  const nextAlerts = alerts.map((item) => {
    const key = alertKey(item);
    currentKeys.add(key);
    const previous = previousByKey.get(key) || {};
    return {
      code: text(item.code, 80),
      node_url: text(item.node_url, 240),
      first_seen: previous.first_seen || checkedAt,
      last_seen: checkedAt,
      count: numberValue(previous.count) + 1,
      last_alerted_at: previous.last_alerted_at || null,
      status: text(item.severity, 20) || "warning",
    };
  });

  for (const previous of previousAlerts) {
    const key = alertKey(previous);
    if (!currentKeys.has(key)) {
      nextAlerts.push({
        code: text(previous.code, 80),
        node_url: text(previous.node_url, 240),
        first_seen: previous.first_seen || checkedAt,
        last_seen: checkedAt,
        count: numberValue(previous.count),
        last_alerted_at: previous.last_alerted_at || null,
        status: "recovered",
      });
    }
  }

  return { alerts: nextAlerts };
}

function shouldSendOperatorAlert(stateAlert = {}, now = new Date(), suppressionSeconds = 1800, warningThreshold = 3) {
  if (stateAlert.status === "warning" && numberValue(stateAlert.count) < warningThreshold) return false;
  const lastAlerted = Date.parse(stateAlert.last_alerted_at || "");
  if (!Number.isFinite(lastAlerted)) return true;
  return now.getTime() - lastAlerted >= suppressionSeconds * 1000;
}

function markAlerted(state = {}, item = {}, alertedAt = new Date().toISOString()) {
  const key = alertKey(item);
  return {
    alerts: (Array.isArray(state.alerts) ? state.alerts : []).map((entry) =>
      alertKey(entry) === key ? { ...entry, last_alerted_at: alertedAt } : entry
    ),
  };
}

module.exports = {
  INCIDENT_CRITICAL_CODES,
  alertKey,
  buildNetworkMonitor,
  hasForbiddenPublicMarker,
  markAlerted,
  shouldSendOperatorAlert,
  updateAlertState,
};
