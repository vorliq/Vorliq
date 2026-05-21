const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const ORIGINAL_ENV = {
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  ANALYTICS_FILE: process.env.ANALYTICS_FILE,
  INCIDENTS_FILE: process.env.INCIDENTS_FILE,
};

process.env.ADMIN_TOKEN = "migration-admin-token";

jest.mock("axios");
const axios = require("axios");
const app = require("../index");

function tempFile(name, payload) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-migration-"));
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

function mockMigrationDependencies() {
  process.env.ANALYTICS_FILE = tempFile("analytics.json", { events: [] });
  process.env.INCIDENTS_FILE = tempFile("incidents.json", { incidents: [] });
  axios.get.mockImplementation((url) => {
    if (url.endsWith("/storage/health")) {
      return Promise.resolve({
        data: {
          success: true,
          overall_status: "ok",
          warnings_count: 0,
          errors_count: 0,
          backup_available: true,
          files: [{ file_name: "chain.json", status: "ok", valid_json: true }],
        },
      });
    }
    if (url.endsWith("/indexes/health")) {
      return Promise.resolve({
        data: {
          success: true,
          status: "ok",
          valid: true,
          rebuild_needed: false,
          index_chain_match: true,
          chain_height: 44,
          latest_block_hash: "0000abcdef123456",
          built_at: "2026-05-21T00:00:00Z",
        },
      });
    }
    if (url.endsWith("/chain/summary")) {
      return Promise.resolve({
        data: {
          success: true,
          summary: {
            block_height: 44,
            last_block_hash: "0000abcdef123456",
            chain_valid: true,
          },
        },
      });
    }
    return Promise.reject(new Error(`unexpected URL ${url}`));
  });
}

describe("migration readiness routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMigrationDependencies();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("GET /api/migration/readiness returns safe JSON storage metadata", async () => {
    const response = await request(app).get("/api/migration/readiness");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.storage_backend).toBe("json");
    expect(response.body.database_enabled).toBe(false);
    expect(response.body.migration_supported).toBe("dry_run_only");
    expect(response.body.chain_source_of_truth).toBe("chain.json");
    expect(response.body.indexes_derived).toBe(true);
    expect(response.body.latest_chain_height).toBe(44);
    expect(JSON.stringify(response.body)).not.toMatch(/migration-admin-token|ADMIN_TOKEN|secret|private[_-]?key|\/home\/vorliq|[A-Z]:\\/i);
  });

  test("admin migration readiness requires token", async () => {
    const response = await request(app).get("/api/admin/migration/readiness");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("admin migration readiness returns safe deeper metadata with token", async () => {
    const response = await request(app)
      .get("/api/admin/migration/readiness")
      .set("Authorization", "Bearer migration-admin-token");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.operator_metadata.dry_run_tool).toBe("tools/migration_dry_run.py");
    expect(response.body.operator_metadata.private_wallet_keys_stored_server_side).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("migration-admin-token");
  });
});
