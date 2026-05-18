import theme from "../theme";

export function unwrap(payload, key) {
  if (!payload) return null;
  if (payload.data && key && payload.data[key] !== undefined) return payload.data[key];
  if (payload.data && payload.data.data && key && payload.data.data[key] !== undefined) return payload.data.data[key];
  if (key && payload[key] !== undefined) return payload[key];
  return payload.data || payload;
}

export function asArray(payload, key) {
  const value = unwrap(payload, key);
  if (Array.isArray(value)) return value;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

export function shortText(value, start = 10, end = 6) {
  const text = String(value || "");
  if (text.length <= start + end + 3) return text || "None";
  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

export function formatTimestamp(value) {
  if (!value) return "Unknown";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1000000000000 ? numeric : numeric * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export function statusColor(status) {
  const value = String(status || "").toLowerCase();
  if (["confirmed", "active", "synced", "paid", "executed", "vlq_confirmed", "repaid", "open"].includes(value)) {
    return theme.success;
  }
  if (["pending", "pending_vote", "approved_pending_issue", "payout_pending", "vlq_pending", "accepted"].includes(value)) {
    return theme.warning;
  }
  if (["rejected", "cancelled", "expired", "overdue", "disputed", "invalid"].includes(value)) {
    return theme.error;
  }
  return theme.accentSecondary;
}

export function normalizeStatus(status) {
  return String(status || "unknown").replace(/_/g, " ");
}
