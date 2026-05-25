#!/usr/bin/env node

const FORBIDDEN_PATTERN = /PRIVATE KEY|BEGIN [A-Z ]*PRIVATE KEY|ADMIN_TOKEN|SERVER_SSH_KEY|password|private_key|admin_token|raw_ip|ip_address|server_path|user_agent|\/home\/vorliq|[A-Za-z]:\\Users\\|ssh-(rsa|ed25519)|Bearer\s+[A-Za-z0-9._~+/=-]+/i;

async function getFetch() {
  if (typeof fetch === "function") return fetch.bind(globalThis);
  const imported = await import("node-fetch");
  return imported.default;
}

async function fetchJson(baseUrl, path) {
  const fetchImpl = await getFetch();
  const response = await fetchImpl(`${baseUrl}${path}`);
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(`${path} returned ${response.status}: ${data.message || data.error || "request failed"}`);
  }
  return data;
}

function containsForbiddenString(value) {
  return FORBIDDEN_PATTERN.test(JSON.stringify(value || {}));
}

function snapshotFromLatest(payload) {
  return payload.snapshot || payload;
}

async function verifySnapshotBase(baseUrl = "https://vorliq.org") {
  const normalizedBase = String(baseUrl || "https://vorliq.org").replace(/\/+$/, "");
  const latestPayload = await fetchJson(normalizedBase, "/api/snapshot/latest");
  const verifyPayload = await fetchJson(normalizedBase, "/api/snapshot/verify");
  const latest = snapshotFromLatest(latestPayload);
  const verifiedSnapshot = verifyPayload.snapshot || {};
  const issues = [];
  const warnings = Array.isArray(verifyPayload.warnings) ? verifyPayload.warnings : [];

  if (verifyPayload.verified !== true) {
    issues.push("snapshot verify endpoint did not return verified=true");
  }
  if (latest.chain_height !== verifiedSnapshot.chain_height) {
    issues.push(`chain height mismatch: latest=${latest.chain_height} verify=${verifiedSnapshot.chain_height}`);
  }
  if (latest.latest_block_hash !== verifiedSnapshot.latest_block_hash) {
    issues.push(`latest block hash mismatch: latest=${latest.latest_block_hash} verify=${verifiedSnapshot.latest_block_hash}`);
  }
  if (containsForbiddenString(latestPayload)) {
    issues.push("latest snapshot contains a forbidden string");
  }
  if (containsForbiddenString(verifyPayload)) {
    issues.push("verification payload contains a forbidden string");
  }

  return {
    ok: issues.length === 0,
    base_url: normalizedBase,
    latest,
    verify: verifyPayload,
    issues,
    warnings,
  };
}

async function main() {
  const baseUrl = process.argv[2] || "https://vorliq.org";
  try {
    const result = await verifySnapshotBase(baseUrl);
    if (!result.ok) {
      console.error("Vorliq snapshot verification failed");
      result.issues.forEach((issue) => console.error(`- ${issue}`));
      process.exit(1);
    }
    if (result.warnings.length) {
      console.warn("Vorliq snapshot verification warnings");
      result.warnings.slice(0, 10).forEach((warning) => console.warn(`- ${warning}`));
      if (result.warnings.length > 10) {
        console.warn(`- ${result.warnings.length - 10} additional warnings suppressed`);
      }
    }
    console.log("Vorliq snapshot verification passed");
    console.log(`Base URL: ${result.base_url}`);
    console.log(`Chain height: ${result.latest.chain_height}`);
    console.log(`Latest block hash: ${result.latest.latest_block_hash}`);
    console.log(`Generated at: ${result.latest.generated_at}`);
  } catch (error) {
    console.error(`Vorliq snapshot verification failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  containsForbiddenString,
  verifySnapshotBase,
};
