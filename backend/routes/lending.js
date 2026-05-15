const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/lending/request", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/request`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/lending/request", "Unable to submit loan request.");
  }
});

router.get("/api/lending/loans", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/lending/loans`, { params: paginationParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/lending/loans", "Unable to load loan requests.");
  }
});

router.get("/api/lending/loan", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/lending/loan`, {
      params: { loan_id: req.query.loan_id },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/lending/loan", "Unable to load loan details.");
  }
});

router.post("/api/lending/vote", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/vote`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/lending/vote", "Unable to cast vote.");
  }
});

router.post("/api/lending/repay", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/repay`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/lending/repay", "Unable to repay loan.");
  }
});

module.exports = router;
