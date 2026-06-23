const os = require("os");
const path = require("path");
const fs = require("fs");

// Give every test file its own shared rate-limit store file so the file-backed
// limiter counters never accumulate across unrelated test files (the suite runs
// in-band in one process). Each file thus starts from an empty store, matching
// how a fresh deployment behaves. Individual tests that need their own isolation
// may still override VORLIQ_RATE_LIMIT_FILE at the top of the file.
process.env.VORLIQ_RATE_LIMIT_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "vlq-rl-")),
  "rate-limits.json"
);
