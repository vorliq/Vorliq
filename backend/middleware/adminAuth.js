const crypto = require("crypto");

const { sendError } = require("../utils/apiResponse");

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
// token immediately clears that IP's failure count.
const FAILURE_LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 60 * 60 * 1000;
const DISABLED = process.env.VORLIQ_DISABLE_RATE_LIMITS === "true";
const attempts = new Map(); // ip -> { count, firstAt, lockedUntil }

function ipKey(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

function lockedSeconds(req) {
  if (DISABLED) return 0;
  const entry = attempts.get(ipKey(req));
  if (!entry || !entry.lockedUntil) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function recordFailure(req) {
  if (DISABLED) return;
  const now = Date.now();
  const key = ipKey(req);
  let entry = attempts.get(key);
  const windowExpired = entry && now - entry.firstAt > WINDOW_MS && (!entry.lockedUntil || entry.lockedUntil <= now);
  if (!entry || windowExpired) entry = { count: 0, firstAt: now, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= FAILURE_LIMIT) entry.lockedUntil = now + LOCK_MS;
  attempts.set(key, entry);
}

function clearFailures(req) {
  attempts.delete(ipKey(req));
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
  attempts.clear();
}

module.exports = adminAuth;
module.exports.resetAdminLockoutForTests = resetAdminLockoutForTests;
