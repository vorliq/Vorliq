const crypto = require("crypto");

const { sendError } = require("../utils/apiResponse");

const AUTHORIZATION_DOMAIN = "vorliq.authority.v1";
const AUTHORIZATION_MAX_AGE_SECONDS = 300;
const AUTHORIZATION_FUTURE_SKEW_SECONDS = 30;
const SIGNED_AUTHORIZATION_MESSAGE =
  "This write requires signed wallet authorization. Read-only records remain available.";
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const ROLE_LIKE_IDENTITIES = new Set(["admin", "operator", "moderator", "system", "vorliq_treasury", "lending_pool"]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const OVERRIDE_FIELDS = new Set([
  "authority_override",
  "authorityOverride",
  "balance",
  "current_treasury_balance",
  "currentTreasuryBalance",
  "source_balance",
  "sourceBalance",
  "treasury_balance",
  "treasuryBalance",
  "vote_weight",
  "voteWeight",
  "voter_balance",
  "voterBalance",
  "voting_balance",
  "votingBalance",
]);
const AUTHORITY_ROUTES = new Map([
  ["/api/governance/propose", { action: "governance.propose", actorFields: ["proposer_address", "proposerAddress"] }],
  ["/api/governance/vote", { action: "governance.vote", actorFields: ["voter_address", "voterAddress"] }],
  ["/api/governance/cancel", { action: "governance.cancel", actorFields: ["proposer_address", "proposerAddress"] }],
  ["/api/treasury/propose", { action: "treasury.propose", actorFields: ["proposer_address", "proposerAddress"] }],
  ["/api/treasury/vote", { action: "treasury.vote", actorFields: ["voter_address", "voterAddress"] }],
  ["/api/treasury/cancel", { action: "treasury.cancel", actorFields: ["proposer_address", "proposerAddress"] }],
  ["/api/lending/request", { action: "lending.request", actorFields: ["requester_address", "requesterAddress"] }],
  ["/api/lending/vote", { action: "lending.vote", actorFields: ["voter_address", "voterAddress"] }],
  ["/api/lending/repay", { action: "lending.repay", actorFields: ["repayer_address", "repayerAddress"] }],
  // Forum authorship: posts/replies render the author's profile name, avatar, and
  // "Wallet Verified" badge, so an unproven author_address let anyone publish a
  // persistent post wearing a real verified member's identity. Enforced here at
  // the Node gateway (the core binds to localhost behind this backend), requiring
  // the claimed author to prove control of the address with a signature.
  ["/api/forum/post", { action: "forum.post", actorFields: ["author_address", "authorAddress"] }],
  ["/api/forum/reply", { action: "forum.reply", actorFields: ["author_address", "authorAddress"] }],
  // Feature votes amplify: 5 of them flip a post into the default Featured view.
  // Signing proves control of the voter; a VLQ-balance floor (enforced in the
  // forum route) stops the amplification being multiplied with free throwaway
  // wallets. Upvote is intentionally NOT here — it only reorders the non-default
  // All Posts tab and has no visibility-flipping threshold.
  ["/api/forum/feature", { action: "forum.feature", actorFields: ["voter_address", "voterAddress"] }],
  // Profile updates: the verify flow (challenge/submit) is sound and unchanged,
  // but profile create/update was unsigned and address-from-body, so anyone could
  // overwrite the display name, avatar, and links rendered next to a wallet's
  // "Wallet Verified" badge — hijacking a genuinely-verified identity. Bind edits
  // to the wallet that controls the address. (The server-side auto-create on first
  // verification is an internal call and not affected.)
  ["/api/profiles/profile", { action: "profile.update", actorFields: ["wallet_address", "walletAddress"] }],
  // Avatar upload: the image is written to a path derived from the wallet
  // address, so without proof of control anyone could overwrite another member's
  // avatar by passing their address. Bind the upload to the wallet that signs it.
  ["/api/profiles/avatar", { action: "profile.avatar", actorFields: ["wallet_address", "walletAddress"] }],
  // Operator verification: a node operator signs a claim that the wallet they
  // control operates a registered node URL. Enforced here at the gateway (and
  // again in the Flask core) so the registry only records a claim from a wallet
  // that proved control of its key. The signed claim alone does not earn a badge;
  // the independent probe must also confirm the node advertises that same wallet.
  ["/api/registry/verify-operator", { action: "registry.verify_operator", actorFields: ["operator_wallet_address", "operatorWalletAddress"] }],
  // Exchange coordination writes. Every offer carries an address that the UI then
  // renders with the member's verified identity, and every lifecycle action
  // (accept, cancel, record the VLQ tx, confirm completion, dispute) moves a
  // shared coordination record and is attributed to a wallet. Unsigned, any of
  // these could be posted "as" another member — creating offers in their name,
  // accepting on their behalf, cancelling their open request, or recording a
  // false VLQ transaction against their trade. Bind each write to the wallet that
  // signs it (the actor field below), exactly like governance/lending/forum.
  ["/api/exchange/offer", { action: "exchange.offer", actorFields: ["creator_address", "creatorAddress"] }],
  ["/api/exchange/accept", { action: "exchange.accept", actorFields: ["acceptor_address", "acceptorAddress"] }],
  ["/api/exchange/complete", { action: "exchange.complete", actorFields: ["caller_address", "callerAddress"] }],
  ["/api/exchange/confirm-complete", { action: "exchange.confirm_complete", actorFields: ["caller_address", "callerAddress"] }],
  ["/api/exchange/record-vlq-tx", { action: "exchange.record_vlq_tx", actorFields: ["caller_address", "callerAddress"] }],
  ["/api/exchange/dispute", { action: "exchange.dispute", actorFields: ["caller_address", "callerAddress"] }],
  ["/api/exchange/cancel", { action: "exchange.cancel", actorFields: ["caller_address", "callerAddress"] }],
  // Email notification preferences store the member's own email keyed by wallet.
  // Sign the write so nobody can set or overwrite another member's email (and so
  // redirect their opt-in mail). The proven wallet is the storage key.
  ["/api/notifications/preferences", { action: "notifications.preferences", actorFields: ["wallet_address", "walletAddress"] }],
]);
const usedNonces = new Map();
const UNSIGNED_AUTHORITY_WRITE_PATHS = new Set(AUTHORITY_ROUTES.keys());

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw authorizationError("AUTHORIZATION_MALFORMED", "Signed payload contains an invalid number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw authorizationError("AUTHORIZATION_MALFORMED", "Signed payload contains an unsupported value.");
}

function bodyWithoutAuthorization(body) {
  const payload = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (key !== "authorization") payload[key] = value;
  }
  return payload;
}

