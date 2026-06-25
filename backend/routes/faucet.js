const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");
const { logError } = require("../logger");
const { validateAddress } = require("../address");
const { getReferrer, isBonusPaid, markBonusPaid } = require("../referralStore");
const {
  isIpBanned,
  isWalletBanned,
  ipFaucetDecision,
  recordFaucetClaim,
} = require("../faucetAbuse");

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

// The client device fingerprint is a hex hash of UA + screen + timezone +
// language + canvas. Keep only hex, lower-cased, bounded — Flask validates it too.
function sanitizeFingerprint(value) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 128);
}

function handleValidationError(req, res, error) {
  if (!error.status || error.response) return false;
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

// Pay the referrer their one-time treasury bonus when a referred wallet makes its
// first faucet claim. Checks the invite relationship (a wallet only has a
// referrer if it was recorded through a real invite link), that it is not a
// self-referral, and that the bonus has not already been paid, then asks Flask to
// mint the treasury -> referrer transfer and records that it was paid so it can
// never fire twice. Never throws: the faucet claim has already succeeded and must
// not be undone by a referral-bonus hiccup.
async function payReferralBonusIfDue(referredAddress) {
  try {
    const referrer = getReferrer(referredAddress);
    if (!referrer || referrer === referredAddress || isBonusPaid(referredAddress)) return;
    const resp = await axios.post(
      `${flaskUrl}/faucet/referral-bonus`,
      { referrer_address: referrer, referred_address: referredAddress },
      { validateStatus: () => true }
    );
    if (resp.status >= 200 && resp.status < 300 && resp.data?.success === true) {
      markBonusPaid(referredAddress, resp.data?.tx_id);
    } else {
      logError(`Referral bonus not paid for ${referredAddress}: ${resp.data?.message || resp.status}`);
    }
  } catch (error) {
    logError(`Referral bonus error for ${referredAddress}: ${error.message}`);
  }
}

router.post("/api/faucet/claim", async (req, res) => {
  try {
    const walletAddress = cleanAddress(req.body?.wallet_address || req.body?.walletAddress);
    const ip = req.ip;
    // Client device fingerprint (UA + screen + timezone + language + canvas);
    // Flask rejects a repeat claim from the same device. Coarse server
    // fingerprint as a fallback if the client could not produce one.
    const deviceFp = sanitizeFingerprint(req.body?.device_fingerprint || req.body?.deviceFingerprint) || requestFingerprint(req);

    // These layers STACK ON TOP OF Flask's per-wallet 24h cooldown and device
    // fingerprint limit; none of them replaces it.

    // Layer 1: permanent admin bans.
    if (isIpBanned(ip) || isWalletBanned(walletAddress)) {
      logError(`Faucet blocked banned ip/wallet ip=${ip}`);
      return res.status(403).json({ success: false, message: "This connection or wallet has been banned from the faucet." });
    }
    // NOTE: a "wallet must be at least an hour old" gate used to live here. It was
    // the single biggest onboarding blocker — a brand-new user who creates a
    // wallet and immediately tries the faucet (the very first thing they do) was
    // turned away for an hour. It is removed deliberately: the create-and-drain
    // abuse it targeted is already bounded by the layers that remain — one IP may
    // fund at most two distinct wallets per 24h (Layer 3 below), wallet creation
    // is capped at three per hour per IP, and Flask enforces a per-wallet 24h
    // cooldown plus a device-fingerprint limit. Those cap faucet payout per IP
    // regardless of wallet age, so the age gate added friction without materially
    // changing the abuse ceiling.
    // Layer 3: one IP may fund at most two distinct wallets per 24 hours.
    const ipDecision = ipFaucetDecision(ip, walletAddress);
    if (!ipDecision.allowed) {
      res.set("Retry-After", String(ipDecision.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: "This connection has already claimed for two different wallets in the last 24 hours. Please try again tomorrow.",
      });
    }

    // Flask enforces the per-wallet cooldown, the device-fingerprint limit, and
    // the treasury checks, then issues the starter transaction.
    const response = await axios.post(
      `${flaskUrl}/faucet/claim`,
      { wallet_address: walletAddress, fingerprint_hash: deviceFp },
      { validateStatus: () => true }
    );

    // Count only a real disbursement toward the IP distinct-wallet tally.
    if (response.status >= 200 && response.status < 300 && response.data?.success === true) {
      recordFaucetClaim(ip, walletAddress, deviceFp);
      // Referral reward: if this wallet was invited through a real invite link
      // (so it has a recorded referrer), pay the referrer a one-time treasury
      // bonus on this, the referred wallet's first faucet claim. Guarded to fire
      // once, never for a self-referral, and never if no real referrer exists.
      // Best-effort: a bonus failure must never fail or roll back the claim.
      await payReferralBonusIfDue(walletAddress);
    } else if (response.status === 429) {
      // Wallet cooldown / device fingerprint: tell the client when to retry.
      if (!res.get("Retry-After")) res.set("Retry-After", "86400");
      logError(`Faucet rate-limited claim ip=${ip}`);
    } else if (/treasury/i.test(response.data?.message || "")) {
      logError(`Faucet treasury unavailable: ${response.data?.message}`);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (handleValidationError(req, res, error)) return;
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
