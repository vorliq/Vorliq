const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/peers/add", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/peers/register`, {
      peer: req.body.peer,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peers/add", "Unable to add peer.");
  }
});

router.get("/api/peers", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/peers", "Unable to load peers.");
  }
});

router.post("/api/peers/sync", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers/sync`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peers/sync", "Unable to sync peers.");
  }
});

router.post("/api/peers/announce", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/peers/announce`, {
      node_url: req.body.node_url || req.body.nodeUrl,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/peers/announce", "Unable to announce peer.");
  }
});

module.exports = router;
