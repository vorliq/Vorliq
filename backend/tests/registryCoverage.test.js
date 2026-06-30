// Coverage for routes/registry.js: public node read routes and their sanitized
// error paths, the public register/heartbeat proxies, and the admin-gated
// lifecycle actions (probe-sweep / archive / restore) including the auth guard.
// Only Flask (axios) is mocked.

process.env.VORLIQ_DISABLE_RATE_LIMITS = "true";
process.env.ADMIN_TOKEN = "registry-test-token";

const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

const ADMIN = { Authorization: "Bearer registry-test-token" };

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ status: 200, data: { success: true, nodes: [], summary: {} } });
  axios.post.mockResolvedValue({ status: 200, data: { success: true } });
});

describe("registry read routes", () => {
  const reads = [
    "/api/registry/nodes",
    "/api/registry/all",
    "/api/registry/node?node_url=https://node.example",
    "/api/registry/summary",
    "/api/registry/lifecycle",
  ];

  test.each(reads)("%s forwards an upstream success", async (route) => {
    const response = await request(app).get(route);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test.each(reads)("%s returns a sanitized 503 when Flask is down", async (route) => {
    const err = new Error("connect ECONNREFUSED");
    err.code = "ECONNREFUSED";
    axios.get.mockRejectedValue(err);
    const response = await request(app).get(route);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
  });
});

describe("registry register / heartbeat proxies", () => {
  test("register forwards a node registration", async () => {
    axios.post.mockResolvedValue({ status: 201, data: { success: true, registered: true } });
    const response = await request(app)
      .post("/api/registry/register")
      .send({ node_url: "https://node.example", display_name: "Example Node" });
    expect(response.status).toBe(201);
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/registry/register", expect.any(Object));
  });

  test("heartbeat returns a sanitized 503 when Flask is unreachable", async () => {
    const err = new Error("ETIMEDOUT");
    err.code = "ETIMEDOUT";
    axios.post.mockRejectedValue(err);
    const response = await request(app)
      .post("/api/registry/heartbeat")
      .send({ node_url: "https://node.example" });
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("ETIMEDOUT");
  });
});

describe("registry admin lifecycle actions", () => {
  test("reject without an admin token", async () => {
    const response = await request(app).post("/api/admin/registry/archive").send({ node_url: "https://n" });
    expect(response.status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("archive proxies to Flask with a valid admin token", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true, archived: true } });
    const response = await request(app)
      .post("/api/admin/registry/archive")
      .set(ADMIN)
      .send({ node_url: "https://node.example" });
    expect(response.status).toBe(200);
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:5001/registry/admin/archive",
      expect.any(Object),
      expect.any(Object)
    );
  });

  test("restore surfaces a sanitized 503 when Flask is unreachable", async () => {
    const err = new Error("ECONNREFUSED");
    err.code = "ECONNREFUSED";
    axios.post.mockRejectedValue(err);
    const response = await request(app)
      .post("/api/admin/registry/restore")
      .set(ADMIN)
      .send({ node_url: "https://node.example" });
    expect(response.status).toBe(503);
  });

  test("probe-sweep runs with a valid admin token", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true, swept: 0 } });
    const response = await request(app).post("/api/admin/registry/probe-sweep").set(ADMIN).send({});
    expect(response.status).toBe(200);
  });
});
