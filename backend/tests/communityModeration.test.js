const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-reports-"));
process.env.VORLIQ_REPORTS_FILE = path.join(tempDir, "reports.json");
process.env.ADMIN_TOKEN = "moderation-admin-token";

jest.mock("axios");
const axios = require("axios");
const app = require("../index");

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
  fs.rmSync(process.env.VORLIQ_REPORTS_FILE, { force: true });
});

test("report creation validates target and reason", async () => {
  const response = await request(app)
    .post("/api/reports")
    .send({ target_type: "bad", target_id: "p1", reason: "spam", description: "spam post" });

  expect(response.status).toBe(400);
  expect(response.body.success).toBe(false);
});

test("report creation rejects unsafe secret text", async () => {
  const response = await request(app)
    .post("/api/reports")
    .send({
      target_type: "profile",
      target_id: "VLQ_MEMBER",
      reason: "impersonation",
      description: "BEGIN PRIVATE KEY should never be here",
    });

  expect(response.status).toBe(400);
  expect(response.body.message).toMatch(/private keys|secrets/i);
});

test("admin reports require token and can review a report", async () => {
  const created = await request(app)
    .post("/api/reports")
    .send({
      target_type: "profile",
      target_id: "VLQ_MEMBER",
      reason: "impersonation",
      description: "Possible impersonation.",
    });

  expect(created.status).toBe(201);
  const blocked = await request(app).get("/api/admin/reports");
  expect(blocked.status).toBe(401);

  const listed = await request(app)
    .get("/api/admin/reports")
    .set("Authorization", "Bearer moderation-admin-token");
  expect(listed.status).toBe(200);
  expect(listed.body.reports).toHaveLength(1);

  const reviewed = await request(app)
    .post("/api/admin/reports/review")
    .set("Authorization", "Bearer moderation-admin-token")
    .send({ report_id: created.body.report.report_id, moderator_note: "reviewed" });
  expect(reviewed.status).toBe(200);
  expect(reviewed.body.report.status).toBe("reviewed");
});

test("profile verification routes proxy safely", async () => {
  axios.post.mockResolvedValue({ status: 200, data: { success: true, message: "Verify Vorliq profile ownership for VLQ at 1" } });

  const response = await request(app)
    .post("/api/profiles/verify/challenge")
    .send({ address: "VLQ_PROFILE" });

  expect(response.status).toBe(200);
  expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/profiles/verify/challenge", { address: "VLQ_PROFILE" });
});

test("admin forum moderation requires token", async () => {
  const response = await request(app)
    .post("/api/admin/moderation/forum/moderate")
    .send({ target_type: "post", post_id: "post", status: "hidden" });

  expect(response.status).toBe(401);
  expect(axios.post).not.toHaveBeenCalled();
});
