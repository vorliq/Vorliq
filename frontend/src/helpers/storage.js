const WALLET_STORAGE_KEY = "vorliq_wallet";
const PBKDF2_ITERATIONS = 250000;
const WALLET_BACKUP_VERSION = 1;

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

async function deriveEncryptionKey(password, salt, iterations = PBKDF2_ITERATIONS) {
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
      iterations,
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
  const now = new Date().toISOString();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);
  const encryptedPrivateKey = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(normalizedWallet.private_key)
  );

  const storedWallet = {
    version: WALLET_BACKUP_VERSION,
    address: normalizedWallet.address,
    public_key: normalizedWallet.public_key,
    encrypted_private_key: bytesToBase64(new Uint8Array(encryptedPrivateKey)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    kdf: "PBKDF2",
    encryption: "AES-GCM",
    encryption_method: "PBKDF2-SHA256-AES-GCM",
    iterations: PBKDF2_ITERATIONS,
    created_at: now,
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
    return {
      address: storedWallet.address,
      public_key: storedWallet.public_key,
      private_key: await decryptStoredWallet(storedWallet, password),
    };
  } catch (error) {
    throw new Error("Incorrect password or corrupted saved wallet.");
  }
}

function validateStoredWallet(storedWallet) {
  if (!storedWallet || typeof storedWallet !== "object") {
    throw new Error("Wallet backup must be a JSON object.");
  }

  const requiredFields = ["address", "public_key", "encrypted_private_key", "salt", "iv"];
  requiredFields.forEach((field) => {
    if (typeof storedWallet[field] !== "string" || !storedWallet[field].trim()) {
      throw new Error(`Wallet backup is missing ${field}.`);
    }
  });

  if ((storedWallet.encryption || "AES-GCM") !== "AES-GCM") {
    throw new Error("Wallet backup uses an unsupported encryption method.");
  }

  if ((storedWallet.kdf || "PBKDF2") !== "PBKDF2") {
    throw new Error("Wallet backup uses an unsupported key derivation method.");
  }

  const iterations = Number(storedWallet.iterations || PBKDF2_ITERATIONS);
  if (!Number.isInteger(iterations) || iterations < 100000) {
    throw new Error("Wallet backup has unsafe or invalid encryption settings.");
  }

  base64ToBytes(storedWallet.salt);
  base64ToBytes(storedWallet.iv);
  base64ToBytes(storedWallet.encrypted_private_key);
}

async function decryptStoredWallet(storedWallet, password) {
  validateStoredWallet(storedWallet);
  const salt = base64ToBytes(storedWallet.salt);
  const iv = base64ToBytes(storedWallet.iv);
  const encryptedPrivateKey = base64ToBytes(storedWallet.encrypted_private_key);
  const key = await deriveEncryptionKey(password, salt, Number(storedWallet.iterations || PBKDF2_ITERATIONS));
  const decryptedPrivateKey = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedPrivateKey
  );

  return new TextDecoder().decode(decryptedPrivateKey);
}

export function getStoredEncryptedWallet() {
  const storedWalletText = window.localStorage.getItem(WALLET_STORAGE_KEY);
  if (!storedWalletText) {
    throw new Error("No saved Vorliq wallet found.");
  }

  const storedWallet = JSON.parse(storedWalletText);
  validateStoredWallet(storedWallet);
  return storedWallet;
}

export async function exportEncryptedWalletBackup(password) {
  const storedWallet = getStoredEncryptedWallet();
  await decryptStoredWallet(storedWallet, password);

  return {
    version: Number(storedWallet.version || WALLET_BACKUP_VERSION),
    address: storedWallet.address,
    public_key: storedWallet.public_key,
    encrypted_private_key: storedWallet.encrypted_private_key,
    salt: storedWallet.salt,
    iv: storedWallet.iv,
    kdf: storedWallet.kdf || "PBKDF2",
    encryption: storedWallet.encryption || "AES-GCM",
    encryption_method: storedWallet.encryption_method || "PBKDF2-SHA256-AES-GCM",
    iterations: Number(storedWallet.iterations || PBKDF2_ITERATIONS),
    created_at: storedWallet.created_at || null,
    exported_at: new Date().toISOString(),
  };
}

export async function importEncryptedWalletBackup(backup, password) {
  validateStoredWallet(backup);
  await decryptStoredWallet(backup, password);

  const storedWallet = {
    version: Number(backup.version || WALLET_BACKUP_VERSION),
    address: backup.address.trim(),
    public_key: backup.public_key,
    encrypted_private_key: backup.encrypted_private_key,
    salt: backup.salt,
    iv: backup.iv,
    kdf: backup.kdf || "PBKDF2",
    encryption: backup.encryption || "AES-GCM",
    encryption_method: backup.encryption_method || "PBKDF2-SHA256-AES-GCM",
    iterations: Number(backup.iterations || PBKDF2_ITERATIONS),
    created_at: backup.created_at || new Date().toISOString(),
    imported_at: new Date().toISOString(),
  };

  window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(storedWallet));
  return true;
}

export function hasWallet() {
  return Boolean(window.localStorage.getItem(WALLET_STORAGE_KEY));
}

export function clearWallet() {
  window.localStorage.removeItem(WALLET_STORAGE_KEY);
}
