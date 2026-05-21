const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const ORIGINAL_ENV = {
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
  VORLIQ_BACKUP_DIR: process.env.VORLIQ_BACKUP_DIR,
  INCIDENTS_FILE: process.env.INCIDENTS_FILE,
  ANALYTICS_FILE: process.env.ANALYTICS_FILE,
};

process.env.ADMIN_TOKEN = "readiness-admin-token";
process.env.NODE_ENV = "production";

jest.mock("axios");
const axios = require("axios");
const { scoreReadiness } = require("../readiness");
const app = require("../index");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-readiness-"));
}

function makeBackup(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const fileName = "vorliq-backup-2026-05-20-120000.tar.gz";
  const filePath = path.join(directory, fileName);
  fs.writeFileSync(filePath, "backup");
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

function mockFlask(options = {}) {
  axios.get.mockImplementation((url) => {
    if (url.endsWith("/diagnostics")) {
      return Promise.resolve({ data: { success: true, chain_valid: true, block_height: 42, pending_transactions: 0 } });
    }
    if (url.endsWith("/chain/summary")) {
      return Promise.resolve({ data: { success: true, summary: { block_height: 42, chain_valid: true } } });
    }
    if (url.endsWith("/registry/summary")) {
      return Promise.resolve({
        data: {
          success: true,
          summary: {
            active_node_count: 1,
            total_registered_node_count: 1,
            synced_node_count: 1,
          },
        },
      });
    }
    if (url.endsWith("/mining/status")) {
      return Promise.resolve({ data: { success: true, status: { can_mine_now: true, current_block_height: 42 } } });
    }
    if (url.endsWith("/treasury/summary")) {
      return Promise.resolve({ data: { success: true, summary: { current_balance: 10 } } });
    }
    if (url.endsWith("/faucet/summary")) {
      return Promise.resolve({ data: { success: true, summary: { enabled: true } } });
    }
    if (url.endsWith("/storage/health")) {
      if (options.storageFails) return Promise.reject(new Error("storage down"));
      return Promise.resolve({
        data: {
          success: true,
          overall_status: "ok",
          critical_files_ok: 3,
          warnings_count: 0,
          errors_count: 0,
          backup_available: true,
          files: [{ file_name: "chain.json", status: "ok", valid_json: true, has_backup: true }],
        },
      });
    }
    if (url.endsWith("/audit/chain")) {
      return Promise.resolve({ data: { success: true, block_count: 2, latest_block_hash: "hash", blocks: [{ index: 0 }] } });
    }
    if (url.endsWith("/audit/treasury")) {
      return Promise.resolve({ data: { success: true, treasury_ledger: [], treasury_proposals: [], payout_statuses: [] } });
    }
    if (url.endsWith("/audit/governance")) {
      return Promise.resolve({ data: { success: true, governance_proposals: [], rule_change_history: [], public_vote_weights: [] } });
    }
    if (url.endsWith("/audit/lending")) {
      return Promise.resolve({ data: { success: true, loans: [] } });
    }
    if (url.endsWith("/audit/exchange")) {
      return Promise.resolve({ data: { success: true, offers: [] } });
    }
    if (url.endsWith("/audit/registry")) {
      return Promise.resolve({ data: { success: true, nodes: [], summary: { active_node_count: 1 } } });
    }
    return Promise.reject(new Error(`unexpected URL ${url}`));
  });
}

describe("production readiness", () => {
  let backupDir;
  let incidentsFile;
  let analyticsFile;

  beforeEach(() => {
    jest.clearAllMocks();
    backupDir = tempDir();
    incidentsFile = path.join(tempDir(), "incidents.json");
    analyticsFile = path.join(tempDir(), "analytics.json");
    process.env.VORLIQ_BACKUP_DIR = backupDir;
    process.env.INCIDENTS_FILE = incidentsFile;
    process.env.ANALYTICS_FILE = analyticsFile;
    makeBackup(backupDir);
    fs.mkdirSync(path.dirname(incidentsFile), { recursive: true });
    fs.writeFileSync(incidentsFile, JSON.stringify({ incidents: [] }));
    mockFlask();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (typeof value === "undefined") delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("GET /api/readiness returns score, status, and checks", async () => {
    const response = await request(app).get("/api/readiness");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(["pass", "warning", "fail"]).toContain(response.body.overall_status);
    expect(response.body.score).toBeGreaterThanOrEqual(0);
    expect(response.body.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(response.body.checks)).toBe(true);
    expect(response.body.checks.some((check) => check.id === "backend_health")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "admin_routes_protected")).toBe(true);
  });

  test("critical fail logic forces overall fail", () => {
    const result = scoreReadiness([
      { status: "pass", severity: "critical" },
      { status: "fail", severity: "critical" },
    ]);

    expect(result.overall_status).toBe("fail");
    expect(result.score).toBeLessThan(90);
  });

  test("admin readiness requires token", async () => {
    const response = await request(app).get("/api/admin/readiness");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("admin readiness returns safe operational metadata with token", async () => {
    const response = await request(app)
      .get("/api/admin/readiness")
      .set("Authorization", "Bearer readiness-admin-token");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.operational_metadata).toBeTruthy();
    expect(response.body.operational_metadata.latest_backup.file_name).toMatch(/^vorliq-backup-/);
  });

  test("readiness response does not include forbidden strings", async () => {
    const response = await request(app)
      .get("/api/admin/readiness")
      .set("Authorization", "Bearer readiness-admin-token");
    const body = JSON.stringify(response.body);

    expect(body).not.toMatch(/readiness-admin-token|ADMIN_TOKEN|SERVER_SSH_KEY|BEGIN EC PRIVATE KEY|\/home\/vorliq/i);
  });

  test("storage failure is handled gracefully", async () => {
    mockFlask({ storageFails: true });
    const response = await request(app).get("/api/readiness");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const storageCheck = response.body.checks.find((check) => check.id === "storage_health_ok");
    expect(storageCheck.status).toBe("fail");
  });
});
