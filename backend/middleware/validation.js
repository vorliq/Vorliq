const net = require("net");
const { logError } = require("../logger");

const SYSTEM_ADDRESSES = new Set(["SYSTEM", "VORLIQ_TREASURY", "LENDING_POOL"]);
const FORUM_CATEGORIES = new Set(["general", "mining", "lending", "exchange", "governance", "technical"]);
const GOVERNANCE_CATEGORIES = new Set(["mining_reward", "difficulty", "loan_limit", "loan_interest", "exchange_limit", "general"]);
const TREASURY_CATEGORIES = new Set(["development", "marketing", "community", "infrastructure", "security", "education", "other"]);

function reject(req, res, message, status = 400) {
  logError(`Validation rejected ${req.method} ${req.originalUrl}: ${message}`);
  return res.status(status).json({ success: false, message });
}

function text(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim();
}

function get(body, ...names) {
  for (const name of names) {
    if (body[name] !== undefined && body[name] !== null) return body[name];
  }
  return undefined;
}

function requireText(req, res, body, names, label, maxLength) {
  const value = text(get(body, ...names));
  if (!value) return reject(req, res, `${label} is required.`);
  if (maxLength && value.length > maxLength) return reject(req, res, `${label} must be ${maxLength} characters or fewer.`);
  body[names[0]] = value;
  return value;
}

function requireNumber(req, res, body, names, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(get(body, ...names));
  if (!Number.isFinite(value)) return reject(req, res, `${label} must be a valid number.`);
  if (value <= min) return reject(req, res, `${label} must be greater than ${min}.`);
  if (value > max) return reject(req, res, `${label} is too large.`);
  body[names[0]] = value;
  return value;
}

function requireEnum(req, res, body, names, label, allowed) {
  const value = requireText(req, res, body, names, label, 80);
  if (res.headersSent) return undefined;
  const normalized = value.toLowerCase();
  if (!allowed.has(normalized)) return reject(req, res, `${label} is not valid.`);
  body[names[0]] = normalized;
  return normalized;
}

function validateAddress(req, res, body, names, label) {
  const value = requireText(req, res, body, names, label, 160);
  if (res.headersSent) return undefined;
  return value;
}

function validateSignature(req, res, body, names, label) {
  const value = requireText(req, res, body, names, label, 512);
  if (res.headersSent) return undefined;
  if (!/^[0-9a-fA-F]+$/.test(value)) return reject(req, res, `${label} must be hex encoded.`);
  return value;
}

