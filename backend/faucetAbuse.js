const path = require("path");

const { atomicWriteJson, safeReadJson } = require("./jsonStore");

// Layered faucet-abuse defence that lives in the Node layer, because only the
// Node layer sees the real client IP (Flask is reached over localhost). These
// checks STACK ON TOP OF the existing per-wallet 24h cooldown and device
// fingerprint limit enforced in Flask — they never replace them.
//
//   * IP -> at most 2 distinct wallets may claim per 24h.
//   * Wallet creation velocity: more than 3 wallets created from one IP within an
//     hour blocks that IP from creating more for 24h (the upstream fix).
//   * Minimum wallet age: a wallet must be at least 1h old before its first claim.
//   * Permanent admin bans for an IP or a wallet.
//
// State is the lightweight JSON store, pruned on every write so it stays small.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const WALLET_CREATE_WINDOW_MS = HOUR_MS;
const WALLET_CREATE_LIMIT = 3; // more than 3 within the window trips the block
const WALLET_CREATE_BLOCK_MS = DAY_MS;
const FAUCET_IP_WALLET_LIMIT = 2; // distinct wallets per IP per 24h
const FAUCET_IP_WINDOW_MS = DAY_MS;
const MIN_WALLET_AGE_MS = HOUR_MS;
// A wallet older than this no longer needs a creation record (it trivially passes
// the min-age gate), so we can forget it to bound the store.
const CREATION_RETENTION_MS = 2 * DAY_MS;

function abuseFile() {
  const dataDir = process.env.VORLIQ_BACKEND_DATA_DIR || path.join(__dirname, "data");
  return process.env.VORLIQ_FAUCET_ABUSE_FILE || path.join(dataDir, "faucet-abuse.json");
}

function emptyStore() {
  return {
    walletCreations: {}, // wallet -> { created_at, ip }
    ipCreations: {}, // ip -> [created_at, ...] (last hour)
    ipCreateBlockedUntil: {}, // ip -> timestamp
    walletClaimCounts: {}, // wallet -> all-time successful claim count
    ipClaims: {}, // ip -> [{ wallet, fingerprint, at }] (last 24h)
    bans: { ips: {}, wallets: {} }, // ip/wallet -> { at, reason }
  };
}

function readStore() {
  const parsed = safeReadJson(abuseFile(), emptyStore());
  const base = emptyStore();
  return {
    walletCreations: parsed.walletCreations || base.walletCreations,
    ipCreations: parsed.ipCreations || base.ipCreations,
    ipCreateBlockedUntil: parsed.ipCreateBlockedUntil || base.ipCreateBlockedUntil,
    walletClaimCounts: parsed.walletClaimCounts || base.walletClaimCounts,
    ipClaims: parsed.ipClaims || base.ipClaims,
    bans: { ips: (parsed.bans && parsed.bans.ips) || {}, wallets: (parsed.bans && parsed.bans.wallets) || {} },
  };
}

function prune(store, now) {
  for (const [wallet, entry] of Object.entries(store.walletCreations)) {
    if (now - Number(entry.created_at || 0) > CREATION_RETENTION_MS) delete store.walletCreations[wallet];
  }
  for (const [ip, list] of Object.entries(store.ipCreations)) {
    const kept = (list || []).filter((ts) => now - Number(ts) < WALLET_CREATE_WINDOW_MS);
    if (kept.length) store.ipCreations[ip] = kept;
    else delete store.ipCreations[ip];
  }
  for (const [ip, until] of Object.entries(store.ipCreateBlockedUntil)) {
    if (Number(until) <= now) delete store.ipCreateBlockedUntil[ip];
  }
  for (const [ip, list] of Object.entries(store.ipClaims)) {
    const kept = (list || []).filter((c) => now - Number(c.at) < FAUCET_IP_WINDOW_MS);
    if (kept.length) store.ipClaims[ip] = kept;
    else delete store.ipClaims[ip];
  }
  return store;
}

