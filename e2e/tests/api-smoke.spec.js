const { expect, test } = require("@playwright/test");
const { safeApiJson } = require("./helpers");

const endpoints = [
  "/api/health",
  "/api/version",
  "/api/version/metadata",
  "/api/changelog",
  "/api/roadmap",
  "/api/readiness",
  "/api/indexes/health",
  "/api/migration/readiness",
  "/api/v1/health",
  "/api/deployment",
  "/api/system/self-check",
  "/api/mining/status",
  "/api/treasury/summary",
  "/api/registry/summary",
  "/api/faucet/summary",
  "/api/network/manifest",
  "/api/snapshot/latest",
  "/api/snapshot/verify",
  "/api/incidents/active",
  "/api/analytics/summary",
];

test.describe("read-only API smoke tests", () => {
  for (const endpoint of endpoints) {
    test(`${endpoint} returns safe JSON`, async ({ request }) => {
      const response = await request.get(endpoint);
      expect(response.ok(), `${endpoint} should return 2xx`).toBe(true);

      const json = await response.json();
      expect(json.success, `${endpoint} should expose success true`).toBe(true);
      safeApiJson(json);
    });
  }

  test("admin overview stays protected without a token", async ({ request }) => {
    const response = await request.get("/api/admin/overview");
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.success).toBe(false);
    safeApiJson(json);
  });

  test("admin analytics stays protected without a token", async ({ request }) => {
    const response = await request.get("/api/admin/analytics");
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.success).toBe(false);
    safeApiJson(json);
  });

  test("admin readiness stays protected without a token", async ({ request }) => {
    const response = await request.get("/api/admin/readiness");
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.success).toBe(false);
    safeApiJson(json);
  });

  test("admin indexes stay protected without a token", async ({ request }) => {
    const response = await request.get("/api/admin/indexes");
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.success).toBe(false);
    safeApiJson(json);
  });

  test("admin migration readiness stays protected without a token", async ({ request }) => {
    const response = await request.get("/api/admin/migration/readiness");
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.success).toBe(false);
    safeApiJson(json);
  });

  test("migration readiness reports PostgreSQL preparation without activation", async ({ request }) => {
    const response = await request.get("/api/migration/readiness");
    expect(response.ok()).toBe(true);
    const json = await response.json();
    expect(json.future_database_target).toBe("postgresql");
    expect(json.storage_backend).toBe("json");
    expect(json.database_enabled).toBe(false);
    expect(json.postgres_active).toBe(false);
    expect(json.postgres_shadow_rehearsal_available).toBe(true);
    expect(json.postgres_shadow_ci_enabled).toBe(true);
    expect(json.migration_phase).toBe("preparation");
    safeApiJson(json);
  });
});
