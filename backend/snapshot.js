const axios = require("axios");

const { canonicalStringify, sha256Hex } = require("./canonicalJson");
const { buildAuditSnapshot, sanitizePublicPayload } = require("./routes/audit");
const { buildNetworkManifest, hashNetworkManifest } = require("./routes/manifest");
const { loadStorageHealth } = require("./routes/storage");
const { listActiveIncidents } = require("./incidents");
const { logError } = require("./logger");
const { signingMetadata, snapshotHash, verifySnapshotSignature } = require("./snapshotSigner");

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const SNAPSHOT_TTL_MS = Number(process.env.SNAPSHOT_TTL_MS || 60000);
const PUBLIC_URL = "https://vorliq.org";
const HASH_KEYS = [
  "chain_summary",
  "latest_block",
  "transactions_index_summary",
  "treasury_summary",
  "governance_summary",
  "lending_summary",
  "exchange_summary",
  "registry_summary",
  "audit_manifest",
  "network_manifest",
];
const FORBIDDEN_SECRET_PATTERNS = [
  /PRIVATE KEY/i,
  /BEGIN [A-Z ]*PRIVATE KEY/i,
  /ADMIN_TOKEN/i,
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

let cachedSnapshot = null;

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicStatus(value = {}) {
  return sanitizePublicPayload({
    available: Boolean(value && Object.keys(value).length),
    success: value.success !== false,
    status: value.status || value.overall_status || value.overallStatus || "unknown",
    overall_status: value.overall_status || value.status || "unknown",
    errors_count: numberOrNull(value.errors_count ?? value.error_count),
    warnings_count: numberOrNull(value.warnings_count ?? value.warning_count),
    chain_height: numberOrNull(value.chain_height),
    latest_block_hash: value.latest_block_hash || null,
    rebuild_needed: value.rebuild_needed === true ? true : value.rebuild_needed === false ? false : null,
    index_chain_match: value.index_chain_match === true || value.chain_match === true,
  });
}

function summaryFromResponse(data) {
  return sanitizePublicPayload(data?.summary || data || {});
}

async function flaskGet(pathname, options = {}) {
  const response = await axios.get(`${flaskUrl}${pathname}`, { timeout: options.timeout || 10000, params: options.params });
  return response.data || {};
}

async function safeCall(label, fn, fallback) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    logError(`Snapshot ${label} lookup failed: ${error.message}`);
    return { ok: false, value: fallback, error };
  }
}

async function getReadinessStatus() {
  const { buildReadiness } = require("./readiness");
  const readiness = await buildReadiness({ skipSnapshot: true });
  return {
    available: Boolean(readiness?.success),
    success: readiness?.success === true,
    overall_status: readiness?.overall_status || "unknown",
    score: numberOrNull(readiness?.score),
    checked_at: readiness?.checked_at || null,
  };
}

function confirmedCount(transactionsResult, chainSummary) {
  return numberOrZero(
    transactionsResult?.total ??
      transactionsResult?.total_transactions ??
      chainSummary?.total_transactions ??
      chainSummary?.confirmed_transaction_count
  );
}

function pendingCount(pendingResult, diagnostics) {
  return numberOrZero(pendingResult?.total ?? diagnostics?.pending_transactions ?? diagnostics?.pending_transaction_count);
}

function treasuryBalance(treasurySummary) {
  return numberOrZero(
    treasurySummary?.current_balance ??
      treasurySummary?.treasury_balance ??
      treasurySummary?.balance ??
      treasurySummary?.available_balance
  );
}

function latestHashFromChainSummary(chainSummary) {
  return chainSummary?.last_block_hash || chainSummary?.latest_block_hash || null;
}

function latestHashFromBlock(latestBlock) {
  return latestBlock?.hash || latestBlock?.block_hash || null;
}

