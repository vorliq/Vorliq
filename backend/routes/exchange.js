const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const EXCHANGE_STATUSES = new Set(["open", "accepted", "vlq_pending", "vlq_confirmed", "completed", "cancelled", "disputed"]);
const OFFER_TYPES = new Set(["buy", "sell"]);

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

function exchangeListParams(req) {
  const params = paginationParams(req);
  if (req.query.status) {
    const status = String(req.query.status).trim().toLowerCase();
    if (!EXCHANGE_STATUSES.has(status)) {
      const error = new Error("status is not valid");
      error.status = 400;
      throw error;
    }
    params.status = status;
  }
  if (req.query.type || req.query.offer_type) {
    const type = String(req.query.type || req.query.offer_type).trim().toLowerCase();
    if (!OFFER_TYPES.has(type)) {
      const error = new Error("offer type is not valid");
      error.status = 400;
      throw error;
    }
    params.type = type;
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

router.post("/api/exchange/offer", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/offer`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "POST /api/exchange/offer", "Unable to create exchange offer.");
  }
});

router.get("/api/exchange/offers", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/exchange/offers`, { params: exchangeListParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/exchange/offers", "Unable to load exchange offers.");
  }
});

router.get("/api/exchange/offer", async (req, res) => {
  try {
    const offerId = cleanText(String(req.query.offer_id || req.query.offerId || ""), "offer ID", 128);
    const response = await axios.get(`${flaskUrl}/exchange/offer`, { params: { offer_id: offerId } });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/exchange/offer", "Unable to load exchange offer.");
  }
});

router.get("/api/exchange/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/exchange/all`, { params: paginationParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/exchange/all", "Unable to load exchange history.");
  }
});

router.get("/api/exchange/my", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/exchange/my`, {
      params: { address: cleanText(String(req.query.address || ""), "address") },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    return handleRouteError(res, error, "GET /api/exchange/my", "Unable to load your exchange offers.");
  }
});

router.get("/api/exchange/summary", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/exchange/summary`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/exchange/summary", "Unable to load exchange summary.");
  }
});

router.post("/api/exchange/accept", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/accept`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/accept", "Unable to accept exchange offer.");
  }
});

router.post("/api/exchange/complete", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/complete`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/complete", "Unable to complete exchange offer.");
  }
});

router.post("/api/exchange/confirm-complete", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/confirm-complete`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/confirm-complete", "Unable to confirm exchange completion.");
  }
});

router.post("/api/exchange/record-vlq-tx", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/record-vlq-tx`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/record-vlq-tx", "Unable to record VLQ transaction.");
  }
});

router.post("/api/exchange/dispute", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/dispute`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/dispute", "Unable to open exchange dispute.");
  }
});

router.post("/api/exchange/cancel", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/cancel`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/cancel", "Unable to cancel exchange offer.");
  }
});

module.exports = router;
