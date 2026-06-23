const axios = require("axios");

const { logError } = require("./logger");

// Network-status reliability. /diagnostics validates the whole chain, so on a
// cold or busy node it can be slow. Instead of letting the frontend wait on it,
// the Node layer refreshes diagnostics in the background every 30s with a hard 5s
// timeout and serves the last good value immediately. If a refresh times out or
// fails, the previous value is kept and served as "stale" rather than surfacing
// "Unavailable" to users. The served payload carries a small _cache block so the
// frontend can show how old the figures are.

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const REFRESH_MS = 30 * 1000;
// Generous enough that a busy core (rebuilding indexes for a freshly mined block)
// still completes the refresh and repopulates the cache, rather than timing out
// and serving an ever-older stale value.
const FETCH_TIMEOUT_MS = 12 * 1000;
const STALE_AFTER_SECONDS = 60;

let cachedData = null; // last successful diagnostics payload
let fetchedAt = 0; // ms timestamp of the last success
let refreshing = false;
let timer = null;

async function refresh() {
  if (refreshing) return cachedData;
  refreshing = true;
  try {
    const response = await axios.get(`${flaskUrl}/diagnostics`, { timeout: FETCH_TIMEOUT_MS });
    if (response && response.data) {
      cachedData = response.data;
      fetchedAt = Date.now();
    }
  } catch (error) {
    // Keep the last good value and serve it stale; never throw from the refresh.
    logError(`Diagnostics background refresh failed (serving last cached): ${error.message}`);
  } finally {
    refreshing = false;
  }
  return cachedData;
}

function cacheMeta() {
  const ageSeconds = cachedData ? Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)) : null;
  return {
    fetched_at: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    age_seconds: ageSeconds,
    stale: ageSeconds != null && ageSeconds > STALE_AFTER_SECONDS,
  };
}

// Return the cached diagnostics immediately. On a cold start (no value yet) do a
// single bounded fetch so the very first caller still gets data.
async function getDiagnostics() {
  if (!cachedData) {
    await refresh();
  }
  return { data: cachedData, cache: cacheMeta() };
}

function startDiagnosticsCache() {
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  if (timer && timer.unref) timer.unref();
  return timer;
}

function _resetForTests() {
  cachedData = null;
  fetchedAt = 0;
  refreshing = false;
}

module.exports = {
  startDiagnosticsCache,
  getDiagnostics,
  refresh,
  _resetForTests,
};
