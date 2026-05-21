const express = require("express");

const adminAuth = require("../middleware/adminAuth");
const { buildReadiness } = require("../readiness");
const { sendError } = require("../utils/apiResponse");
const { logError } = require("../logger");

const router = express.Router();

router.get("/api/readiness", async (req, res) => {
  try {
    return res.json(await buildReadiness());
  } catch (error) {
    logError(`GET /api/readiness failed: ${error.message}`);
    return sendError(res, 500, "READINESS_UNAVAILABLE", "Production readiness is currently unavailable.");
  }
});

router.get("/api/admin/readiness", adminAuth, async (req, res) => {
  try {
    return res.json(await buildReadiness({ deep: true }));
  } catch (error) {
    logError(`GET /api/admin/readiness failed: ${error.message}`);
    return sendError(res, 500, "READINESS_UNAVAILABLE", "Admin readiness is currently unavailable.");
  }
});

module.exports = router;
