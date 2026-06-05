const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");
const { logError } = require("../logger");
const { validateAddress } = require("../address");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const SYSTEM_ADDRESSES = new Set(["SYSTEM", "VORLIQ_TREASURY", "LENDING_POOL"]);

function cleanAddress(value) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error("wallet address is required");
    error.status = 400;
    throw error;
  }
  const address = value.replace(/\u0000/g, "").trim();
  if (address.length > 160) {
    const error = new Error("wallet address must be 160 characters or fewer");
    error.status = 400;
    throw error;
  }
  if (SYSTEM_ADDRESSES.has(address)) {
    const error = new Error("system-controlled addresses cannot claim starter VLQ");
    error.status = 400;
    error.abuseCode = "blocked_system_address";
    throw error;
  }
  const result = validateAddress(address, { label: "wallet address", strictLength: true });
  if (!result.valid) {
    const error = new Error(result.errors[0]);
    error.status = 400;
    throw error;
  }
  return address;
}

function requestFingerprint(req) {
  return crypto
    .createHash("sha256")
    .update(`${req.ip || ""}:${req.get("user-agent") || ""}`)
    .digest("hex");
}

function handleValidationError(req, res, error) {
  if (!error.status) return false;
  if (error.abuseCode) {
    logError(`Faucet ${error.abuseCode}: ${error.message}`);
  }
  res.status(error.status).json({ success: false, message: error.message });
  return true;
}

router.get("/api/faucet/summary", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/faucet/summary`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/faucet/summary", "Unable to load faucet summary.");
  }
});

router.post("/api/faucet/claim", async (req, res) => {
  try {
    const walletAddress = cleanAddress(req.body?.wallet_address || req.body?.walletAddress);
    const fingerprintHash = requestFingerprint(req);
    const response = await axios.post(`${flaskUrl}/faucet/claim`, {
      wallet_address: walletAddress,
      fingerprint_hash: fingerprintHash,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(req, res, error)) return;
    const message = error.response?.data?.message || "";
    if (error.response?.status === 429) {
      logError(`Faucet rate-limited claim fingerprint=${requestFingerprint(req)}`);
    }
    if (/treasury/i.test(message)) {
      logError(`Faucet treasury unavailable: ${message}`);
    }
    return handleRouteError(res, error, "POST /api/faucet/claim", "Unable to submit faucet claim.");
  }
});

router.get("/api/faucet/claims", async (req, res) => {
  try {
    const address = cleanAddress(String(req.query.address || ""));
    const response = await axios.get(`${flaskUrl}/faucet/claims`, { params: { address } });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(req, res, error)) return;
    return handleRouteError(res, error, "GET /api/faucet/claims", "Unable to load faucet claims.");
  }
});

router.get("/api/faucet/recent", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/faucet/recent`, { params: paginationParams(req, 25) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(req, res, error)) return;
    return handleRouteError(res, error, "GET /api/faucet/recent", "Unable to load recent faucet claims.");
  }
});

module.exports = {
  router,
  requestFingerprint,
};
