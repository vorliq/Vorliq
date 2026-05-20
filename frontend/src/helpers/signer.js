import { ec as EC } from "elliptic";

const secp256k1 = new EC("secp256k1");

function pemToBytes(pem) {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  if (!base64) {
    throw new Error("Private key PEM is empty or invalid.");
  }

  const binary = window.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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

async function sha256Hex(message) {
  const encoded = new TextEncoder().encode(message);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function pythonFloatString(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("Amount must be a valid number.");
  }
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

export function createPythonSigningPayload({ senderAddress, receiverAddress, amount, timestamp }) {
  return (
    `{"amount":${pythonFloatString(amount)},` +
    `"receiver_address":"${receiverAddress}",` +
    `"sender_address":"${senderAddress}",` +
    `"timestamp":${timestamp}}`
  );
}

export async function signTransaction({
  senderAddress,
  senderPrivateKey,
  senderPublicKey,
  receiverAddress,
  amount,
}) {
  const timestamp = Date.now() / 1000;
  const privateScalar = extractSecp256k1PrivateScalar(senderPrivateKey);
  const signingPayload = createPythonSigningPayload({
    senderAddress,
    receiverAddress,
    amount,
    timestamp,
  });
  const digestHex = await sha256Hex(signingPayload);
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

export async function signMessage({ privateKeyPem, message }) {
  const privateScalar = extractSecp256k1PrivateScalar(privateKeyPem);
  const digestHex = await sha256Hex(message);
  const key = secp256k1.keyFromPrivate(privateScalar, "hex");
  const signature = key.sign(digestHex, { canonical: true });
  return signature.toDER("hex");
}
