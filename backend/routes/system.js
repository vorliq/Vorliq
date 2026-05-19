const express = require("express");
const axios = require("axios");
const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const { publicBackupStatus } = require("./backup");
const { listActiveIncidents } = require("../incidents");
const { logError } = require("../logger");

const router = express.Router();
const execFileAsync = promisify(execFile);
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const repoRoot = path.resolve(__dirname, "..", "..");

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function publicNodeUrl() {
  const configured = process.env.VORLIQ_NODE_URL || "https://node.vorliq.org";
  return /\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configured) ? "https://node.vorliq.org" : configured;
}

async function deploymentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  if (process.env.VORLIQ_COMMIT) return process.env.VORLIQ_COMMIT;

  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.env.VORLIQ_APP_DIR || repoRoot,
      timeout: 3000,
    });
    return result.stdout.trim();
  } catch (error) {
    logError(`System self-check commit lookup failed: ${error.message}`);
    return null;
  }
}

async function safeDiagnostics() {
  try {
    const response = await axios.get(`${flaskUrl}/diagnostics`, { timeout: 5000 });
    return {
      blockchain_reachable: true,
      chain_valid: booleanOrNull(response.data?.chain_valid),
      block_height: numberOrNull(response.data?.block_height),
      pending_transactions: numberOrNull(response.data?.pending_transactions),
    };
  } catch (error) {
    logError(`System self-check diagnostics failed: ${error.message}`);
    return {
      blockchain_reachable: false,
      chain_valid: null,
      block_height: null,
      pending_transactions: null,
    };
  }
}

async function safeRegistrySummary() {
  try {
    const response = await axios.get(`${flaskUrl}/registry/summary`, { timeout: 5000 });
    const summary = response.data?.summary || {};
    return {
      registry_reachable: true,
      registry_active_node_count: numberOrNull(summary.active_node_count),
      registry_total_node_count: numberOrNull(summary.total_registered_node_count),
      registry_synced_node_count: numberOrNull(summary.synced_node_count),
    };
  } catch (error) {
    logError(`System self-check registry summary failed: ${error.message}`);
    return {
      registry_reachable: false,
      registry_active_node_count: null,
      registry_total_node_count: null,
      registry_synced_node_count: null,
    };
  }
}

router.get("/api/system/self-check", async (req, res) => {
  const [diagnostics, registry, commit] = await Promise.all([
    safeDiagnostics(),
    safeRegistrySummary(),
    deploymentCommit(),
  ]);

  let backupStatusAvailable = false;
  try {
    const backupStatus = publicBackupStatus();
    backupStatusAvailable = Boolean(backupStatus?.success);
  } catch (error) {
    logError(`System self-check backup status failed: ${error.message}`);
  }

  res.json({
    success: true,
    api_health: true,
    ...diagnostics,
    backup_status_available: backupStatusAvailable,
    ...registry,
    active_incident_count: listActiveIncidents().length,
    deployment_commit: commit,
    public_node_url: publicNodeUrl(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
