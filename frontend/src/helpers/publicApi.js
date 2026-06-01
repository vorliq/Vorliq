import api from "./api";

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value.data : fallback;
}

function isUnavailable(result) {
  if (result.status === "rejected") return true;
  return result.value?.data?.success !== true;
}

export async function loadPublicChainSnapshot() {
  const [summaryResult, blocksResult, confirmedResult, pendingResult, healthResult, leaderboardResult] = await Promise.allSettled([
    api.get("/chain/summary"),
    api.get("/chain/blocks", { params: { limit: 6, offset: 0 } }),
    api.get("/transactions", { params: { status: "confirmed", limit: 8, offset: 0 } }),
    api.get("/transactions/pending", { params: { limit: 8, offset: 0 } }),
    api.get("/health", { timeout: 5000 }),
    api.get("/leaderboard", { params: { limit: 1, offset: 0 } }),
  ]);

  const summaryData = settledValue(summaryResult, {});
  const blocksData = settledValue(blocksResult, {});
  const confirmedData = settledValue(confirmedResult, {});
  const pendingData = settledValue(pendingResult, {});
  const healthData = settledValue(healthResult, {});
  const leaderboardData = settledValue(leaderboardResult, {});
  const holderTotal = leaderboardData?.totals?.holders ?? leaderboardData?.holders_total ?? leaderboardData?.holders?.length;

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

export function shortHash(value) {
  if (!value) return "Unavailable";
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

export function formatTime(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return "Time unavailable";
  return new Date(numeric * 1000).toLocaleString();
}

export function formatVlq(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Unavailable";
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 8 })} VLQ`;
}
