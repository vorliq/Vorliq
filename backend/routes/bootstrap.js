const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { canonicalStringify, sha256Hex } = require("../canonicalJson");
const { logError } = require("../logger");
const { verifySnapshot } = require("../snapshot");
const { getAuditSnapshot, sanitizePublicPayload } = require("./audit");
const { loadStorageHealth } = require("./storage");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const repoRoot = path.resolve(__dirname, "..", "..");
const DEFAULT_PUBLIC_NODE = "https://vorliq.org";
const FORBIDDEN_PUBLIC_PATTERNS = [
  /PRIVATE KEY/i,
  /BEGIN [A-Z ]*PRIVATE KEY/i,
  /ADMIN_TOKEN/i,
  /VORLIQ_SNAPSHOT_PRIVATE_KEY/i,
  /SERVER_SSH_KEY/i,
  /password/i,
  /admin[_-]?token/i,
  /private[_-]?key/i,
  /raw[_-]?ip/i,
  /ip_address/i,
  /server[_-]?path/i,
  /user[_-]?agent/i,
  /\/home\/vorliq/i,
  /[A-Za-z]:\\Users\\/i,
  /ssh-(rsa|ed25519)/i,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
];

function publicNodeUrl() {
  return String(process.env.VORLIQ_PUBLIC_NODE_URL || DEFAULT_PUBLIC_NODE).replace(/\/+$/, "");
}

function absoluteUrl(baseUrl, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function hasForbiddenMarker(value) {
  let serialized = "";
  try {
    serialized = JSON.stringify(value || {});
  } catch (error) {
    return true;
  }
  return FORBIDDEN_PUBLIC_PATTERNS.some((pattern) => pattern.test(serialized));
}

function failIfUnsafe(payload, label) {
  if (hasForbiddenMarker(payload)) {
    const error = new Error(`${label} contains forbidden public markers.`);
    error.publicSafeFailure = true;
    throw error;
  }
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function markerDataDir() {
  return process.env.VORLIQ_DATA_DIR || path.join(repoRoot, "blockchain", "data");
}

function safeBootstrapMarker() {
  const markerPath = path.join(markerDataDir(), "bootstrap.json");
  try {
    if (!fs.existsSync(markerPath)) {
      return {
        has_run: false,
        message: "No verified chain bootstrap marker has been recorded.",
      };
    }
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return sanitizePublicPayload({
      has_run: true,
      trusted_node: marker.trusted_node || null,
      bootstrap_time: marker.bootstrap_time || null,
      chain_height: numberOrNull(marker.chain_height),
      latest_block_hash: marker.latest_block_hash || null,
      snapshot_hash: marker.snapshot_hash || null,
      audit_chain_hash: marker.audit_chain_hash || null,
      mode: marker.mode || "unknown",
    });
  } catch (error) {
    return {
      has_run: false,
      message: "Bootstrap marker exists but could not be read safely.",
    };
  }
}

async function flaskGet(pathname, timeout = 7000) {
  const response = await axios.get(`${flaskUrl}${pathname}`, { timeout });
  return response.data || {};
}

async function safeCall(label, fn, fallback = null) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    logError(`Bootstrap ${label} lookup failed: ${error.message}`);
    return { ok: false, value: fallback, error };
  }
}

async function buildBootstrapPackage(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const sourceNode = publicNodeUrl();
  const [snapshotResult, auditSnapshot] = await Promise.all([
    verifySnapshot({ generatedAt, includeReadinessStatus: false }),
    getAuditSnapshot(generatedAt),
  ]);
  const snapshot = snapshotResult.snapshot || {};
  const signature = snapshot.signature || {};
  const manifest = sanitizePublicPayload(auditSnapshot.manifest || {});
  const chainExport = (manifest.exports || []).find((item) => item.name === "chain") || {};
  const auditManifestUrl = absoluteUrl(
    sourceNode,
    `/api/audit/manifest?export_timestamp=${encodeURIComponent(manifest.export_timestamp || generatedAt)}`
  );
  const chainExportUrl = absoluteUrl(sourceNode, chainExport.endpoint || "/api/audit/chain");
  const payload = sanitizePublicPayload({
    success: true,
    package_version: 1,
    generated_at: generatedAt,
    source_node_url: sourceNode,
    deployment_commit: snapshot.deployment_commit || manifest.deployment_commit || null,
    snapshot_hash: signature.snapshot_hash || null,
    snapshot_public_key_id: signature.public_key_id || null,
    snapshot_signature_status: snapshotResult.signature_status || "unknown",
    snapshot_signature_verified: snapshotResult.signature_verified === true,
    chain_height: numberOrZero(snapshot.chain_height ?? manifest.chain_height),
    latest_block_hash: snapshot.latest_block_hash || manifest.latest_block_hash || null,
    confirmed_transaction_count: numberOrZero(snapshot.confirmed_transaction_count),
    audit_manifest_hash: sha256Hex(canonicalStringify(manifest)),
    audit_chain_hash: chainExport.sha256 || null,
    chain_export_url: chainExportUrl,
    snapshot_verify_url: absoluteUrl(sourceNode, "/api/snapshot/verify"),
    audit_manifest_url: auditManifestUrl,
    bootstrap_warning:
      "Dry-run first. Write mode is for a new node or a node whose data has been backed up and intentionally replaced.",
  });
  failIfUnsafe(payload, "Bootstrap package");
  return payload;
}

