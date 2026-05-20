#!/usr/bin/env node

const crypto = require("crypto");

const FORBIDDEN_PATTERN = /PRIVATE KEY|BEGIN PRIVATE KEY|ADMIN_TOKEN|password|\/home\/vorliq|ssh-/i;

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function containsForbiddenString(value) {
  return FORBIDDEN_PATTERN.test(JSON.stringify(value || {}));
}

function calculateBlockHash(block) {
  const blockData = {
    index: block.index,
    timestamp: block.timestamp,
    transactions: block.transactions || [],
    previous_hash: block.previous_hash,
    nonce: block.nonce,
  };
  if (block.miner_address !== undefined && block.miner_address !== null) {
    blockData.miner_address = block.miner_address;
  }
  return sha256Hex(canonicalStringify(blockData));
}

function verifyChain(chainExport) {
  const issues = [];
  const warnings = [];
  const blocks = Array.isArray(chainExport.blocks) ? chainExport.blocks : [];
  if (!blocks.length) {
    issues.push("chain export has no blocks");
    return { issues, warnings };
  }
  if (chainExport.chain_valid !== true) {
    issues.push("chain export reports chain_valid=false");
  }
  blocks.forEach((block, index) => {
    if (!block.hash) {
      issues.push(`block ${index} has no hash`);
    }
    if (index > 0 && block.previous_hash !== blocks[index - 1].hash) {
      issues.push(`block ${index} previous_hash does not match block ${index - 1}`);
    }
    const reproduced = calculateBlockHash(block);
    if (block.hash && reproduced !== block.hash) {
      warnings.push(`block ${index} hash did not reproduce with public serialization`);
    }
  });
  const latest = blocks[blocks.length - 1];
  if (latest?.hash !== chainExport.latest_block_hash) {
    issues.push("latest_block_hash does not match final exported block");
  }
  if (chainExport.block_count !== undefined && Number(chainExport.block_count) !== blocks.length) {
    issues.push("block_count does not match exported block length");
  }
  return { issues, warnings };
}

function verifyTreasury(treasuryExport) {
  const ledger = Array.isArray(treasuryExport.treasury_ledger) ? treasuryExport.treasury_ledger : [];
  if (!ledger.length || treasuryExport.treasury_balance === undefined) {
    return { issues: [], warnings: [] };
  }
  const balance = ledger.reduce((total, entry) => {
    const amount = Number(entry.amount || 0);
    if (entry.type === "reward_in") return total + amount;
    if (entry.type === "payout_paid") return total - amount;
    return total;
  }, 0);
  const reported = Number(treasuryExport.treasury_balance);
  if (!Number.isFinite(reported)) return { issues: ["treasury_balance is not numeric"], warnings: [] };
  return Math.abs(balance - reported) > 0.00000001
    ? { issues: [], warnings: ["treasury ledger reward/payout total does not match treasury_balance"] }
    : { issues: [], warnings: [] };
}

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

async function verifyAuditBase(baseUrl = "https://vorliq.org") {
  const normalizedBase = String(baseUrl || "https://vorliq.org").replace(/\/+$/, "");
  const manifest = await fetchJson(normalizedBase, "/api/audit/manifest");
  const issues = [];
  const warnings = [];
  const exports = {};

  if (!Array.isArray(manifest.exports) || !manifest.exports.length) {
    issues.push("manifest does not list audit exports");
  }
  if (containsForbiddenString(manifest)) {
    issues.push("manifest contains a forbidden string");
  }

  for (const entry of manifest.exports || []) {
    const exportPayload = await fetchJson(normalizedBase, entry.endpoint);
    exports[entry.name] = exportPayload;
    const actualHash = sha256Hex(canonicalStringify(exportPayload));
    if (actualHash !== entry.sha256) {
      issues.push(`${entry.name} hash mismatch: expected ${entry.sha256}, got ${actualHash}`);
    }
    if (containsForbiddenString(exportPayload)) {
      issues.push(`${entry.name} export contains a forbidden string`);
    }
  }

  if (exports.chain) {
    const chainResult = verifyChain(exports.chain);
    issues.push(...chainResult.issues);
    warnings.push(...chainResult.warnings);
  }
  if (exports.treasury) {
    const treasuryResult = verifyTreasury(exports.treasury);
    issues.push(...treasuryResult.issues);
    warnings.push(...treasuryResult.warnings);
  }

  return {
    ok: issues.length === 0,
    base_url: normalizedBase,
    manifest,
    exports,
    issues,
    warnings,
  };
}

async function main() {
  const baseUrl = process.argv[2] || "https://vorliq.org";
  try {
    const result = await verifyAuditBase(baseUrl);
    if (!result.ok) {
      console.error("Vorliq audit verification failed");
      result.issues.forEach((issue) => console.error(`- ${issue}`));
      process.exit(1);
    }
    if (result.warnings.length) {
      console.warn("Vorliq audit verification warnings");
      result.warnings.slice(0, 10).forEach((warning) => console.warn(`- ${warning}`));
      if (result.warnings.length > 10) {
        console.warn(`- ${result.warnings.length - 10} additional warnings suppressed`);
      }
    }
    console.log("Vorliq audit verification passed");
    console.log(`Base URL: ${result.base_url}`);
    console.log(`Exports checked: ${result.manifest.exports.map((entry) => entry.name).join(", ")}`);
    console.log(`Chain height: ${result.manifest.chain_height}`);
    console.log(`Latest block hash: ${result.manifest.latest_block_hash}`);
  } catch (error) {
    console.error(`Vorliq audit verification failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  calculateBlockHash,
  canonicalStringify,
  containsForbiddenString,
  sha256Hex,
  verifyAuditBase,
  verifyChain,
  verifyTreasury,
};
