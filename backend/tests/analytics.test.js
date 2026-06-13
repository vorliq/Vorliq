const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const app = require("../index");

describe("analytics routes", () => {
  const originalAnalyticsFile = process.env.ANALYTICS_FILE;
  const originalAdminToken = process.env.ADMIN_TOKEN;
  let tempDir;
  let analyticsFile;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-analytics-"));
    analyticsFile = path.join(tempDir, "analytics.json");
    process.env.ANALYTICS_FILE = analyticsFile;
    process.env.ADMIN_TOKEN = "analytics-admin-token";
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalAnalyticsFile === undefined) delete process.env.ANALYTICS_FILE;
    else process.env.ANALYTICS_FILE = originalAnalyticsFile;
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;
  });

  function safeEvent(overrides = {}) {
    return {
      event_type: "page_view",
      route: "/growth",
      category: "dashboard",
      anonymous_session_id: "anon_testsession1234567890",
      metadata: { route_category: "dashboard" },
      ...overrides,
    };
  }

  function readEvents() {
    return JSON.parse(fs.readFileSync(analyticsFile, "utf8")).events;
  }

  test("event endpoint accepts allowlisted event", async () => {
    const response = await request(app).post("/api/analytics/event").send(safeEvent());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(readEvents()).toHaveLength(1);
    expect(readEvents()[0].event_type).toBe("page_view");
    expect(fs.existsSync(`${analyticsFile}.bak`)).toBe(true);
  });

  test("analytics atomic write creates backup on overwrite", async () => {
    await request(app).post("/api/analytics/event").send(safeEvent());
    await request(app).post("/api/analytics/event").send(safeEvent({ route: "/forum" }));

    expect(readEvents()).toHaveLength(2);
    expect(fs.existsSync(`${analyticsFile}.bak`)).toBe(true);
    expect(JSON.parse(fs.readFileSync(`${analyticsFile}.bak`, "utf8")).events).toHaveLength(1);
  });

  test("analytics safe load handles corrupt file with backup", async () => {
    const now = new Date().toISOString();
    fs.writeFileSync(analyticsFile, JSON.stringify({ events: [{ ...safeEvent(), timestamp: now }] }));
    fs.writeFileSync(`${analyticsFile}.bak`, JSON.stringify({ events: [{ ...safeEvent({ route: "/backup" }), timestamp: now }] }));
    fs.writeFileSync(analyticsFile, "{bad json");

    const response = await request(app).get("/api/analytics/summary");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(readEvents()[0].route).toBe("/backup");
    expect(fs.readdirSync(tempDir).some((file) => file.startsWith("analytics.json.corrupt."))).toBe(true);
  });

  test("event endpoint rejects unknown event_type", async () => {
    const response = await request(app)
      .post("/api/analytics/event")
      .send(safeEvent({ event_type: "private_key_exported" }));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test("event endpoint rejects unsafe metadata keys", async () => {
    const response = await request(app)
      .post("/api/analytics/event")
      .send(safeEvent({ metadata: { private_key: "secret" } }));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test("summary returns aggregates", async () => {
    await request(app).post("/api/analytics/event").send(safeEvent());
    await request(app).post("/api/analytics/event").send(safeEvent({
      event_type: "forum_page_opened",
      route: "/forum",
      category: "community",
    }));

    const response = await request(app).get("/api/analytics/summary");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.events_7d).toBe(2);
    expect(response.body.page_views_7d).toBe(1);
    expect(response.body.unique_anonymous_sessions_7d).toBe(1);
    expect(response.body.forum_page_views_7d).toBe(1);
    expect(response.body.top_routes_7d[0]).toEqual({ name: "/forum", count: 1 });
  });

  test("admin analytics requires token", async () => {
    const response = await request(app).get("/api/admin/analytics");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Unauthorized");
  });

  test("events do not include raw IP, user agent, or secrets", async () => {
    await request(app)
      .post("/api/analytics/event")
      .set("User-Agent", "Raw Browser Agent")
      .send(safeEvent({
        metadata: { source: "test", link: "safe-link" },
      }));

    const stored = JSON.stringify(readEvents());
    expect(stored).not.toContain("Raw Browser Agent");
    expect(stored).not.toContain("127.0.0.1");
    expect(stored).not.toContain("private_key");
    expect(stored).not.toContain("ADMIN_TOKEN");
    expect(stored).not.toContain("password");
  });

  test("retention pruning works on write", async () => {
    fs.writeFileSync(
      analyticsFile,
      JSON.stringify({
        events: [
          {
            event_id: "old",
            event_type: "page_view",
            route: "/old",
            category: "old",
            timestamp: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
            anonymous_session_id: "anon_oldsession123456",
            metadata: {},
          },
        ],
      })
    );

    await request(app).post("/api/analytics/event").send(safeEvent());

    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].route).toBe("/growth");
  });

  test("batch endpoint accepts a valid batch of interaction events", async () => {
    const response = await request(app)
      .post("/api/analytics/events")
      .send({
        events: [
          safeEvent({ event_type: "cta_click", metadata: { element: "create-account", device: "desktop" } }),
          safeEvent({ event_type: "card_click", metadata: { element: "explorer", device: "mobile" } }),
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.accepted).toBe(2);
    expect(readEvents()).toHaveLength(2);
    expect(readEvents().map((event) => event.event_type).sort()).toEqual(["card_click", "cta_click"]);
  });

  test("batch endpoint rejects a batch containing an invalid event and writes nothing", async () => {
    const response = await request(app)
      .post("/api/analytics/events")
      .send({
        events: [
          safeEvent({ event_type: "cta_click", metadata: { element: "create-account" } }),
          safeEvent({ event_type: "private_key_exported" }),
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(fs.existsSync(analyticsFile) ? readEvents() : []).toHaveLength(0);
  });

  test("batch endpoint rejects an empty or oversized batch", async () => {
    const empty = await request(app).post("/api/analytics/events").send({ events: [] });
    expect(empty.status).toBe(400);

    const oversized = await request(app)
      .post("/api/analytics/events")
      .send({ events: Array.from({ length: 26 }, () => safeEvent({ event_type: "nav_click", metadata: { element: "blockchain" } })) });
    expect(oversized.status).toBe(400);
  });

  test("batch endpoint rejects unsafe metadata keys", async () => {
    const response = await request(app)
      .post("/api/analytics/events")
      .send({ events: [safeEvent({ event_type: "cta_click", metadata: { private_key: "secret" } })] });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test("admin analytics returns the additive aggregate sections", async () => {
    await request(app)
      .post("/api/analytics/events")
      .send({
        events: [
          safeEvent({ event_type: "cta_click", route: "/", metadata: { element: "create-account", device: "desktop" } }),
          safeEvent({ event_type: "card_click", metadata: { element: "explorer", device: "mobile" } }),
          safeEvent({ event_type: "api_failure", metadata: { endpoint: "/readiness", outcome: "timeout" } }),
          safeEvent({ event_type: "frontend_error", metadata: { element: "window_error" } }),
        ],
      });

    const response = await request(app)
      .get("/api/admin/analytics")
      .set("Authorization", "Bearer analytics-admin-token");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.top_buttons)).toBe(true);
    expect(response.body.top_buttons).toEqual(expect.arrayContaining([{ name: "create-account", count: 1 }]));
    expect(response.body.top_cards).toEqual(expect.arrayContaining([{ name: "explorer", count: 1 }]));
    expect(response.body.api_failure_total_30d).toBe(1);
    expect(response.body.frontend_error_count_30d).toBe(1);
    expect(Array.isArray(response.body.device_breakdown)).toBe(true);
    expect(Array.isArray(response.body.journey_funnel)).toBe(true);
  });
});
