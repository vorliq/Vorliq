const express = require("express");
const axios = require("axios");
const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

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

function safeChainSummary(data) {
  const summary = data?.summary || data || {};
  return {
    available: Boolean(data?.success !== false && Object.keys(summary).length),
    block_height: numberOrNull(summary.block_height),
    total_blocks: numberOrNull(summary.total_blocks),
    total_transactions: numberOrNull(summary.total_transactions),
    total_issued: numberOrNull(summary.total_issued),
    current_difficulty: numberOrNull(summary.current_difficulty),
    current_mining_reward: numberOrNull(summary.current_mining_reward),
    last_block_hash: summary.last_block_hash || null,
    last_block_timestamp: summary.last_block_timestamp || null,
    chain_valid: booleanOrNull(summary.chain_valid),
  };
}

function safeDiagnostics(data) {
  const rawNodeUrl = data?.node_url || "https://vorliq.org";
  const publicNodeUrl = /\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(rawNodeUrl) ? "https://vorliq.org" : rawNodeUrl;

  return {
    available: Boolean(data?.success),
    node_url: publicNodeUrl,
    block_height: numberOrNull(data?.block_height),
    chain_valid: booleanOrNull(data?.chain_valid),
    pending_transactions: numberOrNull(data?.pending_transactions),
    known_peers: numberOrNull(data?.known_peers),
    active_registry_nodes: numberOrNull(data?.active_registry_nodes),
    uptime_seconds: numberOrNull(data?.uptime_seconds),
    total_vlq_in_circulation: numberOrNull(data?.total_vlq_in_circulation),
    current_mining_reward: numberOrNull(data?.current_mining_reward),
    last_block_hash: data?.last_block_hash || null,
    last_block_timestamp: data?.last_block_timestamp || null,
  };
}

async function getCommitHash() {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.env.VORLIQ_APP_DIR || repoRoot,
    });
    return result.stdout.trim();
  } catch (error) {
    logError(`Network manifest commit lookup failed: ${error.message}`);
    return null;
  }
}

async function getJson(pathname) {
  const response = await axios.get(`${flaskUrl}${pathname}`, { timeout: 5000 });
  return response.data;
}

router.get("/api/network/manifest", async (req, res) => {
  const [commitHash, chainResult, diagnosticsResult] = await Promise.allSettled([
    getCommitHash(),
    getJson("/chain/summary"),
    getJson("/diagnostics"),
  ]);

  const activeIncidents = listActiveIncidents();
  const sdkVersion = (() => {
    try {
      return require("../../sdk/package.json").version;
    } catch (error) {
      return "unknown";
    }
  })();
  const releaseMetadata = (() => {
    try {
      const metadata = require("../../version.json");
      return {
        current_version: metadata.current_version,
        release_channel: metadata.release_channel,
        api_version: metadata.api_version,
        recommended_node_version: metadata.recommended_node_version,
        metadata_url: "https://vorliq.org/api/version/metadata",
        changelog_url: "https://vorliq.org/api/changelog",
        roadmap_url: "https://vorliq.org/api/roadmap",
      };
    } catch (error) {
      return {
        current_version: "unknown",
        release_channel: "unknown",
      };
    }
  })();

  res.json({
    success: true,
    project: {
      name: "Vorliq",
      version: "1.0.0",
      description: "An experimental open-source community blockchain platform built on its own VLQ network.",
    },
    urls: {
      website: "https://vorliq.org",
      status: "https://status.vorliq.org",
      docs: "https://vorliq.github.io/Vorliq",
      github: "https://github.com/vorliq/Vorliq",
    },
    deployment: {
      commit_hash: commitHash.status === "fulfilled" ? commitHash.value : null,
    },
    chain_summary:
      chainResult.status === "fulfilled"
        ? safeChainSummary(chainResult.value)
        : { available: false },
    diagnostics:
      diagnosticsResult.status === "fulfilled"
        ? safeDiagnostics(diagnosticsResult.value)
        : { available: false },
    available_public_api_groups: [
      "health",
      "network_manifest",
      "chain_summary",
      "paginated_blocks",
      "address_transactions",
      "wallet",
      "transactions",
      "mining",
      "lending",
      "exchange",
      "governance",
      "treasury",
      "forum",
      "chat",
      "achievements",
      "incidents",
      "reports",
      "backup_status",
      "deployment",
      "developer_sdk",
    ],
    sdk: {
      supported_version: sdkVersion,
      docs_url: "https://github.com/vorliq/Vorliq/tree/main/sdk#readme",
    },
    release: releaseMetadata,
    incidents: {
      active: activeIncidents.length > 0,
      active_count: activeIncidents.length,
    },
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
