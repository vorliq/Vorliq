const express = require("express");
const axios = require("axios");
const adminAuth = require("../middleware/adminAuth");
const { verifySnapshot } = require("../snapshot");
const {
  compareNodeToTrustedState,
  hasForbiddenPublicMarker,
  summarizeNetworkSync,
} = require("../nodeCompare");
const { buildNetworkMonitor } = require("../nodeMonitor");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const DEFAULT_TRUSTED_NODE_URL = "https://vorliq.org";

const SYNC_STATUSES = new Set(["synced", "behind", "invalid", "unknown"]);
const ACTIVITY_STATUSES = new Set(["active", "inactive"]);
const LIFECYCLE_STATUSES = new Set(["active", "stale", "inactive", "archived", "retired"]);

function cleanText(value, maxLength = 300) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function boolValue(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
}

function nodePayload(body = {}) {
  return {
    node_url: body.node_url || body.nodeUrl,
    display_name: cleanText(body.display_name || body.displayName, 64),
    description: cleanText(body.description, 300),
    region: cleanText(body.region, 80),
    country: cleanText(body.country, 80),
    operator_wallet_address: cleanText(body.operator_wallet_address || body.operatorWalletAddress, 160),
    software_version: cleanText(body.software_version || body.softwareVersion, 80),
    is_public: boolValue(body.is_public ?? body.isPublic, true),
  };
}

function heartbeatPayload(body = {}) {
  return {
    ...nodePayload(body),
    chain_height: body.chain_height ?? body.chainHeight,
    last_block_hash: cleanText(body.latest_block_hash || body.latestBlockHash || body.last_block_hash || body.lastBlockHash, 160),
    chain_valid: body.chain_valid ?? body.chainValid,
    response_time_ms: body.response_time_ms ?? body.responseTimeMs,
    snapshot_hash: cleanText(body.snapshot_hash || body.snapshotHash, 160),
    snapshot_signature_verified: body.snapshot_signature_verified ?? body.snapshotSignatureVerified,
  };
}

function listParams(query = {}) {
  const params = {};
  if (query.status) {
    const status = String(query.status).toLowerCase();
    if (!ACTIVITY_STATUSES.has(status)) {
      const error = new Error("status must be active or inactive.");
      error.statusCode = 400;
      throw error;
    }
    params.status = status;
  }
  if (query.sync_status || query.syncStatus) {
    const syncStatus = String(query.sync_status || query.syncStatus).toLowerCase();
    if (!SYNC_STATUSES.has(syncStatus)) {
      const error = new Error("sync_status must be synced, behind, invalid, or unknown.");
      error.statusCode = 400;
      throw error;
    }
    params.sync_status = syncStatus;
  }
  if (query.country) params.country = cleanText(query.country, 80);
  if (query.lifecycle_status || query.lifecycleStatus) {
    const lifecycleStatus = String(query.lifecycle_status || query.lifecycleStatus).toLowerCase();
    if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) {
      const error = new Error("lifecycle_status must be active, stale, inactive, archived, or retired.");
      error.statusCode = 400;
      throw error;
    }
    params.lifecycle_status = lifecycleStatus;
  }
  if (["true", "1", "yes"].includes(String(query.include_archived || query.includeArchived || "").toLowerCase())) {
    params.include_archived = "true";
  }
  return params;
}

function sendValidationError(res, error) {
  return res.status(error.statusCode || 400).json({ success: false, message: error.message });
}

function trustedNodeUrl() {
  return String(process.env.VORLIQ_PUBLIC_NODE_URL || DEFAULT_TRUSTED_NODE_URL).replace(/\/+$/, "");
}

function trustedPublicNodeUrl() {
  return String(process.env.VORLIQ_NODE_URL || "https://node.vorliq.org").replace(/\/+$/, "");
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim().replace(/\/+$/, ""));
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
      return "";
    }
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function failIfUnsafe(payload) {
  if (hasForbiddenPublicMarker(payload)) {
    const error = new Error("Node comparison response contains forbidden public markers.");
    error.statusCode = 500;
    throw error;
  }
}

