// Coverage for routes/admin.js. Every /api/admin route is behind adminAuth, so
// each test sends a valid bearer token; the auth guard itself is covered by the
// missing/wrong-token cases. Flask (axios) is mocked. The backend data dir is
// redirected to a temp dir so local incident/alert/backup stores stay hermetic.

const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.VORLIQ_DISABLE_RATE_LIMITS = "true";
process.env.ADMIN_TOKEN = "admin-cov-token";
process.env.VORLIQ_BACKEND_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vlq-admin-"));

const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

const ADMIN = { Authorization: "Bearer admin-cov-token" };

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ status: 200, data: { success: true, items: [], summary: {} } });
  axios.post.mockResolvedValue({ status: 200, data: { success: true } });
});

describe("admin auth guard", () => {
  test("missing token is rejected with 401", async () => {
    const response = await request(app).get("/api/admin/overview");
    expect(response.status).toBe(401);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("wrong token is rejected and never reaches Flask", async () => {
    const response = await request(app).get("/api/admin/overview").set("Authorization", "Bearer nope");
    expect(response.status).toBe(401);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("admin GET routes (with token)", () => {
  const reads = [
    "/api/admin/overview",
    "/api/admin/security",
    "/api/admin/mining/status",
    "/api/admin/backups",
    "/api/admin/indexes",
    "/api/admin/moderation/forum",
    "/api/admin/reports",
    "/api/admin/alerts",
    "/api/admin/usage",
    "/api/admin/faucet-abuse",
  ];

  test.each(reads)("%s responds 200 for an authenticated admin", async (route) => {
    const response = await request(app).get(route).set(ADMIN);
    expect(response.status).toBe(200);
  });

  test("admin responses never echo the admin token", async () => {
    const response = await request(app).get("/api/admin/security").set(ADMIN);
    expect(JSON.stringify(response.body)).not.toContain("admin-cov-token");
  });
});

describe("admin Flask-proxy POST routes (with token)", () => {
  test("index rebuild proxies to Flask", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true, rebuilt: true } });
    const response = await request(app).post("/api/admin/indexes/rebuild").set(ADMIN).send({});
    expect(response.status).toBe(200);
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/indexes/rebuild", {});
  });

  test("forum pin proxies to Flask", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true, pinned: true } });
    const response = await request(app)
      .post("/api/admin/moderation/forum/pin")
      .set(ADMIN)
      .send({ post_id: "p1", pinned: true });
    expect(response.status).toBe(200);
    expect(axios.post).toHaveBeenCalled();
  });

  test("forum moderate sanitizes the message when Flask is unreachable", async () => {
    const err = new Error("ECONNREFUSED 127.0.0.1:5001");
    err.code = "ECONNREFUSED";
    axios.post.mockRejectedValue(err);
    const response = await request(app)
      .post("/api/admin/moderation/forum/moderate")
      .set(ADMIN)
      .send({ post_id: "p1", status: "hidden" });
    // The handler falls back to a generic client message and never leaks the
    // internal Flask host:port from the raw connection error.
    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(response.body)).not.toContain("5001");
  });

  test("forum moderate validates a missing status before proxying", async () => {
    const response = await request(app)
      .post("/api/admin/moderation/forum/moderate")
      .set(ADMIN)
      .send({ post_id: "p1" });
    expect(response.status).toBe(400);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
