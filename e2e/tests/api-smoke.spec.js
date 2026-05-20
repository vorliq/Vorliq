const { expect, test } = require("@playwright/test");
const { safeApiJson } = require("./helpers");

const endpoints = [
  "/api/health",
  "/api/deployment",
  "/api/system/self-check",
  "/api/mining/status",
  "/api/treasury/summary",
  "/api/registry/summary",
  "/api/faucet/summary",
  "/api/network/manifest",
  "/api/incidents/active",
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
});
