const express = require("express");
const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const adminAuth = require("../middleware/adminAuth");
const { publicBackupStatus } = require("./backup");
const { listReports, reportCountForTarget, updateReport } = require("../communityReports");
const { createIncident, listActiveIncidents, listIncidents, resolveIncident } = require("../incidents");
const { getRecentAlerts } = require("../monitors");
const { topPages } = require("../analytics");
const {
  topIpsByClaims24h,
  topWalletsByClaims,
  ipsAtMultiWalletLimit,
  listBans,
  banIp,
  banWallet,
  unbanIp,
  unbanWallet,
} = require("../faucetAbuse");
const { logError } = require("../logger");

const router = express.Router();
const execFileAsync = promisify(execFile);
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const appDirectory = process.env.VORLIQ_APP_DIR || path.resolve(__dirname, "..", "..");
const BACKUP_NAME_PATTERN = /^vorliq-backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/;

router.use("/api/admin", adminAuth);

function backupDirectory() {
  return process.env.VORLIQ_BACKUP_DIR || "/home/vorliq/backups";
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/ADMIN_TOKEN=[^\s]+/gi, "ADMIN_TOKEN=[redacted]")
    .replace(/(password|token|private[_-]?key|secret)=?[^\s]*/gi, "$1=[redacted]")
    .replace(/\/home\/vorliq\/[^\s'"]*/g, "[server-path]")
    .slice(0, 500);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function listBackups() {
  const directory = backupDirectory();
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((fileName) => BACKUP_NAME_PATTERN.test(fileName))
    .map((fileName) => {
      const stats = fs.statSync(path.join(directory, fileName));
      return {
        file_name: fileName,
        size_bytes: stats.size,
        size_mb: Number((stats.size / 1024 / 1024).toFixed(2)),
        created_time: stats.mtime.toISOString(),
        modified_time: stats.mtime.toISOString(),
        modified_timestamp: stats.mtimeMs,
      };
    })
    .sort((left, right) => right.modified_timestamp - left.modified_timestamp)
    .map(({ modified_timestamp, ...backup }) => backup);
}

function latestBackup() {
  return listBackups()[0] || null;
}

function scriptPath(envName, fallbackName) {
  const configured = process.env[envName];
  if (configured) return configured;
  const serverPath = path.join("/home/vorliq", fallbackName);
  if (fs.existsSync(serverPath)) return serverPath;
  return path.resolve(__dirname, "..", "..", "deployment", fallbackName);
}

async function gitInfo() {
  try {
    const [hashResult, timestampResult] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: appDirectory, timeout: 5000 }),
      execFileAsync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: appDirectory, timeout: 5000 }),
    ]);
    return {
      commit_hash: hashResult.stdout.trim(),
      commit_timestamp: timestampResult.stdout.trim(),
    };
  } catch (error) {
    return { commit_hash: null, commit_timestamp: null };
  }
}

async function getServiceStatus(name) {
  if (process.platform !== "linux") return "unavailable";
  try {
    const result = await execFileAsync("systemctl", ["is-active", name], { timeout: 2500 });
    return result.stdout.trim() || "unknown";
  } catch (error) {
    return String(error.stdout || "").trim() || "inactive";
  }
}

function readLogSummaries(pattern, limit) {
  const logFile = path.join(__dirname, "..", "data", "backend.log");
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && pattern.test(line))
    .slice(-limit)
    .map(sanitizeText);
}

function minerStatusFile() {
  return process.env.VORLIQ_MINER_STATUS_FILE || path.join(os.tmpdir(), "vorliq-miner-status.json");
}

function readPublicMinerState() {
  const fileName = minerStatusFile();
  if (!fs.existsSync(fileName)) {
    return {
      last_mining_attempt_timestamp: null,
      last_mining_result: null,
      last_mining_error: null,
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(fileName, "utf8"));
    return {
      last_mining_attempt_timestamp: raw.last_mining_attempt_timestamp || null,
      last_mining_result: raw.last_mining_result ? sanitizeText(raw.last_mining_result) : null,
      last_mining_error: raw.last_mining_error ? sanitizeText(raw.last_mining_error) : null,
    };
  } catch (error) {
    return {
      last_mining_attempt_timestamp: null,
      last_mining_result: null,
      last_mining_error: "Miner status file could not be read.",
    };
  }
}

