const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("registry trust routes", () => {
  test("forwards registry summary route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { active_node_count: 2, synced_node_count: 1 } },
    });

    const response = await request(app).get("/api/registry/summary");

    expect(response.status).toBe(200);
    expect(response.body.summary.active_node_count).toBe(2);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/registry/summary");
  });

  test("forwards all nodes route with filters", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, nodes: [{ node_url: "https://node.example.org", sync_status: "synced" }] },
    });

    const response = await request(app).get("/api/registry/all?status=active&sync_status=synced&country=UK");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/registry/all", {
      params: { status: "active", sync_status: "synced", country: "UK" },
    });
  });

  test("forwards node detail route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, node: { node_url: "https://node.example.org", reliability_score: 100 } },
    });

    const response = await request(app).get("/api/registry/node?node_url=https%3A%2F%2Fnode.example.org");

    expect(response.status).toBe(200);
    expect(response.body.node.reliability_score).toBe(100);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/registry/node", {
      params: { node_url: "https://node.example.org" },
    });
  });

  test("register validation rejects missing display name", async () => {
    const response = await request(app)
      .post("/api/registry/register")
      .send({ node_url: "https://node.example.org" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/display name/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("heartbeat validation rejects unsafe URL", async () => {
    const response = await request(app)
      .post("/api/registry/heartbeat")
      .send({ node_url: "ftp://node.example.org" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/http or https/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("safe responses do not expose secrets", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        summary: {
          active_node_count: 1,
          token: undefined,
          private_key: undefined,
          password: undefined,
        },
      },
    });

    const response = await request(app).get("/api/registry/summary");
    const body = JSON.stringify(response.body).toLowerCase();

    expect(response.status).toBe(200);
    expect(body).not.toContain("private_key");
    expect(body).not.toContain("password");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("token");
  });
});
