const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.VORLIQ_BACKEND_DATA_DIR || path.join(__dirname, "data");
const REPORTS_FILE = process.env.VORLIQ_REPORTS_FILE || path.join(DATA_DIR, "reports.json");
const TARGET_TYPES = new Set(["forum_post", "forum_reply", "chat_message", "profile"]);
const REASONS = new Set(["spam", "impersonation", "abuse", "scam", "illegal_content", "other"]);
const STATUSES = new Set(["open", "reviewed", "dismissed", "action_taken"]);
const SECRET_PATTERN = /(BEGIN [A-Z ]*PRIVATE KEY|private[_ -]?key|password|admin[_ -]?token|bearer\s+[A-Za-z0-9._~+/=-]+|ssh-rsa|ssh-ed25519)/i;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cleanText(value, max) {
  return String(value || "").replace(/\0/g, "").replace(/[<>]/g, "").trim().slice(0, max);
}

function readReports() {
  ensureDataDir();
  if (!fs.existsSync(REPORTS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8"));
    return Array.isArray(parsed.reports) ? parsed.reports : [];
  } catch (error) {
    return [];
  }
}

function writeReports(reports) {
  ensureDataDir();
  fs.writeFileSync(REPORTS_FILE, `${JSON.stringify({ reports }, null, 2)}\n`);
}

function rejectUnsafe(payload) {
  const text = JSON.stringify(payload || {});
  if (SECRET_PATTERN.test(text)) {
    const error = new Error("Report text must not include private keys, passwords, admin tokens, or secrets.");
    error.status = 400;
    throw error;
  }
}

function createReport(input = {}) {
  rejectUnsafe(input);
  const targetType = cleanText(input.target_type || input.targetType, 40);
  const targetId = cleanText(input.target_id || input.targetId, 160);
  const reason = cleanText(input.reason, 40);
  if (!TARGET_TYPES.has(targetType)) {
    const error = new Error("target_type is not valid.");
    error.status = 400;
    throw error;
  }
  if (!targetId) {
    const error = new Error("target_id is required.");
    error.status = 400;
    throw error;
  }
  if (!REASONS.has(reason)) {
    const error = new Error("reason is not valid.");
    error.status = 400;
    throw error;
  }
  const description = cleanText(input.description, 1000);
  const reportedBy = cleanText(input.reported_by || input.reportedBy || "anonymous", 160) || "anonymous";
  const report = {
    report_id: crypto.randomUUID(),
    target_type: targetType,
    target_id: targetId,
    reported_by: reportedBy,
    reason,
    description,
    timestamp: Date.now(),
    status: "open",
    moderator_note: "",
    source: cleanText(input.source || input.route || "web", 120),
  };
  const reports = readReports();
  reports.push(report);
  writeReports(reports.slice(-5000));
  return report;
}

function listReports({ status } = {}) {
  const normalizedStatus = cleanText(status, 40);
  const rows = readReports();
  return rows
    .filter((report) => !normalizedStatus || report.status === normalizedStatus)
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
}

function updateReport(reportId, status, moderatorNote = "") {
  const normalizedId = cleanText(reportId, 120);
  const normalizedStatus = cleanText(status, 40);
  if (!STATUSES.has(normalizedStatus)) {
    const error = new Error("status is not valid.");
    error.status = 400;
    throw error;
  }
  rejectUnsafe({ moderatorNote });
  const reports = readReports();
  const report = reports.find((item) => item.report_id === normalizedId);
  if (!report) {
    const error = new Error("report was not found.");
    error.status = 404;
    throw error;
  }
  report.status = normalizedStatus;
  report.moderator_note = cleanText(moderatorNote, 1000);
  report.reviewed_at = Date.now();
  writeReports(reports);
  return report;
}

function reportCountForTarget(targetType, targetId) {
  return readReports().filter((report) => report.target_type === targetType && report.target_id === targetId).length;
}

module.exports = {
  REASONS,
  TARGET_TYPES,
  createReport,
  listReports,
  reportCountForTarget,
  updateReport,
};
