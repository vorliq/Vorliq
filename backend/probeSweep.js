const axios = require("axios");
require("dotenv").config();

// One-shot trigger for the registry node probe sweep. Modeled on heartbeat.js:
// a small command a systemd timer fires periodically, which asks the running
// backend (single writer of the registry) to independently probe every
// registered node and reconcile what it serves against what it claimed.
const apiUrl = (
  process.env.PROBE_API_URL ||
  process.env.HEARTBEAT_API_URL ||
  process.env.BACKEND_URL ||
  "http://127.0.0.1:5000"
).replace(/\/+$/, "");
const adminToken = process.env.ADMIN_TOKEN || "";
const requestTimeoutMs = Number(process.env.PROBE_SWEEP_TIMEOUT_MS || 120000);

function safeError(error) {
  return error.response?.data?.message || error.response?.data?.error || error.message;
}

async function runProbeSweep({ registryApiUrl = apiUrl, token = adminToken } = {}) {
  if (!token) {
    console.log("Probe sweep skipped: ADMIN_TOKEN is not configured.");
    return null;
  }
  try {
    const response = await axios.post(
      `${registryApiUrl}/api/admin/registry/probe-sweep`,
      {},
      {
        timeout: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 120000,
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const summary = response.data?.summary || {};
    console.log(`Probe sweep complete at ${new Date().toLocaleString()}: ${JSON.stringify(summary)}`);
    return response.data;
  } catch (error) {
    console.log(`Probe sweep failed: ${safeError(error)}`);
    return null;
  }
}

if (require.main === module) {
  runProbeSweep().then((result) => {
    process.exit(result?.success ? 0 : 1);
  });
}

module.exports = { runProbeSweep };
