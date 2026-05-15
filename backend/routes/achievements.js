const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.get("/api/achievements", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/achievements`, {
      params: { address: req.query.address },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/achievements", "Unable to load achievements.");
  }
});

router.get("/api/achievements/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/achievements/all`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/achievements/all", "Unable to load achievement list.");
  }
});

module.exports = router;
