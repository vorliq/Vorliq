const crypto = require("crypto");
const { API_STABILITY, API_VERSION } = require("../utils/apiResponse");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

function cleanIncomingRequestId(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return "";
  const trimmed = candidate.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : "";
}

function requestMetadata(req, res, next) {
  req.requestId = cleanIncomingRequestId(req.get("x-request-id")) || crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  res.setHeader("X-Vorliq-API-Version", API_VERSION);
  res.setHeader("X-Vorliq-API-Stability", API_STABILITY);
  next();
}

function apiV1Alias(req, res, next) {
  if (req.url === "/api/v1" || req.url.startsWith("/api/v1/")) {
    req.vorliqApiVersion = "v1";
    req.vorliqOriginalUrl = req.originalUrl;
    req.url = req.url.replace(/^\/api\/v1(?=\/|$)/, "/api");
  }
  next();
}

module.exports = {
  apiV1Alias,
  cleanIncomingRequestId,
  requestMetadata,
};
