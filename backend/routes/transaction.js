const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/transaction/send", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/transaction`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/transaction/send", "Unable to submit transaction.");
  }
});

module.exports = router;
