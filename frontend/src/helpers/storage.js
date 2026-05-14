const WALLET_STORAGE_KEY = "vorliq_wallet";
const PBKDF2_ITERATIONS = 250000;

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(base64) {
  const binary = window.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function normalizeWallet(wallet) {
  const address = wallet.address;
  const publicKey = wallet.public_key || wallet.publicKey;
  const privateKey = wallet.private_key || wallet.privateKey;

  if (!address || !publicKey || !privateKey) {
    throw new Error("Wallet must include address, public key, and private key.");
  }

  return {
    address,
    public_key: publicKey,
    private_key: privateKey,
  };
}

async function deriveEncryptionKey(password, salt) {
  if (!password) {
    throw new Error("Password is required.");
  }

  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function saveWallet(wallet, password) {
  const normalizedWallet = normalizeWallet(wallet);
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);
  const encryptedPrivateKey = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(normalizedWallet.private_key)
  );

  const storedWallet = {
    address: normalizedWallet.address,
    public_key: normalizedWallet.public_key,
    encrypted_private_key: bytesToBase64(new Uint8Array(encryptedPrivateKey)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    kdf: "PBKDF2",
    encryption: "AES-GCM",
    iterations: PBKDF2_ITERATIONS,
  };

  window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(storedWallet));
  return true;
}

export async function loadWallet(password) {
  const storedWalletText = window.localStorage.getItem(WALLET_STORAGE_KEY);

  if (!storedWalletText) {
    throw new Error("No saved Vorliq wallet found.");
  }

  try {
    const storedWallet = JSON.parse(storedWalletText);
    const salt = base64ToBytes(storedWallet.salt);
    const iv = base64ToBytes(storedWallet.iv);
    const encryptedPrivateKey = base64ToBytes(storedWallet.encrypted_private_key);
    const key = await deriveEncryptionKey(password, salt);
    const decryptedPrivateKey = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encryptedPrivateKey
    );

    return {
      address: storedWallet.address,
      public_key: storedWallet.public_key,
      private_key: new TextDecoder().decode(decryptedPrivateKey),
    };
  } catch (error) {
    throw new Error("Incorrect password or corrupted saved wallet.");
  }
}

export function hasWallet() {
  return Boolean(window.localStorage.getItem(WALLET_STORAGE_KEY));
}

export function clearWallet() {
  window.localStorage.removeItem(WALLET_STORAGE_KEY);
}
