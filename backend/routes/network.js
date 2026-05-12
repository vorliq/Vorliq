const express = require("express");
const axios = require("axios");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/peers/add", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/peers/register`, {
      peer: req.body.peer,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/peers", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers`);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

router.post("/api/peers/sync", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/peers/sync`);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
