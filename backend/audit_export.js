#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const EXPORTS = ["manifest", "chain", "treasury", "governance", "lending", "exchange", "registry"];

async function getFetch() {
  if (typeof fetch === "function") return fetch.bind(globalThis);
  const imported = await import("node-fetch");
  return imported.default;
}

async function fetchJson(baseUrl, exportName) {
  const fetchImpl = await getFetch();
  const endpoint = `${baseUrl}/api/audit/${exportName}`;
  const response = await fetchImpl(endpoint);
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(`${endpoint} failed with status ${response.status}`);
  }
  return data;
}

async function main() {
  const baseUrl = (process.argv[2] || process.env.VORLIQ_AUDIT_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
  const outputDir = path.resolve(__dirname, "..", "docs", "audit");
  fs.mkdirSync(outputDir, { recursive: true });

  for (const exportName of EXPORTS) {
    const data = await fetchJson(baseUrl, exportName);
    const target = path.join(outputDir, `${exportName}.json`);
    fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`Wrote ${path.relative(process.cwd(), target)}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Audit export generation failed: ${error.message}`);
    process.exit(1);
  });
}
