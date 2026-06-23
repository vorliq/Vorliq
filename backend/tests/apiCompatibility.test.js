const request = require("supertest");

process.env.ADMIN_TOKEN = "api-compat-admin-token";

jest.mock("axios");
const axios = require("axios");
const { clearCache } = require("../cache");
const app = require("../index");

beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
  clearCache();
});

test("request ID and API version headers are returned", async () => {
  const response = await request(app).get("/api/health");

  expect(response.status).toBe(200);
  expect(response.headers["x-request-id"]).toMatch(/[A-Za-z0-9._:-]+/);
  expect(response.headers["x-vorliq-api-version"]).toBe("1");
  expect(response.headers["x-vorliq-api-stability"]).toBe("stable");
});

test("custom safe X-Request-ID is preserved", async () => {
  const response = await request(app)
    .get("/api/health")
    .set("X-Request-ID", "sdk-test-123");

  expect(response.status).toBe(200);
  expect(response.headers["x-request-id"]).toBe("sdk-test-123");
});

test("unsafe X-Request-ID is replaced", async () => {
  const response = await request(app)
    .get("/api/health")
    .set("X-Request-ID", "unsafe header with spaces and <>");

  expect(response.status).toBe(200);
  expect(response.headers["x-request-id"]).not.toBe("unsafe header with spaces and <>");
  expect(response.headers["x-request-id"]).toMatch(/[0-9a-f-]{36}/i);
});

test("/api/version returns stable version metadata", async () => {
  const response = await request(app).get("/api/version");

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(response.body.api_version).toBe(1);
  expect(response.body.stability).toBe("stable");
  expect(response.body.supported_versions).toEqual([1]);
  expect(response.body.deprecation_policy_url).toMatch(/api-versioning\.html$/);
  expect(response.body.metadata_url).toMatch(/\/api\/version\/metadata$/);
});

test("/api/version/metadata returns safe canonical release metadata", async () => {
  const response = await request(app).get("/api/version/metadata");

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(response.body.project_name).toBe("Vorliq");
  expect(response.body.current_version).toBe("1.0.0");
  expect(response.body.release_channel).toBe("stable");
  expect(response.body.api_version).toBe(1);
  expect(response.body.recommended_node_version).toBeTruthy();
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE KEY|ADMIN_TOKEN|SERVER_SSH_KEY|\/home\/vorliq/i);
});

test("/api/changelog returns structured safe entries", async () => {
  const response = await request(app).get("/api/changelog");

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(response.body.latest_version).toBe("1.0.0");
  expect(Array.isArray(response.body.entries)).toBe(true);
  expect(response.body.entries.length).toBeGreaterThan(0);
  expect(response.body.entries[0]).toHaveProperty("compatibility_notes");
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE KEY|ADMIN_TOKEN|SERVER_SSH_KEY|\/home\/vorliq/i);
});

test("/api/roadmap returns grouped public roadmap data", async () => {
  const response = await request(app).get("/api/roadmap");

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(Array.isArray(response.body.items)).toBe(true);
  expect(response.body.items.some((item) => item.status === "completed")).toBe(true);
  expect(response.body.items.some((item) => item.status === "planned" || item.status === "research")).toBe(true);
  expect(response.body.disclaimer).toMatch(/can change/i);
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE KEY|ADMIN_TOKEN|SERVER_SSH_KEY|\/home\/vorliq/i);
});

test("/api/v1 aliases reuse stable public read routes", async () => {
  axios.get
    .mockResolvedValueOnce({ status: 200, data: { success: true, summary: { height: 12 } } })
    .mockResolvedValueOnce({ status: 200, data: { success: true, summary: { available: true } } });

  const health = await request(app).get("/api/v1/health");
  expect(health.status).toBe(200);
  expect(health.body.success).toBe(true);

  const chain = await request(app).get("/api/v1/chain/summary");
  expect(chain.status).toBe(200);
  expect(chain.body.summary.height).toBe(12);
  expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain/summary", { timeout: 12000 });

  const faucet = await request(app).get("/api/v1/faucet/summary");
  expect(faucet.status).toBe(200);
  expect(faucet.body.summary.available).toBe(true);
  expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/faucet/summary");
});

test("validation error response includes request_id and error code", async () => {
  const response = await request(app)
    .post("/api/reports")
    .set("X-Request-ID", "report-validation")
    .send({ target_type: "profile", target_id: "profile-1", reason: "other" });

  expect(response.status).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.message).toMatch(/description is required/i);
  expect(response.body.error.code).toBe("VALIDATION_ERROR");
  expect(response.body.error.message).toMatch(/description is required/i);
  expect(response.body.request_id).toBe("report-validation");
});

test("admin route without token includes request_id and no secret", async () => {
  const response = await request(app)
    .get("/api/admin/overview")
    .set("X-Request-ID", "admin-blocked");

  expect(response.status).toBe(401);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe("UNAUTHORIZED");
  expect(response.body.request_id).toBe("admin-blocked");
  expect(JSON.stringify(response.body)).not.toMatch(/api-compat-admin-token|ADMIN_TOKEN|Bearer/i);
});