function hasForbiddenSecretMarker(value) {
  const text = JSON.stringify(value || {});
  return FORBIDDEN_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function buildHashes(payloads) {
  return HASH_KEYS.reduce((hashes, key) => {
    hashes[key] =
      key === "network_manifest"
        ? hashNetworkManifest(payloads[key] || {})
        : sha256Hex(canonicalStringify(payloads[key] || {}));
    return hashes;
  }, {});
}

async function generateSnapshot(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const [
    chainResult,
    diagnosticsResult,
    latestBlocksResult,
    confirmedTransactionsResult,
    pendingTransactionsResult,
    treasuryResult,
    governanceResult,
    lendingResult,
    exchangeResult,
    registryResult,
    storageResult,
    indexResult,
    auditResult,
    networkResult,
    readinessResult,
  ] = await Promise.all([
    safeCall("chain summary", () => flaskGet("/chain/summary"), {}),
    safeCall("diagnostics", () => flaskGet("/diagnostics"), {}),
    safeCall("latest block", () => flaskGet("/chain/blocks", { params: { limit: 1, offset: 0 } }), {}),
    safeCall("confirmed transactions", () => flaskGet("/transactions", { params: { status: "confirmed", limit: 1, offset: 0 } }), {}),
    safeCall("pending transactions", () => flaskGet("/transactions/pending", { params: { limit: 1, offset: 0 } }), {}),
    safeCall("treasury summary", () => flaskGet("/treasury/summary"), {}),
    safeCall("governance summary", () => flaskGet("/governance/summary"), {}),
    safeCall("lending summary", () => flaskGet("/lending/summary"), {}),
    safeCall("exchange summary", () => flaskGet("/exchange/summary"), {}),
    safeCall("registry summary", () => flaskGet("/registry/summary"), {}),
    safeCall("storage health", loadStorageHealth, {}),
    safeCall("index health", () => flaskGet("/indexes/health"), {}),
    safeCall("audit manifest", () => buildAuditSnapshot(generatedAt), { manifest: {} }),
    safeCall("network manifest", () => buildNetworkManifest({ generatedAt }), {}),
    options.includeReadinessStatus === false
      ? Promise.resolve({ ok: true, value: { available: true, overall_status: "not_checked" } })
      : safeCall("readiness", getReadinessStatus, { available: false, overall_status: "unknown" }),
  ]);

  const chainSummary = summaryFromResponse(chainResult.value);
  const diagnostics = summaryFromResponse(diagnosticsResult.value);
  const latestBlocks = Array.isArray(latestBlocksResult.value?.blocks) ? latestBlocksResult.value.blocks : [];
  const latestBlock = sanitizePublicPayload(latestBlocks[0] || {});
  const transactionsIndexSummary = sanitizePublicPayload({
    confirmed_transaction_count: confirmedCount(confirmedTransactionsResult.value, chainSummary),
    pending_transaction_count: pendingCount(pendingTransactionsResult.value, diagnostics),
    confirmed_total_available: confirmedTransactionsResult.ok,
    pending_total_available: pendingTransactionsResult.ok,
  });
  const treasurySummary = summaryFromResponse(treasuryResult.value);
  const governanceSummary = summaryFromResponse(governanceResult.value);
  const lendingSummary = summaryFromResponse(lendingResult.value);
  const exchangeSummary = summaryFromResponse(exchangeResult.value);
  const registrySummary = summaryFromResponse(registryResult.value);
  const auditManifest = sanitizePublicPayload(auditResult.value?.manifest || {});
  const networkManifest = sanitizePublicPayload(networkResult.value || {});

  const payloads = {
    chain_summary: chainSummary,
    latest_block: latestBlock,
    transactions_index_summary: transactionsIndexSummary,
    treasury_summary: treasurySummary,
    governance_summary: governanceSummary,
    lending_summary: lendingSummary,
    exchange_summary: exchangeSummary,
    registry_summary: registrySummary,
    audit_manifest: auditManifest,
    network_manifest: networkManifest,
  };
  const latestBlockHash = latestHashFromChainSummary(chainSummary) || latestHashFromBlock(latestBlock);

  const snapshot = sanitizePublicPayload({
    success: true,
    snapshot_version: 1,
    generated_at: generatedAt,
    network_name: "Vorliq",
    website: PUBLIC_URL,
    api_base: `${PUBLIC_URL}/api`,
    chain_height: numberOrZero(chainSummary.block_height ?? chainSummary.chain_height ?? diagnostics.block_height),
    latest_block_hash: latestBlockHash,
    chain_valid: chainSummary.chain_valid === true || diagnostics.chain_valid === true,
    confirmed_transaction_count: transactionsIndexSummary.confirmed_transaction_count,
    pending_transaction_count: transactionsIndexSummary.pending_transaction_count,
    treasury_balance: treasuryBalance(treasurySummary),
    active_node_count: numberOrZero(registrySummary.active_node_count ?? diagnostics.active_registry_nodes),
    active_incident_count: listActiveIncidents().length,
    deployment_commit: networkManifest.deployment?.commit_hash || auditManifest.deployment_commit || null,
    storage_status: publicStatus(storageResult.value),
    index_status: publicStatus(indexResult.value),
    readiness_status: publicStatus(readinessResult.value),
    hashes: buildHashes(payloads),
  });
  snapshot.signature = signingMetadata(snapshot, { signedAt: generatedAt });
  return sanitizePublicPayload(snapshot);
}

async function getLatestSnapshot(options = {}) {
  if (!options.force && cachedSnapshot && Date.now() - cachedSnapshot.cachedAt < SNAPSHOT_TTL_MS) {
    return cachedSnapshot.snapshot;
  }

  const snapshot = await generateSnapshot(options);
  cachedSnapshot = { cachedAt: Date.now(), snapshot };
  return snapshot;
}

function verifySnapshotObject(snapshot) {
  const checks = [];
  const warnings = [];
  const errors = [];

  function add(id, passed, message, severity = "error") {
    checks.push({ id, passed, message });
    if (!passed) {
      if (severity === "warning") warnings.push(message);
      else errors.push(message);
    }
  }

  add("chain_valid_true", snapshot.chain_valid === true, "Snapshot reports chain_valid true.");
  add("latest_block_hash_present", Boolean(snapshot.latest_block_hash), "Latest block hash is present.");
  add("audit_manifest_hash_present", /^[a-f0-9]{64}$/i.test(snapshot.hashes?.audit_manifest || ""), "Audit manifest hash is present and well formed.");
  add("network_manifest_hash_present", /^[a-f0-9]{64}$/i.test(snapshot.hashes?.network_manifest || ""), "Network manifest hash is present and well formed.");
  add("storage_status_available", Boolean(snapshot.storage_status?.available), "Storage status is available.");
  add("index_status_available", Boolean(snapshot.index_status?.available), "Index status is available.");
  add("readiness_status_available", Boolean(snapshot.readiness_status?.available), "Readiness status is available.");
  add("secret_scan_passed", !hasForbiddenSecretMarker(snapshot), "No forbidden secret markers appear in the snapshot.");
  add(
    "snapshot_hash_matches_payload",
    Boolean(snapshot.signature?.snapshot_hash) && snapshot.signature.snapshot_hash === snapshotHash(snapshot),
    "Snapshot hash matches the canonical snapshot payload excluding signature metadata."
  );

  return { checks, warnings, errors };
}

async function verifySnapshot(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const snapshot = await generateSnapshot({ ...options, generatedAt, includeReadinessStatus: options.includeReadinessStatus !== false });
  const verification = verifySnapshotObject(snapshot);

  const latestBlockHash = snapshot.latest_block_hash;
  const currentChainResult = await safeCall("verify chain summary", () => flaskGet("/chain/summary"), {});
  const currentLatestResult = await safeCall("verify latest block", () => flaskGet("/chain/blocks", { params: { limit: 1, offset: 0 } }), {});
  const currentChainSummary = summaryFromResponse(currentChainResult.value);
  const currentLatestBlocks = currentLatestResult.value;
  const currentLatestBlock = Array.isArray(currentLatestBlocks?.blocks) ? currentLatestBlocks.blocks[0] : null;
  const currentSummaryHash = latestHashFromChainSummary(currentChainSummary);
  const currentBlockHash = latestHashFromBlock(currentLatestBlock);
  const auditSnapshot = await buildAuditSnapshot(generatedAt);
  const networkManifest = await buildNetworkManifest({ generatedAt });
  const auditHash = sha256Hex(canonicalStringify(sanitizePublicPayload(auditSnapshot.manifest)));
  const networkHash = hashNetworkManifest(sanitizePublicPayload(networkManifest));
  const signatureVerification = verifySnapshotSignature(snapshot);

  const extraChecks = [
    {
      id: "latest_block_hash_matches_chain_summary",
      passed: currentChainResult.ok && Boolean(latestBlockHash) && latestBlockHash === currentSummaryHash,
      message: "Latest block hash matches the current chain summary.",
      failureMessage: "Latest block hash does not match the current chain summary.",
    },
    {
      id: "latest_block_hash_matches_latest_block",
      passed: !currentBlockHash || latestBlockHash === currentBlockHash,
      message: "Latest block hash matches the latest public block when block metadata is available.",
      failureMessage: "Latest block hash does not match the latest public block metadata.",
    },
    {
      id: "latest_block_hash_matches_index",
      passed: !snapshot.index_status?.latest_block_hash || snapshot.index_status.latest_block_hash === latestBlockHash,
      message: "Latest block hash matches index status when index metadata exposes it.",
      failureMessage: "Latest block hash does not match index status metadata.",
    },
    {
      id: "audit_manifest_hash_matches_current",
      passed: snapshot.hashes?.audit_manifest === auditHash,
      message: "Audit manifest hash matches the current public audit manifest.",
      failureMessage: "Audit manifest hash does not match the current public audit manifest.",
    },
    {
      id: "network_manifest_hash_matches_current",
      passed: snapshot.hashes?.network_manifest === networkHash,
      message: "Network manifest hash matches the current public network manifest.",
      failureMessage: "Network manifest hash differs from the current public network manifest; this can happen when dynamic network metadata changes during verification.",
      severity: "warning",
    },
  ];

  for (const check of extraChecks) {
    if (!check.passed) check.message = check.failureMessage;
    const { failureMessage, severity, ...publicCheck } = check;
    verification.checks.push(publicCheck);
    if (!check.passed) {
      if (check.severity === "warning") verification.warnings.push(check.message);
      else verification.errors.push(check.message);
    }
  }

  const signatureChecks = [
    {
      id: "snapshot_signature_hash_matches_payload",
      passed: signatureVerification.hash_matches,
      message: "Snapshot signature hash matches the canonical snapshot payload.",
    },
    {
      id: "snapshot_signature_verified",
      passed: signatureVerification.enabled ? signatureVerification.signature_verified === true : !signatureVerification.required,
      message: signatureVerification.enabled
        ? "Snapshot signature verifies against the configured Ed25519 public key."
        : "Snapshot is unsigned and signature verification is not required.",
    },
  ];

  for (const check of signatureChecks) {
    verification.checks.push(check);
    if (!check.passed) verification.errors.push(check.message);
  }

  if (!signatureVerification.enabled && !signatureVerification.required) {
    verification.warnings.push("Snapshot is unsigned; deterministic verification passed but production signing is not configured.");
  }

  if (signatureVerification.required && !signatureVerification.enabled) {
    verification.errors.push("Snapshot signature is required but no valid signature is present.");
  }

  return {
    success: true,
    verified: verification.errors.length === 0,
    signature_verified: signatureVerification.signature_verified,
    signature_enabled: signatureVerification.enabled,
    signature_required: signatureVerification.required,
    signature_status: signatureVerification.status,
    snapshot,
    checks: verification.checks,
    warnings: verification.warnings,
    errors: verification.errors,
  };
}

function clearSnapshotCache() {
  cachedSnapshot = null;
}

module.exports = {
  FORBIDDEN_SECRET_PATTERNS,
  HASH_KEYS,
  clearSnapshotCache,
  generateSnapshot,
  getLatestSnapshot,
  hasForbiddenSecretMarker,
  verifySnapshot,
  verifySnapshotObject,
};
