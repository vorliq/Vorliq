const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const LENDING_STATUSES = new Set([
  "pending_vote",
  "rejected",
  "approved_pending_issue",
  "active",
  "repayment_pending",
  "repaid",
  "overdue",
]);

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

function lendingListParams(req) {
  const params = paginationParams(req);
  if (req.query.status) {
    const status = String(req.query.status).trim().toLowerCase();
    if (!LENDING_STATUSES.has(status)) {
      const error = new Error("status is not valid");
      error.status = 400;
      throw error;
    }
    params.status = status;
  }
  if (req.query.address) {
    params.address = cleanText(String(req.query.address), "address");
  }
  return params;
}

router.post("/api/lending/request", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/request`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/lending/request", "Unable to submit loan request.");
  }
});

router.get("/api/lending/loans", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/lending/loans`, { params: lendingListParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/lending/loans", "Unable to load loan requests.");
  }
});

router.get("/api/lending/loan", async (req, res, next) => {
  try {
    const loanId = cleanText(String(req.query.loan_id || req.query.loanId || ""), "loan ID", 128);
    const response = await axios.get(`${flaskUrl}/lending/loan`, {
      params: { loan_id: loanId },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/lending/loan", "Unable to load loan details.");
  }
});

router.get("/api/lending/my", async (req, res, next) => {
  try {
    const address = cleanText(String(req.query.address || ""), "address");
    const response = await axios.get(`${flaskUrl}/lending/my`, { params: { address } });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/lending/my", "Unable to load member loans.");
  }
});

router.get("/api/lending/summary", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/lending/summary`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/lending/summary", "Unable to load lending summary.");
  }
});

router.post("/api/lending/vote", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/vote`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/lending/vote", "Unable to cast vote.");
  }
});

router.post("/api/lending/repay", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/repay`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/lending/repay", "Unable to repay loan.");
  }
});

module.exports = router;
