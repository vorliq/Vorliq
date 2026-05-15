const crypto = require("crypto");
const { ec: EC } = require("elliptic");

const secp256k1 = new EC("secp256k1");

function pemToBytes(pem) {
  const base64 = String(pem || "")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  if (!base64) {
    throw new Error("Private key PEM is empty or invalid.");
  }

  return Buffer.from(base64, "base64");
}

function extractSecp256k1PrivateScalar(privateKeyPem) {
  const bytes = pemToBytes(privateKeyPem);

  for (let i = 0; i < bytes.length - 34; i += 1) {
    if (bytes[i] === 0x04 && bytes[i + 1] === 0x20) {
      return Array.from(bytes.slice(i + 2, i + 34))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }
  }

  throw new Error("Could not read a SECP256K1 private key from the PEM.");
}

function sha256Hex(message) {
  return crypto.createHash("sha256").update(message).digest("hex");
}

function pythonFloatString(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("Amount must be a valid number.");
  }
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

function createPythonSigningPayload({ senderAddress, receiverAddress, amount, timestamp }) {
  return (
    `{"amount":${pythonFloatString(amount)},` +
    `"receiver_address":"${receiverAddress}",` +
    `"sender_address":"${senderAddress}",` +
    `"timestamp":${timestamp}}`
  );
}

/**
 * Signs a Vorliq transaction with the same payload format and SECP256K1 DER
 * signature used by the Vorliq frontend.
 *
 * @param {object} params - Transaction signing parameters.
 * @param {string} params.senderAddress - Wallet address sending VLQ.
 * @param {string} params.senderPrivateKey - Sender private key in PEM format.
 * @param {string} params.senderPublicKey - Sender public key in PEM format.
 * @param {string} params.receiverAddress - Wallet address receiving VLQ.
 * @param {number|string} params.amount - Amount of VLQ to send.
 * @returns {object} A signed transaction payload accepted by the Vorliq API.
 */
function signTransaction({ senderAddress, senderPrivateKey, senderPublicKey, receiverAddress, amount }) {
  const timestamp = Date.now() / 1000;
  const privateScalar = extractSecp256k1PrivateScalar(senderPrivateKey);
  const signingPayload = createPythonSigningPayload({
    senderAddress,
    receiverAddress,
    amount,
    timestamp,
  });
  const digestHex = sha256Hex(signingPayload);
  const key = secp256k1.keyFromPrivate(privateScalar, "hex");
  const signature = key.sign(digestHex, { canonical: true });

  return {
    sender_address: senderAddress,
    sender_public_key: senderPublicKey,
    receiver_address: receiverAddress,
    amount: Number(amount),
    timestamp,
    signature: signature.toDER("hex"),
  };
}

module.exports = {
  createPythonSigningPayload,
  signTransaction,
};