async function buildNodeComparison({ admin = false, includeInternalMetadata = false } = {}) {
  const checkedAt = new Date().toISOString();
  const [snapshotResult, registryResult] = await Promise.all([
    verifySnapshot({ generatedAt: checkedAt, includeReadinessStatus: false }),
    axios.get(`${flaskUrl}/registry/all`),
  ]);
  const snapshot = snapshotResult.snapshot || {};
  const trustedState = {
    trusted_node_url: trustedNodeUrl(),
    trusted_chain_height: Number.isFinite(Number(snapshot.chain_height)) ? Number(snapshot.chain_height) : null,
    trusted_latest_hash: snapshot.latest_block_hash || null,
    trusted_snapshot_hash: snapshot.signature?.snapshot_hash || null,
    trusted_signature_verified: snapshotResult.signature_verified === true,
    active_window_seconds: 30 * 60,
    now_seconds: Math.floor(new Date(checkedAt).getTime() / 1000),
  };
  const nodes = (registryResult.data?.nodes || []).map((node) => {
    const comparison = compareNodeToTrustedState(node, trustedState);
    if (!includeInternalMetadata) return comparison;
    return {
      ...comparison,
      snapshot_hash: cleanText(node.snapshot_hash || node.snapshotHash, 160),
      snapshot_signature_verified: node.snapshot_signature_verified ?? node.snapshotSignatureVerified ?? null,
    };
  });
  const summary = summarizeNetworkSync(nodes);
  const payload = {
    success: true,
    checked_at: checkedAt,
    trusted_node_url: trustedState.trusted_node_url,
    trusted_chain_height: trustedState.trusted_chain_height,
    trusted_latest_hash: trustedState.trusted_latest_hash,
    trusted_snapshot_hash: trustedState.trusted_snapshot_hash,
    trusted_signature_verified: trustedState.trusted_signature_verified,
    active_node_count: summary.active_node_count,
    summary,
    nodes,
  };

  if (admin) {
    payload.diagnostics = {
      registry_node_count: nodes.length,
      snapshot_verified: snapshotResult.verified === true,
      snapshot_signature_status: snapshotResult.signature_status || "unknown",
      snapshot_signature_required: snapshotResult.signature_required === true,
      comparison_source: "registry heartbeat plus trusted signed public snapshot",
    };
  }

  failIfUnsafe(payload);
  return payload;
}

async function buildNodeMonitor({ admin = false } = {}) {
  const comparison = await buildNodeComparison({ admin: false, includeInternalMetadata: true });
  const monitor = buildNetworkMonitor(comparison, {
    checkedAt: comparison.checked_at,
    trustedPublicNodeUrl: trustedPublicNodeUrl(),
  });

  if (admin) {
    monitor.diagnostics = {
      comparison_checked_at: comparison.checked_at,
      comparison_node_count: Array.isArray(comparison.nodes) ? comparison.nodes.length : 0,
      trusted_signature_verified: comparison.trusted_signature_verified === true,
      trusted_public_node_url_configured: Boolean(trustedPublicNodeUrl()),
      incident_trigger_policy: "critical network integrity alerts only",
    };
  }

  failIfUnsafe(monitor);
  return monitor;
}

router.post("/api/registry/register", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/registry/register`, nodePayload(req.body));
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/registry/register", "Unable to register node.");
  }
});

router.post("/api/registry/heartbeat", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/registry/heartbeat`, heartbeatPayload(req.body));
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/registry/heartbeat", "Unable to update registry heartbeat.");
  }
});

router.get("/api/registry/nodes", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/registry/nodes`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/registry/nodes", "Unable to load registry nodes.");
  }
});

router.get("/api/registry/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/registry/all`, { params: listParams(req.query) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.statusCode) return sendValidationError(res, error);
    return handleRouteError(res, error, "GET /api/registry/all", "Unable to load registry nodes.");
  }
});

router.get("/api/registry/node", async (req, res) => {
  try {
    const nodeUrl = req.query.node_url || req.query.nodeUrl;
    if (!nodeUrl) {
      return res.status(400).json({ success: false, message: "node_url is required." });
    }
    const response = await axios.get(`${flaskUrl}/registry/node`, { params: { node_url: nodeUrl } });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/registry/node", "Unable to load node details.");
  }
});

