const express = require("express");
const axios = require("axios");

const { handleRouteError } = require("./routeError");
const { getReferrer, recordReferral, invitedBy, referralEarnings } = require("../referralStore");
const { logInfo } = require("../logger");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

function cleanAddress(value) {
  return String(value || "")
    .replace(/\0/g, "")
    .trim();
}

// An address "exists on the chain" if it has any on-chain transaction history
// (sent or received). A fabricated or never-used address has none, so this keeps
// the invite graph honest without needing to trust the caller. Returns true on a
// genuine match, false otherwise. A Flask outage is surfaced to the caller as an
// error (handled by the route) rather than silently treated as "exists".
async function referrerExistsOnChain(address) {
  const response = await axios.get(`${flaskUrl}/chain/address`, {
    params: { address, limit: 1, offset: 0 },
    timeout: 8000,
  });
  const data = response.data || {};
  const count = Number(data.transaction_count ?? data.total ?? 0);
  return Number.isFinite(count) && count > 0;
}

// Record that the wallet that just signed up was invited by a referrer. Called
// by the new member's browser right after wallet creation, with the referrer
// taken from the invite link they followed. The link is self-contained (the
// referrer is in the URL), so this works no matter which device or session the
// recipient opens it on. The relationship is immutable once set.
router.post("/api/invites/record", async (req, res) => {
  try {
    const member = cleanAddress(req.body?.wallet_address || req.body?.walletAddress);
    const referrer = cleanAddress(req.body?.referrer_address || req.body?.referrerAddress);

    if (!member || !referrer) {
      return res.status(400).json({ success: false, message: "A wallet address and a referrer address are required." });
    }
    if (member.length > 160 || referrer.length > 160) {
      return res.status(400).json({ success: false, message: "Address is too long." });
    }
    if (member === referrer) {
      return res.status(400).json({ success: false, message: "You cannot invite yourself." });
    }

    // If this member already has a referrer, return it without re-validating —
    // the relationship is first-write-wins and immutable.
    const already = getReferrer(member);
    if (already) {
      return res.json({ success: true, recorded: false, referrer: already, already_recorded: true });
    }

    const exists = await referrerExistsOnChain(referrer);
    if (!exists) {
      return res.status(400).json({
        success: false,
        code: "REFERRER_NOT_ON_CHAIN",
        message: "The referrer is not an active member on the chain yet.",
      });
    }

    const result = recordReferral(member, referrer);
    if (result.recorded) {
      logInfo(`Invite recorded: ${member} was invited by ${referrer}`);
    }
    return res.json({
      success: true,
      recorded: Boolean(result.recorded),
      referrer: result.referrer,
      already_recorded: Boolean(result.alreadyRecorded),
    });
  } catch (error) {
    return handleRouteError(res, error, "POST /api/invites/record", "Unable to record the invite right now.");
  }
});

// Public invite summary for any address: who invited them (if anyone) and the
// members they have invited. Surfaced on the member's own Settings and on any
// public profile page.
router.get("/api/invites/summary", (req, res) => {
  try {
    const address = cleanAddress(req.query.address);
    if (!address) {
      return res.status(400).json({ success: false, message: "address is required." });
    }
    const invited = invitedBy(address);
    return res.json({
      success: true,
      address,
      referrer: getReferrer(address),
      invited_count: invited.length,
      invited,
      earnings: referralEarnings(address),
    });
  } catch (error) {
    return handleRouteError(res, error, "GET /api/invites/summary", "Unable to load invite summary.");
  }
});

module.exports = router;