async function buildBootstrapStatus() {
  const [chainResult, diagnosticsResult, storageResult, indexResult, snapshotResult, auditResult, packageResult] =
    await Promise.all([
      safeCall("chain summary", () => flaskGet("/chain/summary"), {}),
      safeCall("diagnostics", () => flaskGet("/diagnostics"), {}),
      safeCall("storage health", loadStorageHealth, {}),
      safeCall("index health", () => flaskGet("/indexes/health"), {}),
      safeCall("snapshot verification", () => verifySnapshot({ includeReadinessStatus: false }), {}),
      safeCall("audit export", () => getAuditSnapshot(), {}),
      safeCall("bootstrap package", () => buildBootstrapPackage(), {}),
    ]);
  const chainSummary = chainResult.value?.summary || chainResult.value || {};
  const diagnostics = diagnosticsResult.value || {};
  const storageHealth = storageResult.value || {};
  const indexHealth = indexResult.value || {};
  const marker = safeBootstrapMarker();
  const payload = sanitizePublicPayload({
    success: true,
    chain_height: numberOrNull(chainSummary.block_height ?? chainSummary.chain_height ?? diagnostics.block_height),
    latest_block_hash:
      chainSummary.last_block_hash ||
      chainSummary.latest_block_hash ||
      diagnostics.last_block_hash ||
      diagnostics.latest_block_hash ||
      null,
    chain_valid: chainSummary.chain_valid === true || diagnostics.chain_valid === true,
    snapshot_verify_available: snapshotResult.ok && snapshotResult.value?.success === true,
    audit_export_available: auditResult.ok && auditResult.value?.manifest?.success === true,
    bootstrap_package_available: packageResult.ok && packageResult.value?.success === true,
    recommended_trusted_node: DEFAULT_PUBLIC_NODE,
    last_bootstrap_marker: marker,
    storage_backend: storageHealth.storage_backend || storageHealth.backend || "json",
    indexes_status: {
      available: indexResult.ok && indexHealth.success !== false,
      status: indexHealth.status || "unknown",
      valid: indexHealth.valid === true,
      index_chain_match: indexHealth.index_chain_match === true || indexHealth.chain_match === true,
      rebuild_needed: indexHealth.rebuild_needed === true,
      chain_height: numberOrNull(indexHealth.chain_height),
      latest_block_hash: indexHealth.latest_block_hash || null,
    },
  });
  failIfUnsafe(payload, "Bootstrap status");
  return payload;
}

router.get("/api/bootstrap/package", async (req, res) => {
  try {
    res.json(await buildBootstrapPackage());
  } catch (error) {
    logError(`GET /api/bootstrap/package failed: ${error.message}`);
    res.status(error.publicSafeFailure ? 500 : 503).json({
      success: false,
      message: "Verified bootstrap package is currently unavailable.",
    });
  }
});

router.get("/api/bootstrap/status", async (req, res) => {
  try {
    res.json(await buildBootstrapStatus());
  } catch (error) {
    logError(`GET /api/bootstrap/status failed: ${error.message}`);
    res.status(error.publicSafeFailure ? 500 : 503).json({
      success: false,
      message: "Bootstrap status is currently unavailable.",
    });
  }
});

module.exports = router;
module.exports.DEFAULT_PUBLIC_NODE = DEFAULT_PUBLIC_NODE;
module.exports.FORBIDDEN_PUBLIC_PATTERNS = FORBIDDEN_PUBLIC_PATTERNS;
module.exports.buildBootstrapPackage = buildBootstrapPackage;
module.exports.buildBootstrapStatus = buildBootstrapStatus;
module.exports.hasForbiddenMarker = hasForbiddenMarker;
