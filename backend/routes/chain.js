const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

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

module.exports = router;
