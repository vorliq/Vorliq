#!/usr/bin/env node

const { verifyArchiveItem } = require("../backend/snapshotArchive");
const { verifySnapshotSignature } = require("../backend/snapshotSigner");
const { containsForbiddenString } = require("./verify_snapshot");

async function getFetch() {
  if (typeof fetch === "function") return fetch.bind(globalThis);
  const imported = await import("node-fetch");
  return imported.default;
}

async function fetchJson(baseUrl, pathname) {
  const fetchImpl = await getFetch();
  const response = await fetchImpl(`${baseUrl}${pathname}`);
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(`${pathname} returned ${response.status}: ${data.message || data.error || "request failed"}`);
  }
  return data;
}

function parseArgs(args) {
  const options = {
    baseUrl: "https://vorliq.org",
    hash: "",
    list: false,
    requireSignature: true,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--list") {
      options.list = true;
    } else if (arg === "--hash") {
      options.hash = args[index + 1] || "";
      index += 1;
    } else if (arg === "--no-require-signature") {
      options.requireSignature = false;
    } else if (!arg.startsWith("--")) {
      options.baseUrl = arg;
    }
  }
  options.baseUrl = String(options.baseUrl).replace(/\/+$/, "");
  return options;
}

async function verifyArchiveBase(baseUrl, options = {}) {
  const pathname = options.hash ? `/api/snapshot/archive/${encodeURIComponent(options.hash)}` : "/api/snapshot/archive/latest";
  const payload = await fetchJson(baseUrl, pathname);
  const item = payload.archive || payload;
  const verification = verifyArchiveItem(item);
  const signature = verifySnapshotSignature(item.snapshot || {}, {
    requireSignature: options.requireSignature !== false,
    publicKey: item.snapshot?.signature?.public_key,
  });
  const issues = [];

  if (!verification.verified) issues.push(...verification.errors);
  if (signature.signature_verified !== true) issues.push("embedded signed snapshot signature did not verify locally");
  if (options.requireSignature !== false && signature.enabled !== true) issues.push("archive requires a signed embedded snapshot");
  if (containsForbiddenString(payload)) issues.push("archive payload contains a forbidden string");

  return { ok: issues.length === 0, item, verification, signature, issues };
}

async function listArchives(baseUrl) {
  const payload = await fetchJson(baseUrl, "/api/snapshot/archive?limit=10&offset=0");
  return payload.archives || [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    if (options.list) {
      const archives = await listArchives(options.baseUrl);
      console.log(`Vorliq snapshot archive list for ${options.baseUrl}`);
      if (!archives.length) console.log("No archived snapshots are available yet.");
      archives.forEach((item) => {
        console.log(`${item.created_at} ${item.snapshot_hash} height=${item.chain_height} signature=${item.signature_status}`);
      });
      return;
    }

    const result = await verifyArchiveBase(options.baseUrl, options);
    if (!result.ok) {
      console.error("Vorliq snapshot archive verification failed");
      result.issues.forEach((issue) => console.error(`- ${issue}`));
      process.exit(1);
    }
    console.log("Vorliq snapshot archive verification passed");
    console.log(`Base URL: ${options.baseUrl}`);
    console.log(`Snapshot hash: ${result.item.snapshot_hash}`);
    console.log(`Chain height: ${result.item.chain_height}`);
    console.log(`Latest block hash: ${result.item.latest_block_hash}`);
    console.log(`Signature status: ${result.signature.status}`);
    console.log(`Signature verified: ${result.signature.signature_verified}`);
    console.log(`Public key id: ${result.signature.public_key_id || "unavailable"}`);
  } catch (error) {
    console.error(`Vorliq snapshot archive verification failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listArchives,
  parseArgs,
  verifyArchiveBase,
};