function writeStore(store, now = Date.now()) {
  atomicWriteJson(abuseFile(), prune(store, now));
}

function normIp(ip) {
  return String(ip || "unknown").trim() || "unknown";
}

// ---------------------------------------------------------------- bans -----
function isIpBanned(ip) {
  return Boolean(readStore().bans.ips[normIp(ip)]);
}
function isWalletBanned(wallet) {
  return Boolean(readStore().bans.wallets[String(wallet || "")]);
}
function banIp(ip, reason) {
  const store = readStore();
  store.bans.ips[normIp(ip)] = { at: new Date().toISOString(), reason: String(reason || "manual admin ban") };
  writeStore(store);
}
function banWallet(wallet, reason) {
  const store = readStore();
  store.bans.wallets[String(wallet || "")] = { at: new Date().toISOString(), reason: String(reason || "manual admin ban") };
  writeStore(store);
}
function unbanIp(ip) {
  const store = readStore();
  delete store.bans.ips[normIp(ip)];
  writeStore(store);
}
function unbanWallet(wallet) {
  const store = readStore();
  delete store.bans.wallets[String(wallet || "")];
  writeStore(store);
}

// ----------------------------------------------- wallet creation -----------
// Decide whether an IP may create another wallet right now. Trips (and persists)
// a 24h block when the per-hour velocity is exceeded. Returns
// { allowed, retryAfterSeconds, reason }.
function walletCreateDecision(ip, now = Date.now()) {
  // Same escape hatch the rate limiters use (rateLimits.js, authLockout.js,
  // adminAuth.js): the e2e harness legitimately creates many wallets from one
  // IP, which would trip the velocity gate and persist a 24h block. Only the
  // e2e harness sets this flag, never production. Unit tests do not set it,
  // so the velocity-gate tests still exercise the real behaviour.
  if (process.env.VORLIQ_DISABLE_RATE_LIMITS === "true") {
    return { allowed: true };
  }
  const store = readStore();
  ip = normIp(ip);
  const blockedUntil = Number(store.ipCreateBlockedUntil[ip] || 0);
  if (blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000), reason: "blocked" };
  }
  const recent = (store.ipCreations[ip] || []).filter((ts) => now - Number(ts) < WALLET_CREATE_WINDOW_MS);
  if (recent.length >= WALLET_CREATE_LIMIT) {
    const until = now + WALLET_CREATE_BLOCK_MS;
    store.ipCreateBlockedUntil[ip] = until;
    writeStore(store, now);
    return { allowed: false, retryAfterSeconds: Math.ceil(WALLET_CREATE_BLOCK_MS / 1000), reason: "velocity" };
  }
  return { allowed: true };
}

// Record a wallet that was actually created, with its IP and the IP's creation
// timestamp (used by the velocity window and the min-age gate).
function recordWalletCreation(wallet, ip, now = Date.now()) {
  const store = readStore();
  ip = normIp(ip);
  store.walletCreations[String(wallet)] = { created_at: now, ip };
  store.ipCreations[ip] = (store.ipCreations[ip] || []).concat(now);
  writeStore(store, now);
}

function walletCreatedAt(wallet) {
  const entry = readStore().walletCreations[String(wallet || "")];
  return entry ? Number(entry.created_at) : null;
}

// Min-age gate. Unknown wallets (created before this feature, or imported) are
// grandfathered — we only block wallets we have a fresh creation record for.
function walletTooNew(wallet, now = Date.now()) {
  const createdAt = walletCreatedAt(wallet);
  if (createdAt == null) return false;
  return now - createdAt < MIN_WALLET_AGE_MS;
}

// ----------------------------------------------- faucet claims -------------
// Distinct wallets that have successfully claimed from this IP within 24h.
function ipDistinctWallets(ip, now = Date.now()) {
  const list = (readStore().ipClaims[normIp(ip)] || []).filter((c) => now - Number(c.at) < FAUCET_IP_WINDOW_MS);
  return new Set(list.map((c) => c.wallet));
}

