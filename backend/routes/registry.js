const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/registry/register", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/registry/register`, {
      node_url: req.body.node_url || req.body.nodeUrl,
      display_name: req.body.display_name || req.body.displayName,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/registry/register", "Unable to register node.");
  }
});

router.get("/api/registry/nodes", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/registry/nodes`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/registry/nodes", "Unable to load registry nodes.");
  }
});

router.post("/api/registry/heartbeat", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/registry/heartbeat`, {
      node_url: req.body.node_url || req.body.nodeUrl,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/registry/heartbeat", "Unable to update registry heartbeat.");
  }
});

module.exports = router;
