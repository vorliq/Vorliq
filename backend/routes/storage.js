const express = require("express");
const axios = require("axios");

const adminAuth = require("../middleware/adminAuth");
const { analyticsFile } = require("../analytics");
const { incidentsFilePath } = require("../incidents");
const { backendStorageHealth } = require("../jsonStore");
const { logError } = require("../logger");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

function summarize(blockchainHealth, backendHealth) {
  const files = [...(blockchainHealth.files || []), ...(backendHealth.files || [])];
  const errors = files.filter((file) => file.status === "error").length;
  const warnings = files.filter((file) => file.status === "warning").length;
  return {
    success: true,
    overall_status: errors ? "error" : warnings ? "warning" : "ok",
    critical_files_ok: files.filter((file) => file.status === "ok").length,
    warnings_count: warnings,
    errors_count: errors,
    warning_count: warnings,
    error_count: errors,
    backup_available: Boolean(blockchainHealth.backup_available || backendHealth.backup_available),
    files,
  };
}

async function loadStorageHealth() {
  const [blockchainResponse, backendHealth] = await Promise.all([
    axios.get(`${flaskUrl}/storage/health`, { timeout: 5000 }),
    Promise.resolve(backendStorageHealth([analyticsFile(), incidentsFilePath()])),
  ]);
  return summarize(blockchainResponse.data || {}, backendHealth);
}

router.get("/api/storage/health", async (req, res) => {
  try {
    res.json(await loadStorageHealth());
  } catch (error) {
    logError(`GET /api/storage/health failed: ${error.message}`);
    res.status(503).json({
      success: false,
      overall_status: "error",
      message: "Storage health is currently unavailable.",
    });
  }
});

router.get("/api/admin/storage", adminAuth, async (req, res) => {
  try {
    res.json(await loadStorageHealth());
  } catch (error) {
    logError(`GET /api/admin/storage failed: ${error.message}`);
    res.status(503).json({
      success: false,
      overall_status: "error",
      message: "Storage health is currently unavailable.",
    });
  }
});

module.exports = router;
module.exports.loadStorageHealth = loadStorageHealth;
