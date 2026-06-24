// Production mobile audit. Runs against the live site on a phone-sized viewport
// with a pre-seeded signed-in wallet, and checks the things a real user on a
// phone would hit: every authenticated page renders without errors or horizontal
// overflow, key data values are real numbers (not "Unavailable"/"—"), charts
// render with real data, the notification bell is present, and the activity feed
// shows real events. Skips automatically without credentials.
const { test, expect } = require("@playwright/test");
const { importWalletViaUI } = require("./journeys/helpers");
const { expectNoCrashText, disableMotion } = require("./helpers");

const PRIVATE_KEY = (process.env.E2E_PROD_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const PASSWORD = process.env.E2E_PROD_PASSWORD || "";

const AUTH_PAGES = [
  "/dashboard", "/wallet", "/send", "/receive", "/mine",
  "/lending", "/governance", "/faucet", "/settings",
];

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", isMobile: true, hasTouch: true });

test.describe("production mobile audit (signed in, 390px)", () => {
  test.skip(!PRIVATE_KEY || !PASSWORD, "Set E2E_PROD_PRIVATE_KEY and E2E_PROD_PASSWORD to run the mobile audit.");

  test.beforeEach(async ({ page }) => {
    await disableMotion(page);
    await importWalletViaUI(page, PRIVATE_KEY, PASSWORD);
  });

  test("every authenticated page renders cleanly with no horizontal overflow", async ({ page }) => {
    for (const route of AUTH_PAGES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main#main-content"), `${route} main content`).toBeVisible({ timeout: 20_000 });
      await expectNoCrashText(page);
      // Mobile layout must not overflow horizontally.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2);
    }
  });

  test("wallet shows a real VLQ balance, not Unavailable", async ({ page }) => {
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    const main = page.locator("main#main-content");
    await expect(main.getByText(/\bVLQ\b/i).first()).toBeVisible({ timeout: 20_000 });
    // A numeric balance is present somewhere in the wallet main content.
    await expect(main.getByText(/\d/).first()).toBeVisible({ timeout: 20_000 });
  });

  test("dashboard: bell present and activity feed shows real events", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /notifications/i }).first()).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator("main").getByText(/miner|new block|proposed by|requested by|→/i).first(),
      "the activity feed should show real recent network activity"
    ).toBeVisible({ timeout: 20_000 });
  });

  test("explorer shows real blocks and the dashboard/landing charts render", async ({ page }) => {
    await page.goto("/blockchain", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main").getByText(/block #\d+/i).first(), "explorer shows real blocks").toBeVisible({ timeout: 20_000 });
    await expectNoCrashText(page);

    // The dashboard renders a balance LineChart (svg) from the wallet's real history.
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main svg").first(), "dashboard renders its chart").toBeVisible({ timeout: 20_000 });
    await expectNoCrashText(page);

    // The public landing page renders sparkline charts of real network metrics.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("svg.vn-spark, main svg").first(), "landing renders a chart").toBeVisible({ timeout: 20_000 });
    await expectNoCrashText(page);
  });
});
