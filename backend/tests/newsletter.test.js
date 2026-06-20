const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const app = require("../index");

describe("newsletter routes", () => {
  let tempDir;
  let newsletterFile;
  const originalNewsletterFile = process.env.VORLIQ_NEWSLETTER_FILE;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-newsletter-"));
    newsletterFile = path.join(tempDir, "newsletter.json");
    process.env.VORLIQ_NEWSLETTER_FILE = newsletterFile;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalNewsletterFile === undefined) {
      delete process.env.VORLIQ_NEWSLETTER_FILE;
    } else {
      process.env.VORLIQ_NEWSLETTER_FILE = originalNewsletterFile;
    }
  });

  test("a valid email subscribes successfully and is persisted", async () => {
    const response = await request(app)
      .post("/api/newsletter/subscribe")
      .send({ email: "Member@Example.com" });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("subscribed");
    expect(response.body.already_subscribed).toBe(false);
    expect(response.body.email).toBe("member@example.com");

    const stored = JSON.parse(fs.readFileSync(newsletterFile, "utf8"));
    expect(stored.subscribers).toHaveLength(1);
    expect(stored.subscribers[0].email).toBe("member@example.com");
  });

  test("subscribing the same email twice reports a duplicate without adding a row", async () => {
    await request(app).post("/api/newsletter/subscribe").send({ email: "dup@example.com" });
    const second = await request(app)
      .post("/api/newsletter/subscribe")
      .send({ email: "DUP@example.com" });

    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.status).toBe("already_subscribed");
    expect(second.body.already_subscribed).toBe(true);

    const stored = JSON.parse(fs.readFileSync(newsletterFile, "utf8"));
    expect(stored.subscribers).toHaveLength(1);
  });

  test("a missing email returns a validation error", async () => {
    const response = await request(app).post("/api/newsletter/subscribe").send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("a malformed email returns a validation error and stores nothing", async () => {
    const response = await request(app)
      .post("/api/newsletter/subscribe")
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(fs.existsSync(newsletterFile)).toBe(false);
  });

  test("a flood of sign-ups from one connection is rate limited with a clear message", async () => {
    const responses = [];
    for (let i = 0; i < 16; i += 1) {
      responses.push(await request(app).post("/api/newsletter/subscribe").send({ email: `flood${i}@example.com` }));
    }
    const limited = responses.find((r) => r.status === 429);
    expect(limited).toBeDefined();
    expect(limited.body.success).toBe(false);
    expect(limited.body.message).toMatch(/too many sign-up attempts/i);
  });
});
