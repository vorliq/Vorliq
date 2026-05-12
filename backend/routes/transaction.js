const express = require("express");
const axios = require("axios");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/transaction/send", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/transaction`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
