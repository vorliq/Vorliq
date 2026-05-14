const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/governance/propose", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/governance/propose`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/governance/propose", "Unable to create governance proposal.");
  }
});

router.get("/api/governance/proposals", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/proposals`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/governance/proposals", "Unable to load active governance proposals.");
  }
});

router.get("/api/governance/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/all`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/governance/all", "Unable to load governance history.");
  }
});

router.get("/api/governance/proposal", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/proposal`, {
      params: { proposal_id: req.query.proposal_id },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/governance/proposal", "Unable to load governance proposal.");
  }
});

router.post("/api/governance/vote", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/governance/vote`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/governance/vote", "Unable to cast governance vote.");
  }
});

router.get("/api/governance/settings", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/governance/settings`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/governance/settings", "Unable to load governance settings.");
  }
});

module.exports = router;