router.get("/api/registry/summary", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/registry/summary`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/registry/summary", "Unable to load registry summary.");
  }
});

router.get("/api/registry/lifecycle", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/registry/lifecycle`, { params: listParams(req.query) });
    failIfUnsafe(response.data);
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.statusCode) return sendValidationError(res, error);
    return handleRouteError(res, error, "GET /api/registry/lifecycle", "Unable to load registry lifecycle.");
  }
});

function lifecyclePayload(body = {}) {
  const nodeUrl = body.node_url || body.nodeUrl;
  const normalizedNodeUrl = normalizeUrl(nodeUrl);
  if (!normalizedNodeUrl) {
    const error = new Error("node_url must be a valid http or https URL without credentials.");
    error.statusCode = 400;
    throw error;
  }
  return {
    node_url: normalizedNodeUrl,
    reason: cleanText(body.reason || "Registry lifecycle updated by administrator.", 300),
    force: body.force === true || ["true", "1", "yes"].includes(String(body.force || "").toLowerCase()),
  };
}

async function postLifecycleAction(action, req, res) {
  try {
    const payload = lifecyclePayload(req.body || {});
    if (action === "archive" && normalizeUrl(payload.node_url) === normalizeUrl(trustedPublicNodeUrl()) && !payload.force) {
      return res.status(400).json({
        success: false,
        message: "Trusted public node cannot be archived without force=true.",
      });
    }
    const response = await axios.post(`${flaskUrl}/registry/admin/${action}`, payload, {
      headers: { Authorization: req.get("authorization") || "" },
    });
    failIfUnsafe(response.data);
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.statusCode) return sendValidationError(res, error);
    return handleRouteError(res, error, `POST /api/admin/registry/${action}`, `Unable to ${action} registry node.`);
  }
}

router.post("/api/admin/registry/probe-sweep", adminAuth, async (req, res) => {
  try {
    const response = await axios.post(
      `${flaskUrl}/registry/admin/probe-sweep`,
      {},
      { headers: { Authorization: req.get("authorization") || "" } }
    );
    failIfUnsafe(response.data);
    return res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/admin/registry/probe-sweep", "Unable to run registry probe sweep.");
  }
});

router.post("/api/admin/registry/archive", adminAuth, async (req, res) => postLifecycleAction("archive", req, res));
router.post("/api/admin/registry/restore", adminAuth, async (req, res) => postLifecycleAction("restore", req, res));
router.post("/api/admin/registry/retire", adminAuth, async (req, res) => postLifecycleAction("retire", req, res));

router.get("/api/nodes/compare", async (req, res) => {
  try {
    return res.json(await buildNodeComparison());
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: "Node comparison is currently unavailable." });
    }
    return handleRouteError(res, error, "GET /api/nodes/compare", "Node comparison is currently unavailable.");
  }
});

router.get("/api/admin/nodes/compare", adminAuth, async (req, res) => {
  try {
    return res.json(await buildNodeComparison({ admin: true }));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: "Admin node comparison is currently unavailable." });
    }
    return handleRouteError(res, error, "GET /api/admin/nodes/compare", "Admin node comparison is currently unavailable.");
  }
});

router.get("/api/nodes/monitor", async (req, res) => {
  try {
    return res.json(await buildNodeMonitor());
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: "Node monitor is currently unavailable." });
    }
    return handleRouteError(res, error, "GET /api/nodes/monitor", "Node monitor is currently unavailable.");
  }
});

router.get("/api/admin/nodes/monitor", adminAuth, async (req, res) => {
  try {
    return res.json(await buildNodeMonitor({ admin: true }));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: "Admin node monitor is currently unavailable." });
    }
    return handleRouteError(res, error, "GET /api/admin/nodes/monitor", "Admin node monitor is currently unavailable.");
  }
});

module.exports = router;
module.exports.buildNodeComparison = buildNodeComparison;
module.exports.buildNodeMonitor = buildNodeMonitor;
