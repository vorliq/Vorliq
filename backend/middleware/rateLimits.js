const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const crypto = require("crypto");
const { logError } = require("../logger");

// Seconds until the window resets, for the Retry-After header. express-rate-limit
// exposes req.rateLimit.resetTime; fall back to the full window if it is missing.
function retryAfterSeconds(req, windowMs) {
  const reset = req.rateLimit && req.rateLimit.resetTime;
  if (reset instanceof Date) {
    return Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000));
  }
  return Math.max(1, Math.ceil((windowMs || 60000) / 1000));
}

function rateLimitHandler(req, res, _next, options) {
  logError(`Rate limit rejected ${req.method} ${req.originalUrl} from ${req.ip}`);
  // Every rate-limited response tells a legitimate client exactly when to retry.
  res.set("Retry-After", String(retryAfterSeconds(req, options.windowMs)));
  return res.status(options.statusCode).json({
    success: false,
    message: options.message,
  });
}

// Per-wallet key for signed writes: the rate limit follows the acting wallet
// (taken from the request body's actor field) rather than the IP, so it cannot be
// dodged by switching connection and one busy wallet cannot exhaust a shared IP.
function walletKey(req) {
  const body = req.body || {};
  const wallet =
    body.sender_address || body.senderAddress ||
    body.voter_address || body.voterAddress ||
    body.author_address || body.authorAddress ||
    body.requester_address || body.requesterAddress ||
    body.repayer_address || body.repayerAddress ||
    body.proposer_address || body.proposerAddress ||
    body.wallet_address || body.walletAddress;
  return wallet ? `w:${String(wallet).slice(0, 160)}` : `ip:${req.ip}`;
}

// End-to-end runs drive the real write paths hard (many wallets, mines, claims)
// from a single IP, which legitimately trips the per-IP limits. When this flag is
// set (only by the e2e harness, never in production) the caps are raised so the
// suite can run; the limiter middleware stays wired so its behaviour is still
// exercised. Unit tests do NOT set this flag, so the rate-limit tests still pass.
const RELAX_LIMITS = process.env.VORLIQ_DISABLE_RATE_LIMITS === "true";

function cap(max) {
  return RELAX_LIMITS ? 1_000_000 : max;
}

function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max: cap(max),
    standardHeaders: true,
    legacyHeaders: false,
    message,
    handler: rateLimitHandler,
  });
}

const apiSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: cap(120),
  delayMs: () => 100,
  validate: { delayMs: false },
});

const generalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 450,
  message: "Too many requests. Please slow down and try again soon.",
});

// Wallet creation is the second tightest public limit (after the faucet): it is
// where multi-wallet abuse begins, and the faucetAbuse velocity check (3/hour)
// is the real ceiling, so this is a calibrated backstop, not a generous default.
const walletLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
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

// The faucet gets the tightest public limit. A legitimate user claims at most
// once per 24h per wallet, so even a handful of attempts per hour is plenty.
const faucetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: cap(6),
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many faucet claims. Please try again later.",
  handler(req, res, _next, options) {
    const fingerprint = crypto
      .createHash("sha256")
      .update(`${req.ip || ""}:${req.get("user-agent") || ""}`)
      .digest("hex");
    logError(`Faucet rate limit rejected ${req.method} ${req.originalUrl} fingerprint=${fingerprint}`);
    res.set("Retry-After", String(retryAfterSeconds(req, options.windowMs)));
    return res.status(options.statusCode).json({
      success: false,
      message: options.message,
    });
  },
});

// Per-wallet limit for signed value writes (send, governance vote, lending):
// ten per minute per wallet, keyed by the acting wallet with Retry-After backoff.
const perWalletWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: cap(10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: walletKey,
  message: "You are making signed actions too quickly. Please wait a few seconds and try again.",
  handler: rateLimitHandler,
});

// Forum posting: five posts per minute per wallet.
const forumPostLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: cap(5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: walletKey,
  message: "You are posting too quickly. Please wait a moment before posting again.",
  handler: rateLimitHandler,
});

// Exchange coordination endpoints: twenty requests per minute per IP.
const exchangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: cap(20),
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many exchange requests. Please slow down and try again shortly.",
  handler: rateLimitHandler,
});

const chatLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 40,
  message: "Chat messages are rate limited. Please slow down.",
});

// Public unauthenticated sign-up write. A handful of legitimate retries are
// fine; a flood from one IP is abuse. Sits on top of the global generalLimiter.
const newsletterLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many sign-up attempts from this connection. Please try again later.",
});

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: cap(80),
  standardHeaders: true,
  legacyHeaders: false,
  message: "Analytics requests are rate limited. Please slow down.",
  handler(req, res, _next, options) {
    logError(`Analytics rate limit rejected ${req.method} ${req.originalUrl}`);
    res.set("Retry-After", String(retryAfterSeconds(req, options.windowMs)));
    return res.status(options.statusCode).json({
      success: false,
      message: options.message,
    });
  },
});

module.exports = {
  analyticsLimiter,
  apiSlowDown,
  chatLimiter,
  exchangeLimiter,
  faucetLimiter,
  forumPostLimiter,
  generalLimiter,
  miningLimiter,
  newsletterLimiter,
  perWalletWriteLimiter,
  proposalLimiter,
  registryLimiter,
  reportLimiter,
  transactionLimiter,
  walletLimiter,
  writeLimiter,
};
