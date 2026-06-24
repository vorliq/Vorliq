// One-off production health check for the items that need a real browser:
//   3. all nine authenticated pages load without errors at mobile width
//   6. the balance chart shows a real line for a wallet with transaction history
//   4. the notification bell increments when a block credits the wallet
// Run on demand (not part of the scheduled suite) with the pre-seeded prod wallet.
const { test, expect } = require("@playwright/test");
const { importWalletViaUI } = require("./journeys/helpers");
const { expectNoCrashText, disableMotion } = require("./helpers");

const PRIVATE_KEY = (process.env.E2E_PROD_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const PASSWORD = process.env.E2E_PROD_PASSWORD || "";

const PAGES = ["/dashboard", "/wallet", "/send", "/receive", "/mine", "/lending", "/governance", "/faucet", "/settings"];

test.describe("production health check", () => {
  test.skip(!PRIVATE_KEY || !PASSWORD, "Set E2E_PROD_PRIVATE_KEY and E2E_PROD_PASSWORD.");
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", navigationTimeout: 45_000 });

  test.beforeEach(async ({ page }) => {
    await disableMotion(page);
    await importWalletViaUI(page, PRIVATE_KEY, PASSWORD);
  });

  test("item 3: all nine authenticated pages load without errors at mobile width", async ({ page }) => {
    for (const route of PAGES) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main#main-content"), `${route} main content`).toBeVisible({ timeout: 20_000 });
      await expectNoCrashText(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} overflows by ${overflow}px at 390px`).toBeLessThanOrEqual(2);
      expect(errors, `${route} JS errors: ${errors.join("; ")}`).toHaveLength(0);
    }
  });

  test("item 6: balance chart renders a real line for a wallet with transaction history", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main#main-content")).toBeVisible({ timeout: 20_000 });
    // The balance LineChart draws the series as an SVG <path stroke=...> inside the
    // .vn-chart container. A real multi-point series produces a path with geometry.
    const line = page.locator(".vn-chart svg path[stroke]").first();
    await expect(line, "a chart line should be drawn from real balance history").toBeVisible({ timeout: 25_000 });
    const d = await line.evaluate((el) => el.getAttribute("d") || "");
    expect(d.length, "the chart line should have real geometry").toBeGreaterThan(10);
  });

  test("item 4: notification bell increments when a block credits the wallet", async ({ page }) => {
    // Needs a credit to the test wallet to land mid-test (fired out-of-band by the
    // runner), so it is opt-in: set E2E_HEALTH_CREDIT=1 only when you are also
    // sending VLQ to the wallet during the run. Skipped otherwise so the spec stays
    // safe to run unattended.
    test.skip(process.env.E2E_HEALTH_CREDIT !== "1", "Set E2E_HEALTH_CREDIT=1 and fire a credit to the wallet during the run.");
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const bell = page.getByRole("button", { name: /notifications/i }).first();
    await expect(bell, "the notification bell should be present").toBeVisible({ timeout: 20_000 });
    // Give the realtime socket time to connect before the credit lands.
    await page.waitForTimeout(8000);
    const before = await readBell(bell);
    // A credit to this wallet is fired externally (see the runner) ~15-20s after
    // launch; wait for the unread count to increase as the crediting block mines
    // and the wallet:credit event arrives over the socket.
    await expect
      .poll(async () => (await readBell(bell)) > before, { timeout: 180_000, intervals: [3000] })
      .toBe(true);
  });
});

async function readBell(bell) {
  const txt = (await bell.innerText().catch(() => "")) || "";
  const m = txt.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}
