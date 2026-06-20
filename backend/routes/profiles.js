const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const AVATAR_STYLES = new Set(["gradient", "green", "cyan", "blue", "gold", "purple"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function reject(res, message) {
  return res.status(400).json({ success: false, message });
}

// Local validation failures carry a 400 status so the route catch can tell them
// apart from a genuine upstream failure (which has either an axios `.response`
// or, for a connection drop, neither status nor response). Without this, a
// `!error.response` guard would catch a connection failure to Flask and leak
// the raw "connect ECONNREFUSED host:port" string to the client at HTTP 400.
function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function safeText(value, field, max, required = false) {
  const normalized = text(value);
  if (required && !normalized) throw badRequest(`${field} is required.`);
  if (normalized.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`);
  if (/[<>]/.test(normalized) || /javascript:/i.test(normalized) || /data:/i.test(normalized)) {
    throw badRequest(`${field} contains unsafe markup.`);
  }
  return normalized;
}

function safeUrl(value, field) {
  const normalized = safeText(value, field, 240);
  if (!normalized) return "";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (error) {
    throw badRequest(`${field} must be a safe http or https URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw badRequest(`${field} must be a safe http or https URL.`);
  }
  return normalized;
}

function validateProfileBody(req, res, next) {
  try {
    const body = req.body || {};
    const displayName = safeText(body.display_name || body.displayName, "display name", 32, true);
    if (displayName.length < 3) throw new Error("display name must be at least 3 characters.");
    const walletAddress = safeText(body.wallet_address || body.walletAddress, "wallet address", 160, true);
    const avatarStyle = safeText(body.avatar_style || body.avatarStyle || "gradient", "avatar style", 24) || "gradient";
    if (!AVATAR_STYLES.has(avatarStyle)) throw new Error("avatar style is not valid.");

    req.body = {
      wallet_address: walletAddress,
      display_name: displayName,
      bio: safeText(body.bio, "bio", 300),
      location: safeText(body.location, "location", 80),
      country: safeText(body.country, "country", 80),
      avatar_style: avatarStyle,
      website: safeUrl(body.website, "website"),
      x_link: safeUrl(body.x_link || body.xLink, "X link"),
      telegram_link: safeUrl(body.telegram_link || body.telegramLink, "Telegram link"),
      discord_name: safeText(body.discord_name || body.discordName, "Discord name", 80),
    };
    return next();
  } catch (error) {
    return reject(res, error.message);
  }
}

router.post("/api/profiles/profile", validateProfileBody, async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/profiles/profile`, req.body);
    return res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/profiles/profile", "Unable to save profile.");
  }
});

router.get("/api/profiles/profile", async (req, res) => {
  try {
    const address = safeText(req.query.address, "address", 160, true);
    const response = await axios.get(`${flaskUrl}/profiles/profile`, { params: { address } });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return reject(res, error.message);
    return handleRouteError(res, error, "GET /api/profiles/profile", "Unable to load profile.");
  }
});

router.get("/api/profiles", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/profiles`, { params: paginationParams(req) });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return reject(res, error.message);
    return handleRouteError(res, error, "GET /api/profiles", "Unable to load profiles.");
  }
});

router.get("/api/profiles/search", async (req, res) => {
  try {
    const q = safeText(req.query.q, "query", 80, true);
    const response = await axios.get(`${flaskUrl}/profiles/search`, {
      params: { ...paginationParams(req), q },
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return reject(res, error.message);
    return handleRouteError(res, error, "GET /api/profiles/search", "Unable to search profiles.");
  }
});

router.get("/api/profiles/top", async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit || "20", 10);
    if (!Number.isFinite(rawLimit) || rawLimit <= 0) return reject(res, "limit must be greater than zero.");
    const response = await axios.get(`${flaskUrl}/profiles/top`, {
      params: { limit: Math.min(rawLimit, 100) },
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/profiles/top", "Unable to load top profiles.");
  }
});

router.post("/api/profiles/verify/challenge", async (req, res) => {
  try {
    const address = safeText(req.body?.address || req.body?.wallet_address || req.body?.walletAddress, "wallet address", 160, true);
    const response = await axios.post(`${flaskUrl}/profiles/verify/challenge`, { address });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return reject(res, error.message);
    return handleRouteError(res, error, "POST /api/profiles/verify/challenge", "Unable to create verification challenge.");
  }
});

router.post("/api/profiles/verify/submit", async (req, res) => {
  try {
    const body = req.body || {};
    const payload = {
      address: safeText(body.address || body.wallet_address || body.walletAddress, "wallet address", 160, true),
      public_key: safeText(body.public_key || body.publicKey, "public key", 3000, true),
      signature: safeText(body.signature, "signature", 512, true),
      message: safeText(body.message, "verification message", 220, true),
    };
    const response = await axios.post(`${flaskUrl}/profiles/verify/submit`, payload);
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) return reject(res, error.message);
    return handleRouteError(res, error, "POST /api/profiles/verify/submit", "Unable to verify profile ownership.");
  }
});

module.exports = router;
