const cors = require("cors");
const helmet = require("helmet");

const productionOrigins = new Set([
  "https://vorliq.org",
  "https://www.vorliq.org",
  "https://node.vorliq.org",
  "https://status.vorliq.org",
  "https://vorliq.github.io",
  "https://vorliq.github.io/Vorliq",
]);

const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (productionOrigins.has(origin)) return true;
  if (localhostPattern.test(origin)) return true;
  return false;
}

function corsMiddleware() {
  return cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
}

function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'", "https://formspree.io"],
        "img-src": ["'self'", "data:", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "connect-src": [
          "'self'",
          "https://vorliq.org",
          "https://www.vorliq.org",
          "https://node.vorliq.org",
          "https://status.vorliq.org",
          "https://vorliq.github.io",
          "https://formspree.io",
          "wss://vorliq.org",
          "wss://www.vorliq.org",
          "http://localhost:*",
          "ws://localhost:*",
          "http://127.0.0.1:*",
          "ws://127.0.0.1:*",
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

function securityStatus() {
  return {
    success: true,
    node_env: process.env.NODE_ENV || "development",
    production_mode: process.env.NODE_ENV === "production",
    rate_limiting_enabled: true,
    security_headers_enabled: true,
    cors_restricted: true,
    allowed_production_origins: Array.from(productionOrigins),
  };
}

module.exports = {
  corsMiddleware,
  helmetMiddleware,
  isAllowedOrigin,
  securityStatus,
};
