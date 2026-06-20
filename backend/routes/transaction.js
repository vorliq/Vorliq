const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const VALID_STATUSES = new Set(["pending", "confirmed", "all"]);

function transactionPagination(req) {
  const limit = Number.parseInt(req.query.limit ?? "25", 10);
  const offset = Number.parseInt(req.query.offset ?? "0", 10);
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
  return { limit: Math.min(limit, 100), offset };
}

function optionalText(value, label, maxLength = 160) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).replace(/\u0000/g, "").trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    const error = new Error(`${label} must be ${maxLength} characters or fewer`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

router.post("/api/transaction/send", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/transaction`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/transaction/send", "Unable to submit transaction.");
  }
});

router.get("/api/transactions/pending", async (req, res) => {
  try {
    const params = {
      ...transactionPagination(req),
      address: optionalText(req.query.address, "address"),
    };
    const response = await axios.get(`${flaskUrl}/transactions/pending`, { params });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return res.status(error.status).json({ success: false, message: error.message });
    return handleRouteError(res, error, "GET /api/transactions/pending", "Unable to load pending transactions.");
  }
});

router.get("/api/transactions", async (req, res) => {
  try {
    const status = optionalText(req.query.status, "status", 20) || "all";
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: "status must be pending, confirmed, or all" });
    }
    const params = {
      ...transactionPagination(req),
      address: optionalText(req.query.address, "address"),
      type: optionalText(req.query.type, "type", 80),
      status,
    };
    const response = await axios.get(`${flaskUrl}/transactions`, { params });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return res.status(error.status).json({ success: false, message: error.message });
    return handleRouteError(res, error, "GET /api/transactions", "Unable to load transactions.");
  }
});

router.get("/api/transactions/:tx_id", async (req, res) => {
  try {
    const txId = optionalText(req.params.tx_id, "transaction ID", 128);
    if (!txId) return res.status(400).json({ success: false, message: "transaction ID is required" });
    const response = await axios.get(`${flaskUrl}/transactions/${encodeURIComponent(txId)}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return res.status(error.status).json({ success: false, message: error.message });
    return handleRouteError(res, error, "GET /api/transactions/:tx_id", "Unable to load transaction.");
  }
});

module.exports = router;
