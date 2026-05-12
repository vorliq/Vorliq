const express = require("express");
const axios = require("axios");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/wallet/create", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/wallet`);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
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
    next(error);
  }
});

module.exports = router;
