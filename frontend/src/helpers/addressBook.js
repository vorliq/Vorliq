// Personal address book ("contacts"): short labels for wallet addresses the user
// sends to often. It is PURELY local — it never touches the backend. At rest it
// is encrypted in localStorage with a key derived from the wallet password (the
// same PBKDF2-SHA256 + AES-GCM scheme the wallet itself uses), because contacts
// are personal metadata that should not leave the device or sit in plaintext.
const STORAGE_KEY = "vorliq_address_book";
const PBKDF2_ITERATIONS = 250000;
const MAX_ENTRIES = 200;
const MAX_LABEL = 40;

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary);
}

function base64ToBytes(base64) {
  const binary = window.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function sanitizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const label = String(entry?.label || "").trim().slice(0, MAX_LABEL);
    const address = String(entry?.address || "").replace(/\s+/g, "");
    if (!label || !address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, address });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function hasAddressBook() {
  return Boolean(window.localStorage.getItem(STORAGE_KEY));
}

// Decrypt and return the contacts. Returns [] if none saved. Throws if the
// password is wrong (AES-GCM auth failure) — callers surface that to the user.
export async function loadAddressBook(password) {
  const text = window.localStorage.getItem(STORAGE_KEY);
  if (!text) return [];
  const blob = JSON.parse(text);
  const key = await deriveKey(password, base64ToBytes(blob.salt));
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(blob.iv) },
    key,
    base64ToBytes(blob.data)
  );
  return sanitizeEntries(JSON.parse(new TextDecoder().decode(plaintext)));
}

// Encrypt and store the contacts. An empty list removes the stored book entirely.
export async function saveAddressBook(entries, password) {
  const clean = sanitizeEntries(entries);
  if (clean.length === 0) {
    window.localStorage.removeItem(STORAGE_KEY);
    return [];
  }
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(clean))
  );
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      kdf: "PBKDF2-SHA256",
      encryption: "AES-GCM",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(data)),
    })
  );
  return clean;
}

export function clearAddressBook() {
  window.localStorage.removeItem(STORAGE_KEY);
}

// Case-insensitive search by label (and address), for the Send recipient field.
export function searchAddressBook(entries, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || !Array.isArray(entries)) return [];
  return entries.filter(
    (entry) => entry.label.toLowerCase().includes(q) || entry.address.toLowerCase().includes(q)
  );
}
