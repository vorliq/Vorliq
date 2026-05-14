const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/mine", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/mine`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/mine", "Unable to mine a block.");
  }
});

module.exports = router;
