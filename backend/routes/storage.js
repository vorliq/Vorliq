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
    storage_adapter_interface_available: Boolean(blockchainHealth.storage_adapter_interface_available),
    storage_backend: blockchainHealth.storage_backend || "json",
    active_storage_adapter: blockchainHealth.active_storage_adapter || blockchainHealth.storage_backend || "json",
    postgres_adapter_available: Boolean(blockchainHealth.postgres_adapter_available),
    postgres_adapter_enabled: Boolean(blockchainHealth.postgres_adapter_enabled),
    postgres_active: Boolean(blockchainHealth.postgres_active),
    postgres_write_mode: blockchainHealth.postgres_write_mode || "disabled",
    postgres_runtime_blocked_in_production: Boolean(blockchainHealth.postgres_runtime_blocked_in_production),
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
