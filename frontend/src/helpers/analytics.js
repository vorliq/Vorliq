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
  "node_sync_page_opened",
  "docs_link_clicked",
  "error_boundary_seen",
  "cta_click",
  "nav_click",
  "card_click",
  "section_view",
  "dashboard_action",
  "api_failure",
  "frontend_error",
]);

const SAFE_METADATA_KEYS = new Set([
  "source",
  "section",
  "link",
  "status",
  "reason",
  "route_category",
  "feature",
  "element",
  "device",
  "endpoint",
  "outcome",
  "duration_ms",
  "value",
]);

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
    "/nodes/compare": "node_sync_page_opened",
  };
  return exact[pathname || "/"] || null;
}

// ---- Viewport bucket (non-identifying) ----
export function deviceBucket() {
  if (typeof window === "undefined") return "unknown";
  const width = window.innerWidth || 0;
  if (width === 0) return "unknown";
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

// ---- Batched, fire-and-forget event queue ----
// Interaction events are queued and flushed in small batches so they never block
// navigation, clicks or rendering. Flush uses sendBeacon (or keepalive fetch) so
// in-flight events survive page unloads, and every path fails silently.
const queue = [];
let flushTimer = null;
const BATCH_LIMIT = 10;
const FLUSH_DELAY_MS = 2500;

function analyticsEndpoint(pathSuffix) {
  const base = api?.defaults?.baseURL || "/api";
  return `${base.replace(/\/$/, "")}${pathSuffix}`;
}

export function flushAnalytics() {
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const body = JSON.stringify({ events });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(analyticsEndpoint("/analytics/events"), blob)) return;
    }
    if (typeof fetch === "function") {
      fetch(analyticsEndpoint("/analytics/events"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (error) {
    // Analytics must never surface errors to the user.
  }
}

function scheduleFlush() {
  if (queue.length >= BATCH_LIMIT) {
    flushAnalytics();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushAnalytics();
  }, FLUSH_DELAY_MS);
}

// Queue a single interaction event. Returns false and does nothing when analytics
// is disabled or the event/payload is not allowed.
export function track(eventType, options = {}) {
  const payload = buildAnalyticsPayload(eventType, {
    ...options,
    metadata: { device: deviceBucket(), ...(options.metadata || {}) },
  });
  if (!payload) return false;
  queue.push(payload);
  scheduleFlush();
  return true;
}

export function trackClick(kind, element, options = {}) {
  const typeByKind = { cta: "cta_click", nav: "nav_click", card: "card_click", dashboard: "dashboard_action" };
  const eventType = typeByKind[kind] || "cta_click";
  return track(eventType, { ...options, metadata: { element: cleanText(element, 80), ...(options.metadata || {}) } });
}

export function trackSection(section, options = {}) {
  return track("section_view", { ...options, metadata: { section: cleanText(section, 80), ...(options.metadata || {}) } });
}

export function trackApiFailure(endpoint, outcome, durationMs) {
  return track("api_failure", {
    metadata: {
      endpoint: cleanText(endpoint, 80),
      outcome: cleanText(outcome || "error", 24),
      ...(Number.isFinite(durationMs) ? { duration_ms: String(Math.round(durationMs)) } : {}),
    },
  });
}

export function trackError(source) {
  return track("frontend_error", { metadata: { element: cleanText(source || "window_error", 60) } });
}

// Parse a data-vq-track value of the form "kind:element" (e.g. "cta:create-account").
function parseTrackAttr(value) {
  const text = String(value || "");
  const separator = text.indexOf(":");
  if (separator === -1) return { kind: "cta", element: text };
  return { kind: text.slice(0, separator), element: text.slice(separator + 1) };
}

let analyticsInitialised = false;

// Wire up delegated click tracking, section visibility, error capture, and flush
// on unload. Idempotent and safe to call once at app start.
export function initAnalytics() {
  if (analyticsInitialised || typeof document === "undefined") return () => {};
  analyticsInitialised = true;

  function onClick(event) {
    const target = event.target?.closest?.("[data-vq-track]");
    if (!target) return;
    const { kind, element } = parseTrackAttr(target.getAttribute("data-vq-track"));
    trackClick(kind, element);
  }

  function onError() {
    trackError("window_error");
  }
  function onRejection() {
    trackError("unhandled_rejection");
  }
  function onHide() {
    flushAnalytics();
  }

  document.addEventListener("click", onClick, { capture: true });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAnalytics();
  });

  let observer = null;
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const section = entry.target.getAttribute("data-vq-section");
          trackSection(section);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.4 }
    );
    // Observe current and future sections.
    document.querySelectorAll("[data-vq-section]").forEach((node) => observer.observe(node));
    window.setTimeout(() => {
      document.querySelectorAll("[data-vq-section]").forEach((node) => observer.observe(node));
    }, 1500);
  }

  return () => {
    document.removeEventListener("click", onClick, { capture: true });
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("pagehide", onHide);
    if (observer) observer.disconnect();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    queue.length = 0;
    analyticsInitialised = false;
  };
}
