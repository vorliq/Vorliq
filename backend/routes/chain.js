const express = require("express");
const axios = require("axios");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.get("/api/chain", async (req, res, next) => {
  try {
    const response = await axios.get(`${flaskUrl}/chain`);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
