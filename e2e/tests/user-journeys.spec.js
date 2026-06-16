const { expect, test } = require("@playwright/test");
const {
  disableMotion,
  expectMainContent,
  expectNoCrashText,
  expectNoHorizontalOverflow,
  prepareReadOnlyPage,
  safeGoto,
} = require("./helpers");

test.describe("read-only user journeys", () => {
  test("landing hero renders the brand headline without a blocking modal", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await disableMotion(page);
    await safeGoto(page, "/");

    await expectMainContent(page, /Your Community's Bank/i);
    await expect(page.getByRole("dialog", { name: /welcome to vorliq/i })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("theme toggle switches between readable theme states", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const toggle = page.getByRole("button", { name: /switch to light mode/i }).first();
    await toggle.evaluate((button) => button.click());
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: /switch to dark mode/i }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("login page exposes create/import wallet flow without submitting", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/login");

    await expectMainContent(page, /Create Your Vorliq Wallet|Welcome Back|Import Wallet Backup/i);
    await expectNoCrashText(page);
  });

  test("wallet page renders address/balance or a sign-in prompt", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/wallet");

    await expectMainContent(page, /Wallet/i);
    // Read-only (logged out) shows the sign-in prompt; logged in shows address/balance.
    await expect(page.locator("main#main-content")).toContainText(/sign in|address|balance/i);
    await expectNoHorizontalOverflow(page);
  });

  test("faucet loads funded or empty state without claiming", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/faucet");

    await expectMainContent(page, /Faucet|Starter VLQ/i);
    await expect(page.locator("main#main-content")).toContainText(/treasury|cooldown|claim|starter/i);
    await expectNoCrashText(page);
  });

  test("mine page shows status and reward/cooldown language without mining", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/mine");

    await expectMainContent(page, /Mining/i);
    await expect(page.locator("main#main-content")).toContainText(/difficulty|reward|mining history|node/i);
  });

  test("invalid transaction and block details fail gracefully", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/tx/not-a-real-e2e-transaction");
    await expectMainContent(page, /Transaction/i);
    await expectNoCrashText(page);

    await safeGoto(page, "/block/not-a-real-e2e-block");
    await expectMainContent(page, /Block/i);
    await expectNoCrashText(page);
  });

  test("forum search/filter controls do not crash", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/forum");

    await expectMainContent(page, /Forum/i);
    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    if (await search.count()) {
      await search.fill("mining");
      await search.press("Enter").catch(() => {});
    }
    await expectNoCrashText(page);
  });

  test("registry shows public node summary", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/registry");

    await expectMainContent(page, /Registry/i);
    await expect(page.locator("main")).toContainText(/Vorliq Public Node|Active Nodes|synced|reliability/i);
  });

  test("health page shows operational sections", async ({ page }) => {
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/health");

    await expectMainContent(page, /Health/i);
    await expect(page.locator("main")).toContainText(/Mining|Registry|Incident|Backup/i);
  });
});
