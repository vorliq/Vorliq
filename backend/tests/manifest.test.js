const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

describe("GET /api/network/manifest", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;
  const originalServerKey = process.env.SERVER_SSH_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_TOKEN = "test-secret-admin-token";
    process.env.SERVER_SSH_KEY = "test-secret-ssh-key";
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/chain/summary")) {
        return Promise.resolve({
          data: {
            success: true,
            summary: {
              block_height: 12,
              total_blocks: 13,
              total_transactions: 27,
              total_issued: 650,
              current_difficulty: 4,
              current_mining_reward: 50,
              last_block_hash: "0000abc",
              last_block_timestamp: 1715791000,
              chain_valid: true,
              private_key: "should-not-leak",
            },
          },
        });
      }

      if (url.endsWith("/diagnostics")) {
        return Promise.resolve({
          data: {
            success: true,
            node_url: "https://vorliq.org",
            block_height: 12,
            chain_valid: true,
            pending_transactions: 2,
            known_peers: 3,
            active_registry_nodes: 1,
            uptime_seconds: 99,
            total_vlq_in_circulation: 650,
            current_mining_reward: 50,
            last_block_hash: "0000abc",
            last_block_timestamp: 1715791000,
            env: process.env,
            path_hint: "/home/vorliq/app",
          },
        });
      }

      return Promise.reject(new Error(`unexpected URL ${url}`));
    });
  });

  afterEach(() => {
    if (originalAdminToken === undefined) {
      delete process.env.ADMIN_TOKEN;
    } else {
      process.env.ADMIN_TOKEN = originalAdminToken;
    }

    if (originalServerKey === undefined) {
      delete process.env.SERVER_SSH_KEY;
    } else {
      process.env.SERVER_SSH_KEY = originalServerKey;
    }
  });

  test("returns safe public network metadata", async () => {
    const response = await request(app).get("/api/network/manifest");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.project.name).toBe("Vorliq");
    expect(response.body.urls.website).toBe("https://vorliq.org");
    expect(response.body.urls.github).toBe("https://github.com/vorliq/Vorliq");
    expect(response.body.generated_at).toBeTruthy();
    expect(response.body.chain_summary.block_height).toBe(12);
    expect(response.body.chain_summary.chain_valid).toBe(true);
    expect(response.body.diagnostics.available).toBe(true);
    expect(response.body.sdk.supported_version).toBe("1.0.0");
    expect(response.body.available_public_api_groups).toContain("network_manifest");
  });

  test("does not expose secrets, environment data, private keys, or server paths", async () => {
    const response = await request(app).get("/api/network/manifest");
    const body = JSON.stringify(response.body);

    expect(body).not.toContain("ADMIN_TOKEN");
    expect(body).not.toContain("SERVER_SSH_KEY");
    expect(body).not.toContain("test-secret-admin-token");
    expect(body).not.toContain("test-secret-ssh-key");
    expect(body).not.toContain("private_key");
    expect(body).not.toContain("password");
    expect(body).not.toContain('"env"');
    expect(body).not.toContain("/home/vorliq");
  });

  test("returns a safe fallback when blockchain metadata is temporarily unavailable", async () => {
    axios.get.mockRejectedValue(new Error("blockchain unavailable"));

    const response = await request(app).get("/api/network/manifest");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.chain_summary).toEqual({ available: false });
    expect(response.body.diagnostics).toEqual({ available: false });
    expect(response.body.generated_at).toBeTruthy();
  });
});
