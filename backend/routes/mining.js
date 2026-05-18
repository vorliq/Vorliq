const express = require("express");
const axios = require("axios");
const { paginationParams } = require("../pagination");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.get("/api/mining/status", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/mining/status`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/mining/status", "Unable to load mining status.");
  }
});

router.get("/api/mining/history", async (req, res) => {
  try {
    const params = paginationParams(req, 25);
    const response = await axios.get(`${flaskUrl}/mining/history`, { params });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/mining/history", "Unable to load mining history.");
  }
});

router.post("/api/mine", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/mine`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        message:
          error.response.data?.message ||
          "Mining was rejected by the fair mining rules. Please wait before trying again.",
        wait_seconds: error.response.data?.wait_seconds,
      });
    }

    return handleRouteError(res, error, "POST /api/mine", "Unable to mine a block.");
  }
});

module.exports = router;
