const axios = require("axios");

const { loadStorageHealth } = require("./routes/storage");
const { logError } = require("./logger");

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeHash(value) {
  const text = String(value || "").trim();
  return /^[a-f0-9]{16,128}$/i.test(text) ? text : null;
}

function summarizeStorage(storageHealth) {
  return {
    available: Boolean(storageHealth?.success),
    overall_status: storageHealth?.overall_status || "unknown",
    warnings_count: numberOrNull(storageHealth?.warnings_count),
    errors_count: numberOrNull(storageHealth?.errors_count),
    backup_available: Boolean(storageHealth?.backup_available),
  };
}

function summarizeIndex(indexHealth) {
  return {
    available: Boolean(indexHealth?.success),
    status: indexHealth?.status || "unknown",
    valid: Boolean(indexHealth?.valid),
    rebuild_needed: Boolean(indexHealth?.rebuild_needed),
    index_chain_match: Boolean(indexHealth?.index_chain_match),
    chain_height: numberOrNull(indexHealth?.chain_height),
    latest_block_hash: safeHash(indexHealth?.latest_block_hash),
    built_at: indexHealth?.built_at || null,
  };
}

async function flaskGet(pathname, timeout = 5000) {
  const response = await axios.get(`${flaskUrl}${pathname}`, { timeout });
  return response.data || {};
}

async function buildMigrationReadiness(options = {}) {
  const [storageResult, indexResult, chainResult] = await Promise.allSettled([
    loadStorageHealth(),
    flaskGet("/indexes/health"),
    flaskGet("/chain/summary"),
  ]);

  if (storageResult.status === "rejected") {
    logError(`Migration readiness storage health failed: ${storageResult.reason?.message || storageResult.reason}`);
  }
  if (indexResult.status === "rejected") {
    logError(`Migration readiness index health failed: ${indexResult.reason?.message || indexResult.reason}`);
  }
  if (chainResult.status === "rejected") {
    logError(`Migration readiness chain summary failed: ${chainResult.reason?.message || chainResult.reason}`);
  }

  const storage = storageResult.status === "fulfilled" ? storageResult.value : null;
  const index = indexResult.status === "fulfilled" ? indexResult.value : null;
  const chain = chainResult.status === "fulfilled" ? chainResult.value?.summary || chainResult.value : {};
  const latestHeight = numberOrNull(chain?.block_height ?? chain?.height ?? index?.chain_height);
  const latestHash = safeHash(chain?.last_block_hash ?? chain?.latest_block_hash ?? index?.latest_block_hash);

  const response = {
    success: true,
    storage_backend: "json",
    database_enabled: false,
    migration_supported: "dry_run_only",
    chain_source_of_truth: "chain.json",
    pending_source_of_truth: "pending.json",
    indexes_derived: true,
    latest_chain_height: latestHeight,
    latest_block_hash: latestHash,
    last_storage_health: summarizeStorage(storage),
    last_index_health: summarizeIndex(index),
    docs_url: "https://vorliq.github.io/Vorliq/storage-adapters.html",
    schema_map_url: "https://vorliq.github.io/Vorliq/schema-map.html",
    message: "Production storage is intentionally still hardened JSON. Database migration support is dry-run preparation only.",
  };

  if (options.deep) {
    response.operator_metadata = {
      dry_run_tool: "tools/migration_dry_run.py",
      dry_run_command: "python tools/migration_dry_run.py --output migration-dry-run-report.json",
      rollback_required: true,
      immutable_chain_required: true,
      private_wallet_keys_stored_server_side: false,
      notes: [
        "Run a dry-run report before any future adapter cutover.",
        "Do not import indexes as source-of-truth tables; rebuild them after migration.",
        "Keep chain.json backups until a future adapter has passed parity checks.",
      ],
    };
  }

  return response;
}

module.exports = {
  buildMigrationReadiness,
};
