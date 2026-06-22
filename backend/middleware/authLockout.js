// Failed-attempt lockout for the wallet-authentication path.
//
// Wallet unlock and key derivation happen in the member's browser, so the only
// place the backend can see a wallet-authentication attempt is the signed-
// authorization gateway: every authenticated write must carry a signature proving
// control of the wallet. A brute-force or forgery attempt against a wallet shows
// up here as a run of signatures that fail to verify. This module counts those
// credential failures per client and, after five within ten minutes, locks the
// client out for ten minutes with a clear message saying how long to wait.
//
// Only genuine credential failures count (a bad signature, or a wallet/key that
// does not match) — transient envelope problems like an expired timestamp or a
// replayed nonce do not, so a member with a slow clock is never locked out. A
// successful authorization immediately clears the client's failure count.

const FAILURE_LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000; // five failures must fall inside ten minutes
const LOCK_MS = 10 * 60 * 1000; // lock duration once the limit is hit

// Disabled under the same flag the rate limiters use, so the e2e harness (which
// drives the real write paths hard, but always with valid signatures) is never
// affected. Never set in production.
const DISABLED = process.env.VORLIQ_DISABLE_RATE_LIMITS === "true";

// Credential failures that indicate a wrong/forged key — the signals of a brute
// force. Format/timing failures are deliberately excluded.
const CREDENTIAL_FAILURE_CODES = new Set([
  "AUTHORIZATION_SIGNATURE_INVALID",
  "AUTHORIZATION_WALLET_MISMATCH",
  "AUTHORIZATION_PUBLIC_KEY_INVALID",
  "AUTHORIZATION_ACTOR_MISMATCH",
  "AUTHORIZATION_WALLET_INVALID",
]);

const attempts = new Map(); // clientKey -> { count, firstAt, lockedUntil }

function clientKey(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

// Seconds remaining on an active lock for this client, or 0 if not locked.
function lockedSecondsRemaining(req) {
  if (DISABLED) return 0;
  const entry = attempts.get(clientKey(req));
  if (!entry || !entry.lockedUntil) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// Record a credential failure. Returns the seconds remaining on the lock if this
// failure tripped (or is within) a lockout, otherwise 0.
function recordFailure(req, code) {
  if (DISABLED || !CREDENTIAL_FAILURE_CODES.has(code)) return 0;
  const now = Date.now();
  const key = clientKey(req);
  let entry = attempts.get(key);
  // Start a fresh window if there is none, or the previous one has fully elapsed
  // and no lock is active.
  const windowExpired = entry && now - entry.firstAt > WINDOW_MS && (!entry.lockedUntil || entry.lockedUntil <= now);
  if (!entry || windowExpired) {
    entry = { count: 0, firstAt: now, lockedUntil: 0 };
  }
  entry.count += 1;
  if (entry.count >= FAILURE_LIMIT) {
    entry.lockedUntil = now + LOCK_MS;
  }
  attempts.set(key, entry);
  return entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1000) : 0;
}

function clearFailures(req) {
  attempts.delete(clientKey(req));
}

function lockoutMessage(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return (
    `Too many failed wallet authorization attempts. For your security this connection is ` +
    `locked for about ${minutes} minute${minutes === 1 ? "" : "s"}. Please wait and try again.`
  );
}

function resetAuthLockoutForTests() {
  attempts.clear();
}

module.exports = {
  CREDENTIAL_FAILURE_CODES,
  clearFailures,
  lockedSecondsRemaining,
  lockoutMessage,
  recordFailure,
  resetAuthLockoutForTests,
};
