const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { atomicWriteJson, safeReadJson } = require("./jsonStore");

const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const EVENT_TYPES = new Set([
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

const METADATA_KEYS = new Set([
  "source",
  "section",
  "link",
  "status",
  "reason",
  "route_category",
  "feature",
]);

function analyticsFile() {
  return process.env.ANALYTICS_FILE || path.join(__dirname, "data", "analytics.json");
}

function emptyStore() {
  return { events: [] };
}

function ensureStoreFile() {
  const file = analyticsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    atomicWriteJson(file, emptyStore());
  }
}

function readStore() {
  ensureStoreFile();
  const parsed = safeReadJson(analyticsFile(), emptyStore());
  return { events: Array.isArray(parsed.events) ? parsed.events : [] };
}

function writeStore(store) {
  ensureStoreFile();
  atomicWriteJson(analyticsFile(), { events: store.events || [] });
}

function cutoffTime(now = Date.now()) {
  return now - RETENTION_MS;
}

function pruneEvents(events, now = Date.now()) {
  const cutoff = cutoffTime(now);
  return (events || []).filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function pruneAnalytics(now = Date.now()) {
  const store = readStore();
  const pruned = pruneEvents(store.events, now);
  if (pruned.length !== store.events.length) {
    writeStore({ events: pruned });
  }
  return pruned;
}

function cleanText(value, max) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);
}

function validateMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    const error = new Error("metadata must be an object.");
    error.status = 400;
    throw error;
  }

  return Object.entries(metadata).reduce((safe, [key, value]) => {
    if (!METADATA_KEYS.has(key)) {
      const error = new Error(`metadata key ${key} is not allowed.`);
      error.status = 400;
      throw error;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = cleanText(value, 80);
    }
    return safe;
  }, {});
}

function validateAnalyticsEvent(body = {}) {
  if (!EVENT_TYPES.has(body.event_type)) {
    const error = new Error("event_type is not allowed.");
    error.status = 400;
    throw error;
  }

  const route = cleanText(body.route || "/", 120);
  const category = cleanText(body.category || "general", 60);
  const anonymousSessionId = cleanText(body.anonymous_session_id, 80);
  if (!anonymousSessionId || !/^anon_[A-Za-z0-9_-]{12,72}$/.test(anonymousSessionId)) {
    const error = new Error("anonymous_session_id is invalid.");
    error.status = 400;
    throw error;
  }

  return {
    event_id: crypto.randomUUID(),
    event_type: body.event_type,
    route,
    category,
    timestamp: new Date().toISOString(),
    anonymous_session_id: anonymousSessionId,
    metadata: validateMetadata(body.metadata),
  };
}

function appendEvent(body) {
  const event = validateAnalyticsEvent(body);
  const store = readStore();
  const events = pruneEvents(store.events);
  events.push(event);
  writeStore({ events });
  return event;
}

function eventsSince(events, days, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return events.filter((event) => Date.parse(event.timestamp) >= cutoff);
}

function eventsToday(events, now = Date.now()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return events.filter((event) => Date.parse(event.timestamp) >= start.getTime());
}

function topCounts(events, key, limit = 8) {
  const counts = new Map();
  events.forEach((event) => {
    const value = event[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function countType(events, eventType) {
  return events.filter((event) => event.event_type === eventType).length;
}

function uniqueSessions(events) {
  return new Set(events.map((event) => event.anonymous_session_id).filter(Boolean)).size;
}

function dailyCounts(events, days = 30, now = Date.now()) {
  const buckets = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    buckets.push({ date: key, events: 0, page_views: 0, unique_anonymous_sessions: 0, sessions: new Set() });
  }
  const byDate = new Map(buckets.map((bucket) => [bucket.date, bucket]));
  events.forEach((event) => {
    const date = String(event.timestamp || "").slice(0, 10);
    const bucket = byDate.get(date);
    if (!bucket) return;
    bucket.events += 1;
    if (event.event_type === "page_view") bucket.page_views += 1;
    if (event.anonymous_session_id) bucket.sessions.add(event.anonymous_session_id);
  });
  return buckets.map(({ sessions, ...bucket }) => ({
    ...bucket,
    unique_anonymous_sessions: sessions.size,
  }));
}

function summary(now = Date.now()) {
  const events = pruneAnalytics(now);
  const today = eventsToday(events, now);
  const sevenDays = eventsSince(events, 7, now);
  return {
    success: true,
    events_today: today.length,
    events_7d: sevenDays.length,
    page_views_today: countType(today, "page_view"),
    page_views_7d: countType(sevenDays, "page_view"),
    unique_anonymous_sessions_today: uniqueSessions(today),
    unique_anonymous_sessions_7d: uniqueSessions(sevenDays),
    top_routes_7d: topCounts(sevenDays, "route"),
    top_features_7d: topCounts(sevenDays, "category"),
    onboarding_completed_7d: countType(sevenDays, "onboarding_completed"),
    faucet_interest_7d: countType(sevenDays, "faucet_page_opened") + countType(sevenDays, "faucet_claim_attempted"),
    mine_page_views_7d: countType(sevenDays, "mine_page_opened"),
    forum_page_views_7d: countType(sevenDays, "forum_page_opened"),
  };
}

function adminSummary(now = Date.now()) {
  const events = pruneAnalytics(now);
  const thirtyDays = eventsSince(events, 30, now);
  return {
    success: true,
    retention_days: RETENTION_DAYS,
    daily_counts: dailyCounts(thirtyDays, 30, now),
    top_routes: topCounts(thirtyDays, "route", 12),
    feature_usage: topCounts(thirtyDays, "category", 12),
    error_events: countType(thirtyDays, "error_boundary_seen"),
    onboarding_completion_count: countType(thirtyDays, "onboarding_completed"),
    analytics_opt_out_count: 0,
    note: "Analytics stores aggregate product events only. It is not required to reconstruct blockchain balances.",
  };
}

module.exports = {
  EVENT_TYPES,
  METADATA_KEYS,
  RETENTION_DAYS,
  adminSummary,
  appendEvent,
  analyticsFile,
  pruneAnalytics,
  summary,
  validateAnalyticsEvent,
};
