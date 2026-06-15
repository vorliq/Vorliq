const express = require("express");

const { subscribe } = require("../newsletterStore");
const { logError } = require("../logger");
const { sendError } = require("../utils/apiResponse");

const router = express.Router();

// Public newsletter sign-up. Stores the email in the existing JSON storage and
// returns clear created / duplicate / validation responses.
router.post("/api/newsletter/subscribe", (req, res) => {
  try {
    const source = req.get("referer") ? "web" : "api";
    const { created, subscriber } = subscribe(req.body || {}, { source });
    return res.status(created ? 201 : 200).json({
      success: true,
      status: created ? "subscribed" : "already_subscribed",
      already_subscribed: !created,
      email: subscriber.email,
      message: created
        ? "Thanks — you're on the Vorliq list."
        : "You're already subscribed to Vorliq updates.",
    });
  } catch (error) {
    if (error.status === 400) {
      return sendError(res, 400, error.code || "VALIDATION_ERROR", error.message);
    }
    logError(`[${req.requestId || "unknown"}] POST /api/newsletter/subscribe failed: ${error.message}`);
    return sendError(res, 500, "INTERNAL_ERROR", "Unable to record your sign-up right now. Please try again later.");
  }
});

module.exports = router;
