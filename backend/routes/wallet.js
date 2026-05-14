const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/wallet/create", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/wallet`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/wallet/create", "Unable to create a wallet.");
  }
});

router.get("/api/wallet/balance", async (req, res, next) => {
  try {
    const { address } = req.query;
    const response = await axios.get(`${flaskUrl}/balance`, {
      params: { address },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/wallet/balance", "Unable to load wallet balance.");
  }
});

module.exports = router;
