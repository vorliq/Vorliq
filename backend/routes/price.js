const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/price/signal", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/price/signal`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/price/signal", "Unable to submit price signal.");
  }
});

router.get("/api/price/signals", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/price/signals`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/price/signals", "Unable to load price signals.");
  }
});

router.get("/api/price/median", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/price/median`, {
      params: { currency: req.query.currency },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/price/median", "Unable to load median price.");
  }
});

module.exports = router;
