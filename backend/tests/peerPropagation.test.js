const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("peer propagation routes", () => {
  test("forwards propagation status", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        broadcast_enabled: false,
        receive_enabled: true,
        active_peer_count: 1,
        eligible_broadcast_peer_count: 0,
      },
    });

    const response = await request(app).get("/api/peers/propagation/status");

    expect(response.status).toBe(200);
    expect(response.body.receive_enabled).toBe(true);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/peers/propagation/status");
  });

  test("forwards propagation events with pagination and filters", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, events: [{ status: "quarantined", type: "block" }], total: 1, limit: 10, offset: 5 },
    });

    const response = await request(app).get("/api/peers/propagation/events?limit=10&offset=5&status=quarantined&type=block");

    expect(response.status).toBe(200);
    expect(response.body.events[0].status).toBe("quarantined");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/peers/propagation/events", {
      params: { limit: 10, offset: 5, status: "quarantined", type: "block" },
    });
  });

  test("rejects invalid propagation event filters before proxying", async () => {
    const response = await request(app).get("/api/peers/propagation/events?status=raw");

    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("admin propagation endpoint requires token", async () => {
    const response = await request(app).get("/api/admin/peers/propagation");

    expect(response.status).toBe(401);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("admin propagation endpoint forwards with token without exposing token", async () => {
    const originalToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "peer-propagation-admin";
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        broadcast_enabled: false,
        receive_enabled: true,
        diagnostics: { retention_limit: 500 },
      },
    });

    const response = await request(app)
      .get("/api/admin/peers/propagation")
      .set("Authorization", "Bearer peer-propagation-admin");

    expect(response.status).toBe(200);
    expect(response.body.diagnostics.retention_limit).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("peer-propagation-admin");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/admin/peers/propagation");

    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
  });

  test("peer transaction and block receive proxies forward safely", async () => {
    axios.post.mockResolvedValueOnce({ status: 201, data: { success: true, tx_id: "tx1" } });
    axios.post.mockResolvedValueOnce({ status: 202, data: { success: false, quarantined: true, reason: "ahead_candidate" } });

    const txResponse = await request(app).post("/api/peer/transaction").send({ transaction: { tx_id: "tx1" } });
    const blockResponse = await request(app).post("/api/peer/block").send({ block: { index: 2 } });

    expect(txResponse.status).toBe(201);
    expect(blockResponse.status).toBe(202);
    expect(axios.post).toHaveBeenNthCalledWith(1, "http://localhost:5001/peer/transaction", { transaction: { tx_id: "tx1" } });
    expect(axios.post).toHaveBeenNthCalledWith(2, "http://localhost:5001/peer/block", { block: { index: 2 } });
  });

  test("propagation responses do not expose forbidden markers", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, events: [{ safe_message: "redacted", peer_url: "https://peer.example.org" }] },
    });

    const response = await request(app).get("/api/peers/propagation/events");
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(serialized).not.toMatch(/PRIVATE KEY|ADMIN_TOKEN|ssh-ed25519|raw_ip|user_agent|server_path/i);
  });
});
