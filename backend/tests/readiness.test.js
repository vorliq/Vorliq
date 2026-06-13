const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const request = require("supertest");

const ORIGINAL_ENV = {
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
  VORLIQ_BACKUP_DIR: process.env.VORLIQ_BACKUP_DIR,
  INCIDENTS_FILE: process.env.INCIDENTS_FILE,
  ANALYTICS_FILE: process.env.ANALYTICS_FILE,
  VORLIQ_SNAPSHOT_ARCHIVE_DIR: process.env.VORLIQ_SNAPSHOT_ARCHIVE_DIR,
  VORLIQ_SNAPSHOT_PRIVATE_KEY: process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY,
  VORLIQ_SNAPSHOT_PUBLIC_KEY: process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY,
  VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE: process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE,
};

process.env.ADMIN_TOKEN = "readiness-admin-token";
process.env.NODE_ENV = "production";

jest.mock("axios");
const axios = require("axios");
const { buildReadiness, scoreReadiness } = require("../readiness");
const { clearSnapshotCache } = require("../snapshot");
const { createSnapshotArchive } = require("../snapshotArchive");
const app = require("../index");

function testKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

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
            active_node_count: options.registryInactive ? 0 : 1,
            total_registered_node_count: 1,
            synced_node_count: options.registryInactive ? 0 : 1,
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
    if (url.endsWith("/indexes/health")) {
      return Promise.resolve({
        data: {
          success: true,
          exists: true,
          valid: true,
          status: "ok",
          schema_version: 1,
          chain_height: 42,
          latest_block_hash: "0000hash",
          built_at: "2026-05-21T00:00:00Z",
          rebuild_needed: false,
          index_chain_match: true,
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
  let archiveDir;

  beforeEach(() => {
    jest.clearAllMocks();
    clearSnapshotCache();
    backupDir = tempDir();
    incidentsFile = path.join(tempDir(), "incidents.json");
    analyticsFile = path.join(tempDir(), "analytics.json");
    archiveDir = tempDir();
    process.env.VORLIQ_BACKUP_DIR = backupDir;
    process.env.INCIDENTS_FILE = incidentsFile;
    process.env.ANALYTICS_FILE = analyticsFile;
    process.env.VORLIQ_SNAPSHOT_ARCHIVE_DIR = archiveDir;
    delete process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY;
    delete process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY;
    delete process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE;
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
    expect(response.body.index_health).toBe("ok");
    expect(response.body.index_rebuild_needed).toBe(false);
    expect(response.body.index_chain_match).toBe(true);
    expect(response.body.migration_readiness_available).toBe(true);
    expect(response.body.storage_backend).toBe("json");
    expect(response.body.storage_adapter_interface_available).toBe(true);
    expect(response.body.active_storage_adapter).toBe("json");
    expect(response.body.database_enabled).toBe(false);
    expect(response.body.future_database_target).toBe("postgresql");
    expect(response.body.postgres_adapter_available).toBe(true);
    expect(response.body.postgres_adapter_enabled).toBe(false);
    expect(response.body.postgres_write_mode).toBe("disabled");
    expect(response.body.postgres_runtime_blocked_in_production).toBe(true);
    expect(response.body.postgres_schema_present).toBe(true);
    expect(response.body.postgres_active).toBe(false);
    expect(response.body.postgres_shadow_rehearsal_available).toBe(true);
    expect(response.body.postgres_shadow_ci_enabled).toBe(true);
    expect(response.body.migration_phase).toBe("preparation");
    expect(response.body.rollback_plan_required).toBe(true);
    expect(response.body.migration_tools_available).toBe(true);
    expect(response.body.snapshot_signature_available).toBe(false);
    expect(response.body.snapshot_signature_verified).toBe(false);
    expect(response.body.snapshot_signature_required).toBe(false);
    expect(response.body.snapshot_signature_status).toBe("unsigned");
    expect(response.body.snapshot_archive_available).toBe(false);
    expect(response.body.snapshot_archive_latest_verified).toBe(false);
    expect(response.body.snapshot_archive_signature_valid).toBe(false);
    const signatureCheck = response.body.checks.find((check) => check.id === "snapshot_signature_status");
    expect(signatureCheck.status).toBe("warning");
    expect(signatureCheck.safe_metadata).toMatchObject({
      snapshot_signature_available: false,
      snapshot_signature_verified: false,
      snapshot_signature_required: false,
      snapshot_signature_status: "unsigned",
    });
    expect(response.body.checks.some((check) => check.id === "index_health_ok")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "migration_readiness_available")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "storage_backend_json")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "database_not_enabled_expected")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "postgres_schema_present")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "postgres_not_active_expected")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "postgres_adapter_disabled_expected")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "migration_tools_available")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "postgres_shadow_rehearsal_available")).toBe(true);
    expect(response.body.checks.some((check) => check.id === "postgres_shadow_ci_enabled")).toBe(true);
    expect(response.body.checks.find((check) => check.id === "snapshot_archive_available").status).toBe("warning");
  });

  test("critical fail logic forces overall fail", () => {
    const result = scoreReadiness([
      { status: "pass", severity: "critical" },
      { status: "fail", severity: "critical" },
    ]);

    expect(result.overall_status).toBe("fail");
    expect(result.score).toBeLessThan(90);
  });

  test("embedded readiness skipSnapshot does not fail secret scan", async () => {
    const readiness = await buildReadiness({ skipSnapshot: true });

    expect(readiness.success).toBe(true);
    expect(readiness.overall_status).not.toBe("fail");
    expect(readiness.snapshot_endpoint_available).toBe(true);
    expect(readiness.snapshot_verify_passed).toBe(true);
    expect(readiness.snapshot_secret_scan_passed).toBe(true);
    const secretScan = readiness.checks.find((check) => check.id === "snapshot_secret_scan_passed");
    expect(secretScan.status).toBe("pass");
  });

  test("readiness includes verified snapshot archive checks", async () => {
    const keys = testKeypair();
    process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = keys.privateKey;
    process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = keys.publicKey;
    await createSnapshotArchive({ directory: archiveDir, createdAt: "2026-05-25T12:00:00.000Z" });

    const response = await request(app).get("/api/readiness");

    expect(response.status).toBe(200);
    expect(response.body.snapshot_archive_available).toBe(true);
    expect(response.body.snapshot_archive_latest_verified).toBe(true);
    expect(response.body.snapshot_archive_signature_valid).toBe(true);
    expect(response.body.checks.find((check) => check.id === "snapshot_archive_latest_verified").status).toBe("pass");
    expect(response.body.checks.find((check) => check.id === "snapshot_archive_signature_valid").status).toBe("pass");
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

  test("required snapshot signature failure is reported safely", async () => {
    process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE = "true";
    const response = await request(app).get("/api/readiness");

    expect(response.status).toBe(200);
    expect(response.body.snapshot_signature_required).toBe(true);
    expect(response.body.snapshot_signature_verified).toBe(false);
    expect(response.body.snapshot_signature_status).toBe("missing_required_signature");
    const signatureCheck = response.body.checks.find((check) => check.id === "snapshot_signature_status");
    expect(signatureCheck.status).toBe("fail");
    expect(JSON.stringify(response.body)).not.toMatch(/BEGIN PRIVATE KEY|VORLIQ_SNAPSHOT_PRIVATE_KEY/i);
  });

  test("public node can pass while registry heartbeat is stale", async () => {
    mockFlask({ registryInactive: true });
    const response = await request(app).get("/api/readiness");

    expect(response.status).toBe(200);
    const publicNodeCheck = response.body.checks.find((check) => check.id === "public_node_active");
    const registryCheck = response.body.checks.find((check) => check.id === "registry_active_node_count");
    expect(publicNodeCheck.status).toBe("pass");
    expect(publicNodeCheck.message).toMatch(/registry heartbeat visibility needs attention/i);
    expect(registryCheck.status).toBe("warning");
  });

  test("transient node connect errors warn then escalate, but real bad values fail immediately", async () => {
    mockFlask();
    const successImpl = axios.get.getMockImplementation();
    // Baseline success computation clears any prior transient state.
    await buildReadiness();

    const connError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5001"), { code: "ECONNREFUSED" });
    const withNodeUnreachable = (url) => {
      if (url.endsWith("/diagnostics") || url.endsWith("/chain/summary")) return Promise.reject(connError);
      return successImpl(url);
    };

    // 1) First transient connect failure -> warning, not an immediate critical fail.
    axios.get.mockImplementation(withNodeUnreachable);
    const first = await buildReadiness();
    const chainFirst = first.checks.find((check) => check.id === "chain_valid");
    // The critical chain check degrades to a transient warning, never an
    // instant critical fail, so the old score-0 criticalFail cascade is gone.
    expect(chainFirst.status).toBe("warning");
    expect(first.checks.some((check) => check.severity === "critical" && check.status === "fail")).toBe(false);
    expect(first.score).toBeGreaterThan(0);

    // 2) Still unreachable on the next computation -> escalates to a real fail.
    axios.get.mockImplementation(withNodeUnreachable);
    const second = await buildReadiness();
    const chainSecond = second.checks.find((check) => check.id === "chain_valid");
    expect(chainSecond.status).toBe("fail");
    expect(second.overall_status).toBe("fail");

    // 3) A call that connects and returns a genuinely invalid chain still fails at once.
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/diagnostics")) {
        return Promise.resolve({ data: { success: true, chain_valid: false, block_height: 42, pending_transactions: 0 } });
      }
      if (url.endsWith("/chain/summary")) {
        return Promise.resolve({ data: { success: true, summary: { block_height: 42, chain_valid: false } } });
      }
      return successImpl(url);
    });
    const third = await buildReadiness();
    const chainThird = third.checks.find((check) => check.id === "chain_valid");
    expect(chainThird.status).toBe("fail");
    expect(third.overall_status).toBe("fail");

    // Restore a clean success baseline so shared transient state does not leak.
    axios.get.mockImplementation(successImpl);
    await buildReadiness();
  });
});
