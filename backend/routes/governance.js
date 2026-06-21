const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");
const realtime = require("../realtime");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const GOVERNANCE_STATUSES = new Set(["active", "passed_pending_execution", "executed", "rejected", "expired", "cancelled"]);
const GOVERNANCE_CATEGORIES = new Set(["mining_reward", "difficulty", "loan_limit", "loan_interest", "exchange_limit", "general"]);

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

function governanceListParams(req) {
  const params = paginationParams(req);
  if (req.query.status) {
    const status = String(req.query.status).trim().toLowerCase();
    if (!GOVERNANCE_STATUSES.has(status)) {
      const error = new Error("status is not valid");
      error.status = 400;
      throw error;
    }
    params.status = status;
  }
  if (req.query.category) {
    const category = String(req.query.category).trim().toLowerCase();
    if (!GOVERNANCE_CATEGORIES.has(category)) {
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
  if (error.status && !error.response) {
    res.status(error.status).json({ success: false, message: error.message });
    return true;
  }
  return false;
}

router.post("/api/governance/propose", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/governance/propose`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/governance/propose", "Unable to create governance proposal.");
  }
});

router.get("/api/governance/proposals", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/proposals`, { params: governanceListParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/governance/proposals", "Unable to load governance proposals.");
  }
});

router.get("/api/governance/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/all`, { params: governanceListParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/governance/all", "Unable to load governance history.");
  }
});

router.get("/api/governance/proposal", async (req, res) => {
  try {
    const proposalId = cleanText(String(req.query.proposal_id || req.query.proposalId || ""), "proposal ID", 128);
    const response = await axios.get(`${flaskUrl}/governance/proposal`, {
      params: { proposal_id: proposalId },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/governance/proposal", "Unable to load governance proposal.");
  }
});

router.get("/api/governance/my", async (req, res) => {
  try {
    const address = cleanText(String(req.query.address || ""), "address");
    const response = await axios.get(`${flaskUrl}/governance/my`, { params: { address } });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/governance/my", "Unable to load member governance activity.");
  }
});

router.get("/api/governance/summary", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/summary`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/governance/summary", "Unable to load governance summary.");
  }
});

router.post("/api/governance/vote", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/governance/vote`, req.body);
    res.status(response.status).json(response.data);
    // If this vote pushed the proposal to a recorded outcome, notify its author.
    realtime.emitProposalOutcome(response.data?.proposal);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/governance/vote", "Unable to cast governance vote.");
  }
});

router.post("/api/governance/cancel", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/governance/cancel`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/governance/cancel", "Unable to cancel governance proposal.");
  }
});

router.get("/api/governance/settings", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/settings`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/governance/settings", "Unable to load governance settings.");
  }
});

router.get("/api/governance/rule-changes", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/rule-changes`, { params: paginationParams(req, 25) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/governance/rule-changes", "Unable to load governance rule changes.");
  }
});

router.get("/api/governance/settings/history", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/settings/history`, { params: paginationParams(req, 25) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/governance/settings/history", "Unable to load governance settings history.");
  }
});

module.exports = router;
