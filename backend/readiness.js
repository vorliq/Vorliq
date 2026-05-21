const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { summary: analyticsSummary } = require("./analytics");
const { buildAuditSnapshot } = require("./routes/audit");
const { publicBackupStatus } = require("./routes/backup");
const { loadStorageHealth } = require("./routes/storage");
const { listActiveIncidents } = require("./incidents");
const { securityStatus } = require("./middleware/security");
const { API_VERSION, API_STABILITY } = require("./utils/apiResponse");
const { logError } = require("./logger");
const { buildMigrationReadiness } = require("./migrationReadiness");

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const CRITICAL_STATUSES = new Set(["critical", "major"]);
const FAIL_WEIGHTS = { critical: 45, high: 24, medium: 12, low: 6 };
const WARNING_WEIGHTS = { critical: 18, high: 10, medium: 6, low: 3 };
const FORBIDDEN_KEY_PATTERN = /(token|secret|password|private[_-]?key|raw[_-]?user|user[_-]?agent|ip_address|server_path|path)$/i;
const FORBIDDEN_TEXT_PATTERNS = [
  /ADMIN_TOKEN/gi,
  /SERVER_SSH_KEY/gi,
  /BEGIN [A-Z ]*PRIVATE KEY/gi,
  /\/home\/vorliq\/[^\s"']*/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

function sanitizeText(value) {
  return FORBIDDEN_TEXT_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    String(value || "").replace(/[<>]/g, "").slice(0, 500)
  );
}

function sanitizeMetadata(value) {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((safe, [key, item]) => {
      if (FORBIDDEN_KEY_PATTERN.test(key)) return safe;
      safe[key] = sanitizeMetadata(item);
      return safe;
    }, {});
  }
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return String(value || "");
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function addCheck(checks, { id, name, category, status, severity, message, safe_metadata = {} }) {
  checks.push({
    id,
    name,
    category,
    status,
    severity,
    message: sanitizeText(message),
    safe_metadata: sanitizeMetadata(safe_metadata),
  });
}

async function safeCall(label, fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    logError(`Readiness ${label} check failed: ${error.message}`);
    return { ok: false, error };
  }
}

async function deploymentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  if (process.env.VORLIQ_COMMIT) return process.env.VORLIQ_COMMIT;
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: process.env.VORLIQ_APP_DIR || repoRoot,
    timeout: 5000,
  });
  return result.stdout.trim();
}

async function flaskGet(pathname, timeout = 7000) {
  const response = await axios.get(`${flaskUrl}${pathname}`, { timeout });
  return response.data || {};
}

function backupAgeHours(backupStatus) {
  const timestamp = Date.parse(backupStatus?.latest_backup?.modified_time || "");
  if (!Number.isFinite(timestamp)) return null;
  return Number(((Date.now() - timestamp) / 36e5).toFixed(2));
}

function scoreReadiness(checks) {
  const score = Math.max(
    0,
    Math.round(
      checks.reduce((remaining, check) => {
        if (check.status === "fail") return remaining - (FAIL_WEIGHTS[check.severity] || 8);
        if (check.status === "warning") return remaining - (WARNING_WEIGHTS[check.severity] || 4);
        return remaining;
      }, 100)
    )
  );
  const criticalFail = checks.some((check) => check.status === "fail" && check.severity === "critical");
  const highFail = checks.some((check) => check.status === "fail" && check.severity === "high");
  if (criticalFail) return { score, overall_status: "fail" };
  if (score >= 90 && !highFail) return { score, overall_status: "pass" };
  if (score >= 70) return { score, overall_status: "warning" };
  return { score, overall_status: "fail" };
}

function readVersionMetadata() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "version.json"), "utf8"));
}

async function diskUsage() {
  if (process.platform === "win32") return null;
  const result = await execFileAsync("df", ["-Pk", repoRoot], { timeout: 3000 });
  const lines = result.stdout.trim().split(/\r?\n/);
  const parts = String(lines[1] || "").trim().split(/\s+/);
  const usedPercent = Number(String(parts[4] || "").replace("%", ""));
  return Number.isFinite(usedPercent) ? { used_percent: usedPercent, free_percent: 100 - usedPercent } : null;
}

function incidentCounts(activeIncidents) {
  return activeIncidents.reduce(
    (counts, incident) => {
      const severity = String(incident.severity || "minor").toLowerCase();
      counts.total += 1;
      counts[severity] = (counts[severity] || 0) + 1;
      return counts;
    },
    { total: 0, minor: 0, major: 0, critical: 0 }
  );
}