function validatePublicUrl(req, res, body, names, label) {
  const value = requireText(req, res, body, names, label, 240);
  if (res.headersSent) return undefined;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return reject(req, res, `${label} must be a valid URL.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return reject(req, res, `${label} must use http or https.`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalDevelopment = process.env.NODE_ENV !== "production";
  const privateHost =
    host === "localhost" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("169.254.") ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    net.isIP(host) === 0 && host.endsWith(".local");

  if (privateHost && !isLocalDevelopment) {
    return reject(req, res, `${label} must be a public URL.`);
  }

  body[names[0]] = parsed.toString().replace(/\/$/, "");
  return body[names[0]];
}

function validateBody(req, res, next) {
  const body = req.body || {};
  const path = req.path;

  if (path === "/api/wallet/balance") {
    if (!text(req.query.address)) return reject(req, res, "wallet address is required.");
  }

  if (path === "/api/transaction/send") {
    const sender = validateAddress(req, res, body, ["sender_address", "senderAddress", "sender"], "sender address");
    if (res.headersSent) return;
    if (SYSTEM_ADDRESSES.has(sender)) return reject(req, res, "system-controlled addresses cannot submit public transactions.");
    validateAddress(req, res, body, ["receiver_address", "receiverAddress", "receiver"], "receiver address");
    if (res.headersSent) return;
    requireNumber(req, res, body, ["amount"], "amount", { min: 0, max: 21_000_000 });
    if (res.headersSent) return;
    validateSignature(req, res, body, ["signature"], "signature");
    if (res.headersSent) return;
    requireText(req, res, body, ["sender_public_key", "senderPublicKey"], "sender public key", 3000);
  }

  if (path === "/api/mine") {
    validateAddress(req, res, body, ["miner_address", "minerAddress"], "miner address");
  }

  if (path === "/api/forum/post") {
    validateAddress(req, res, body, ["author_address", "authorAddress"], "author address");
    if (res.headersSent) return;
    requireText(req, res, body, ["title"], "title", 140);
    if (res.headersSent) return;
    requireText(req, res, body, ["body"], "body", 5000);
    if (res.headersSent) return;
    requireEnum(req, res, body, ["category"], "category", FORUM_CATEGORIES);
  }

  if (path === "/api/forum/reply") {
    requireText(req, res, body, ["post_id", "postId"], "post ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["author_address", "authorAddress"], "author address");
    if (res.headersSent) return;
    requireText(req, res, body, ["body"], "reply", 3000);
  }

  if (path === "/api/forum/upvote") {
    requireText(req, res, body, ["post_id", "postId"], "post ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["address"], "wallet address");
  }

  if (path === "/api/forum/feature") {
    requireText(req, res, body, ["post_id", "postId"], "post ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["voter_address", "voterAddress"], "voter address");
  }

  if (path === "/api/lending/request") {
    validateAddress(req, res, body, ["requester_address", "requesterAddress"], "requester address");
    if (res.headersSent) return;
    requireNumber(req, res, body, ["amount"], "loan amount", { min: 0, max: 10000 });
    if (res.headersSent) return;
    requireText(req, res, body, ["reason"], "reason", 1000);
  }

  if (path === "/api/lending/vote") {
    requireText(req, res, body, ["loan_id", "loanId"], "loan ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["voter_address", "voterAddress"], "voter address");
    if (res.headersSent) return;
    requireEnum(req, res, body, ["vote"], "vote", new Set(["yes", "no"]));
  }

  if (path === "/api/lending/repay") {
    requireText(req, res, body, ["loan_id", "loanId"], "loan ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["repayer_address", "repayerAddress"], "repayer address");
  }

  if (req.method === "POST" && path === "/api/exchange/offer") {
    validateAddress(req, res, body, ["creator_address", "creatorAddress"], "creator address");
    if (res.headersSent) return;
    requireEnum(req, res, body, ["offer_type", "offerType"], "offer type", new Set(["buy", "sell"]));
    if (res.headersSent) return;
    requireNumber(req, res, body, ["amount"], "offer amount", { min: 0, max: 100000 });
    if (res.headersSent) return;
    requireText(req, res, body, ["price"], "price", 160);
    if (res.headersSent) return;
    requireText(req, res, body, ["description"], "description", 1000);
  }

  if (path === "/api/exchange/accept") {
    requireText(req, res, body, ["offer_id", "offerId"], "offer ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["acceptor_address", "acceptorAddress"], "acceptor address");
  }

  if (path === "/api/exchange/complete" || path === "/api/exchange/cancel" || path === "/api/exchange/confirm-complete") {
    requireText(req, res, body, ["offer_id", "offerId"], "offer ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["caller_address", "callerAddress"], "caller address");
  }

  if (path === "/api/exchange/record-vlq-tx") {
    requireText(req, res, body, ["offer_id", "offerId"], "offer ID", 128);
    if (res.headersSent) return;
    requireText(req, res, body, ["tx_id", "txId"], "transaction ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["caller_address", "callerAddress"], "caller address");
  }

  if (path === "/api/exchange/dispute") {
    requireText(req, res, body, ["offer_id", "offerId"], "offer ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["caller_address", "callerAddress"], "caller address");
    if (res.headersSent) return;
    requireText(req, res, body, ["reason"], "dispute reason", 1000);
  }

  if (path === "/api/governance/propose") {
    validateAddress(req, res, body, ["proposer_address", "proposerAddress"], "proposer address");
    if (res.headersSent) return;
    requireText(req, res, body, ["title"], "title", 160);
    if (res.headersSent) return;
    requireText(req, res, body, ["description"], "description", 3000);
    if (res.headersSent) return;
    const category = requireEnum(req, res, body, ["category"], "category", GOVERNANCE_CATEGORIES);
    if (res.headersSent) return;
    if (category === "general") {
      requireText(req, res, body, ["parameter"], "parameter value", 500);
    } else {
      const value = Number(get(body, "parameter"));
      if (!Number.isFinite(value)) return reject(req, res, "parameter value must be a valid number.");
      if (category === "mining_reward" && (value <= 0 || value > 1000)) {
        return reject(req, res, "mining reward must be greater than 0 and no more than 1000 VLQ.");
      }
      if (category === "difficulty" && (!Number.isInteger(value) || value < 2 || value > 8)) {
        return reject(req, res, "difficulty must be an integer between 2 and 8.");
      }
      if (category === "loan_limit" && (value <= 0 || value > 1_000_000)) {
        return reject(req, res, "loan limit must be greater than 0 and no more than 1000000 VLQ.");
      }
      if (category === "loan_interest" && (value < 0 || value > 100)) {
        return reject(req, res, "loan interest must be between 0 and 100 percent.");
      }
      if (category === "exchange_limit" && (!Number.isInteger(value) || value <= 0 || value > 1000)) {
        return reject(req, res, "exchange limit must be between 1 and 1000.");
      }
      body.parameter = value;
    }
  }

  if (path === "/api/governance/cancel") {
    requireText(req, res, body, ["proposal_id", "proposalId"], "proposal ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["proposer_address", "proposerAddress"], "proposer address");
  }

  if (path === "/api/treasury/propose") {
    validateAddress(req, res, body, ["proposer_address", "proposerAddress"], "proposer address");
    if (res.headersSent) return;
    validateAddress(req, res, body, ["recipient_address", "recipientAddress"], "recipient address");
    if (res.headersSent) return;
    requireText(req, res, body, ["title"], "title", 160);
    if (res.headersSent) return;
    requireText(req, res, body, ["description"], "description", 3000);
    if (res.headersSent) return;
    requireEnum(req, res, body, ["category"], "category", TREASURY_CATEGORIES);
    if (res.headersSent) return;
    requireNumber(req, res, body, ["requested_amount", "requestedAmount"], "requested amount", { min: 0, max: 1_000_000 });
  }

  if (path === "/api/treasury/vote") {
    requireText(req, res, body, ["proposal_id", "proposalId"], "proposal ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["voter_address", "voterAddress"], "voter address");
    if (res.headersSent) return;
    requireEnum(req, res, body, ["vote"], "vote", new Set(["yes", "no"]));
  }

  if (path === "/api/treasury/cancel") {
    requireText(req, res, body, ["proposal_id", "proposalId"], "proposal ID", 128);
    if (res.headersSent) return;
    validateAddress(req, res, body, ["proposer_address", "proposerAddress"], "proposer address");
  }

  if (path === "/api/price/signal") {
    validateAddress(req, res, body, ["submitter_address", "submitterAddress"], "submitter address");
    if (res.headersSent) return;
    requireText(req, res, body, ["currency"], "currency", 24);
    if (res.headersSent) return;
    requireNumber(req, res, body, ["price_value", "priceValue", "price"], "price", { min: 0, max: 1_000_000_000 });
  }

  if (path === "/api/registry/register") {
    validatePublicUrl(req, res, body, ["node_url", "nodeUrl"], "node URL");
    if (res.headersSent) return;
    requireText(req, res, body, ["display_name", "displayName"], "display name", 80);
  }

  if (path === "/api/registry/heartbeat" || path === "/api/peers/announce") {
    validatePublicUrl(req, res, body, ["node_url", "nodeUrl"], "node URL");
  }

  if (path === "/api/peers/add") {
    validatePublicUrl(req, res, body, ["peer"], "peer URL");
  }

  if (res.headersSent) return;
  req.body = body;
  next();
}

module.exports = {
  validateBody,
  validatePublicUrl,
};
