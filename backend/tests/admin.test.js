const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

jest.mock("axios");
const axios = require("axios");
const app = require("../index");

describe("admin routes", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;
  const originalBackupDir = process.env.VORLIQ_BACKUP_DIR;
  let tempDir;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = "admin-test-token";
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-admin-"));
    process.env.VORLIQ_BACKUP_DIR = tempDir;
    axios.get.mockReset();
    axios.post.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;
    if (originalBackupDir === undefined) delete process.env.VORLIQ_BACKUP_DIR;
    else process.env.VORLIQ_BACKUP_DIR = originalBackupDir;
  });

  test("admin routes reject missing token", async () => {
    const response = await request(app).get("/api/admin/overview");
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Unauthorized");
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(response.body.request_id).toBeTruthy();
  });

  test("admin routes reject wrong token", async () => {
    const response = await request(app).get("/api/admin/security").set("Authorization", "Bearer wrong");
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Unauthorized");
  });

  test("admin overview returns safe fields with correct token", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/chain/summary")) return Promise.resolve({ data: { summary: { height: 12, chain_valid: true, pending_transactions: 2, difficulty: 3, mining_reward: 50 } } });
      if (url.endsWith("/economics")) return Promise.resolve({ data: { difficulty: 3, mining_reward: 50 } });
      if (url.endsWith("/treasury/balance")) return Promise.resolve({ data: { balance: 25 } });
      if (url.endsWith("/profiles")) return Promise.resolve({ data: { total: 4, profiles: [] } });
      if (url.endsWith("/forum/posts")) return Promise.resolve({ data: { total: 5, posts: [] } });
      return Promise.resolve({ data: {} });
    });

    const response = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", "Bearer admin-test-token");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.blockchain.height).toBe(12);
    expect(response.body.deployment.commit_hash).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain("admin-test-token");
    expect(JSON.stringify(response.body)).not.toContain("/home/vorliq");
  });

  test("admin security endpoint does not leak secrets", async () => {
    process.env.SECRET_TEST_VALUE = "do-not-show";
    const response = await request(app)
      .get("/api/admin/security")
      .set("Authorization", "Bearer admin-test-token");

    expect(response.status).toBe(200);
    expect(response.body.admin_routes_protected).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("do-not-show");
    delete process.env.SECRET_TEST_VALUE;
  });

  test("backup metadata endpoint does not leak server paths", async () => {
    const file = path.join(tempDir, "vorliq-backup-2026-05-17-120000.tar.gz");
    fs.writeFileSync(file, "backup");

    const response = await request(app)
      .get("/api/admin/backups")
      .set("Authorization", "Bearer admin-test-token");

    expect(response.status).toBe(200);
    expect(response.body.backups[0].file_name).toBe("vorliq-backup-2026-05-17-120000.tar.gz");
    expect(JSON.stringify(response.body)).not.toContain(tempDir);
    expect(JSON.stringify(response.body)).not.toContain("/home/vorliq");
  });

  test("forum moderation endpoints require admin token", async () => {
    const response = await request(app)
      .post("/api/admin/moderation/forum/pin")
      .send({ post_id: "post", pinned: true });

    expect(response.status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("forum moderation proxy forwards validated admin authorization to Flask", async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, post: { post_id: "post", pinned: true } } });

    const response = await request(app)
      .post("/api/admin/moderation/forum/pin")
      .set("Authorization", "Bearer admin-test-token")
      .send({ post_id: "post", pinned: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/forum/admin/pin"),
      { post_id: "post", pinned: true },
      { headers: { Authorization: "Bearer admin-test-token" } }
    );
    expect(JSON.stringify(response.body)).not.toContain("admin-test-token");
  });
});