async function flaskGet(pathname, options = {}) {
  const response = await axios.get(`${flaskUrl}${pathname}`, { timeout: 5000, ...options });
  return response.data || {};
}

function flaskAdminOptions(req, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: req.get("authorization") || "",
    },
  };
}

function text(value, max = 500) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}

function requireLimitedText(value, field, max) {
  const normalized = String(value || "").replace(/[<>]/g, "").trim();
  if (!normalized) {
    const error = new Error(`${field} is required.`);
    error.status = 400;
    throw error;
  }
  if (normalized.length > max) {
    const error = new Error(`${field} must be ${max} characters or fewer.`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

function booleanValue(value, field) {
  if (typeof value === "boolean") return value;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  const error = new Error(`${field} must be a boolean.`);
  error.status = 400;
  throw error;
}

async function profileName(address) {
  if (!address) return "";
  try {
    const data = await flaskGet("/profiles/profile", { params: { address } });
    return data.profile?.display_name || "";
  } catch (error) {
    return "";
  }
}

async function moderationPost(post) {
  const body = String(post.body || "");
  return {
    post_id: post.post_id,
    title: post.title || "Untitled",
    author_address: post.author_address || "",
    profile_display_name: await profileName(post.author_address),
    created_timestamp: post.timestamp || null,
    vote_count: safeNumber(post.vote_count),
    reply_count: Array.isArray(post.replies) ? post.replies.length : 0,
    featured: Boolean(post.featured),
    pinned: Boolean(post.pinned),
    moderation_status: post.moderation_status || "visible",
    moderation_reason: post.moderation_reason || "",
    locked: post.moderation_status === "locked",
    hidden: post.moderation_status === "hidden",
    report_count: reportCountForTarget("forum_post", post.post_id),
    body_preview: body.length > 180 ? `${body.slice(0, 180)}...` : body,
    replies: (post.replies || []).slice(0, 10).map((reply) => ({
      reply_id: reply.reply_id,
      author_address: reply.author_address || "",
      body_preview: String(reply.body || "").slice(0, 160),
      moderation_status: reply.moderation_status || "visible",
      report_count: reportCountForTarget("forum_reply", reply.reply_id),
    })),
  };
}

router.get("/api/admin/overview", async (req, res) => {
  try {
    const [deployment, chainSummary, economics, treasury, profiles, forumPosts] = await Promise.all([
      gitInfo(),
      flaskGet("/chain/summary").catch(() => ({})),
      flaskGet("/economics").catch(() => ({})),
      flaskGet("/treasury/balance").catch(() => ({})),
      flaskGet("/profiles", { params: { limit: 1, offset: 0 } }).catch(() => ({})),
      flaskGet("/forum/posts", { params: { limit: 1, offset: 0 } }).catch(() => ({})),
    ]);

    const backupStatus = publicBackupStatus();
    const activeIncidents = listActiveIncidents();
    const allIncidents = listIncidents();
    const serviceStatus = {
      blockchain: await getServiceStatus("vorliq-blockchain.service"),
      backend: await getServiceStatus("vorliq-backend.service"),
      heartbeat: await getServiceStatus("vorliq-heartbeat.service"),
      nginx: await getServiceStatus("nginx.service"),
    };

    return res.json({
      success: true,
      deployment,
      blockchain: {
        height: safeNumber(chainSummary.summary?.height ?? chainSummary.height ?? chainSummary.block_height),
        chain_valid: Boolean(chainSummary.summary?.chain_valid ?? chainSummary.chain_valid ?? chainSummary.valid),
        pending_transaction_count: safeNumber(chainSummary.summary?.pending_transactions ?? chainSummary.pending_transaction_count),
        current_difficulty: safeNumber(economics.difficulty ?? chainSummary.summary?.difficulty ?? chainSummary.difficulty),
        current_mining_reward: safeNumber(economics.mining_reward ?? chainSummary.summary?.mining_reward ?? chainSummary.mining_reward),
      },
      treasury: {
        balance: safeNumber(treasury.balance ?? treasury.treasury_balance),
      },
      backups: {
        ...backupStatus,
        latest_backup: latestBackup() || backupStatus.latest_backup || null,
      },
      incidents: {
        active_count: activeIncidents.length,
        total_count: allIncidents.length,
      },
      forum: {
        active_post_count: safeNumber(forumPosts.total, Array.isArray(forumPosts.posts) ? forumPosts.posts.length : 0),
      },
      profiles: {
        total_count: safeNumber(profiles.total, Array.isArray(profiles.profiles) ? profiles.profiles.length : 0),
      },
      slow_routes: readLogSummaries(/Slow route/i, 10),
      services: serviceStatus,
      server_uptime_seconds: Math.floor(process.uptime()),
      host_uptime_seconds: Math.floor(os.uptime()),
    });
  } catch (error) {
    logError(`GET /api/admin/overview failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Admin overview is unavailable." });
  }
});

router.get("/api/admin/security", (req, res) => {
  res.json({
    success: true,
    rate_limiting_enabled: true,
    cors_mode: "restricted",
    helmet_enabled: true,
    json_body_limit: "100kb default, 2.5mb forum media route",
    csp_enabled: true,
    public_write_routes_protected_from_system_addresses: true,
    incident_write_routes_protected: true,
    admin_routes_protected: true,
    abuse_log_summaries: readLogSummaries(/rate limit|Validation rejected|system-controlled|too large|invalid/i, 20),
    note: "No secrets, private keys, passwords, tokens, or raw environment values are displayed.",
  });
});

router.get("/api/admin/mining/status", async (req, res) => {
  try {
    const publicStatus = await flaskGet("/mining/status").catch(() => ({}));
    const minerState = readPublicMinerState();
    return res.json({
      success: true,
      status: publicStatus.status || null,
      autominers: {
        public_node_miner_enabled: process.env.VORLIQ_PUBLIC_MINER_ENABLED === "true",
        public_node_miner_address_configured: Boolean(process.env.VORLIQ_PUBLIC_MINER_ADDRESS),
      },
      services: {
        public_node_miner: await getServiceStatus("vorliq-miner.service"),
      },
      last_mining_attempt_timestamp: minerState.last_mining_attempt_timestamp,
      last_mining_result: minerState.last_mining_result,
      last_mining_error: minerState.last_mining_error,
      note: "No private keys, admin tokens, or environment secrets are displayed.",
    });
  } catch (error) {
    logError(`GET /api/admin/mining/status failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Admin mining status is unavailable." });
  }
});

router.post("/api/admin/incidents/create", (req, res) => {
  try {
    const body = req.body || {};
    const severity = text(body.severity, 20).toLowerCase();
    if (!["minor", "major", "critical"].includes(severity)) {
      return res.status(400).json({ success: false, message: "severity must be minor, major, or critical" });
    }
    const affected = Array.isArray(body.affected_services || body.affectedServices)
      ? (body.affected_services || body.affectedServices).map((service) => requireLimitedText(service, "affected service", 80)).filter(Boolean)
      : [];
    const incident = createIncident({
      title: requireLimitedText(body.title, "title", 160),
      message: requireLimitedText(body.message || body.description, "message", 3000),
      severity,
      affected_services: affected,
    });
    return res.status(201).json({ success: true, incident });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/api/admin/incidents/resolve", (req, res) => {
  const incident = resolveIncident(text(req.body?.id || req.body?.incident_id || req.body?.incidentId, 120));
  if (!incident) return res.status(404).json({ success: false, message: "Incident was not found." });
  return res.json({ success: true, incident });
});

router.get("/api/admin/backups", (req, res) => {
  try {
    const backups = listBackups();
    res.json({
      success: true,
      backups,
      latest_backup: backups[0] || null,
      latest_verification_passed: null,
    });
  } catch (error) {
    logError(`GET /api/admin/backups failed: ${error.message}`);
    res.status(500).json({ success: false, message: "Backup metadata is unavailable." });
  }
});

router.get("/api/admin/indexes", async (req, res) => {
  try {
    const health = await flaskGet("/indexes/health");
    return res.json({
      success: true,
      index_health: health,
      note: "Indexes are derived from chain.json and can be rebuilt safely without changing historical blocks.",
    });
  } catch (error) {
    logError(`GET /api/admin/indexes failed: ${sanitizeText(error.message)}`);
    return res.status(503).json({ success: false, message: "Index health is unavailable." });
  }
});

router.post("/api/admin/indexes/rebuild", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/indexes/rebuild`, {});
    return res.status(response.status).json(response.data);
  } catch (error) {
    logError(`POST /api/admin/indexes/rebuild failed: ${sanitizeText(error.message)}`);
    const status = error.response?.status || 503;
    return res.status(status).json({ success: false, message: "Index rebuild failed." });
  }
});

router.post("/api/admin/backups/run", async (req, res) => {
  try {
    await execFileAsync("bash", [scriptPath("VORLIQ_BACKUP_SCRIPT", "backup.sh")], { timeout: 120000 });
    return res.json({ success: true, latest_backup: latestBackup() });
  } catch (error) {
    logError(`POST /api/admin/backups/run failed: ${sanitizeText(error.message)}`);
    return res.status(500).json({ success: false, message: "Backup run failed.", latest_backup: latestBackup() });
  }
});

router.post("/api/admin/backups/verify", async (req, res) => {
  const latest = latestBackup();
  if (!latest) return res.status(404).json({ success: false, message: "No backup archive is available to verify." });
  try {
    await execFileAsync("bash", [scriptPath("VORLIQ_VERIFY_BACKUP_SCRIPT", "verify_backup.sh"), path.join(backupDirectory(), latest.file_name)], { timeout: 120000 });
    return res.json({ success: true, latest_backup: latest, verification_passed: true });
  } catch (error) {
    logError(`POST /api/admin/backups/verify failed: ${sanitizeText(error.message)}`);
    return res.status(500).json({ success: false, message: "Backup verification failed.", latest_backup: latest, verification_passed: false });
  }
});

router.get("/api/admin/moderation/forum", async (req, res) => {
  try {
    const data = await flaskGet("/forum/admin/posts", flaskAdminOptions(req, { params: { limit: 25, offset: 0 } }));
    const posts = await Promise.all((data.posts || []).map(moderationPost));
    return res.json({ success: true, posts, total: safeNumber(data.total, posts.length) });
  } catch (error) {
    logError(`GET /api/admin/moderation/forum failed: ${error.message}`);
    return res.status(503).json({ success: false, message: "Forum moderation data is unavailable." });
  }
});

router.get("/api/admin/reports", (req, res) => {
  const reports = listReports({ status: req.query.status });
  return res.json({ success: true, reports, total: reports.length });
});

router.post("/api/admin/reports/review", (req, res) => {
  try {
    const report = updateReport(req.body?.report_id || req.body?.reportId, "reviewed", req.body?.moderator_note || req.body?.moderatorNote || "");
    return res.json({ success: true, report });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }
});

router.post("/api/admin/reports/dismiss", (req, res) => {
  try {
    const report = updateReport(req.body?.report_id || req.body?.reportId, "dismissed", req.body?.moderator_note || req.body?.moderatorNote || "");
    return res.json({ success: true, report });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }
});

router.post("/api/admin/reports/action", (req, res) => {
  try {
    const report = updateReport(req.body?.report_id || req.body?.reportId, "action_taken", req.body?.moderator_note || req.body?.moderatorNote || "");
    return res.json({ success: true, report });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }
});

router.post("/api/admin/moderation/forum/pin", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/admin/pin`, {
      post_id: requireLimitedText(req.body?.post_id || req.body?.postId, "post ID", 128),
      pinned: booleanValue(req.body?.pinned, "pinned"),
    }, flaskAdminOptions(req));
    return res.status(response.status).json(response.data);
  } catch (error) {
    const status = error.status || error.response?.status || 400;
    // Use the upstream message when present, but never fall back to the raw
    // error string (a connection failure would expose the internal Flask
    // host:port). Log the real cause server-side instead.
    if (!error.response) logError(`admin moderation upstream error: ${error.message}`);
    return res.status(status).json({ success: false, message: error.response?.data?.error || "Unable to complete this moderation action." });
  }
});

router.post("/api/admin/moderation/forum/feature", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/admin/feature`, {
      post_id: requireLimitedText(req.body?.post_id || req.body?.postId, "post ID", 128),
      featured: booleanValue(req.body?.featured, "featured"),
    }, flaskAdminOptions(req));
    return res.status(response.status).json(response.data);
  } catch (error) {
    const status = error.status || error.response?.status || 400;
    // Use the upstream message when present, but never fall back to the raw
    // error string (a connection failure would expose the internal Flask
    // host:port). Log the real cause server-side instead.
    if (!error.response) logError(`admin moderation upstream error: ${error.message}`);
    return res.status(status).json({ success: false, message: error.response?.data?.error || "Unable to complete this moderation action." });
  }
});

router.post("/api/admin/moderation/forum/moderate", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/admin/moderate`, {
      target_type: requireLimitedText(req.body?.target_type || req.body?.targetType || "post", "target type", 20),
      post_id: requireLimitedText(req.body?.post_id || req.body?.postId, "post ID", 128),
      reply_id: text(req.body?.reply_id || req.body?.replyId, 128),
      status: requireLimitedText(req.body?.status, "moderation status", 20),
      reason: text(req.body?.reason, 240),
    }, flaskAdminOptions(req));
    return res.status(response.status).json(response.data);
  } catch (error) {
    const status = error.status || error.response?.status || 400;
    // Use the upstream message when present, but never fall back to the raw
    // error string (a connection failure would expose the internal Flask
    // host:port). Log the real cause server-side instead.
    if (!error.response) logError(`admin moderation upstream error: ${error.message}`);
    return res.status(status).json({ success: false, message: error.response?.data?.error || "Unable to complete this moderation action." });
  }
});

