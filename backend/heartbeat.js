const axios = require("axios");
require("dotenv").config();

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const localNodeUrl = process.env.VORLIQ_NODE_URL || process.env.LOCAL_NODE_URL || "http://localhost:5001";
const displayName = process.env.VORLIQ_NODE_NAME || process.env.NODE_DISPLAY_NAME || "Vorliq Public Node";
const region = process.env.VORLIQ_NODE_REGION || "";
const country = process.env.VORLIQ_NODE_COUNTRY || "";
const operatorWallet = process.env.VORLIQ_OPERATOR_WALLET || "";
const softwareVersion = process.env.npm_package_version ? `backend-${process.env.npm_package_version}` : "vorliq-node";
const heartbeatIntervalMs = 5 * 60 * 1000;

function basePayload() {
  return {
    node_url: localNodeUrl,
    display_name: displayName,
    region,
    country,
    operator_wallet_address: operatorWallet,
    software_version: softwareVersion,
    is_public: true,
  };
}

async function getDiagnostics() {
  try {
    const started = Date.now();
    const response = await axios.get(`${flaskUrl}/diagnostics`, { timeout: 8000 });
    return {
      chain_height: response.data.block_height,
      last_block_hash: response.data.last_block_hash,
      chain_valid: Boolean(response.data.chain_valid),
      response_time_ms: Date.now() - started,
    };
  } catch (error) {
    console.log(`Diagnostics check failed before heartbeat: ${error.response?.data?.error || error.message}`);
    return {
      chain_valid: false,
      response_time_ms: null,
    };
  }
}

async function registerLocalNode() {
  try {
    await axios.post(`${flaskUrl}/registry/register`, basePayload());
    console.log(`Registered ${localNodeUrl} in the Vorliq public node registry.`);
  } catch (error) {
    console.log(`Registry registration failed: ${error.response?.data?.error || error.response?.data?.message || error.message}`);
  }
}

async function sendHeartbeat() {
  try {
    const diagnostics = await getDiagnostics();
    await axios.post(`${flaskUrl}/registry/heartbeat`, {
      ...basePayload(),
      ...diagnostics,
    });
    console.log(`Heartbeat sent for ${localNodeUrl} at ${new Date().toLocaleString()}.`);
  } catch (error) {
    console.log(`Heartbeat failed: ${error.response?.data?.error || error.response?.data?.message || error.message}`);
  }
}

async function startHeartbeatLoop() {
  await registerLocalNode();
  await sendHeartbeat();
  setInterval(sendHeartbeat, heartbeatIntervalMs);
}

startHeartbeatLoop();
