// Tiny pub/sub so a freshly uploaded avatar refreshes everywhere it is shown
// (sidebar, forum cards, proposal/loan cards) without a page reload. Each entry
// is a per-address version stamp appended to the image URL to bust the cache.
import api from "./api";

const versions = new Map();

// Resolve the active API base (respecting any per-device node override) without
// depending on a named export, so this stays safe when tests mock the api module.
function apiBase() {
  try {
    return String((api && api.defaults && api.defaults.baseURL) || "/api");
  } catch (error) {
    return "/api";
  }
}
const listeners = new Set();

export function avatarVersion(address) {
  return address ? versions.get(address) || 0 : 0;
}

export function bumpAvatarVersion(address) {
  if (!address) return;
  versions.set(address, Date.now());
  listeners.forEach((listener) => listener());
}

export function subscribeAvatar(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function avatarImageUrl(address, version) {
  if (!address) return "";
  const base = apiBase().replace(/\/$/, "");
  const stamp = version ? `&v=${encodeURIComponent(version)}` : "";
  return `${base}/profiles/avatar?address=${encodeURIComponent(address)}${stamp}`;
}
