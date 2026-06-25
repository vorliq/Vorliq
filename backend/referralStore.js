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

// The one-time on-chain reward (in VLQ) paid to a referrer from the treasury when
// a member they invited makes their first faucet claim.
const REFERRAL_BONUS = 5;

// Mark that the referral bonus has been paid for `member` (the referred wallet),
// recording the on-chain tx so it can be shown and so the bonus fires exactly
// once. Returns { paid:true, referrer } the first time, { paid:false, reason } if
// the member has no referrer, is its own referrer, or was already paid.
function markBonusPaid(member, txId) {
  const key = String(member || "").trim();
  if (!key) return { paid: false, reason: "missing_address" };
  const store = readStore();
  const entry = store.referrals[key];
  if (!entry || !entry.referrer) return { paid: false, reason: "no_referrer" };
  if (entry.referrer === key) return { paid: false, reason: "self_referral" };
  if (entry.bonus_paid_at) return { paid: false, reason: "already_paid", referrer: entry.referrer };
  entry.bonus_paid_at = new Date().toISOString();
  entry.bonus_tx_id = String(txId || "") || null;
  writeStore(store);
  return { paid: true, referrer: entry.referrer };
}

// Has the referral bonus already been paid for this referred member?
function isBonusPaid(member) {
  const entry = readStore().referrals[String(member || "").trim()];
  return Boolean(entry && entry.bonus_paid_at);
}

// Total referral reward earned by `address`: REFERRAL_BONUS for each member they
// invited whose bonus has been paid, plus the paid/pending counts.
function referralEarnings(address) {
  const key = String(address || "").trim();
  const { referrals } = readStore();
  let paidCount = 0;
  let pendingCount = 0;
  for (const entry of Object.values(referrals)) {
    if (!entry || entry.referrer !== key) continue;
    if (entry.bonus_paid_at) paidCount += 1;
    else pendingCount += 1;
  }
  return { total_vlq: paidCount * REFERRAL_BONUS, paid_count: paidCount, pending_count: pendingCount, bonus_per_referral: REFERRAL_BONUS };
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
  markBonusPaid,
  isBonusPaid,
  referralEarnings,
  REFERRAL_BONUS,
};
