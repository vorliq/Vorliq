const { expect, test } = require("@playwright/test");
const {
  expectMainContent,
  expectNoCrashText,
  expectNoHorizontalOverflow,
  prepareReadOnlyPage,
  safeApiJson,
  safeGoto,
} = require("./helpers");

test.describe("CI production smoke", () => {
  test("dashboard loads read-only in desktop Chromium", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    await expectMainContent(page, /Vorliq Dashboard/i);
    await expectNoCrashText(page);
    await expectNoHorizontalOverflow(page);
  });

  test("health loads read-only in mobile Chromium", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/health");

    await expectMainContent(page, /Health/i);
    await expect(page.locator("main")).toContainText(/Mining|Registry|Incident|Backup/i);
    await expectNoCrashText(page);
    await expectNoHorizontalOverflow(page);
  });

  test("safe production API endpoints respond in Chromium", async ({ page }) => {
    for (const endpoint of ["/api/health", "/api/deployment", "/api/network/manifest"]) {
      const response = await page.goto(endpoint, { waitUntil: "domcontentloaded" });
      expect(response, `${endpoint} should return a response`).toBeTruthy();
      expect(response.ok(), `${endpoint} should return 2xx`).toBe(true);
      const json = JSON.parse(await page.locator("body").innerText());
      expect(json.success, `${endpoint} should expose success true`).toBe(true);
      safeApiJson(json);
    }
  });
});
