const { sendError } = require("../utils/apiResponse");

function adminAuth(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  const authorization = req.get("authorization") || "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!adminToken || !providedToken || providedToken !== adminToken) {
    return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
  }

  return next();
}

module.exports = adminAuth;
