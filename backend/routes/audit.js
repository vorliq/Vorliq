const express = require("express");
const axios = require("axios");
const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const { canonicalStringify, sha256Hex } = require("../canonicalJson");
const { listActiveIncidents } = require("../incidents");
const { logError } = require("../logger");
const { loadStorageHealth } = require("./storage");

const router = express.Router();
const execFileAsync = promisify(execFile);
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const repoRoot = path.resolve(__dirname, "..", "..");
const AUDIT_EXPORTS = ["chain", "treasury", "governance", "lending", "exchange", "registry"];
const SNAPSHOT_TTL_MS = Number(process.env.AUDIT_SNAPSHOT_TTL_MS || 30000);
const FORBIDDEN_KEY_FRAGMENTS = ["private_key", "password", "admin_token", "server_path", "raw_ip", "ssh_key"];
const FORBIDDEN_VALUE_PATTERNS = [/BEGIN PRIVATE KEY/gi, /PRIVATE KEY/gi, /ADMIN_TOKEN/gi, /\/home\/vorliq/gi, /ssh-/gi];

let cachedSnapshot = null;

function sortRecords(records, keys) {
  if (!Array.isArray(records)) return [];
  return [...records].sort((a, b) => {
    for (const key of keys) {
      const av = a?.[key];
      const bv = b?.[key];
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    }
    return canonicalStringify(a).localeCompare(canonicalStringify(b));
  });
}

function sanitizePublicPayload(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizePublicPayload);
  }
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((result, key) => {
      const lowered = key.toLowerCase();
      if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
        return result;
      }
      result[key] = sanitizePublicPayload(value[key]);
      return result;
    }, {});
  }
  if (typeof value === "string") {
    return FORBIDDEN_VALUE_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
  }
  return value;
}

async function getCommitHash() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  if (process.env.VORLIQ_COMMIT) return process.env.VORLIQ_COMMIT;
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.env.VORLIQ_APP_DIR || repoRoot,
    });
    return result.stdout.trim();
  } catch (error) {
    logError(`Audit commit lookup failed: ${error.message}`);
    return null;
  }
}

async function getFlaskAuditExport(name) {
  const response = await axios.get(`${flaskUrl}/audit/${name}`, { timeout: 10000 });
  return response.data || {};
}

function normalizeExport(name, payload, exportTimestamp) {
  const sanitized = sanitizePublicPayload(payload || {});
  const common = {
    ...sanitized,
    success: true,
    audit_schema_version: 1,
    export_type: name,
    network_name: "Vorliq",
    export_timestamp: exportTimestamp,
  };

  if (name === "chain") {
    return {
      ...common,
      blocks: sortRecords(common.blocks || [], ["index", "timestamp", "hash"]),
    };
  }
  if (name === "treasury") {
    return {
      ...common,
      treasury_ledger: sortRecords(common.treasury_ledger || [], ["block_index", "transaction_index", "tx_id", "timestamp"]),
      treasury_proposals: sortRecords(common.treasury_proposals || [], ["created_at", "proposal_id"]),
      payout_statuses: sortRecords(common.payout_statuses || [], ["proposal_id"]),
    };
  }
  if (name === "governance") {
    return {
      ...common,
      governance_proposals: sortRecords(common.governance_proposals || [], ["created_at", "proposal_id"]),
      rule_change_history: sortRecords(common.rule_change_history || [], ["applied_at", "proposal_id"]),
      public_vote_weights: sortRecords(common.public_vote_weights || [], ["proposal_id"]),
    };
  }
  if (name === "lending") {
    return { ...common, loans: sortRecords(common.loans || [], ["timestamp", "loan_id"]) };
  }
  if (name === "exchange") {
    return { ...common, offers: sortRecords(common.offers || [], ["timestamp", "offer_id"]) };
  }
  if (name === "registry") {
    return { ...common, nodes: sortRecords(common.nodes || [], ["node_url", "display_name"]) };
  }
  return common;
}

async function buildAuditSnapshot(exportTimestamp = new Date().toISOString()) {
  const exportResults = await Promise.all(AUDIT_EXPORTS.map((name) => getFlaskAuditExport(name)));
  const exportsByName = AUDIT_EXPORTS.reduce((result, name, index) => {
    result[name] = normalizeExport(name, exportResults[index], exportTimestamp);
    return result;
  }, {});

  const [commitHash, storageHealth] = await Promise.all([
    getCommitHash(),
    loadStorageHealth().catch((error) => {
      logError(`Audit storage health lookup failed: ${error.message}`);
      return { overall_status: "unknown" };
    }),
  ]);

  const chainExport = exportsByName.chain;
  const registryExport = exportsByName.registry;
  const manifestExports = AUDIT_EXPORTS.map((name) => ({
    name,
    endpoint: `/api/audit/${name}?export_timestamp=${encodeURIComponent(exportTimestamp)}`,
    sha256: sha256Hex(canonicalStringify(exportsByName[name])),
  }));

  const manifest = {
    success: true,
    audit_schema_version: 1,
    export_type: "manifest",
    network_name: "Vorliq",
    website: "https://vorliq.org",
    public_node_url: process.env.VORLIQ_PUBLIC_NODE_URL || "https://vorliq.org",
    export_timestamp: exportTimestamp,
    deployment_commit: commitHash,
    chain_height: Math.max(Number(chainExport.block_count || 0) - 1, 0),
    latest_block_hash: chainExport.latest_block_hash || null,
    storage_health_status: storageHealth.overall_status || "unknown",
    active_node_count: registryExport.summary?.active_node_count ?? 0,
    active_incident_count: listActiveIncidents().length,
    exports: manifestExports,
  };

  return {
    createdAt: Date.now(),
    manifest,
    exportsByName,
  };
}

async function getAuditSnapshot(exportTimestamp = null) {
  const cachedTimestamp = cachedSnapshot?.manifest?.export_timestamp;
  if (
    cachedSnapshot &&
    (!exportTimestamp || cachedTimestamp === exportTimestamp) &&
    Date.now() - cachedSnapshot.createdAt < SNAPSHOT_TTL_MS
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = await buildAuditSnapshot(exportTimestamp || undefined);
  return cachedSnapshot;
}

router.get("/api/audit/manifest", async (req, res) => {
  try {
    const snapshot = await getAuditSnapshot();
    res.json(snapshot.manifest);
  } catch (error) {
    logError(`GET /api/audit/manifest failed: ${error.message}`);
    res.status(503).json({ success: false, message: "Audit manifest is currently unavailable." });
  }
});

for (const name of AUDIT_EXPORTS) {
  router.get(`/api/audit/${name}`, async (req, res) => {
    try {
      const requestedTimestamp = typeof req.query.export_timestamp === "string" ? req.query.export_timestamp : null;
      const snapshot = await getAuditSnapshot(requestedTimestamp);
      res.json(snapshot.exportsByName[name]);
    } catch (error) {
      logError(`GET /api/audit/${name} failed: ${error.message}`);
      res.status(503).json({ success: false, message: `${name} audit export is currently unavailable.` });
    }
  });
}

module.exports = router;
module.exports.AUDIT_EXPORTS = AUDIT_EXPORTS;
module.exports.buildAuditSnapshot = buildAuditSnapshot;
module.exports.canonicalStringify = canonicalStringify;
module.exports.sha256Hex = sha256Hex;
module.exports.sanitizePublicPayload = sanitizePublicPayload;
