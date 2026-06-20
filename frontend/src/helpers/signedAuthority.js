import api from "./api";
import { signMessage } from "./signer";
import { loadWallet } from "./storage";

export const AUTHORIZATION_DOMAIN = "vorliq.authority.v1";

const AUTHORITY_ACTIONS = Object.freeze({
  "governance.propose": { path: "/governance/propose", actorField: "proposer_address" },
  "governance.vote": { path: "/governance/vote", actorField: "voter_address" },
  "governance.cancel": { path: "/governance/cancel", actorField: "proposer_address" },
  "treasury.propose": { path: "/treasury/propose", actorField: "proposer_address" },
  "treasury.vote": { path: "/treasury/vote", actorField: "voter_address" },
  "treasury.cancel": { path: "/treasury/cancel", actorField: "proposer_address" },
  "lending.request": { path: "/lending/request", actorField: "requester_address" },
  "lending.vote": { path: "/lending/vote", actorField: "voter_address" },
  "lending.repay": { path: "/lending/repay", actorField: "repayer_address" },
  "forum.post": { path: "/forum/post", actorField: "author_address" },
  "forum.reply": { path: "/forum/reply", actorField: "author_address" },
  "forum.feature": { path: "/forum/feature", actorField: "voter_address" },
  "profile.update": { path: "/profiles/profile", actorField: "wallet_address" },
  "profile.avatar": { path: "/profiles/avatar", actorField: "wallet_address" },
  "registry.verify_operator": { path: "/registry/verify-operator", actorField: "operator_wallet_address" },
});

const FORBIDDEN_BODY_FIELDS = new Set([
  "authorization",
  "private_key",
  "privateKey",
  "wallet_password",
  "walletPassword",
  "password",
]);

const AUTHORIZATION_ERROR_CODES = new Set([
  "SIGNED_AUTHORIZATION_REQUIRED",
  "AUTHORIZATION_MALFORMED",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_ACTION_MISMATCH",
  "AUTHORIZATION_DOMAIN_MISMATCH",
  "AUTHORIZATION_WALLET_INVALID",
  "AUTHORIZATION_WALLET_MISMATCH",
  "AUTHORIZATION_ACTOR_MISMATCH",
  "AUTHORIZATION_OVERRIDE_REJECTED",
  "AUTHORIZATION_BODY_HASH_MISMATCH",
  "AUTHORIZATION_MESSAGE_MISMATCH",
  "AUTHORIZATION_SIGNATURE_INVALID",
  "AUTHORIZATION_REPLAYED",
  "AUTHORIZATION_PUBLIC_KEY_INVALID",
]);

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Signed payload contains an invalid number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Signed payload contains an unsupported value.");
}

export async function authorityBodyHash(body) {
  const encoded = new TextEncoder().encode(canonicalJson(body));
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function authorityMessage({ action, bodyHash, nonce, timestamp, wallet }) {
  return canonicalJson({
    action,
    body_hash: bodyHash,
    domain: AUTHORIZATION_DOMAIN,
    nonce,
    timestamp,
    wallet,
  });
}

// Vetted translations of specific, known backend eligibility errors into clear,
// friendly guidance. We deliberately match only messages we have reviewed here;
// any other upstream text still collapses to the page's neutral fallback, so a
// raw backend object or unexpected server string is never shown to a person.
// This turns "you tried something you aren't eligible for yet" from an opaque
// dead-end ("Unable to create proposal.") into an accurate, actionable reason.
const KNOWN_ELIGIBILITY_MESSAGES = [
  [
    /only vlq holders can create governance proposals/i,
    "You need to hold some VLQ before you can create a governance proposal. Receive or earn VLQ first, then try again.",
  ],
  [
    /proposer cannot have more than three active proposals/i,
    "You already have three active proposals, which is the most allowed at once. Wait for one to close before creating another.",
  ],
  [
    /requester already has an active loan lifecycle/i,
    "You already have a loan in progress. You can request a new one once your current loan is fully repaid.",
  ],
  [
    /loan amount cannot be greater than/i,
    "That amount is above the maximum loan size (10,000 VLQ). Enter a smaller amount.",
  ],
  [
    /loan amount must be greater than zero/i,
    "Enter a loan amount greater than zero.",
  ],
  [
    /only vlq holders with a positive balance can vote/i,
    "You need to hold some VLQ before your vote can carry weight. Receive or earn VLQ first, then vote.",
  ],
  [
    /(voter|requester|proposer|repayer) has already voted|already voted on this/i,
    "You have already voted on this.",
  ],
];

function upstreamMessage(error) {
  return error?.response?.data?.error?.message || error?.response?.data?.message || "";
}

export function authorityErrorMessage(error, fallback) {
  const code = error?.response?.data?.error?.code || error?.response?.data?.code;
  if (AUTHORIZATION_ERROR_CODES.has(code)) {
    return code === "AUTHORIZATION_EXPIRED" || code === "AUTHORIZATION_REPLAYED"
      ? "Signed wallet authorization expired or was already used. Sign the action again."
      : "Signed wallet authorization was rejected. Check your saved wallet and try again.";
  }
  if (error?.message === "Incorrect password or corrupted saved wallet." || error?.message === "No saved Vorliq wallet found.") {
    return error.message;
  }
  const upstream = upstreamMessage(error);
  for (const [matcher, friendly] of KNOWN_ELIGIBILITY_MESSAGES) {
    if (matcher.test(upstream)) {
      return friendly;
    }
  }
  return fallback;
}

export async function createSignedAuthorityRequest({ action, body, walletPassword }) {
  const config = AUTHORITY_ACTIONS[action];
  if (!config) {
    throw new Error("Unsupported signed authority action.");
  }
  if (!walletPassword) {
    throw new Error("Enter your wallet password to sign this action locally.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Signed authority body must be an object.");
  }
  if (Object.keys(body).some((field) => FORBIDDEN_BODY_FIELDS.has(field))) {
    throw new Error("Signed authority body contains a forbidden local-only field.");
  }

  const localWallet = await loadWallet(walletPassword);
  const payload = {
    ...body,
    [config.actorField]: localWallet.address,
  };
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = createAuthorityNonce();
  const bodyHash = await authorityBodyHash(payload);
  const message = authorityMessage({
    action,
    bodyHash,
    nonce,
    timestamp,
    wallet: localWallet.address,
  });
  const signature = await signMessage({
    privateKeyPem: localWallet.private_key,
    message,
  });

  return {
    path: config.path,
    body: {
      ...payload,
      authorization: {
        wallet: localWallet.address,
        public_key: localWallet.public_key,
        signature,
        message,
        timestamp,
        nonce,
        action,
        body_hash: bodyHash,
        domain: AUTHORIZATION_DOMAIN,
      },
    },
  };
}

export async function postSignedAuthority(options) {
  const request = await createSignedAuthorityRequest(options);
  const response = await api.post(request.path, request.body);
  if (response.data?.success === false) {
    throw new Error("Signed authority action was rejected.");
  }
  return response;
}

function createAuthorityNonce() {
  if (typeof window.crypto.randomUUID === "function") {
    return `authority-${window.crypto.randomUUID()}`;
  }
  const bytes = window.crypto.getRandomValues(new Uint8Array(24));
  return `authority-${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
