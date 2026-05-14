const express = require("express");
const axios = require("axios");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/lending/request", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/request`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/lending/loans", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/lending/loans`);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/lending/loan", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/lending/loan`, {
      params: { loan_id: req.query.loan_id },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

router.post("/api/lending/vote", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/vote`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

router.post("/api/lending/repay", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/lending/repay`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
