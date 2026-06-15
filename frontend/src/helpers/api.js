import axios from "axios";

const defaultApiUrl =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:5000/api"
    : "/api";

// Optional per-device node override, set from Settings → Network. Lets a member
// point the app at a different Vorliq node API base without rebuilding. Only
// http(s) URLs are accepted; anything else falls back to the build default.
const NODE_URL_STORAGE_KEY = "vorliq_node_url";

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function storedNodeUrl() {
  try {
    const value = window.localStorage.getItem(NODE_URL_STORAGE_KEY);
    return value && isHttpUrl(value) ? value : "";
  } catch {
    return "";
  }
}

const buildDefaultUrl = process.env.REACT_APP_API_URL || defaultApiUrl;

const api = axios.create({
  baseURL: storedNodeUrl() || buildDefaultUrl,
  timeout: 120000,
});

export function getNodeUrl() {
  return api.defaults.baseURL;
}

export function getDefaultNodeUrl() {
  return buildDefaultUrl;
}

// Persist and apply a node URL override. Pass an empty string to reset to the
// build default. Returns the URL now in effect.
export function setNodeUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    try {
      window.localStorage.removeItem(NODE_URL_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    api.defaults.baseURL = buildDefaultUrl;
    return api.defaults.baseURL;
  }
  if (!isHttpUrl(trimmed)) {
    throw new Error("Enter a valid http(s) node URL.");
  }
  try {
    window.localStorage.setItem(NODE_URL_STORAGE_KEY, trimmed);
  } catch {
    // ignore storage errors; the override still applies for this session
  }
  api.defaults.baseURL = trimmed;
  return api.defaults.baseURL;
}

export default api;
