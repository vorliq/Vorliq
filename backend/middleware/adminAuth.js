function adminAuth(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  const authorization = req.get("authorization") || "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!adminToken || !providedToken || providedToken !== adminToken) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  return next();
}

module.exports = adminAuth;
