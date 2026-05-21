#!/usr/bin/env node

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const apiUrl = (process.env.MAINTENANCE_API_URL || process.env.PUBLIC_MINER_API_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const logFile = process.env.VORLIQ_MAINTENANCE_LOG || "/var/log/vorliq-maintenance.log";
const adminToken = process.env.ADMIN_TOKEN || "";

function sanitize(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/ADMIN_TOKEN=[^\s]+/gi, "ADMIN_TOKEN=[redacted]")
    .replace(/(password|token|private[_-]?key|secret)=?[^\s]*/gi, "$1=[redacted]")
    .replace(/\/home\/vorliq\/[^\s'"]*/g, "[server-path]")
    .slice(0, 500);
}

function writeLog(level, message, metadata = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitize(message),
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, typeof value === "string" ? sanitize(value) : value])
    ),
  };
  const line = `${JSON.stringify(record)}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
  } catch (error) {
    process.stdout.write(line);
  }
}

async function get(pathname) {
  const response = await axios.get(`${apiUrl}${pathname}`, { timeout: 10000 });
  return response.data || {};
}

async function postAdmin(pathname) {
  if (!adminToken) {
    return { skipped: true, reason: "admin token is not configured" };
  }
  const response = await axios.post(
    `${apiUrl}${pathname}`,
    {},
    { timeout: 30000, headers: { Authorization: `Bearer ${adminToken}` } }
  );
  return response.data || {};
}

async function run() {
  writeLog("info", "maintenance check started");
  const [health, readiness, storage, indexes, backup] = await Promise.allSettled([
    get("/api/health"),
    get("/api/readiness"),
    get("/api/storage/health"),
    get("/api/indexes/health"),
    get("/api/backup/status"),
  ]);

  const indexData = indexes.status === "fulfilled" ? indexes.value : null;
  const rebuildNeeded = Boolean(indexData?.rebuild_needed);

  writeLog("info", "maintenance health snapshot", {
    backend_ok: health.status === "fulfilled" && health.value.success === true,
    readiness_status: readiness.status === "fulfilled" ? readiness.value.overall_status : "unavailable",
    storage_status: storage.status === "fulfilled" ? storage.value.overall_status : "unavailable",
    index_status: indexData?.status || "unavailable",
    index_rebuild_needed: rebuildNeeded,
    backup_visible: backup.status === "fulfilled" ? Boolean(backup.value.latest_backup) : false,
  });

  if (rebuildNeeded) {
    const rebuild = await postAdmin("/api/admin/indexes/rebuild");
    writeLog(rebuild.skipped ? "warning" : "info", "index rebuild checked", {
      rebuild_skipped: Boolean(rebuild.skipped),
      rebuild_status: rebuild.status || "unknown",
      rebuild_needed_after: Boolean(rebuild.rebuild_needed),
    });
  }

  writeLog("info", "maintenance check completed");
}

run().catch((error) => {
  writeLog("error", "maintenance check failed", { error: sanitize(error.message) });
  process.exitCode = 1;
});
