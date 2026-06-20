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

function adminAuth(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  const authorization = req.get("authorization") || "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!adminToken || !providedToken || !tokensMatch(providedToken, adminToken)) {
    return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
  }

  return next();
}

module.exports = adminAuth;
