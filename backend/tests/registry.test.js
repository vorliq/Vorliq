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

  test("forwards registry lifecycle route with safe output", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        summary: { active_count: 1, stale_count: 0, inactive_count: 0, archived_count: 0, retired_count: 0 },
        nodes: [{ node_url: "https://node.example.org", lifecycle_status: "active" }],
      },
    });

    const response = await request(app).get("/api/registry/lifecycle");

    expect(response.status).toBe(200);
    expect(response.body.summary.active_count).toBe(1);
    expect(JSON.stringify(response.body)).not.toMatch(/private_key|password|ADMIN_TOKEN/i);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/registry/lifecycle", { params: {} });
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

  test("archive route requires admin token", async () => {
    const response = await request(app)
      .post("/api/admin/registry/archive")
      .send({ node_url: "https://old.example.org", reason: "old test node" });

    expect(response.status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("restore route requires admin token", async () => {
    const response = await request(app)
      .post("/api/admin/registry/restore")
      .send({ node_url: "https://old.example.org", reason: "restore" });

    expect(response.status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("retire route requires admin token", async () => {
    const response = await request(app)
      .post("/api/admin/registry/retire")
      .send({ node_url: "https://old.example.org", reason: "retire" });

    expect(response.status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("cannot casually archive trusted public node", async () => {
    const originalToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "registry-admin-test";

    const response = await request(app)
      .post("/api/admin/registry/archive")
      .set("Authorization", "Bearer registry-admin-test")
      .send({ node_url: "https://node.vorliq.org", reason: "test" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/trusted public node/i);
    expect(axios.post).not.toHaveBeenCalled();

    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
  });

  test("admin lifecycle archive forwards without exposing token", async () => {
    const originalToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "registry-admin-test";
    axios.post.mockResolvedValue({
      status: 200,
      data: { success: true, node: { node_url: "https://old.example.org", lifecycle_status: "archived" } },
    });

    const response = await request(app)
      .post("/api/admin/registry/archive")
      .set("Authorization", "Bearer registry-admin-test")
      .send({ node_url: "https://old.example.org", reason: "old test node" });

    expect(response.status).toBe(200);
    expect(response.body.node.lifecycle_status).toBe("archived");
    expect(JSON.stringify(response.body)).not.toContain("registry-admin-test");
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/registry/admin/archive", {
      node_url: "https://old.example.org",
      reason: "old test node",
      force: false,
    });

    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
  });
});
