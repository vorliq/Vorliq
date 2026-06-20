// Client-side wallet derivation for the "sign in with a private key" flow.
//
// SECURITY: this runs entirely in the browser. The private key passed in is used
// only to derive the public key and address and is never returned, stored, or
// transmitted by this module. The caller is responsible for clearing the raw key
// from memory once it has the derived wallet (and the encrypted backup).
//
// The address algorithm is byte-for-byte identical to the Vorliq chain
// (blockchain/wallet.py) and the Node authority gateway: it is
//   base58( ripemd160( sha256( 0x04 || X || Y ) ) )
// over the uncompressed secp256k1 public point, and the public key is emitted as
// a SubjectPublicKeyInfo PEM — exactly what the chain's /wallet/create returns.
// Verified against a chain-generated test vector in the matching test file.
/* global BigInt */
import { ec as EC } from "elliptic";
import hash from "hash.js";

import { extractSecp256k1PrivateScalar } from "./signer";

const secp256k1 = new EC("secp256k1");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// DER prefix for an id-ecPublicKey SubjectPublicKeyInfo on the secp256k1 curve,
// up to and including the BIT STRING header. The 65-byte uncompressed point
// (0x04 || X || Y) is appended to this to form the full SPKI.
const SPKI_SECP256K1_PREFIX = "3056301006072a8648ce3d020106052b8104000a034200";

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base58Encode(bytes) {
  let number = BigInt(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") || "0"}`);
  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return "1".repeat(leading) + encoded;
}

function publicKeyPem(pointHex) {
  const der = hexToBytes(SPKI_SECP256K1_PREFIX + pointHex);
  const body = bytesToBase64(der).match(/.{1,64}/g).join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

// Derives { address, public_key, private_key } from a pasted secp256k1 private
// key PEM. Throws a clear, user-facing Error for anything malformed.
export function deriveWalletFromPrivateKey(privateKeyPem) {
  if (typeof privateKeyPem !== "string" || !privateKeyPem.trim()) {
    throw new Error("Enter your private key to sign in.");
  }
  const normalized = privateKeyPem.trim();

  let scalarHex;
  try {
    scalarHex = extractSecp256k1PrivateScalar(normalized);
  } catch (error) {
    throw new Error("That does not look like a valid Vorliq private key. Paste the full PEM, including the BEGIN and END lines.");
  }
  if (!scalarHex || !/^[0-9a-fA-F]{64}$/.test(scalarHex)) {
    throw new Error("Could not read a secp256k1 private key from that PEM.");
  }

  let key;
  try {
    key = secp256k1.keyFromPrivate(scalarHex, "hex");
    const validation = key.validate();
    if (!validation.result) throw new Error(validation.reason || "invalid key");
  } catch (error) {
    throw new Error("That private key is not a valid secp256k1 key.");
  }

  const pointHex = key.getPublic(false, "hex"); // 0x04 || X || Y
  const pointBytes = hexToBytes(pointHex);
  const sha = hash.sha256().update(pointBytes).digest();
  const rip = hash.ripemd160().update(sha).digest();
  const address = base58Encode(Uint8Array.from(rip));

  return {
    address,
    public_key: publicKeyPem(pointHex),
    private_key: normalized,
  };
}

export default deriveWalletFromPrivateKey;
