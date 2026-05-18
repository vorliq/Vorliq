jest.mock("axios");

function loadHeartbeat(env = {}) {
  jest.resetModules();
  Object.assign(process.env, env);
  const heartbeat = require("../heartbeat");
  return { heartbeat, axios: require("axios") };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NODE_ENV;
  delete process.env.HEARTBEAT_API_URL;
  delete process.env.BACKEND_URL;
  delete process.env.FLASK_URL;
  delete process.env.VORLIQ_NODE_URL;
  delete process.env.LOCAL_NODE_URL;
  delete process.env.VORLIQ_NODE_NAME;
  delete process.env.NODE_DISPLAY_NAME;
  delete process.env.VORLIQ_NODE_REGION;
  delete process.env.VORLIQ_NODE_COUNTRY;
  delete process.env.VORLIQ_OPERATOR_WALLET;
  delete process.env.ADMIN_TOKEN;
  delete process.env.GITHUB_SHA;
  delete process.env.VORLIQ_COMMIT;
});

describe("production heartbeat", () => {
  test("uses production-safe public node defaults", () => {
    const { heartbeat } = loadHeartbeat({ NODE_ENV: "production", GITHUB_SHA: "abcdef1234567890" });

    expect(heartbeat.basePayload()).toMatchObject({
      node_url: "https://node.vorliq.org",
      display_name: "Vorliq Public Node",
      region: "London",
      country: "United Kingdom",
      software_version: "abcdef1",
      is_public: true,
    });
  });

  test("sends configured node_url through local backend API", async () => {
    const { heartbeat, axios } = loadHeartbeat({
      NODE_ENV: "production",
      HEARTBEAT_API_URL: "http://127.0.0.1:5000",
      FLASK_URL: "http://127.0.0.1:5001",
      VORLIQ_NODE_URL: "https://node.vorliq.org",
    });
    axios.get.mockResolvedValue({
      data: { block_height: 22, last_block_hash: "0000abc", chain_valid: true },
    });
    axios.post.mockResolvedValue({ data: { success: true, node: { node_url: "https://node.vorliq.org" } } });

    await heartbeat.sendHeartbeat();

    expect(axios.get).toHaveBeenCalledWith("http://127.0.0.1:5001/diagnostics", { timeout: 8000 });
    expect(axios.post).toHaveBeenCalledWith(
      "http://127.0.0.1:5000/api/registry/heartbeat",
      expect.objectContaining({
        node_url: "https://node.vorliq.org",
        chain_height: 22,
        last_block_hash: "0000abc",
        chain_valid: true,
      }),
      { timeout: 8000 }
    );
  });

  test("registers node if heartbeat reports missing node", async () => {
    const { heartbeat, axios } = loadHeartbeat({ NODE_ENV: "production" });
    axios.get.mockResolvedValue({
      data: { block_height: 22, last_block_hash: "0000abc", chain_valid: true },
    });
    axios.post
      .mockRejectedValueOnce({ response: { status: 404, data: { message: "Node not found" } } })
      .mockResolvedValueOnce({ data: { success: true, node: { node_url: "https://node.vorliq.org" } } })
      .mockResolvedValueOnce({ data: { success: true, node: { sync_status: "synced" } } });

    const result = await heartbeat.sendHeartbeat();

    expect(result.success).toBe(true);
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:5000/api/registry/register",
      expect.objectContaining({ node_url: "https://node.vorliq.org" }),
      { timeout: 8000 }
    );
    expect(axios.post).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:5000/api/registry/heartbeat",
      expect.objectContaining({ node_url: "https://node.vorliq.org" }),
      { timeout: 8000 }
    );
  });

  test("does not expose environment secrets in heartbeat payload", async () => {
    const { heartbeat, axios } = loadHeartbeat({ NODE_ENV: "production", ADMIN_TOKEN: "super-secret-admin-token" });
    axios.get.mockResolvedValue({
      data: { block_height: 22, last_block_hash: "0000abc", chain_valid: true },
    });
    axios.post.mockResolvedValue({ data: { success: true } });

    await heartbeat.sendHeartbeat();

    const payloadText = JSON.stringify(axios.post.mock.calls.map((call) => call[1]));
    expect(payloadText).not.toContain("super-secret-admin-token");
    expect(payloadText).not.toContain("ADMIN_TOKEN");
  });

  test("handles registry failure safely", async () => {
    const { heartbeat, axios } = loadHeartbeat({ NODE_ENV: "production" });
    axios.get.mockResolvedValue({
      data: { block_height: 22, last_block_hash: "0000abc", chain_valid: true },
    });
    axios.post.mockRejectedValue({ response: { status: 500, data: { message: "registry unavailable" } } });

    await expect(heartbeat.sendHeartbeat()).resolves.toBeNull();
  });
});
