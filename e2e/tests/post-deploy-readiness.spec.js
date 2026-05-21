const { expect, test } = require("@playwright/test");
const {
  expectMainContent,
  expectNoCrashText,
  expectNoHorizontalOverflow,
  prepareReadOnlyPage,
  safeApiJson,
  safeGoto,
} = require("./helpers");

test.describe("post-deploy production readiness smoke", () => {
  test("readiness page loads after deployment", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/readiness");

    await expectMainContent(page, /Readiness/i);
    await expect(page.locator("main")).toContainText(/Production Readiness|technical readiness/i);
    await expectNoCrashText(page);
    await expectNoHorizontalOverflow(page);
  });

  test("readiness API returns safe JSON after deployment", async ({ request }) => {
    const response = await request.get("/api/readiness");
    expect(response.ok()).toBe(true);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(["pass", "warning", "fail"]).toContain(json.overall_status);
    expect(Array.isArray(json.checks)).toBe(true);
    safeApiJson(json);
  });
});
