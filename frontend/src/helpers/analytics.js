import api from "./api";

export const ANALYTICS_ENABLED_KEY = "vorliq_analytics_enabled";
export const ANALYTICS_SESSION_KEY = "vorliq_anonymous_session_id";

const SAFE_EVENT_TYPES = new Set([
  "page_view",
  "onboarding_completed",
  "wallet_page_opened",
  "wallet_created_client_event",
  "send_page_opened",
  "mine_page_opened",
  "faucet_page_opened",
  "faucet_claim_attempted",
  "lending_page_opened",
  "exchange_page_opened",
  "governance_page_opened",
  "treasury_page_opened",
  "forum_page_opened",
  "chat_page_opened",
  "profile_page_opened",
  "registry_page_opened",
  "docs_link_clicked",
  "error_boundary_seen",
]);

const SAFE_METADATA_KEYS = new Set(["source", "section", "link", "status", "reason", "route_category", "feature"]);

function storageAvailable() {
  return typeof window !== "undefined" && window.localStorage;
}

export function isAnalyticsEnabled() {
  if (!storageAvailable()) return false;
  return window.localStorage.getItem(ANALYTICS_ENABLED_KEY) !== "false";
}

export function setAnalyticsEnabled(enabled) {
  if (!storageAvailable()) return;
  window.localStorage.setItem(ANALYTICS_ENABLED_KEY, enabled ? "true" : "false");
  if (!enabled) {
    window.localStorage.removeItem(ANALYTICS_SESSION_KEY);
  }
}

export function getAnonymousSessionId() {
  if (!storageAvailable() || !isAnalyticsEnabled()) return null;
  const existing = window.localStorage.getItem(ANALYTICS_SESSION_KEY);
  if (existing) return existing;
  const random = new Uint8Array(18);
  window.crypto?.getRandomValues?.(random);
  const suffix = Array.from(random, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 36);
  const fallback = Math.random().toString(36).slice(2, 18);
  const id = `anon_${suffix || fallback}`;
  window.localStorage.setItem(ANALYTICS_SESSION_KEY, id);
  return id;
}

function cleanText(value, max) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);
}

function safeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return Object.entries(metadata).reduce((safe, [key, value]) => {
    if (!SAFE_METADATA_KEYS.has(key)) return safe;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = cleanText(value, 80);
    }
    return safe;
  }, {});
}

export function buildAnalyticsPayload(eventType, options = {}) {
  if (!SAFE_EVENT_TYPES.has(eventType)) return null;
  const anonymousSessionId = getAnonymousSessionId();
  if (!anonymousSessionId) return null;
  return {
    event_type: eventType,
    route: cleanText(options.route || window.location.pathname || "/", 120),
    category: cleanText(options.category || "general", 60),
    anonymous_session_id: anonymousSessionId,
    metadata: safeMetadata(options.metadata),
  };
}

export async function sendAnalyticsEvent(eventType, options = {}) {
  const payload = buildAnalyticsPayload(eventType, options);
  if (!payload) return { sent: false };
  try {
    await api.post("/analytics/event", payload);
    return { sent: true };
  } catch (error) {
    return { sent: false };
  }
}

export function routeCategory(pathname) {
  const route = pathname || "/";
  if (route === "/") return "dashboard";
  if (route.includes("wallet") || route.includes("send") || route.includes("faucet")) return "wallet";
  if (route.includes("mine") || route.includes("blockchain") || route.includes("stats") || route.includes("health")) return "network";
  if (route.includes("forum") || route.includes("chat") || route.includes("profile") || route.includes("account")) return "community";
  if (route.includes("lending") || route.includes("exchange") || route.includes("governance") || route.includes("treasury")) return "coordination";
  if (route.includes("registry") || route.includes("network")) return "registry";
  return "general";
}

export function featureEventForRoute(pathname) {
  const exact = {
    "/wallet": "wallet_page_opened",
    "/send": "send_page_opened",
    "/mine": "mine_page_opened",
    "/faucet": "faucet_page_opened",
    "/lending": "lending_page_opened",
    "/exchange": "exchange_page_opened",
    "/governance": "governance_page_opened",
    "/treasury": "treasury_page_opened",
    "/forum": "forum_page_opened",
    "/chat": "chat_page_opened",
    "/profile": "profile_page_opened",
    "/registry": "registry_page_opened",
  };
  return exact[pathname || "/"] || null;
}