function bodyHash(payload) {
  return crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

function authorizationMessage({ action, body_hash, nonce, timestamp, wallet }) {
  return canonicalJson({
    action,
    body_hash,
    domain: AUTHORIZATION_DOMAIN,
    nonce,
    timestamp,
    wallet,
  });
}

function authorizationError(code, message, status = 401) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function base58Encode(buffer) {
  let number = BigInt(`0x${buffer.toString("hex") || "0"}`);
  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  let leading = 0;
  while (leading < buffer.length && buffer[leading] === 0) leading += 1;
  return "1".repeat(leading) + encoded;
}

function addressFromPublicKey(publicKeyPem) {
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "secp256k1") {
      throw authorizationError("AUTHORIZATION_PUBLIC_KEY_INVALID", "Authorization public key must be a Vorliq secp256k1 key.");
    }
    const jwk = publicKey.export({ format: "jwk" });
    const x = Buffer.from(jwk.x, "base64url");
    const y = Buffer.from(jwk.y, "base64url");
    const point = Buffer.concat([Buffer.from([4]), x, y]);
    const sha = crypto.createHash("sha256").update(point).digest();
    return base58Encode(crypto.createHash("ripemd160").update(sha).digest());
  } catch (error) {
    if (error.code === "AUTHORIZATION_PUBLIC_KEY_INVALID") throw error;
    throw authorizationError("AUTHORIZATION_PUBLIC_KEY_INVALID", "Authorization public key is invalid.");
  }
}

function actorFromPayload(payload, actorFields) {
  const values = actorFields.filter((field) => payload[field] !== undefined).map((field) => String(payload[field]).trim());
  if (values.length === 0 || values.some((value) => value !== values[0])) {
    throw authorizationError("AUTHORIZATION_ACTOR_MISMATCH", "Signed authorization wallet must match the route actor.");
  }
  return values[0];
}

function rejectOverrides(payload) {
  if (Object.keys(payload).some((field) => OVERRIDE_FIELDS.has(field))) {
    throw authorizationError("AUTHORIZATION_OVERRIDE_REJECTED", "Client-supplied authority or balance overrides are not allowed.", 400);
  }
}

function pruneNonces(now) {
  for (const [key, expiresAt] of usedNonces.entries()) {
    if (expiresAt <= now) usedNonces.delete(key);
  }
}

