const axios = require("axios");
require("dotenv").config();

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const localNodeUrl = process.env.LOCAL_NODE_URL || "http://localhost:5001";
const displayName = process.env.NODE_DISPLAY_NAME || "Local Vorliq Node";
const heartbeatIntervalMs = 5 * 60 * 1000;

async function registerLocalNode() {
  try {
    await axios.post(`${flaskUrl}/registry/register`, {
      node_url: localNodeUrl,
      display_name: displayName,
    });
    console.log(`Registered ${localNodeUrl} in the Vorliq public node registry.`);
  } catch (error) {
    console.log(`Registry registration failed: ${error.response?.data?.error || error.message}`);
  }
}

async function sendHeartbeat() {
  try {
    await axios.post(`${flaskUrl}/registry/heartbeat`, {
      node_url: localNodeUrl,
    });
    console.log(`Heartbeat sent for ${localNodeUrl} at ${new Date().toLocaleString()}.`);
  } catch (error) {
    console.log(`Heartbeat failed: ${error.response?.data?.error || error.message}`);
  }
}

async function startHeartbeatLoop() {
  await registerLocalNode();
  await sendHeartbeat();
  setInterval(sendHeartbeat, heartbeatIntervalMs);
}

startHeartbeatLoop();
