const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/exchange/offer", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/offer`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/offer", "Unable to create exchange offer.");
  }
});

router.get("/api/exchange/offers", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/exchange/offers`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/exchange/offers", "Unable to load exchange offers.");
  }
});

router.get("/api/exchange/all", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/exchange/all`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/exchange/all", "Unable to load exchange history.");
  }
});

router.get("/api/exchange/my", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/exchange/my`, {
      params: { address: req.query.address },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/exchange/my", "Unable to load your exchange offers.");
  }
});

router.post("/api/exchange/accept", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/accept`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/accept", "Unable to accept exchange offer.");
  }
});

router.post("/api/exchange/complete", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/complete`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/complete", "Unable to complete exchange offer.");
  }
});

router.post("/api/exchange/cancel", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/exchange/cancel`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/exchange/cancel", "Unable to cancel exchange offer.");
  }
});

module.exports = router;
