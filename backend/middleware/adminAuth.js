const crypto = require("crypto");

const { sendError } = require("../utils/apiResponse");
const { recordHit, peekHit, clearHit, resetStore } = require("../rateLimitStore");

// Constant-time token comparison. Hashing first gives both inputs a fixed length
// so timingSafeEqual never throws on a length mismatch and the comparison leaks
// neither the token length nor its bytes through response timing.
function tokensMatch(provided, expected) {
  const a = crypto.createHash("sha256").update(String(provided)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Brute-force lockout for the admin token. Five wrong tokens from one IP within
// ten minutes locks that IP out of every admin endpoint for one hour. A correct
// token immediately clears that IP's failure count. Counters live in the SHARED
// file store (not per-process memory), so the lockout is enforced globally across
// all Node workers.
const FAILURE_LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 60 * 60 * 1000;
const FAIL_NS = "admin-fail";
const LOCK_NS = "admin-lock";
const DISABLED = process.env.VORLIQ_DISABLE_RATE_LIMITS === "true";

function ipKey(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

function lockedSeconds(req) {
  if (DISABLED) return 0;
  const lock = peekHit(LOCK_NS, ipKey(req));
  if (!lock.count) return 0;
  const remaining = lock.resetAt - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function recordFailure(req) {
  if (DISABLED) return;
  const key = ipKey(req);
  const { count } = recordHit(FAIL_NS, key, WINDOW_MS);
  if (count >= FAILURE_LIMIT) {
    // Open (or keep) a one-hour lock for this IP.
    recordHit(LOCK_NS, key, LOCK_MS);
  }
}

function clearFailures(req) {
  const key = ipKey(req);
  clearHit(FAIL_NS, key);
  clearHit(LOCK_NS, key);
}

function adminAuth(req, res, next) {
  // A locked-out connection cannot even attempt a token, so a brute force is
  // stopped here no matter what it sends.
  const locked = lockedSeconds(req);
  if (locked > 0) {
    res.set("Retry-After", String(locked));
    return sendError(res, 429, "ADMIN_LOCKED", "Too many failed admin attempts. This connection is locked. Try again later.");
  }

  const adminToken = process.env.ADMIN_TOKEN;
  const authorization = req.get("authorization") || "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!adminToken || !providedToken || !tokensMatch(providedToken, adminToken)) {
    recordFailure(req);
    return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
  }

  // A correct token clears the slate for this connection.
  clearFailures(req);
  return next();
}

function resetAdminLockoutForTests() {
  resetStore();
}

module.exports = adminAuth;
module.exports.resetAdminLockoutForTests = resetAdminLockoutForTests;
