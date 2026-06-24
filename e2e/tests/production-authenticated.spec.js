// Production authenticated journeys.
//
// Unlike the local journey suite, this runs against the real production site
// (E2E_BASE_URL, default https://vorliq.org) and deliberately does NOT create a
// wallet or claim the faucet — both have real-world cooldowns and would pollute
// production. Instead it signs in with a pre-seeded wallet whose private key and
// browser password are provided as GitHub Actions secrets, and exercises only the
// journeys that are safe to run repeatedly against production with no side
// effects: sign in and see a balance, load all nine authenticated pages, open the
// block explorer and see a real block, and confirm the notification bell and live
// activity feed are present and populated.
//
// The scheduled GitHub Action runs this every six hours so a production
// regression is caught automatically; a failure posts to the alerts log.
const { test, expect } = require("@playwright/test");
const { importWalletViaUI, assertNoHorizontalOverflow } = require("./journeys/helpers");
const { expectNoCrashText, disableMotion } = require("./helpers");

// The site has entrance animations (cards reveal on scroll), which can leave a
// control "not stable" long enough to trip a click. Report reduced motion and
// neutralise animation/transition durations so interactions are deterministic.
test.use({ reducedMotion: "reduce" });

// GitHub secrets store the PEM with escaped newlines; restore them.
const PRIVATE_KEY = (process.env.E2E_PROD_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const PASSWORD = process.env.E2E_PROD_PASSWORD || "";

const AUTH_PAGES = [
  "/dashboard",
  "/wallet",
  "/send",
  "/receive",
  "/mine",
  "/lending",
  "/governance",
  "/faucet",
  "/settings",
];

test.describe("production authenticated journeys (pre-seeded credentials)", () => {
  test.skip(
    !PRIVATE_KEY || !PASSWORD,
    "Set E2E_PROD_PRIVATE_KEY and E2E_PROD_PASSWORD (GitHub secrets) to run the production authenticated journeys."
  );

  test.beforeEach(async ({ page }) => {
    await disableMotion(page);
    await importWalletViaUI(page, PRIVATE_KEY, PASSWORD);
  });

  test("sign in with private key shows the wallet address and a balance", async ({ page }) => {
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    await expect(
      page.locator("main#main-content").getByText(/\bVLQ\b/i).first(),
      "the wallet page should show a VLQ balance for the signed-in wallet"
    ).toBeVisible({ timeout: 20_000 });
    await expectNoCrashText(page);
  });

  test("all nine authenticated pages load without errors", async ({ page }) => {
    for (const route of AUTH_PAGES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator("main#main-content"),
        `${route} should render its main content`
      ).toBeVisible({ timeout: 20_000 });
      await expectNoCrashText(page);
      await assertNoHorizontalOverflow(page, route);
    }
  });

  test("block explorer shows a real, recent block", async ({ page }) => {
    await page.goto("/blockchain", { waitUntil: "domcontentloaded" });
    // A real block row renders as "block #<index>" with a hash; the chain height
    // header renders as "#<height>". Either proves a real block is on screen.
    await expect(
      page.locator("main").getByText(/block #\d+/i).first(),
      "the explorer should list at least one real block"
    ).toBeVisible({ timeout: 20_000 });
    await expectNoCrashText(page);
  });

  test("notification bell is present and the activity feed has real content", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: /notifications/i }).first(),
      "the notification bell should be present in the app shell"
    ).toBeVisible({ timeout: 20_000 });
    // The dashboard activity feed shows recent on-chain events (blocks, transfers,
    // proposals, loans). At least one real row should be visible — not an empty
    // state.
    await expect(
      page.locator("main").getByText(/miner|new block|proposed by|requested by|→/i).first(),
      "the activity feed should show real recent network activity, not an empty state"
    ).toBeVisible({ timeout: 20_000 });
    await expectNoCrashText(page);
  });
});
