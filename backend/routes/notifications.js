const express = require("express");
const axios = require("axios");

const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

// Read a member's notification preferences. The core returns only the masked
// email and event toggles, so this read is safe to expose.
router.get("/api/notifications/preferences", async (req, res) => {
  try {
    const address = String(req.query.address || req.query.walletAddress || "").trim();
    if (!address) {
      return res.status(400).json({ success: false, message: "wallet address is required" });
    }
    const response = await axios.get(`${flaskUrl}/notifications/preferences`, { params: { address } });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/notifications/preferences", "Unable to load notification preferences.");
  }
});

// Save preferences. This path is in AUTHORITY_ROUTES, so the signed-authority
// middleware has already proven the caller controls the wallet before we forward
// the (still-signed) body to the core, which re-verifies it.
router.post("/api/notifications/preferences", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/notifications/preferences`, req.body);
    return res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/notifications/preferences", "Unable to save notification preferences.");
  }
});

module.exports = router;
