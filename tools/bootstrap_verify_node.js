#!/usr/bin/env node

const { verifySnapshotSignature } = require("../backend/snapshotSigner");
const { containsForbiddenString } = require("./verify_snapshot");

async function getFetch() {
  if (typeof fetch === "function") return fetch.bind(globalThis);
  const imported = await import("node-fetch");
  return imported.default;
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const fetchImpl = await getFetch();
  const response = await fetchImpl(`${baseUrl}${pathname}`, { signal: AbortSignal.timeout(options.timeout || 20000) });
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(`${pathname} returned ${response.status}: ${data.message || data.error || "request failed"}`);
  }
  return data;
}

function normalizeBaseUrl(value) {
  return String(value || "https://vorliq.org").replace(/\/+$/, "");
}

async function bootstrapVerifyNode(nodeUrl = "https://vorliq.org", options = {}) {
  const baseUrl = normalizeBaseUrl(nodeUrl);
  const publicNodeUrl = options.publicNodeUrl || "https://node.vorliq.org";
  const registryPath = `/api/registry/node?${new URLSearchParams({ node_url: publicNodeUrl }).toString()}`;
  const [health, version, publicKey, latestPayload, verifyPayload, readinessResult, registryResult] = await Promise.allSettled([
    fetchJson(baseUrl, "/api/health"),
    fetchJson(baseUrl, "/api/version"),
    fetchJson(baseUrl, "/api/snapshot/public-key"),
    fetchJson(baseUrl, "/api/snapshot/latest"),
    fetchJson(baseUrl, "/api/snapshot/verify"),
    fetchJson(baseUrl, "/api/readiness"),
    fetchJson(baseUrl, registryPath),
  ]);

  const issues = [];
  function value(result, label, required = true) {
    if (result.status === "fulfilled") return result.value;
    if (required) issues.push(`${label} unavailable: ${result.reason.message}`);
    return null;
  }

  const healthData = value(health, "health");
  const versionData = value(version, "version");
  const publicKeyData = value(publicKey, "snapshot public key");
  const latestData = value(latestPayload, "latest snapshot");
  const verifyData = value(verifyPayload, "snapshot verification");
  const readinessData = value(readinessResult, "readiness", false);
  const registryData = value(registryResult, "registry node", false);
  const snapshot = latestData?.snapshot || latestData || {};
  const signature = verifySnapshotSignature(snapshot, {
    requireSignature: true,
    publicKey: snapshot.signature?.public_key || publicKeyData?.public_key,
  });

  if (healthData?.success !== true) issues.push("node health did not return success=true");
  if (verifyData?.verified !== true) issues.push("snapshot verification endpoint did not return verified=true");
  if (verifyData?.signature_verified !== true) issues.push("snapshot verification endpoint did not return signature_verified=true");
  if (signature.signature_verified !== true) issues.push("local signature verification failed");
  if (containsForbiddenString({ healthData, versionData, publicKeyData, latestData, verifyData, readinessData, registryData })) {
    issues.push("bootstrap response contained a forbidden secret marker");
  }

  const registryNode = registryData?.node || registryData || null;
  return {
    ok: issues.length === 0,
    base_url: baseUrl,
    node_reachable: healthData?.success === true,
    api_version: versionData?.api_version || versionData?.version || versionData?.current_version || null,
    deployment_commit: snapshot.deployment_commit || readinessData?.deployment_commit || null,
    snapshot_signed: signature.enabled === true,
    signature_valid: signature.signature_verified === true,
    public_key_id: signature.public_key_id || publicKeyData?.public_key_id || null,
    chain_height: snapshot.chain_height ?? null,
    latest_block_hash: snapshot.latest_block_hash || null,
    readiness_status: readinessData?.overall_status || null,
    registry: registryNode
      ? {
          available: true,
          node_url: registryNode.node_url || publicNodeUrl,
          active: registryNode.active === true,
          sync_status: registryNode.sync_status || "unknown",
          display_name: registryNode.display_name || registryNode.name || "",
          region: registryNode.region || "",
          country: registryNode.country || "",
        }
      : { available: false, node_url: publicNodeUrl },
    issues,
  };
}

async function main() {
  const nodeUrl = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) || process.argv[2] || "https://vorliq.org";
  try {
    const report = await bootstrapVerifyNode(nodeUrl);
    if (!report.ok) {
      console.error("Vorliq node bootstrap verification failed");
      report.issues.forEach((issue) => console.error(`- ${issue}`));
      process.exit(1);
    }
    console.log("Vorliq node bootstrap verification passed");
    console.log(`Node reachable: ${report.node_reachable}`);
    console.log(`API version: ${report.api_version || "unknown"}`);
    console.log(`Deployment commit: ${report.deployment_commit || "unknown"}`);
    console.log(`Snapshot signed: ${report.snapshot_signed}`);
    console.log(`Signature valid: ${report.signature_valid}`);
    console.log(`Public key id: ${report.public_key_id || "unavailable"}`);
    console.log(`Chain height: ${report.chain_height}`);
    console.log(`Latest block hash: ${report.latest_block_hash || "unknown"}`);
    console.log(`Readiness: ${report.readiness_status || "unknown"}`);
    if (report.registry.available) {
      console.log(`Registry node: ${report.registry.node_url} active=${report.registry.active} sync=${report.registry.sync_status}`);
    }
  } catch (error) {
    console.error(`Vorliq node bootstrap verification failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  bootstrapVerifyNode,
};