// Decide whether this IP may claim for this wallet. Already-seen wallets are
// allowed through (the per-wallet cooldown handles repeats); a NEW wallet beyond
// the 2-per-24h distinct limit is blocked. Returns { allowed, reason }.
function ipFaucetDecision(ip, wallet, now = Date.now()) {
  // Same e2e-harness escape hatch as walletCreateDecision above: the journeys
  // claim for many fresh wallets from one IP, which is exactly what this gate
  // exists to stop in production. Unit tests do not set the flag.
  if (process.env.VORLIQ_DISABLE_RATE_LIMITS === "true") {
    return { allowed: true };
  }
  const wallets = ipDistinctWallets(ip, now);
  if (wallets.has(String(wallet))) return { allowed: true };
  if (wallets.size >= FAUCET_IP_WALLET_LIMIT) {
    return { allowed: false, retryAfterSeconds: Math.ceil(FAUCET_IP_WINDOW_MS / 1000), reason: "ip_wallet_limit" };
  }
  return { allowed: true };
}

// Record a successful claim. Counts toward the IP distinct-wallet limit and the
// all-time per-wallet tally.
function recordFaucetClaim(ip, wallet, fingerprint, now = Date.now()) {
  const store = readStore();
  ip = normIp(ip);
  store.ipClaims[ip] = (store.ipClaims[ip] || []).concat({ wallet: String(wallet), fingerprint: String(fingerprint || ""), at: now });
  store.walletClaimCounts[String(wallet)] = (store.walletClaimCounts[String(wallet)] || 0) + 1;
  writeStore(store, now);
}

// ----------------------------------------------- admin views ---------------
function topIpsByClaims24h(limit = 10, now = Date.now()) {
  const store = readStore();
  const rows = Object.entries(store.ipClaims).map(([ip, list]) => {
    const recent = (list || []).filter((c) => now - Number(c.at) < FAUCET_IP_WINDOW_MS);
    return { ip, claims: recent.length, distinct_wallets: new Set(recent.map((c) => c.wallet)).size };
  });
  return rows.filter((r) => r.claims > 0).sort((a, b) => b.claims - a.claims).slice(0, limit);
}

function topWalletsByClaims(limit = 10) {
  const store = readStore();
  return Object.entries(store.walletClaimCounts)
    .map(([wallet, claims]) => ({ wallet, claims }))
    .sort((a, b) => b.claims - a.claims)
    .slice(0, limit);
}

function ipsAtMultiWalletLimit(now = Date.now()) {
  const store = readStore();
  return Object.entries(store.ipClaims)
    .map(([ip, list]) => {
      const recent = (list || []).filter((c) => now - Number(c.at) < FAUCET_IP_WINDOW_MS);
      return { ip, distinct_wallets: new Set(recent.map((c) => c.wallet)).size };
    })
    .filter((r) => r.distinct_wallets >= FAUCET_IP_WALLET_LIMIT)
    .sort((a, b) => b.distinct_wallets - a.distinct_wallets);
}

function listBans() {
  const store = readStore();
  return {
    ips: Object.entries(store.bans.ips).map(([ip, meta]) => ({ ip, ...meta })),
    wallets: Object.entries(store.bans.wallets).map(([wallet, meta]) => ({ wallet, ...meta })),
  };
}

module.exports = {
  abuseFile,
  // constants (also used in messages/tests)
  WALLET_CREATE_LIMIT,
  FAUCET_IP_WALLET_LIMIT,
  MIN_WALLET_AGE_MS,
  // bans
  isIpBanned,
  isWalletBanned,
  banIp,
  banWallet,
  unbanIp,
  unbanWallet,
  listBans,
  // wallet creation
  walletCreateDecision,
  recordWalletCreation,
  walletCreatedAt,
  walletTooNew,
  // faucet claims
  ipFaucetDecision,
  recordFaucetClaim,
  ipDistinctWallets,
  // admin views
  topIpsByClaims24h,
  topWalletsByClaims,
  ipsAtMultiWalletLimit,
};
