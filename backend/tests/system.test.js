const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

describe("GET /api/system/self-check", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;
  const originalServerKey = process.env.SERVER_SSH_KEY;
  const originalNodeUrl = process.env.VORLIQ_NODE_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.SERVER_SSH_KEY = "test-private-key";
    process.env.VORLIQ_NODE_URL = "https://node.vorliq.org";
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/diagnostics")) {
        return Promise.resolve({
          data: {
            success: true,
            chain_valid: true,
            block_height: 42,
            pending_transactions: 3,
            private_key: "should-not-leak",
          },
        });
      }

      if (url.endsWith("/registry/summary")) {
        return Promise.resolve({
          data: {
            success: true,
            summary: {
              active_node_count: 1,
              total_registered_node_count: 2,
              synced_node_count: 1,
              secret_path: "/home/vorliq/app",
            },
          },
        });
      }

      if (url.endsWith("/storage/health")) {
        return Promise.resolve({
          data: {
            success: true,
            overall_status: "ok",
            critical_files_ok: 13,
            warnings_count: 0,
            errors_count: 0,
            backup_available: true,
            files: [{ file_name: "chain.json", status: "ok" }],
          },
        });
      }

      return Promise.reject(new Error(`unexpected URL ${url}`));
    });
  });

  afterEach(() => {
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;

    if (originalServerKey === undefined) delete process.env.SERVER_SSH_KEY;
    else process.env.SERVER_SSH_KEY = originalServerKey;

    if (originalNodeUrl === undefined) delete process.env.VORLIQ_NODE_URL;
    else process.env.VORLIQ_NODE_URL = originalNodeUrl;
  });

  test("returns a safe production self-check summary", async () => {
    const response = await request(app).get("/api/system/self-check");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.api_health).toBe(true);
    expect(response.body.blockchain_reachable).toBe(true);
    expect(response.body.chain_valid).toBe(true);
    expect(response.body.registry_active_node_count).toBe(1);
    expect(response.body.storage_health).toBe("ok");
    expect(response.body.critical_storage_errors).toBe(0);
    expect(response.body.backup_available).toBe(true);
    expect(response.body.public_node_url).toBe("https://node.vorliq.org");
    expect(response.body.timestamp).toBeTruthy();
  });

  test("does not expose secrets, private fields, or server paths", async () => {
    const response = await request(app).get("/api/system/self-check");
    const body = JSON.stringify(response.body);

    expect(body).not.toContain("ADMIN_TOKEN");
    expect(body).not.toContain("SERVER_SSH_KEY");
    expect(body).not.toContain("test-admin-token");
    expect(body).not.toContain("test-private-key");
    expect(body).not.toContain("private_key");
    expect(body).not.toContain("/home/vorliq");
  });
});