async function buildReadiness(options = {}) {
  const checks = [];
  const checkedAt = new Date().toISOString();

  addCheck(checks, {
    id: "backend_health",
    name: "Backend health",
    category: "API",
    status: "pass",
    severity: "critical",
    message: "Backend readiness code executed.",
    safe_metadata: { process_uptime_seconds: Math.floor(process.uptime()) },
  });

  const [
    commitResult,
    diagnosticsResult,
    chainSummaryResult,
    storageResult,
    indexResult,
    backupResult,
    auditResult,
    registryResult,
    miningResult,
    treasuryResult,
    faucetResult,
    analyticsResult,
    versionResult,
    networkManifestResult,
    migrationResult,
  ] = await Promise.all([
    safeCall("deployment commit", deploymentCommit),
    safeCall("diagnostics", () => flaskGet("/diagnostics")),
    safeCall("chain summary", () => flaskGet("/chain/summary")),
    safeCall("storage health", loadStorageHealth),
    safeCall("index health", () => flaskGet("/indexes/health")),
    safeCall("backup status", () => Promise.resolve(publicBackupStatus())),
    safeCall("audit manifest", () => buildAuditSnapshot()),
    safeCall("registry summary", () => flaskGet("/registry/summary")),
    safeCall("mining status", () => flaskGet("/mining/status")),
    safeCall("treasury summary", () => flaskGet("/treasury/summary")),
    safeCall("faucet summary", () => flaskGet("/faucet/summary")),
    safeCall("analytics summary", () => Promise.resolve(analyticsSummary())),
    safeCall("version metadata", () => Promise.resolve(readVersionMetadata())),
    safeCall("network manifest", async () => {
      const metadata = readVersionMetadata();
      const commit = await deploymentCommit().catch(() => null);
      return { success: true, project: metadata.project_name, api_version: metadata.api_version, deployment_commit: commit };
    }),
    safeCall("migration readiness", () => buildMigrationReadiness()),
  ]);

  addCheck(checks, {
    id: "deployment_commit_available",
    name: "Deployment commit available",
    category: "Deployment",
    status: commitResult.ok && commitResult.value ? "pass" : "fail",
    severity: "critical",
    message: commitResult.ok && commitResult.value ? "Current deployment commit is available." : "Current deployment commit could not be resolved.",
    safe_metadata: { commit: commitResult.value || null },
  });

  addCheck(checks, {
    id: "api_version_available",
    name: "API version available",
    category: "API",
    status: API_VERSION ? "pass" : "fail",
    severity: "high",
    message: API_VERSION ? "API version metadata is configured." : "API version metadata is missing.",
    safe_metadata: { api_version: Number(API_VERSION), stability: API_STABILITY },
  });

  const publicSecurity = securityStatus();
  addCheck(checks, {
    id: "security_status_available",
    name: "Security status available",
    category: "Security",
    status: publicSecurity.success && publicSecurity.rate_limiting_enabled && publicSecurity.security_headers_enabled
      ? publicSecurity.production_mode ? "pass" : "warning"
      : "fail",
    severity: "high",
    message: publicSecurity.production_mode
      ? "Security status is available and production mode is active."
      : "Security status is available, but production mode is not active.",
    safe_metadata: {
      rate_limiting_enabled: publicSecurity.rate_limiting_enabled,
      security_headers_enabled: publicSecurity.security_headers_enabled,
      cors_restricted: publicSecurity.cors_restricted,
      production_mode: publicSecurity.production_mode,
    },
  });

  const storage = storageResult.value || {};
  addCheck(checks, {
    id: "storage_health_ok",
    name: "Storage health ok",
    category: "Storage",
    status: storageResult.ok ? storage.overall_status === "ok" ? "pass" : storage.overall_status === "warning" ? "warning" : "fail" : "fail",
    severity: "critical",
    message: storageResult.ok ? `Storage health is ${storage.overall_status || "unknown"}.` : "Storage health could not be loaded.",
    safe_metadata: {
      overall_status: storage.overall_status || "unknown",
      warnings_count: numberOrNull(storage.warnings_count),
      errors_count: numberOrNull(storage.errors_count),
      backup_available: Boolean(storage.backup_available),
    },
  });

  const indexHealth = indexResult.value || {};
  const indexChainMatch = indexHealth.index_chain_match === true || indexHealth.chain_match === true;
  addCheck(checks, {
    id: "index_health_ok",
    name: "Index health ok",
    category: "Storage",
    status: indexResult.ok && indexHealth.status === "ok" && indexHealth.rebuild_needed !== true ? "pass" : indexResult.ok ? "warning" : "fail",
    severity: "medium",
    message: indexResult.ok
      ? `Index health is ${indexHealth.status || "unknown"}.`
      : "Index health could not be loaded.",
    safe_metadata: {
      exists: Boolean(indexHealth.exists),
      valid: Boolean(indexHealth.valid),
      schema_version: numberOrNull(indexHealth.schema_version),
      chain_height: numberOrNull(indexHealth.chain_height),
      latest_block_hash: indexHealth.latest_block_hash || null,
      built_at: indexHealth.built_at || null,
      index_rebuild_needed: Boolean(indexHealth.rebuild_needed),
      index_chain_match: Boolean(indexChainMatch),
    },
  });

  const migration = migrationResult.value || {};
  addCheck(checks, {
    id: "migration_readiness_available",
    name: "Migration readiness available",
    category: "Storage",
    status: migrationResult.ok && migration.success ? "pass" : "warning",
    severity: "medium",
    message: migrationResult.ok
      ? "Migration readiness metadata is available."
      : "Migration readiness metadata is unavailable.",
    safe_metadata: {
      storage_backend: migration.storage_backend || "unknown",
      database_enabled: Boolean(migration.database_enabled),
      migration_supported: migration.migration_supported || "unknown",
      chain_source_of_truth: migration.chain_source_of_truth || "unknown",
      indexes_derived: Boolean(migration.indexes_derived),
    },
  });

  addCheck(checks, {
    id: "storage_backend_json",
    name: "Storage backend JSON",
    category: "Storage",
    status: migrationResult.ok && migration.storage_backend === "json" ? "pass" : "fail",
    severity: "critical",
    message: migration.storage_backend === "json"
      ? "Production storage backend is intentionally JSON."
      : "Production storage backend is not reporting JSON as expected.",
    safe_metadata: {
      storage_backend: migration.storage_backend || "unknown",
      chain_source_of_truth: migration.chain_source_of_truth || "unknown",
    },
  });

  addCheck(checks, {
    id: "database_not_enabled_expected",
    name: "Database not enabled expected",
    category: "Storage",
    status: migrationResult.ok && migration.database_enabled === false ? "pass" : "fail",
    severity: "critical",
    message: migration.database_enabled === false
      ? "No database adapter is active in production, as expected for this release."
      : "A database adapter appears enabled unexpectedly.",
    safe_metadata: {
      database_enabled: Boolean(migration.database_enabled),
      migration_supported: migration.migration_supported || "unknown",
    },
  });

  const backup = backupResult.value || {};
  const ageHours = backupAgeHours(backup);
  addCheck(checks, {
    id: "backup_recent",
    name: "Backup recent",
    category: "Backup",
    status: backupResult.ok && backup.latest_backup && ageHours !== null ? ageHours <= 48 ? "pass" : "warning" : "fail",
    severity: "high",
    message: backupResult.ok && backup.latest_backup
      ? `Latest backup age is ${ageHours} hours.`
      : "No latest backup archive is visible.",
    safe_metadata: {
      backup_monitoring_configured: Boolean(backup.backup_monitoring_configured),
      backup_directory_exists: Boolean(backup.backup_directory_exists),
      latest_backup_file_name: backup.latest_backup?.file_name || null,
      latest_backup_age_hours: ageHours,
      retention_days: backup.retention_days || null,
    },
  });

  const activeIncidents = listActiveIncidents();
  const counts = incidentCounts(activeIncidents);
  const hasCriticalIncident = activeIncidents.some((incident) => CRITICAL_STATUSES.has(String(incident.severity || "").toLowerCase()));
  addCheck(checks, {
    id: "no_active_major_incidents",
    name: "No active major incidents",
    category: "Incidents",
    status: hasCriticalIncident ? "fail" : activeIncidents.length ? "warning" : "pass",
    severity: hasCriticalIncident ? "critical" : "medium",
    message: hasCriticalIncident ? "A major or critical incident is active." : activeIncidents.length ? "Minor incidents are active." : "No active incidents are listed.",
    safe_metadata: { active_incident_count: activeIncidents.length, counts },
  });

  const auditManifest = auditResult.value?.manifest || {};
  const auditExportHashes = auditManifest.exports || [];
  const hashesValid = auditExportHashes.length > 0 && auditExportHashes.every((item) => /^[a-f0-9]{64}$/i.test(item.sha256 || ""));
  addCheck(checks, {
    id: "audit_manifest_available",
    name: "Audit manifest available",
    category: "Audit",
    status: auditResult.ok && auditManifest.success ? "pass" : "fail",
    severity: "high",
    message: auditResult.ok && auditManifest.success ? "Audit manifest can be generated." : "Audit manifest is unavailable.",
    safe_metadata: {
      export_count: auditExportHashes.length,
      chain_height: numberOrNull(auditManifest.chain_height),
      storage_health_status: auditManifest.storage_health_status || "unknown",
    },
  });

  addCheck(checks, {
    id: "audit_manifest_verifiable",
    name: "Audit manifest verifiable",
    category: "Audit",
    status: auditResult.ok && hashesValid ? "pass" : "fail",
    severity: "high",
    message: auditResult.ok && hashesValid ? "Audit manifest export hashes are well formed." : "Audit manifest export hashes could not be verified.",
    safe_metadata: { export_hash_count: auditExportHashes.length },
  });

  addCheck(checks, {
    id: "network_manifest_available",
    name: "Network manifest available",
    category: "Network",
    status: networkManifestResult.ok && networkManifestResult.value?.success ? "pass" : "fail",
    severity: "medium",
    message: networkManifestResult.ok ? "Network manifest source metadata is available." : "Network manifest source metadata is unavailable.",
    safe_metadata: {
      project: networkManifestResult.value?.project || "Vorliq",
      api_version: networkManifestResult.value?.api_version || null,
      deployment_commit_available: Boolean(networkManifestResult.value?.deployment_commit),
    },
  });

  const registrySummary = registryResult.value?.summary || {};
  const activeNodeCount = numberOrNull(registrySummary.active_node_count);
  const syncedNodeCount = numberOrNull(registrySummary.synced_node_count);
  const diagnosticsNodeActive = diagnosticsResult.ok
    && diagnosticsResult.value?.success !== false
    && diagnosticsResult.value?.chain_valid === true
    && numberOrNull(diagnosticsResult.value?.block_height) !== null;
  const registryNodeActive = registryResult.ok
    && (activeNodeCount || 0) > 0
    && (syncedNodeCount === null || syncedNodeCount > 0);
  addCheck(checks, {
    id: "public_node_active",
    name: "Public node active",
    category: "Network",
    status: registryNodeActive || diagnosticsNodeActive ? "pass" : "fail",
    severity: "critical",
    message: registryNodeActive
      ? "At least one registry-listed public node is active."
      : diagnosticsNodeActive
        ? "The public node API is active; registry heartbeat visibility needs attention."
        : "No active public node is visible.",
    safe_metadata: {
      active_node_count: activeNodeCount,
      synced_node_count: syncedNodeCount,
      diagnostics_available: diagnosticsResult.ok,
    },
  });

  addCheck(checks, {
    id: "registry_active_node_count",
    name: "Registry active node count",
    category: "Network",
    status: registryResult.ok && (activeNodeCount || 0) > 0 ? "pass" : "warning",
    severity: "medium",
    message: registryResult.ok ? `${activeNodeCount || 0} active registry node(s) are visible.` : "Registry summary is unavailable.",
    safe_metadata: {
      active_node_count: activeNodeCount,
      total_registered_node_count: numberOrNull(registrySummary.total_registered_node_count),
      inactive_node_count: Math.max(0, (numberOrNull(registrySummary.total_registered_node_count) || 0) - (activeNodeCount || 0)),
    },
  });

  const chainValid = diagnosticsResult.value?.chain_valid ?? chainSummaryResult.value?.summary?.chain_valid ?? chainSummaryResult.value?.chain_valid;
  addCheck(checks, {
    id: "chain_valid",
    name: "Chain valid",
    category: "Blockchain",
    status: diagnosticsResult.ok && chainValid === true ? "pass" : "fail",
    severity: "critical",
    message: chainValid === true ? "Blockchain diagnostics report a valid chain." : "Blockchain diagnostics do not confirm a valid chain.",
    safe_metadata: {
      block_height: numberOrNull(diagnosticsResult.value?.block_height ?? chainSummaryResult.value?.summary?.block_height),
      pending_transactions: numberOrNull(diagnosticsResult.value?.pending_transactions),
    },
  });

  addCheck(checks, {
    id: "mining_status_available",
    name: "Mining status available",
    category: "Blockchain",
    status: miningResult.ok && miningResult.value?.success !== false ? "pass" : "warning",
    severity: "medium",
    message: miningResult.ok ? "Mining status is available." : "Mining status is unavailable.",
    safe_metadata: {
      can_mine_now: miningResult.value?.status?.can_mine_now ?? null,
      current_block_height: numberOrNull(miningResult.value?.status?.current_block_height),
    },
  });

  addCheck(checks, {
    id: "treasury_summary_available",
    name: "Treasury summary available",
    category: "Economy",
    status: treasuryResult.ok && treasuryResult.value?.success !== false ? "pass" : "warning",
    severity: "medium",
    message: treasuryResult.ok ? "Treasury summary is available." : "Treasury summary is unavailable.",
    safe_metadata: { summary_available: treasuryResult.ok },
  });

  addCheck(checks, {
    id: "faucet_summary_available",
    name: "Faucet summary available",
    category: "Economy",
    status: faucetResult.ok && faucetResult.value?.success !== false ? "pass" : "warning",
    severity: "medium",
    message: faucetResult.ok ? "Faucet summary is available." : "Faucet summary is unavailable.",
    safe_metadata: { summary_available: faucetResult.ok },
  });

  addCheck(checks, {
    id: "analytics_summary_available",
    name: "Analytics summary available",
    category: "Observability",
    status: analyticsResult.ok && analyticsResult.value?.success ? "pass" : "warning",
    severity: "low",
    message: analyticsResult.ok ? "Analytics summary is available." : "Analytics summary is unavailable.",
    safe_metadata: { events_today: numberOrNull(analyticsResult.value?.events_today) },
  });

  addCheck(checks, {
    id: "admin_routes_protected",
    name: "Admin routes protected",
    category: "Security",
    status: process.env.ADMIN_TOKEN ? "pass" : "warning",
    severity: "high",
    message: process.env.ADMIN_TOKEN ? "Admin routes require a configured server token." : "Admin routes reject public access, but no operator token is configured.",
    safe_metadata: { admin_protection_configured: Boolean(process.env.ADMIN_TOKEN) },
  });

  addCheck(checks, {
    id: "version_metadata_available",
    name: "Version metadata available",
    category: "Release",
    status: versionResult.ok && versionResult.value?.current_version ? "pass" : "fail",
    severity: "medium",
    message: versionResult.ok ? "Version metadata is available." : "Version metadata is unavailable.",
    safe_metadata: {
      current_version: versionResult.value?.current_version || null,
      release_channel: versionResult.value?.release_channel || null,
      recommended_node_version: versionResult.value?.recommended_node_version || null,
    },
  });

  const scored = scoreReadiness(checks);
  const response = {
    success: true,
    overall_status: scored.overall_status,
    score: scored.score,
    checked_at: checkedAt,
    index_health: indexHealth.status || "unknown",
    index_rebuild_needed: Boolean(indexHealth.rebuild_needed),
    index_chain_match: Boolean(indexChainMatch),
    migration_readiness_available: Boolean(migrationResult.ok && migration.success),
    storage_backend: migration.storage_backend || "unknown",
    database_enabled: Boolean(migration.database_enabled),
    checks,
  };

  if (options.deep) {
    const disk = await safeCall("disk usage", diskUsage);
    response.operational_metadata = sanitizeMetadata({
      latest_backup: backup.latest_backup
        ? {
            file_name: backup.latest_backup.file_name,
            size_mb: backup.latest_backup.size_mb,
            modified_time: backup.latest_backup.modified_time,
            age_hours: ageHours,
          }
        : null,
      storage: {
        warnings_count: numberOrNull(storage.warnings_count),
        errors_count: numberOrNull(storage.errors_count),
        backup_available: Boolean(storage.backup_available),
      },
      index_health: {
        status: indexHealth.status || "unknown",
        rebuild_needed: Boolean(indexHealth.rebuild_needed),
        index_chain_match: Boolean(indexChainMatch),
        chain_height: numberOrNull(indexHealth.chain_height),
        latest_block_hash: indexHealth.latest_block_hash || null,
        built_at: indexHealth.built_at || null,
      },
      migration: {
        storage_backend: migration.storage_backend || "unknown",
        database_enabled: Boolean(migration.database_enabled),
        migration_supported: migration.migration_supported || "unknown",
        chain_source_of_truth: migration.chain_source_of_truth || "unknown",
        indexes_derived: Boolean(migration.indexes_derived),
        latest_chain_height: numberOrNull(migration.latest_chain_height),
        latest_block_hash: migration.latest_block_hash || null,
      },
      incidents: counts,
      registry: {
        active_node_count: activeNodeCount,
        inactive_node_count: Math.max(0, (numberOrNull(registrySummary.total_registered_node_count) || 0) - (activeNodeCount || 0)),
        synced_node_count: syncedNodeCount,
      },
      deployment: {
        commit: commitResult.value || null,
        version: versionResult.value?.current_version || null,
        release_channel: versionResult.value?.release_channel || null,
      },
      disk: disk.ok ? disk.value : null,
      services: ["backend", "blockchain", "nginx", "heartbeat", "backup", "monitor"],
    });
  }

  return response;
}

module.exports = {
  addCheck,
  buildReadiness,
  sanitizeMetadata,
  scoreReadiness,
};
