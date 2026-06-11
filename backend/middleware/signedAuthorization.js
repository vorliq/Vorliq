const { sendError } = require("../utils/apiResponse");

const UNSIGNED_AUTHORITY_WRITE_PATHS = new Set([
  "/api/governance/propose",
  "/api/governance/vote",
  "/api/governance/cancel",
  "/api/treasury/propose",
  "/api/treasury/vote",
  "/api/treasury/cancel",
  "/api/lending/request",
  "/api/lending/vote",
  "/api/lending/repay",
]);

const SIGNED_AUTHORIZATION_MESSAGE =
  "This write is unavailable until Vorliq verifies signed wallet authorization. Read-only records remain available.";

function requireSignedAuthorityWrite(req, res, next) {
  if (req.method === "POST" && UNSIGNED_AUTHORITY_WRITE_PATHS.has(req.path)) {
    return sendError(res, 503, "SIGNED_AUTHORIZATION_REQUIRED", SIGNED_AUTHORIZATION_MESSAGE);
  }
  return next();
}

module.exports = {
  requireSignedAuthorityWrite,
  SIGNED_AUTHORIZATION_MESSAGE,
  UNSIGNED_AUTHORITY_WRITE_PATHS,
};