function verifySignedAuthorization(body, route, nowSeconds = Math.floor(Date.now() / 1000)) {
  const routeConfig = AUTHORITY_ROUTES.get(route);
  if (!routeConfig) return null;
  const authorization = body?.authorization;
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
    throw authorizationError(
      "SIGNED_AUTHORIZATION_REQUIRED",
      SIGNED_AUTHORIZATION_MESSAGE,
      503
    );
  }
  const required = ["wallet", "public_key", "signature", "message", "timestamp", "nonce", "action", "body_hash", "domain"];
  if (required.some((field) => authorization[field] === undefined || authorization[field] === null)) {
    throw authorizationError("AUTHORIZATION_MALFORMED", "Signed authorization envelope is incomplete.");
  }

  const wallet = String(authorization.wallet).trim();
  const publicKey = String(authorization.public_key);
  const signature = String(authorization.signature).trim();
  const action = String(authorization.action).trim();
  const nonce = String(authorization.nonce).trim();
  const claimedBodyHash = String(authorization.body_hash).trim().toLowerCase();
  const timestamp = Number(authorization.timestamp);
  const payload = bodyWithoutAuthorization(body);

  if (wallet.length > 96 || publicKey.length > 2000 || signature.length > 512 || String(authorization.message).length > 2000) {
    throw authorizationError("AUTHORIZATION_MALFORMED", "Signed authorization envelope exceeds safe field limits.");
  }
  if (!Number.isInteger(timestamp) || !NONCE_PATTERN.test(nonce) || !/^[a-f0-9]{64}$/.test(claimedBodyHash)) {
    throw authorizationError("AUTHORIZATION_MALFORMED", "Signed authorization timestamp, nonce, or body hash is malformed.");
  }
  if (timestamp < nowSeconds - AUTHORIZATION_MAX_AGE_SECONDS || timestamp > nowSeconds + AUTHORIZATION_FUTURE_SKEW_SECONDS) {
    throw authorizationError("AUTHORIZATION_EXPIRED", "Signed authorization timestamp is expired or outside the allowed clock window.");
  }
  if (action !== routeConfig.action) {
    throw authorizationError("AUTHORIZATION_ACTION_MISMATCH", "Signed authorization action does not match this route.");
  }
  if (authorization.domain !== AUTHORIZATION_DOMAIN) {
    throw authorizationError("AUTHORIZATION_DOMAIN_MISMATCH", "Signed authorization domain does not match Vorliq authority writes.");
  }
  if (ROLE_LIKE_IDENTITIES.has(wallet.toLowerCase())) {
    throw authorizationError("AUTHORIZATION_WALLET_INVALID", "Reserved or role-like identities cannot authorize public wallet actions.");
  }
  if (addressFromPublicKey(publicKey) !== wallet) {
    throw authorizationError("AUTHORIZATION_WALLET_MISMATCH", "Authorization wallet does not match the supplied public key.");
  }
  if (actorFromPayload(payload, routeConfig.actorFields) !== wallet) {
    throw authorizationError("AUTHORIZATION_ACTOR_MISMATCH", "Signed authorization wallet must match the route actor.");
  }
  rejectOverrides(payload);

  const calculatedBodyHash = bodyHash(payload);
  if (calculatedBodyHash !== claimedBodyHash) {
    throw authorizationError("AUTHORIZATION_BODY_HASH_MISMATCH", "Signed authorization body hash does not match the request payload.");
  }
  const expectedMessage = authorizationMessage({
    action,
    body_hash: calculatedBodyHash,
    nonce,
    timestamp,
    wallet,
  });
  if (authorization.message !== expectedMessage) {
    throw authorizationError("AUTHORIZATION_MESSAGE_MISMATCH", "Signed authorization message is not canonical.");
  }
  let signatureValid = false;
  try {
    signatureValid =
      /^[a-fA-F0-9]+$/.test(signature) &&
      crypto.verify("sha256", Buffer.from(expectedMessage, "utf8"), publicKey, Buffer.from(signature, "hex"));
  } catch (_error) {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw authorizationError("AUTHORIZATION_SIGNATURE_INVALID", "Signed authorization signature is invalid.");
  }

  pruneNonces(nowSeconds);
  const nonceKey = `${wallet}:${nonce}`;
  if (usedNonces.has(nonceKey)) {
    throw authorizationError("AUTHORIZATION_REPLAYED", "Signed authorization nonce has already been used.");
  }
  usedNonces.set(nonceKey, timestamp + AUTHORIZATION_MAX_AGE_SECONDS + AUTHORIZATION_FUTURE_SKEW_SECONDS);
  return { action, wallet, nonce, timestamp, body_hash: calculatedBodyHash };
}

function requireSignedAuthorityWrite(req, res, next) {
  if (req.method !== "POST" || !AUTHORITY_ROUTES.has(req.path)) return next();
  try {
    req.signedAuthorization = verifySignedAuthorization(req.body, req.path);
    return next();
  } catch (error) {
    return sendError(res, error.status || 401, error.code || "AUTHORIZATION_INVALID", error.message);
  }
}

function resetUsedNoncesForTests() {
  usedNonces.clear();
}

module.exports = {
  AUTHORIZATION_DOMAIN,
  AUTHORIZATION_MAX_AGE_SECONDS,
  AUTHORITY_ROUTES,
  SIGNED_AUTHORIZATION_MESSAGE,
  UNSIGNED_AUTHORITY_WRITE_PATHS,
  addressFromPublicKey,
  authorizationMessage,
  bodyHash,
  bodyWithoutAuthorization,
  canonicalJson,
  requireSignedAuthorityWrite,
  resetUsedNoncesForTests,
  verifySignedAuthorization,
};
