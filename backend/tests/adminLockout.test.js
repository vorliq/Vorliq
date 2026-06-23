const request = require("supertest");

// A fixed admin token for the test process.
process.env.ADMIN_TOKEN = "test-admin-token-value";

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
