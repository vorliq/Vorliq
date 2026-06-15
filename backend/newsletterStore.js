const path = require("path");

const { atomicWriteJson, safeReadJson } = require("./jsonStore");

// Newsletter sign-ups are kept in the existing JSON storage system, mirroring
// the other lightweight stores (e.g. communityReports). No new database.
// The path is resolved lazily per call so test env overrides are honoured.
function newsletterFile() {
  const dataDir = process.env.VORLIQ_BACKEND_DATA_DIR || path.join(__dirname, "data");
  return process.env.VORLIQ_NEWSLETTER_FILE || path.join(dataDir, "newsletter.json");
}
const MAX_EMAIL_LENGTH = 254;
// Pragmatic email shape check — deliberately conservative, not RFC-exhaustive.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "VALIDATION_ERROR";
  return error;
}

function normalizeEmail(value) {
  return String(value || "")
    .replace(/\0/g, "")
    .trim()
    .toLowerCase();
}

function readSubscribers() {
  const data = safeReadJson(newsletterFile(), { subscribers: [] });
  return Array.isArray(data.subscribers) ? data.subscribers : [];
}

function writeSubscribers(subscribers) {
  atomicWriteJson(newsletterFile(), { subscribers });
}

// Records an email sign-up. Throws a 400 validation error for a missing/invalid
// address. Returns { created: true, subscriber } for a new sign-up, or
// { created: false, subscriber } when the address is already subscribed.
function subscribe(input = {}, meta = {}) {
  const rawEmail = input.email ?? input.address;
  if (rawEmail == null || String(rawEmail).trim() === "") {
    throw validationError("An email address is required.");
  }
  const email = normalizeEmail(rawEmail);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw validationError("Please provide a valid email address.");
  }

  const subscribers = readSubscribers();
  const existing = subscribers.find((entry) => entry.email === email);
  if (existing) {
    return { created: false, subscriber: existing };
  }

  const subscriber = {
    email,
    subscribed_at: Date.now(),
    source: String(meta.source || "web").slice(0, 120),
  };
  subscribers.push(subscriber);
  // Cap the file to a sane size; sign-ups are append-only otherwise.
  writeSubscribers(subscribers.slice(-100000));
  return { created: true, subscriber };
}

function listSubscribers() {
  return readSubscribers();
}

module.exports = {
  newsletterFile,
  listSubscribers,
  subscribe,
};
