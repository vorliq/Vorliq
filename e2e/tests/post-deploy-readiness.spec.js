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

  test("readiness API returns safe JSON after deployment", async ({ page }) => {
    let response;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await page.goto("/api/readiness", { waitUntil: "domcontentloaded" });
      if (response?.ok()) break;
      await page.waitForTimeout(5000);
    }

    expect(response, "readiness API should return a response").toBeTruthy();
    expect(response.ok(), `readiness API returned ${response.status()}`).toBe(true);
    const json = JSON.parse(await page.locator("body").innerText());
    expect(json.success).toBe(true);
    expect(["pass", "warning", "fail"]).toContain(json.overall_status);
    expect(Array.isArray(json.checks)).toBe(true);
    safeApiJson(json);
  });
});
