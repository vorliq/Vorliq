const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const { logError } = require("../logger");

function rateLimitHandler(req, res, _next, options) {
  logError(`Rate limit rejected ${req.method} ${req.originalUrl} from ${req.ip}`);
  return res.status(options.statusCode).json({
    success: false,
    message: options.message,
  });
}

function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message,
    handler: rateLimitHandler,
  });
}

const apiSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 120,
  delayMs: () => 100,
  validate: { delayMs: false },
});

const generalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 450,
  message: "Too many requests. Please slow down and try again soon.",
});

const walletLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: "Too many wallets created from this connection. Please try again later.",
});

const miningLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 6,
  message: "Mining requests are rate limited. Please wait before trying again.",
});

const transactionLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many transaction submissions. Please wait before trying again.",
});

const writeLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 50,
  message: "Too many write requests. Please wait before trying again.",
});

const proposalLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: "Too many proposal requests. Please try again later.",
});

const reportLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Weekly report generation is rate limited. Please try again later.",
});

const registryLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many registry requests. Please try again later.",
});

const chatLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 40,
  message: "Chat messages are rate limited. Please slow down.",
});

module.exports = {
  apiSlowDown,
  chatLimiter,
  generalLimiter,
  miningLimiter,
  proposalLimiter,
  registryLimiter,
  reportLimiter,
  transactionLimiter,
  walletLimiter,
  writeLimiter,
};
