const path = require("path");

const { atomicWriteJson, safeReadJson } = require("./jsonStore");

// Member-to-member invite relationships. A new member can have exactly one
// referrer, recorded once (first write wins, so it can never be overwritten or
// reassigned later). This is social metadata only — there is no token reward —
// so it lives in the lightweight JSON store alongside the other non-consensus
// records (avatars, newsletter), never on the chain. The path resolves lazily so
// tests can override it.
function referralFile() {
  const dataDir = process.env.VORLIQ_BACKEND_DATA_DIR || path.join(__dirname, "data");
  return process.env.VORLIQ_REFERRAL_FILE || path.join(dataDir, "referrals.json");
}

function emptyStore() {
  // referrals: { <newMemberAddress>: { referrer: <address>, recorded_at: <iso> } }
  return { referrals: {} };
}

function readStore() {
  const parsed = safeReadJson(referralFile(), emptyStore());
  const referrals = parsed && typeof parsed.referrals === "object" && parsed.referrals ? parsed.referrals : {};
  return { referrals };
}

function writeStore(store) {
  atomicWriteJson(referralFile(), { referrals: store.referrals || {} });
}

function getReferrer(address) {
  const key = String(address || "").trim();
  if (!key) return null;
  const entry = readStore().referrals[key];
  return entry && entry.referrer ? entry.referrer : null;
}

// Record that `newMember` was invited by `referrer`. First write wins: if this
// member already has a referrer, the existing one is kept and returned. Returns
// { recorded, referrer, alreadyRecorded }.
function recordReferral(newMember, referrer) {
  const member = String(newMember || "").trim();
  const ref = String(referrer || "").trim();
  if (!member || !ref) {
    return { recorded: false, referrer: null, reason: "missing_address" };
  }
  if (member === ref) {
    return { recorded: false, referrer: null, reason: "self_referral" };
  }
  const store = readStore();
  const existing = store.referrals[member];
  if (existing && existing.referrer) {
    // Already invited by someone — the relationship is immutable.
    return { recorded: false, referrer: existing.referrer, alreadyRecorded: true };
  }
  store.referrals[member] = { referrer: ref, recorded_at: new Date().toISOString() };
  writeStore(store);
  return { recorded: true, referrer: ref };
}

// Every member invited by `address`, newest first.
function invitedBy(address) {
  const key = String(address || "").trim();
  if (!key) return [];
  const { referrals } = readStore();
  return Object.entries(referrals)
    .filter(([, entry]) => entry && entry.referrer === key)
    .sort((a, b) => String(b[1].recorded_at || "").localeCompare(String(a[1].recorded_at || "")))
    .map(([member, entry]) => ({ address: member, recorded_at: entry.recorded_at || null }));
}

module.exports = {
  referralFile,
  getReferrer,
  recordReferral,
  invitedBy,
};
