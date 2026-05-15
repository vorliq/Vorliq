const express = require("express");
const axios = require("axios");
const { sendCachedJson } = require("../cache");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.get("/api/chain", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/chain`);
    res.json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/chain", "Unable to load the blockchain.");
  }
});

router.get("/api/economics", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/economics`);
    res.json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/economics", "Unable to load token economics.");
  }
});

router.get("/api/chain/blocks", async (req, res) => {
  try {
    const params = paginationParams(req);
    const response = await axios.get(`${flaskUrl}/chain/blocks`, { params });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/chain/blocks", "Unable to load paginated blocks.");
  }
});

router.get("/api/chain/summary", async (req, res) => {
  try {
    return sendCachedJson(req, res, "chain-summary", 15_000, async () => {
      const response = await axios.get(`${flaskUrl}/chain/summary`);
      return { status: response.status, data: response.data };
    });
  } catch (error) {
    return handleRouteError(res, error, "GET /api/chain/summary", "Unable to load chain summary.");
  }
});

router.get("/api/chain/address", async (req, res) => {
  try {
    const params = {
      ...paginationParams(req),
      address: req.query.address,
    };
    const response = await axios.get(`${flaskUrl}/chain/address`, { params });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/chain/address", "Unable to load address transactions.");
  }
});

router.get("/api/diagnostics", async (req, res, next) => {
  try {
    return sendCachedJson(req, res, "diagnostics", 15_000, async () => {
      const response = await axios.get(`${flaskUrl}/diagnostics`);
      return { status: response.status, data: response.data };
    });
  } catch (error) {
    return handleRouteError(res, error, "GET /api/diagnostics", "Unable to load node diagnostics.");
  }
});

router.get("/api/leaderboard", async (req, res) => {
  try {
    const params = paginationParams(req, 20);
    return sendCachedJson(req, res, "leaderboard", 30_000, async () => {
      const response = await axios.get(`${flaskUrl}/leaderboard`, { params });
      return { status: response.status, data: response.data };
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/leaderboard", "Unable to load leaderboard.");
  }
});

module.exports = router;
