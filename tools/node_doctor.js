#!/usr/bin/env node

const { execFile } = require("child_process");
const os = require("os");

function parseArgs(argv) {
  const args = {
    baseUrl: "http://127.0.0.1:5000",
    publicUrl: "",
    trustedNode: "https://vorliq.org",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      args.baseUrl = next;
      index += 1;
    } else if (arg === "--public-url" && next) {
      args.publicUrl = next;
      index += 1;
    } else if (arg === "--trusted-node" && next) {
      args.trustedNode = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function getFetch() {
  if (typeof fetch === "function") return fetch.bind(globalThis);
  const imported = await import("node-fetch");
  return imported.default;
}

async function fetchJson(baseUrl, pathname, { timeout = 12000, query } = {}) {
  const fetchImpl = await getFetch();
  const url = new URL(pathname, `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    }
  }
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`${url.pathname} did not return JSON`);
  }
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || `${url.pathname} returned ${response.status}`);
  }
  return data;
}

function statusRank(status) {
  return { PASS: 0, WARN: 1, FAIL: 2 }[status] ?? 2;
}

function createReporter() {
  const checks = [];
  return {
    checks,
    add(status, name, explanation, fix = "") {
      checks.push({ status, name, explanation, fix });
      const suffix = fix && status !== "PASS" ? ` Fix: ${fix}` : "";
      console.log(`${status} ${name} - ${explanation}${suffix}`);
    },
    exitCode() {
      return checks.reduce((highest, check) => Math.max(highest, statusRank(check.status)), 0);
    },
  };
}

async function checkEndpoint(reporter, statusName, baseUrl, pathname, evaluator, fix) {
  try {
    const data = await fetchJson(baseUrl, pathname);
    const result = evaluator(data);
    reporter.add(result.status, statusName, result.explanation, result.fix || fix);
    return data;
  } catch (error) {
    reporter.add("FAIL", statusName, error.message, fix);
    return null;
  }
}

async function checkRegistryNode(reporter, trustedNode, publicUrl) {
  if (!publicUrl) {
    return;
  }

  try {
    const data = await fetchJson(trustedNode, "/api/registry/node", {
      query: { node_url: publicUrl },
    });
    const node = data.node || data;
    if (node.active && node.sync_status === "synced") {
      reporter.add("PASS", "registry node detail", `${publicUrl} is active and synced in the trusted registry.`);
    } else if (node.node_url) {
      reporter.add("WARN", "registry node detail", `${publicUrl} is registered with active=${Boolean(node.active)} sync=${node.sync_status || "unknown"}.`, "sudo systemctl start vorliq-heartbeat-once.service");
    } else {
      reporter.add("WARN", "registry node detail", "The trusted registry response did not include a node record.", "sudo systemctl start vorliq-heartbeat-once.service");
    }
  } catch (error) {
    reporter.add("WARN", "registry node detail", error.message, "Check VORLIQ_NODE_URL and run sudo systemctl start vorliq-heartbeat-once.service");
  }
}

function commandExists(command) {
  return new Promise((resolve) => {
    execFile("sh", ["-lc", `command -v ${command}`], (error) => resolve(!error));
  });
}

function systemctlIsActive(service) {
  return new Promise((resolve) => {
    execFile("systemctl", ["is-active", service], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? String(stdout || "").trim() || "inactive" : String(stdout || "").trim());
    });
  });
}

async function checkServices(reporter) {
  if (os.platform() !== "linux" || !(await commandExists("systemctl"))) {
    return;
  }

  for (const service of ["vorliq-blockchain.service", "vorliq-backend.service", "vorliq-heartbeat.service"]) {
    const state = await systemctlIsActive(service);
    if (state === "active") {
      reporter.add("PASS", service, "Service is active.");
    } else {
      reporter.add("WARN", service, `Service state is ${state}.`, `sudo systemctl status ${service} --no-pager`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: node tools/node_doctor.js [--base-url URL] [--public-url URL] [--trusted-node URL]");
    process.exit(0);
  }

  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const trustedNode = normalizeBaseUrl(args.trustedNode);
  const reporter = createReporter();

  console.log(`Vorliq node doctor`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Trusted node: ${trustedNode}`);
  if (args.publicUrl) console.log(`Public URL: ${args.publicUrl}`);

  await checkEndpoint(reporter, "backend health", baseUrl, "/api/health", (data) => ({
    status: data.success === true ? "PASS" : "FAIL",
    explanation: data.success === true ? "Backend API is reachable." : "Backend API did not return success=true.",
  }), "sudo systemctl restart vorliq-backend.service");

  await checkEndpoint(reporter, "chain summary", baseUrl, "/api/chain/summary", (data) => {
    const summary = data.summary || data;
    if (summary.chain_valid === false || data.is_valid === false) {
      return { status: "FAIL", explanation: "Chain summary reports an invalid chain." };
    }
    return { status: "PASS", explanation: `Chain summary is available at height ${summary.block_height ?? summary.height ?? "unknown"}.` };
  }, "sudo systemctl restart vorliq-blockchain.service");

  await checkEndpoint(reporter, "diagnostics", baseUrl, "/api/diagnostics", (data) => {
    if (data.chain_valid === false) return { status: "FAIL", explanation: "Diagnostics reports chain_valid=false." };
    return { status: "PASS", explanation: `Diagnostics is available at height ${data.block_height ?? "unknown"}.` };
  }, "sudo systemctl restart vorliq-blockchain.service");

  await checkEndpoint(reporter, "trusted snapshot verification", trustedNode, "/api/snapshot/verify", (data) => {
    if (data.verified === true && data.signature_verified === true) {
      return { status: "PASS", explanation: "Trusted node snapshot and signature verify." };
    }
    if (data.verified === true) {
      return { status: "WARN", explanation: "Trusted node snapshot verifies but signature_verified was not true." };
    }
    return { status: "FAIL", explanation: "Trusted node snapshot verification failed." };
  }, `node tools/bootstrap_verify_node.js ${trustedNode}`);

  await checkEndpoint(reporter, "local snapshot verification", baseUrl, "/api/snapshot/verify", (data) => {
    if (data.verified === true && data.signature_verified === true) {
      return { status: "PASS", explanation: "Local snapshot is signed and verified." };
    }
    if (data.verified === true) {
      return { status: "WARN", explanation: "Local snapshot verifies but is not signed by a community-node key." };
    }
    return { status: "WARN", explanation: "Local snapshot verification is unavailable or incomplete." };
  }, "Check local backend and snapshot configuration.");

  await checkEndpoint(reporter, "registry summary", trustedNode, "/api/registry/summary", (data) => {
    const summary = data.summary || {};
    return { status: "PASS", explanation: `${summary.active_node_count ?? 0} active nodes, ${summary.synced_node_count ?? 0} synced nodes in trusted registry.` };
  }, "Check trusted node registry availability.");

  await checkRegistryNode(reporter, trustedNode, args.publicUrl);

  await checkEndpoint(reporter, "storage health", baseUrl, "/api/storage/health", (data) => {
    if (data.overall_status === "ok") return { status: "PASS", explanation: "Storage health is ok." };
    if (data.overall_status === "warning") return { status: "WARN", explanation: "Storage health has warnings." };
    return { status: "FAIL", explanation: `Storage health is ${data.overall_status || "unavailable"}.` };
  }, "Review /api/storage/health and restore from backup only after verifying data.");

  await checkEndpoint(reporter, "index health", baseUrl, "/api/indexes/health", (data) => {
    if (data.status === "ok" && data.rebuild_needed !== true) return { status: "PASS", explanation: "Derived indexes are healthy." };
    if (data.rebuild_needed === true) return { status: "WARN", explanation: "Derived indexes report rebuild_needed=true." };
    return { status: "WARN", explanation: `Index health status is ${data.status || "unknown"}.` };
  }, "Use protected admin index rebuild only after checking chain health.");

  await checkEndpoint(reporter, "readiness", baseUrl, "/api/readiness", (data) => {
    if (data.overall_status === "pass") return { status: "PASS", explanation: `Readiness passes with score ${data.score ?? "unknown"}.` };
    if (data.overall_status === "warning") return { status: "WARN", explanation: `Readiness has warnings with score ${data.score ?? "unknown"}.` };
    return { status: "FAIL", explanation: `Readiness status is ${data.overall_status || "unknown"}.` };
  }, "Open /readiness or run node tools/check_readiness.js.");

  await checkServices(reporter);

  const exitCode = reporter.exitCode();
  console.log(`Node doctor completed with exit code ${exitCode}.`);
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL node doctor - ${error.message}`);
    process.exit(2);
  });
}
