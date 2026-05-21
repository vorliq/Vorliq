#!/usr/bin/env node

const assert = require("assert");
const { exitCodeForStatus, formatReport, sanitizeText } = require("./check_readiness");

const base = {
  success: true,
  checked_at: "2026-05-20T00:00:00.000Z",
  checks: [
    {
      id: "backend_health",
      name: "Backend health",
      category: "API",
      status: "pass",
      severity: "critical",
      message: "Backend readiness code executed.",
    },
  ],
};

assert.strictEqual(exitCodeForStatus("pass"), 0);
assert.strictEqual(exitCodeForStatus("warning"), 1);
assert.strictEqual(exitCodeForStatus("warning", true), 0);
assert.strictEqual(exitCodeForStatus("fail"), 2);

const passReport = formatReport({ ...base, overall_status: "pass", score: 100 });
assert.match(passReport, /All readiness checks passed/);

const warningReport = formatReport({
  ...base,
  overall_status: "warning",
  score: 82,
  checks: [{ ...base.checks[0], status: "warning", message: "Backup is older than expected." }],
});
assert.match(warningReport, /Warning checks/);

const failReport = formatReport({
  ...base,
  overall_status: "fail",
  score: 30,
  checks: [{ ...base.checks[0], status: "fail", message: "ADMIN_TOKEN=/home/vorliq/app/private" }],
});
assert.match(failReport, /Failing checks/);
assert.doesNotMatch(failReport, /ADMIN_TOKEN|\/home\/vorliq/i);
assert.doesNotMatch(sanitizeText("Bearer abc.def"), /abc\.def/);

console.log("Readiness CLI smoke passed");
