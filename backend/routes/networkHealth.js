const express = require("express");
const axios = require("axios");

const { handleRouteError } = require("./routeError");
const { getRecentAlerts } = require("../monitors");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

// 30-day uptime derived from the monitoring alerts log: downtime is the time the
// chain/backend monitors spent in a CRITICAL firing state (from a "firing" event
// to its matching "resolved"), clamped to the 30-day window. No criticals -> ~100%.
function uptime30dPercent() {
  const now = Date.now();
  const windowMs = 30 * 24 * 60 * 60 * 1000;
  const start = now - windowMs;
  const events = getRecentAlerts(1000)
    .map((e) => ({ monitor: e.monitor, severity: String(e.severity || "").toLowerCase(), status: String(e.status || "").toLowerCase(), t: Date.parse(e.created_at) }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);

  let downtime = 0;
  const firingSince = {};
  for (const e of events) {
    if (e.status === "firing" && e.severity === "critical") {
      if (firingSince[e.monitor] == null) firingSince[e.monitor] = e.t;
    } else if (e.status === "resolved" && firingSince[e.monitor] != null) {
      const s = Math.max(firingSince[e.monitor], start);
      const end = Math.min(e.t, now);
      if (end > s) downtime += end - s;
      delete firingSince[e.monitor];
    }
  }
  for (const m of Object.keys(firingSince)) {
    const s = Math.max(firingSince[m], start);
    if (now > s) downtime += now - s;
  }
  const pct = Math.max(0, Math.min(100, 100 * (1 - downtime / windowMs)));
  return Math.round(pct * 1000) / 1000;
}

// Public, no-auth snapshot of network health. Aggregates the live chain figures
// with a derived uptime so a visitor (or an external monitor) can see the network
// is alive without an account.
router.get("/api/network-health", async (req, res) => {
  try {
    const [summaryR, miningR, nodesR] = await Promise.allSettled([
      axios.get(`${flaskUrl}/chain/summary`, { timeout: 8000 }),
      axios.get(`${flaskUrl}/mining/status`, { timeout: 8000 }),
      axios.get(`${flaskUrl}/registry/nodes`, { timeout: 8000 }),
    ]);
    const summary = summaryR.status === "fulfilled" ? summaryR.value.data?.summary || {} : {};
    const mining = miningR.status === "fulfilled" ? miningR.value.data || {} : {};
    const nodes = nodesR.status === "fulfilled" ? nodesR.value.data?.nodes || [] : [];

    const lastTs = Number(summary.last_block_timestamp ?? mining.last_block_timestamp) || null;
    const chainValid = summary.chain_valid !== false && mining.chain_valid !== false;
    const reachable = summaryR.status === "fulfilled" || miningR.status === "fulfilled";

    return res.json({
      success: true,
      generated_at: new Date().toISOString(),
      chain_height: summary.block_height ?? mining.current_block_height ?? null,
      last_block_timestamp: lastTs,
      seconds_since_last_block: lastTs ? Math.max(0, Math.round(Date.now() / 1000 - lastTs)) : null,
      pending_transaction_count: mining.pending_transaction_count ?? null,
      chain_health: !reachable ? "unreachable" : chainValid ? "healthy" : "degraded",
      // The node serving this request is itself a registered, live node, so the
      // floor is 1 even when the peer registry has not recorded others.
      registered_nodes: Math.max(1, Array.isArray(nodes) ? nodes.length : 0),
      uptime_30d_percent: uptime30dPercent(),
    });
  } catch (error) {
    return handleRouteError(res, error, "GET /api/network-health", "Unable to load network health.");
  }
});

module.exports = router;
