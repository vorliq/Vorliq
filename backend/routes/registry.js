const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

const SYNC_STATUSES = new Set(["synced", "behind", "invalid", "unknown"]);
const ACTIVITY_STATUSES = new Set(["active", "inactive"]);

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
    last_block_hash: cleanText(body.last_block_hash || body.lastBlockHash, 160),
    chain_valid: body.chain_valid ?? body.chainValid,
    response_time_ms: body.response_time_ms ?? body.responseTimeMs,
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
  return params;
}

function sendValidationError(res, error) {
  return res.status(error.statusCode || 400).json({ success: false, message: error.message });
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

module.exports = router;
