const express = require("express");

const { getLatestSnapshot, verifySnapshot } = require("../snapshot");
const { logError } = require("../logger");

const router = express.Router();

router.get("/api/snapshot/latest", async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    res.json({ success: true, snapshot });
  } catch (error) {
    logError(`GET /api/snapshot/latest failed: ${error.message}`);
    res.status(503).json({
      success: false,
      message: "Snapshot is currently unavailable.",
    });
  }
});

router.get("/api/snapshot/verify", async (req, res) => {
  try {
    res.json(await verifySnapshot());
  } catch (error) {
    logError(`GET /api/snapshot/verify failed: ${error.message}`);
    res.status(503).json({
      success: false,
      verified: false,
      signature_verified: false,
      signature_enabled: false,
      snapshot: null,
      checks: [],
      warnings: [],
      errors: ["Snapshot verification is currently unavailable."],
    });
  }
});

module.exports = router;
