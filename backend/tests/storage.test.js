const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

describe("storage health routes", () => {
  const originalAnalyticsFile = process.env.ANALYTICS_FILE;
  const originalIncidentsFile = process.env.INCIDENTS_FILE;
  const originalAdminToken = process.env.ADMIN_TOKEN;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-storage-"));
    process.env.ANALYTICS_FILE = path.join(tempDir, "analytics.json");
    process.env.INCIDENTS_FILE = path.join(tempDir, "incidents.json");
    process.env.ADMIN_TOKEN = "storage-admin-token";
    axios.get.mockReset();
    axios.get.mockResolvedValue({
      data: {
        success: true,
        overall_status: "ok",
        critical_files_ok: 13,
        warnings_count: 0,
        errors_count: 0,
          backup_available: false,
          storage_adapter_interface_available: true,
          storage_backend: "json",
          active_storage_adapter: "json",
          postgres_adapter_available: true,
          postgres_adapter_enabled: false,
          postgres_active: false,
          postgres_write_mode: "disabled",
          postgres_runtime_blocked_in_production: true,
          files: [{ file_name: "chain.json", exists: true, valid_json: true, has_backup: false, status: "ok" }],
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalAnalyticsFile === undefined) delete process.env.ANALYTICS_FILE;
    else process.env.ANALYTICS_FILE = originalAnalyticsFile;
    if (originalIncidentsFile === undefined) delete process.env.INCIDENTS_FILE;
    else process.env.INCIDENTS_FILE = originalIncidentsFile;
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;
  });

  test("/api/storage/health returns safe metadata", async () => {
    const response = await request(app).get("/api/storage/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.files.map((file) => file.file_name)).toContain("chain.json");
    expect(response.body.storage_backend).toBe("json");
    expect(response.body.active_storage_adapter).toBe("json");
    expect(response.body.postgres_adapter_enabled).toBe(false);
    expect(response.body.postgres_write_mode).toBe("disabled");
    expect(JSON.stringify(response.body)).not.toContain(tempDir);
    expect(JSON.stringify(response.body)).not.toContain("/home/vorliq");
  });

  test("admin storage requires token", async () => {
    const response = await request(app).get("/api/admin/storage");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Unauthorized");
  });
});
