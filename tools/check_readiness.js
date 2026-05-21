#!/usr/bin/env node

const FORBIDDEN_PATTERNS = [
  /ADMIN_TOKEN/gi,
  /SERVER_SSH_KEY/gi,
  /BEGIN [A-Z ]*PRIVATE KEY/gi,
  /\/home\/vorliq\/[^\s"']*/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

function sanitizeText(value) {
  return FORBIDDEN_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    String(value || "")
  );
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    baseUrl: "https://vorliq.org",
    allowWarning: false,
  };

  for (const arg of argv) {
    if (arg === "--allow-warning") {
      args.allowWarning = true;
    } else if (!arg.startsWith("--")) {
      args.baseUrl = arg;
    }
  }

  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  return args;
}

function exitCodeForStatus(status, allowWarning = false) {
  if (status === "pass") return 0;
  if (status === "warning") return allowWarning ? 0 : 1;
  return 2;
}

function formatReport(readiness) {
  const lines = [];
  lines.push(`Vorliq production readiness: ${readiness.overall_status} (${readiness.score}/100)`);
  lines.push(`Checked at: ${readiness.checked_at || "unknown"}`);
  lines.push("");

  const failing = (readiness.checks || []).filter((check) => check.status === "fail");
  const warnings = (readiness.checks || []).filter((check) => check.status === "warning");

  if (failing.length) {
    lines.push("Failing checks:");
    failing.forEach((check) => {
      lines.push(`- [${check.severity}] ${check.id}: ${check.message}`);
    });
    lines.push("");
  }

  if (warnings.length) {
    lines.push("Warning checks:");
    warnings.forEach((check) => {
      lines.push(`- [${check.severity}] ${check.id}: ${check.message}`);
    });
    lines.push("");
  }

  if (!failing.length && !warnings.length) {
    lines.push("All readiness checks passed.");
    lines.push("");
  }

  lines.push("Check summary:");
  (readiness.checks || []).forEach((check) => {
    lines.push(`- ${check.status.toUpperCase()} ${check.category} / ${check.name}`);
  });

  return sanitizeText(lines.join("\n"));
}

async function fetchReadiness(baseUrl) {
  const response = await fetch(`${baseUrl}/api/readiness`, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Readiness endpoint returned non-JSON response with status ${response.status}.`);
  }
  if (!response.ok || json.success !== true) {
    throw new Error(json.message || `Readiness endpoint returned status ${response.status}.`);
  }
  return json;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  try {
    const readiness = await fetchReadiness(args.baseUrl);
    console.log(formatReport(readiness));
    return exitCodeForStatus(readiness.overall_status, args.allowWarning);
  } catch (error) {
    console.error(sanitizeText(`Readiness check failed: ${error.message}`));
    return 2;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  exitCodeForStatus,
  formatReport,
  main,
  parseArgs,
  sanitizeText,
};
