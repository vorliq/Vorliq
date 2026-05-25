const crypto = require("crypto");

const { canonicalStringify, sha256Hex } = require("./canonicalJson");

const ALGORITHM = "Ed25519";

function envFlag(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function normalizePem(value) {
  const text = String(value || "").trim();
  return text ? text.replace(/\\n/g, "\n") : "";
}

function publicKeyId(publicKey) {
  const normalized = normalizePem(publicKey);
  if (!normalized) return null;
  return `ed25519:${sha256Hex(normalized).slice(0, 16)}`;
}

function privateKeyFromEnv() {
  const pem = normalizePem(process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY);
  if (!pem) return null;
  return crypto.createPrivateKey(pem);
}

function publicKeyFromEnv() {
  const pem = normalizePem(process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY);
  if (!pem) return null;
  return crypto.createPublicKey(pem);
}

function exportPublicKey(keyObject) {
  if (!keyObject) return null;
  return keyObject.export({ type: "spki", format: "pem" });
}

function configuredPublicKeyPem(privateKeyObject = null) {
  const configured = normalizePem(process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY);
  if (configured) return exportPublicKey(crypto.createPublicKey(configured));
  if (privateKeyObject) return exportPublicKey(crypto.createPublicKey(privateKeyObject));
  return null;
}

function snapshotPayload(snapshot = {}) {
  const { signature, ...payload } = snapshot || {};
  return payload;
}

function snapshotHash(snapshot = {}) {
  return sha256Hex(canonicalStringify(snapshotPayload(snapshot)));
}

function signSnapshotHash(snapshotHashValue, privateKeyObject) {
  const signature = crypto.sign(null, Buffer.from(String(snapshotHashValue), "utf8"), privateKeyObject);
  return signature.toString("base64");
}

function verifySnapshotHashSignature(snapshotHashValue, signature, publicKey) {
  if (!snapshotHashValue || !signature || !publicKey) return false;
  const publicKeyObject = typeof publicKey === "string" ? crypto.createPublicKey(normalizePem(publicKey)) : publicKey;
  return crypto.verify(
    null,
    Buffer.from(String(snapshotHashValue), "utf8"),
    publicKeyObject,
    Buffer.from(String(signature), "base64")
  );
}

function signingMetadata(snapshot, options = {}) {
  const requireSignature = options.requireSignature ?? envFlag("VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE");
  let privateKeyObject = null;
  let publicKeyPem = null;
  let signingError = null;

  try {
    privateKeyObject = privateKeyFromEnv();
  } catch (error) {
    signingError = "private_key_invalid";
  }

  try {
    publicKeyPem = configuredPublicKeyPem(privateKeyObject);
  } catch (error) {
    publicKeyPem = null;
    signingError = signingError || "public_key_invalid";
  }

  const hash = snapshotHash(snapshot);
  const base = {
    enabled: false,
    algorithm: ALGORITHM,
    public_key_id: publicKeyId(publicKeyPem),
    public_key: publicKeyPem,
    snapshot_hash: hash,
    signature: null,
    signed_at: null,
    status: signingError || (requireSignature ? "missing_required_signature" : "unsigned"),
  };

  if (!privateKeyObject || !publicKeyPem || signingError) {
    return base;
  }

  try {
    const signature = signSnapshotHash(hash, privateKeyObject);
    const verified = verifySnapshotHashSignature(hash, signature, publicKeyPem);
    return {
      ...base,
      enabled: true,
      signature: verified ? signature : null,
      signed_at: options.signedAt || new Date().toISOString(),
      status: verified ? "signed" : "invalid",
    };
  } catch (error) {
    return { ...base, status: "signing_failed" };
  }
}

function verifySnapshotSignature(snapshot = {}, options = {}) {
  const requireSignature = options.requireSignature ?? envFlag("VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE");
  const signature = snapshot.signature || {};
  const hash = snapshotHash(snapshot);
  const hashMatches = signature.snapshot_hash === hash;
  const enabled = signature.enabled === true || Boolean(signature.signature);
  let publicKey = options.publicKey || signature.public_key;
  try {
    publicKey = options.publicKey || configuredPublicKeyPem() || signature.public_key;
  } catch (error) {
    publicKey = options.publicKey || signature.public_key || null;
  }
  const publicKeyMatches = !signature.public_key || !publicKey || normalizePem(signature.public_key) === normalizePem(publicKey);
  let signatureVerified = false;
  let status = signature.status || "unsigned";

  if (enabled && hashMatches && publicKey && signature.signature) {
    try {
      signatureVerified = verifySnapshotHashSignature(hash, signature.signature, publicKey);
      status = signatureVerified && publicKeyMatches ? "verified" : "invalid";
    } catch (error) {
      status = "invalid";
    }
  } else if (enabled) {
    status = "invalid";
  } else if (requireSignature) {
    status = "missing_required_signature";
  } else {
    status = "unsigned";
  }

  return {
    enabled,
    required: requireSignature,
    algorithm: signature.algorithm || ALGORITHM,
    public_key_id: signature.public_key_id || publicKeyId(publicKey),
    snapshot_hash: hash,
    signed_snapshot_hash: signature.snapshot_hash || null,
    hash_matches: hashMatches,
    public_key_present: Boolean(publicKey),
    public_key_matches: publicKeyMatches,
    signature_present: Boolean(signature.signature),
    signature_verified: signatureVerified,
    status,
    verified: enabled ? signatureVerified && hashMatches && publicKeyMatches : !requireSignature,
  };
}

module.exports = {
  ALGORITHM,
  configuredPublicKeyPem,
  envFlag,
  normalizePem,
  publicKeyId,
  signingMetadata,
  snapshotHash,
  snapshotPayload,
  signSnapshotHash,
  verifySnapshotHashSignature,
  verifySnapshotSignature,
};
