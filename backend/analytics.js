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
  "node_sync_page_opened",
  "docs_link_clicked",
  "error_boundary_seen",
  // Additive interaction and reliability events.
  "cta_click",
  "nav_click",
  "card_click",
  "section_view",
  "dashboard_action",
  "api_failure",
  "frontend_error",
]);

const METADATA_KEYS = new Set([
  "source",
  "section",
  "link",
  "status",
  "reason",
  "route_category",
  "feature",
  // Additive, non-identifying interaction context.
  "element",
  "device",
  "endpoint",
  "outcome",
  "duration_ms",
  "value",
]);

const MAX_BATCH_EVENTS = 25;

function analyticsFile() {
  return process.env.ANALYTICS_FILE || path.join(__dirname, "data", "analytics.json");
}

function emptyStore() {
  return { events: [] };
}

// Storage lock recovery, scoped to the analytics file only. A legitimate write
// holds the lock for milliseconds, and the shared lock helper gives up after 5s,
// so any analytics.json.lock older than this threshold belongs to a process that
// died mid-write (for example, killed during a deploy restart). Such a stale lock
// would otherwise deadlock every future analytics write forever. Removing it is
// safe: the holder is gone, atomic writes rename a complete temp file, and at
// worst a single best-effort event is lost. This never touches any other store.
const STALE_LOCK_MS = 12000;

function clearStaleAnalyticsLock() {
  const lockPath = `${analyticsFile()}.lock`;
  try {
    const stats = fs.statSync(lockPath);
    if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    // No lock file, or it was removed by a concurrent writer. Nothing to do.
  }
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
  clearStaleAnalyticsLock();
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

// Batch ingest. Validates each event; the whole batch is rejected if any event
// is invalid or the batch is malformed, so it can never be abused to write
// arbitrary data. One disk write for the whole batch.
function appendEvents(list) {
  if (!Array.isArray(list)) {
    const error = new Error("events must be an array.");
    error.status = 400;
    throw error;
  }
  if (list.length === 0 || list.length > MAX_BATCH_EVENTS) {
    const error = new Error(`events must contain between 1 and ${MAX_BATCH_EVENTS} items.`);
    error.status = 400;
    throw error;
  }

  const validated = list.map((item) => validateAnalyticsEvent(item || {}));
  const store = readStore();
  const events = pruneEvents(store.events);
  validated.forEach((event) => events.push(event));
  writeStore({ events });
  return validated.length;
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

// Count by a metadata sub-key, optionally restricted to a set of event types.
function topMetaCounts(events, metaKey, eventTypes = null, limit = 10) {
  const allowed = eventTypes ? new Set(eventTypes) : null;
  const counts = new Map();
  events.forEach((event) => {
    if (allowed && !allowed.has(event.event_type)) return;
    const value = (event.metadata && event.metadata[metaKey]) || null;
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function deviceBreakdown(events) {
  const counts = { mobile: 0, tablet: 0, desktop: 0, unknown: 0 };
  events.forEach((event) => {
    const device = (event.metadata && event.metadata.device) || "unknown";
    if (counts[device] === undefined) counts.unknown += 1;
    else counts[device] += 1;
  });
  return Object.entries(counts).map(([name, count]) => ({ name, count }));
}

// API failures grouped by endpoint, with a simple reliability picture.
function apiFailureBreakdown(events) {
  const failures = events.filter((event) => event.event_type === "api_failure");
  const byEndpoint = new Map();
  failures.forEach((event) => {
    const endpoint = (event.metadata && event.metadata.endpoint) || "unknown";
    const outcome = (event.metadata && event.metadata.outcome) || "error";
    const entry = byEndpoint.get(endpoint) || { endpoint, total: 0, timeout: 0, error: 0 };
    entry.total += 1;
    if (outcome === "timeout") entry.timeout += 1;
    else entry.error += 1;
    byEndpoint.set(endpoint, entry);
  });
  return [...byEndpoint.values()].sort((left, right) => right.total - left.total).slice(0, 12);
}

// A small, honest journey funnel from landing to first key actions.
function journeyFunnel(events) {
  const isCta = (label) => (event) =>
    event.event_type === "cta_click" && event.metadata && String(event.metadata.element || "").includes(label);
  const stages = [
    { stage: "Landing views", count: events.filter((e) => e.event_type === "page_view" && e.route === "/").length },
    { stage: "Create account clicks", count: events.filter(isCta("create-account")).length },
    { stage: "Explore blockchain clicks", count: events.filter(isCta("explore-blockchain")).length },
    { stage: "Wallet opened", count: countType(events, "wallet_page_opened") },
    { stage: "Blockchain opened", count: events.filter((e) => e.event_type === "page_view" && e.route === "/blockchain").length },
  ];
  return stages;
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
  const apiFailures = apiFailureBreakdown(thirtyDays);
  const apiFailureTotal = apiFailures.reduce((sum, entry) => sum + entry.total, 0);
  const pageViews = countType(thirtyDays, "page_view");
  return {
    success: true,
    retention_days: RETENTION_DAYS,
    total_events_30d: thirtyDays.length,
    daily_counts: dailyCounts(thirtyDays, 30, now),
    top_routes: topCounts(thirtyDays, "route", 12),
    feature_usage: topCounts(thirtyDays, "category", 12),
    error_events: countType(thirtyDays, "error_boundary_seen"),
    onboarding_completion_count: countType(thirtyDays, "onboarding_completed"),
    analytics_opt_out_count: 0,
    // Additive aggregate sections for the admin analytics view.
    top_buttons: topMetaCounts(thirtyDays, "element", ["cta_click", "nav_click"], 12),
    top_cards: topMetaCounts(thirtyDays, "element", ["card_click"], 12),
    dashboard_features: topMetaCounts(thirtyDays, "element", ["dashboard_action"], 12),
    journey_funnel: journeyFunnel(thirtyDays),
    device_breakdown: deviceBreakdown(thirtyDays),
    api_failures: apiFailures,
    api_failure_total_30d: apiFailureTotal,
    page_views_30d: pageViews,
    api_error_rate_30d: pageViews > 0 ? Number((apiFailureTotal / pageViews).toFixed(4)) : 0,
    frontend_error_count_30d: countType(thirtyDays, "frontend_error") + countType(thirtyDays, "error_boundary_seen"),
    explorer_usage_30d:
      thirtyDays.filter((event) => event.event_type === "page_view" && event.route === "/blockchain").length +
      topMetaCounts(thirtyDays, "element", ["card_click"], 50)
        .filter((entry) => String(entry.name).includes("explorer"))
        .reduce((sum, entry) => sum + entry.count, 0),
    note: "Analytics stores aggregate product events only. It does not store IP addresses, wallet identity, keys, or secrets, and is not required to reconstruct blockchain balances.",
  };
}

module.exports = {
  EVENT_TYPES,
  METADATA_KEYS,
  MAX_BATCH_EVENTS,
  RETENTION_DAYS,
  adminSummary,
  appendEvent,
  appendEvents,
  analyticsFile,
  pruneAnalytics,
  summary,
  validateAnalyticsEvent,
};
