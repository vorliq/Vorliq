import { trackApiFailure } from "./analytics";
import api from "./api";

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value.data : fallback;
}

function isUnavailable(result) {
  if (result.status === "rejected") return true;
  return result.value?.data?.success !== true;
}

// Report rejected public GET endpoints to analytics (endpoint + timeout/error).
// Fire-and-forget; never affects the returned data.
function reportFailures(pairs) {
  pairs.forEach(([result, endpoint]) => {
    if (result.status !== "rejected") return;
    const reason = result.reason || {};
    const outcome =
      reason.code === "ECONNABORTED" || /timeout/i.test(reason.message || "") ? "timeout" : "error";
    trackApiFailure(endpoint, outcome);
  });
}

// Core chain snapshot. These endpoints are fast, so the main homepage cards and
// the hero card can render quickly without waiting on slower status checks.
export async function loadPublicChainSnapshot() {
  const [summaryResult, blocksResult, confirmedResult, pendingResult, healthResult, leaderboardResult] =
    await Promise.allSettled([
      api.get("/chain/summary"),
      api.get("/chain/blocks", { params: { limit: 6, offset: 0 } }),
      api.get("/transactions", { params: { status: "confirmed", limit: 8, offset: 0 } }),
      api.get("/transactions/pending", { params: { limit: 8, offset: 0 } }),
      api.get("/health", { timeout: 5000 }),
      api.get("/leaderboard", { params: { limit: 1, offset: 0 } }),
    ]);

  reportFailures([
    [summaryResult, "/chain/summary"],
    [blocksResult, "/chain/blocks"],
    [confirmedResult, "/transactions"],
    [pendingResult, "/transactions/pending"],
    [healthResult, "/health"],
    [leaderboardResult, "/leaderboard"],
  ]);

  const summaryData = settledValue(summaryResult, {});
  const blocksData = settledValue(blocksResult, {});
  const confirmedData = settledValue(confirmedResult, {});
  const pendingData = settledValue(pendingResult, {});
  const healthData = settledValue(healthResult, {});
  const leaderboardData = settledValue(leaderboardResult, {});
  const holderTotal =
    leaderboardData?.totals?.holders ?? leaderboardData?.holders_total ?? leaderboardData?.holders?.length;

  return {
    summary: summaryData.summary || null,
    blocks: blocksData.blocks || [],
    confirmedTransactions: confirmedData.transactions || [],
    confirmedTotal: confirmedData.total,
    pendingTransactions: pendingData.transactions || [],
    pendingTotal: pendingData.total,
    health: healthData,
    holderTotal,
    unavailable: {
      summary: isUnavailable(summaryResult),
      blocks: isUnavailable(blocksResult),
      confirmedTransactions: isUnavailable(confirmedResult),
      pendingTransactions: isUnavailable(pendingResult),
      health: isUnavailable(healthResult),
      holders: isUnavailable(leaderboardResult) || holderTotal == null,
    },
  };
}

// Network status (readiness, deployment, peer propagation). The readiness check
// runs many gates and can be slow, so it is loaded separately with a generous
// timeout and never blocks the core chain cards from rendering.
export async function loadNetworkStatus() {
  const [readinessResult, deploymentResult, propagationResult] = await Promise.allSettled([
    api.get("/readiness", { timeout: 20000 }),
    api.get("/deployment", { timeout: 20000 }),
    api.get("/peers/propagation/status", { timeout: 15000 }),
  ]);

  reportFailures([
    [readinessResult, "/readiness"],
    [deploymentResult, "/deployment"],
    [propagationResult, "/peers/propagation/status"],
  ]);

  return {
    readiness: isUnavailable(readinessResult) ? null : settledValue(readinessResult, {}),
    deployment: isUnavailable(deploymentResult) ? null : settledValue(deploymentResult, {}),
    propagation: isUnavailable(propagationResult) ? null : settledValue(propagationResult, {}),
    unavailable: {
      readiness: isUnavailable(readinessResult),
      deployment: isUnavailable(deploymentResult),
      propagation: isUnavailable(propagationResult),
    },
  };
}

export function shortHash(value) {
  if (!value) return "Unavailable";
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

// Middle-truncated hash for tight card layouts, e.g. 0000096058…825192.
// Returns the full value separately via the caller (use as title attribute).
export function formatHash(value, lead = 10, tail = 6) {
  if (value == null || value === "") return "Unavailable";
  const text = String(value);
  if (text.length <= lead + tail + 1) return text;
  return `${text.slice(0, lead)}…${text.slice(-tail)}`;
}

// Normalises a status into a short, clean, human label.
export function formatStatus(value) {
  if (value == null || value === "") return "Unavailable";
  const map = {
    pass: "Operational",
    ok: "Operational",
    healthy: "Operational",
    warning: "Monitoring",
    warn: "Monitoring",
    fail: "Attention",
    error: "Attention",
    syncing: "Syncing",
    valid: "Valid",
    invalid: "Under review",
    unavailable: "Unavailable",
  };
  const key = String(value).toLowerCase();
  if (map[key]) return map[key];
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

export function formatTime(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return "Time unavailable";
  return new Date(numeric * 1000).toLocaleString();
}

export function formatRelativeTime(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - numeric));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatVlq(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Unavailable";
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 8 })} VLQ`;
}

export function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Unavailable";
  return numeric.toLocaleString();
}