// The most recent production monitoring alerts (chain health, Flask
// reachability, disk space) so the admin dashboard can surface them without
// anyone watching a terminal. Last ten events, newest first.
router.get("/api/admin/alerts", (req, res) => {
  try {
    return res.json({ success: true, alerts: getRecentAlerts(10) });
  } catch (error) {
    logError(`GET /api/admin/alerts failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Unable to load alerts." });
  }
});

// Usage summary for the Usage tab. Domain counts (active wallets, transactions,
// faucet claims, governance proposals, lending requests, forum posts) for the
// last 7 and 30 days come from Flask, which holds the chain and the community
// stores; the top pages come from the Node analytics events. If Flask is briefly
// unavailable the page still renders the analytics-derived parts.
router.get("/api/admin/usage", async (req, res) => {
  try {
    const domain = await flaskGet("/analytics/usage", { timeout: 8000 }).catch((error) => {
      logError(`admin usage: Flask domain stats unavailable: ${error.message}`);
      return null;
    });
    return res.json({
      success: true,
      generated_at: new Date().toISOString(),
      domain_available: Boolean(domain && domain.success !== false),
      windows: domain
        ? { "7d": domain["7d"] || null, "30d": domain["30d"] || null }
        : { "7d": null, "30d": null },
      top_pages_7d: topPages(7, 5),
      top_pages_30d: topPages(30, 5),
    });
  } catch (error) {
    logError(`GET /api/admin/usage failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Unable to load usage summary." });
  }
});

// Faucet abuse monitoring: top IPs by claim count in the last 24h, top wallets by
// claims ever, and any IP currently at the multi-wallet limit. Plus the current
// permanent bans.
router.get("/api/admin/faucet-abuse", (req, res) => {
  try {
    return res.json({
      success: true,
      top_ips_24h: topIpsByClaims24h(10),
      top_wallets: topWalletsByClaims(10),
      ips_at_limit: ipsAtMultiWalletLimit(),
      bans: listBans(),
    });
  } catch (error) {
    logError(`GET /api/admin/faucet-abuse failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Unable to load faucet abuse data." });
  }
});

// Permanently ban (or lift a ban on) an IP or wallet from the faucet.
router.post("/api/admin/faucet-ban", (req, res) => {
  try {
    const type = String(req.body?.type || "").trim().toLowerCase();
    const value = String(req.body?.value || "").trim();
    const action = String(req.body?.action || "ban").trim().toLowerCase();
    const reason = String(req.body?.reason || "manual admin ban").slice(0, 240);
    if (!["ip", "wallet"].includes(type) || !value) {
      return res.status(400).json({ success: false, message: "Provide type (ip|wallet) and value." });
    }
    if (action === "unban") {
      if (type === "ip") unbanIp(value);
      else unbanWallet(value);
    } else {
      if (type === "ip") banIp(value, reason);
      else banWallet(value, reason);
    }
    return res.json({ success: true, type, value, action });
  } catch (error) {
    logError(`POST /api/admin/faucet-ban failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Unable to update faucet ban." });
  }
});

module.exports = router;
