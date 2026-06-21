// Local end-to-end config: drives the FULL write-path journeys against a live
// local stack (Flask blockchain + Node backend + built React app), at three
// viewport sizes. This is separate from playwright.config.js, which runs the
// read-only smoke suite against production.
//
// Single command:  npm run e2e:local   (from the e2e/ directory)
//
// It boots all three services itself (reusing already-running ones in dev), then
// global-setup.local.js mines blocks to fund the community treasury so the
// faucet journey can pay out. Each viewport project uses a distinct user-agent
// so the faucet's per-fingerprint limit is not shared across viewports.
const path = require("path");
const { defineConfig } = require("@playwright/test");

const FLASK_PORT = process.env.E2E_FLASK_PORT || "5001";
const NODE_PORT = process.env.E2E_NODE_PORT || "5000";
const STATIC_PORT = process.env.E2E_STATIC_PORT || "3000";
// Use `localhost` (not 127.0.0.1): the app only points its API client at the
// local backend when window.location.hostname === "localhost".
const baseURL = `http://localhost:${STATIC_PORT}`;

const pythonBin =
  process.platform === "win32"
    ? path.resolve(__dirname, "..", "blockchain", ".venv", "Scripts", "python.exe")
    : path.resolve(__dirname, "..", "blockchain", ".venv", "bin", "python");

// An isolated data dir keeps e2e runs from mutating real local chain data.
const dataDir = process.env.E2E_DATA_DIR || path.resolve(__dirname, ".e2e-data");

// A per-run nonce keeps the faucet's per-fingerprint limit (IP+user-agent) from
// accumulating across repeated local runs: each invocation gets fresh
// fingerprints, while the three viewports stay distinct within a run.
const RUN_ID = process.env.E2E_RUN_ID || String(Date.now());

function viewport(width, height, ua) {
  return {
    viewport: { width, height },
    userAgent: `${ua} VorliqE2E/${width}x${height}/${RUN_ID}`,
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  };
}

module.exports = defineConfig({
  testDir: "./tests/journeys",
  timeout: 180_000, // journeys mine blocks, which is deliberately slow
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // the journeys share one chain; run them serially
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-local", open: "never" }]],
  outputDir: "test-results-local",
  globalSetup: require.resolve("./global-setup.local.js"),
  use: { baseURL },
  projects: [
    { name: "mobile-375", use: viewport(375, 812, "MobileE2E") },
    { name: "tablet-768", use: viewport(768, 1024, "TabletE2E") },
    { name: "desktop-1280", use: viewport(1280, 900, "DesktopE2E") },
  ],
  webServer: [
    {
      command: `"${pythonBin}" app.py`,
      cwd: path.resolve(__dirname, "..", "blockchain"),
      url: `http://127.0.0.1:${FLASK_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VORLIQ_HOST: "127.0.0.1",
        VORLIQ_PORT: FLASK_PORT,
        VORLIQ_MINING_ENABLED: "true",
        VORLIQ_DATA_DIR: dataDir,
        // Remove the 30s minimum block spacing so journeys can confirm txs fast,
        // and pin difficulty (otherwise the retarget ramps PoW up to a crawl).
        VORLIQ_BLOCK_TIME_MINIMUM: "0",
        VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT: "true",
        VORLIQ_DIFFICULTY: "2",
        // Short governance voting window so journey 7 can reach an outcome fast.
        VORLIQ_GOVERNANCE_VOTING_PERIOD_SECONDS: "3",
        // Enable the test-only lending-pool seeding endpoint for journey 6.
        VORLIQ_ENABLE_TEST_SEED: "true",
        NODE_ENV: "test",
      },
    },
    {
      command: "node index.js",
      cwd: path.resolve(__dirname, "..", "backend"),
      url: `http://127.0.0.1:${NODE_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        HOST: "127.0.0.1",
        PORT: NODE_PORT,
        FLASK_URL: `http://127.0.0.1:${FLASK_PORT}`,
        NODE_ENV: "test",
        // Relax per-IP rate limits: the suite drives the real write paths hard
        // from one IP. Never set in production.
        VORLIQ_DISABLE_RATE_LIMITS: "true",
      },
    },
    {
      command: "node static-server.js",
      cwd: __dirname,
      url: `http://localhost:${STATIC_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { E2E_STATIC_PORT: STATIC_PORT },
    },
  ],
});
