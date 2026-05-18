const express = require("express");
const axios = require("axios");
const { sendCachedJson } = require("../cache");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const TREASURY_STATUSES = new Set(["active", "passed_pending_payout", "payout_pending", "paid", "rejected", "expired", "cancelled"]);
const TREASURY_CATEGORIES = new Set(["development", "marketing", "community", "infrastructure", "security", "education", "other"]);

function cleanText(value, field, max = 160) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${field} is required`);
    error.status = 400;
    throw error;
  }
  const text = value.trim();
  if (text.length > max) {
    const error = new Error(`${field} is too long`);
    error.status = 400;
    throw error;
  }
  return text;
}

function treasuryListParams(req) {
  const params = paginationParams(req);
  if (req.query.status) {
    const status = String(req.query.status).trim().toLowerCase();
    if (!TREASURY_STATUSES.has(status)) {
      const error = new Error("status is not valid");
      error.status = 400;
      throw error;
    }
    params.status = status;
  }
  if (req.query.category) {
    const category = String(req.query.category).trim().toLowerCase();
    if (!TREASURY_CATEGORIES.has(category)) {
      const error = new Error("category is not valid");
      error.status = 400;
      throw error;
    }
    params.category = category;
  }
  if (req.query.address) {
    params.address = cleanText(String(req.query.address), "address");
  }
  return params;
}

function handleValidationError(res, error) {
  if (error.status) {
    res.status(error.status).json({ success: false, message: error.message });
    return true;
  }
  return false;
}

router.get("/api/treasury/balance", async (req, res) => {
  try {
    return sendCachedJson(req, res, "treasury-balance", 15_000, async () => {
      const response = await axios.get(`${flaskUrl}/treasury/balance`);
      return { status: response.status, data: response.data };
    });
  } catch (error) {
    return handleRouteError(res, error, "GET /api/treasury/balance", "Unable to load treasury balance.");
  }
});

router.get("/api/treasury/summary", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/treasury/summary`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/treasury/summary", "Unable to load treasury summary.");
  }
});

router.get("/api/treasury/proposals", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/treasury/proposals`, { params: treasuryListParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/treasury/proposals", "Unable to load treasury proposals.");
  }
});

router.get("/api/treasury/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/treasury/all`, { params: treasuryListParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/treasury/all", "Unable to load treasury history.");
  }
});

router.get("/api/treasury/proposal", async (req, res) => {
  try {
    const proposalId = cleanText(String(req.query.proposal_id || req.query.proposalId || ""), "proposal ID", 128);
    const response = await axios.get(`${flaskUrl}/treasury/proposal`, { params: { proposal_id: proposalId } });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/treasury/proposal", "Unable to load treasury proposal.");
  }
});

router.get("/api/treasury/my", async (req, res) => {
  try {
    const address = cleanText(String(req.query.address || ""), "address");
    const response = await axios.get(`${flaskUrl}/treasury/my`, { params: { address } });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/treasury/my", "Unable to load member treasury activity.");
  }
});

router.post("/api/treasury/propose", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/treasury/propose`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/treasury/propose", "Unable to create treasury proposal.");
  }
});

router.post("/api/treasury/vote", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/treasury/vote`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/treasury/vote", "Unable to cast treasury vote.");
  }
});

router.post("/api/treasury/cancel", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/treasury/cancel`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/treasury/cancel", "Unable to cancel treasury proposal.");
  }
});

router.get("/api/treasury/ledger", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/treasury/ledger`, { params: paginationParams(req, 25) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/treasury/ledger", "Unable to load treasury ledger.");
  }
});

module.exports = router;
