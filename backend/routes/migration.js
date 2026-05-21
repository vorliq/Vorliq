const express = require("express");

const adminAuth = require("../middleware/adminAuth");
const { buildMigrationReadiness } = require("../migrationReadiness");
const { sendError } = require("../utils/apiResponse");
const { logError } = require("../logger");

const router = express.Router();

router.get("/api/migration/readiness", async (req, res) => {
  try {
    return res.json(await buildMigrationReadiness());
  } catch (error) {
    logError(`GET /api/migration/readiness failed: ${error.message}`);
    return sendError(res, 503, "MIGRATION_READINESS_UNAVAILABLE", "Migration readiness is currently unavailable.");
  }
});

router.get("/api/admin/migration/readiness", adminAuth, async (req, res) => {
  try {
    return res.json(await buildMigrationReadiness({ deep: true }));
  } catch (error) {
    logError(`GET /api/admin/migration/readiness failed: ${error.message}`);
    return sendError(res, 503, "MIGRATION_READINESS_UNAVAILABLE", "Admin migration readiness is currently unavailable.");
  }
});

module.exports = router;
