const os = require("os");
const path = require("path");
const fs = require("fs");
const request = require("supertest");

// A fixed admin token for the test process, and an isolated shared-store file so
// the lockout counters never touch real data.
process.env.ADMIN_TOKEN = "test-admin-token-value";
process.env.VORLIQ_RATE_LIMIT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rl-")), "rate-limits.json");

const app = require("../index");
const { resetAdminLockoutForTests } = require("../middleware/adminAuth");

beforeEach(() => resetAdminLockoutForTests());

describe("admin token brute-force lockout", () => {
  test("five wrong tokens lock the IP out of admin endpoints for an hour", async () => {
    // Five wrong attempts: each is a plain 401.
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .get("/api/admin/overview")
        .set("Authorization", "Bearer wrong-token");
      expect(res.status).toBe(401);
    }
    // The sixth attempt — even with the CORRECT token — is locked out (429)
    // with a Retry-After roughly an hour out.
    const locked = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", "Bearer test-admin-token-value");
    expect(locked.status).toBe(429);
    expect(locked.body.error?.code || locked.body.code).toBe("ADMIN_LOCKED");
    const retryAfter = Number(locked.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(3000);
    expect(retryAfter).toBeLessThanOrEqual(3600);
  });
});
