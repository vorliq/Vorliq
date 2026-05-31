const express = require("express");
const axios = require("axios");
const adminAuth = require("../middleware/adminAuth");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const EVENT_STATUSES = new Set(["accepted", "duplicate", "rejected", "quarantined", "failed"]);
const EVENT_TYPES = new Set(["transaction", "block"]);

function eventParams(query = {}) {
  const limit = Number.parseInt(query.limit ?? "25", 10);
  const offset = Number.parseInt(query.offset ?? "0", 10);
  if (!Number.isInteger(limit) || limit <= 0) {
    const error = new Error("limit must be a positive integer");
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    const error = new Error("offset must be zero or greater");
    error.status = 400;
    throw error;
  }
  const params = { limit: Math.min(limit, 100), offset };
  if (query.status) {
    const status = String(query.status).toLowerCase();
    if (!EVENT_STATUSES.has(status)) {
      const error = new Error("status must be accepted, duplicate, rejected, quarantined, or failed.");
      error.status = 400;
      throw error;
    }
    params.status = status;
  }
  if (query.type) {
    const type = String(query.type).toLowerCase();
    if (!EVENT_TYPES.has(type)) {
      const error = new Error("type must be transaction or block.");
      error.status = 400;
      throw error;
    }
    params.type = type;
  }
  return params;
}

router.post("/api/peers/add", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/peers/register`, {
      peer: req.body.peer,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peers/add", "Unable to add peer.");
  }
});

router.get("/api/peers", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/peers", "Unable to load peers.");
  }
});

router.post("/api/peers/sync", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers/sync`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peers/sync", "Unable to sync peers.");
  }
});

router.post("/api/peers/announce", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/peers/announce`, {
      node_url: req.body.node_url || req.body.nodeUrl,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peers/announce", "Unable to announce peer.");
  }
});

router.post("/api/peer/transaction", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/peer/transaction`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peer/transaction", "Peer transaction was rejected.");
  }
});

router.post("/api/peer/block", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/peer/block`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peer/block", "Peer block was rejected.");
  }
});

router.get("/api/peers/propagation/status", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers/propagation/status`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/peers/propagation/status", "Unable to load peer propagation status.");
  }
});

router.get("/api/peers/propagation/events", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers/propagation/events`, { params: eventParams(req.query) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    return handleRouteError(res, error, "GET /api/peers/propagation/events", "Unable to load peer propagation events.");
  }
});

router.get("/api/admin/peers/propagation", adminAuth, async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/admin/peers/propagation`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/admin/peers/propagation", "Unable to load admin peer propagation diagnostics.");
  }
});

module.exports = router;
