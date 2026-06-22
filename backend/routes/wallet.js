const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { sendCachedJson } = require("../cache");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

router.post("/api/wallet/create", async (req, res, next) => {
  try {
    const response = await axios.post(`${flaskUrl}/wallet`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/wallet/create", "Unable to create a wallet.");
  }
});

router.get("/api/wallet/balance", async (req, res, next) => {
  try {
    const { address } = req.query;
    // Several surfaces (sidebar, dashboard, wallet, send, faucet) poll the same
    // address's balance, so under load Flask sees a storm of identical lookups.
    // A short per-address cache collapses those into one upstream read every few
    // seconds. The TTL is deliberately small: balances only change when a block
    // is mined, and the send path validates funds server-side at Flask, so a
    // 2.5s-stale display figure is safe. Keyed by address via the query string.
    return sendCachedJson(
      req,
      res,
      "wallet-balance",
      2500,
      async () => {
        const response = await axios.get(`${flaskUrl}/balance`, { params: { address } });
        return { status: response.status, data: response.data };
      },
      // Per-wallet figure: browser-cacheable but never via a shared proxy.
      "private"
    );
  } catch (error) {
    return handleRouteError(res, error, "GET /api/wallet/balance", "Unable to load wallet balance.");
  }
});

module.exports = router;
