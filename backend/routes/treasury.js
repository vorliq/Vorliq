const express = require("express");
const axios = require("axios");
const { sendCachedJson } = require("../cache");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

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

router.get("/api/treasury/proposals", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/treasury/proposals`, { params: paginationParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/treasury/proposals", "Unable to load treasury proposals.");
  }
});

router.get("/api/treasury/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/treasury/all`, { params: paginationParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/treasury/all", "Unable to load treasury history.");
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

module.exports = router;
