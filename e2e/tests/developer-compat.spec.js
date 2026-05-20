const { expect, test } = require("@playwright/test");
const { expectNoCrashText, safeApiJson } = require("./helpers");

function docsBaseUrl() {
  if (process.env.E2E_DOCS_BASE_URL) return process.env.E2E_DOCS_BASE_URL.replace(/\/+$/, "");
  if (process.env.E2E_BASE_URL) return `${process.env.E2E_BASE_URL.replace(/\/+$/, "")}/docs`;
  return "https://vorliq.github.io/Vorliq";
}

test("stable v1 API compatibility endpoints return safe JSON", async ({ request }) => {
  for (const endpoint of ["/api/version", "/api/v1/health", "/api/v1/chain/summary"]) {
    const response = await request.get(endpoint);
    expect(response.ok(), `${endpoint} should return 2xx`).toBe(true);
    expect(response.headers()["x-request-id"], `${endpoint} should include request id`).toBeTruthy();
    expect(response.headers()["x-vorliq-api-version"], `${endpoint} should include version`).toBe("1");
    const json = await response.json();
    expect(json.success, `${endpoint} should expose success true`).toBe(true);
    safeApiJson(json);
  }
});

test("developer compatibility docs load", async ({ page }) => {
  for (const path of ["/api-versioning.html", "/examples.html", "/upgrades.html"]) {
    await page.goto(`${docsBaseUrl()}${path}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/Vorliq|API|Developer/i);
    await expectNoCrashText(page);
  }
});
