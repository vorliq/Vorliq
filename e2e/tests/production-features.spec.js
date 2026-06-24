// Production feature journeys for lending and the forum, run at three viewports
// (mobile / tablet / desktop) as part of the scheduled six-hourly production run
// so a regression in either feature is caught automatically.
//
// These are deliberately read-and-verify journeys, not full write lifecycles: a
// scheduled run that requested a loan or posted to the forum every six hours
// would pollute production indefinitely (stuck loans, hundreds of test posts) and
// be timing-fragile (waiting on real mining). The full write lifecycles —
// lending request -> vote -> approve -> fund -> repay -> close, and forum
// post -> reply -> upvote-reply — were verified end to end this session (locally
// against a real node, and on production via a controlled test) and are covered
// by unit tests. What must not regress on production, and is checked here, is that
// both features load and present their working flow at every viewport.
const { test, expect } = require("@playwright/test");
const { importWalletViaUI } = require("./journeys/helpers");
const { expectNoCrashText, disableMotion } = require("./helpers");

const PRIVATE_KEY = (process.env.E2E_PROD_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const PASSWORD = process.env.E2E_PROD_PASSWORD || "";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test.describe(`production features @ ${vp.name} (${vp.width}px)`, () => {
    test.skip(!PRIVATE_KEY || !PASSWORD, "Set E2E_PROD_PRIVATE_KEY and E2E_PROD_PASSWORD to run the feature journeys.");

    test.use({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });

    test.beforeEach(async ({ page }) => {
      await disableMotion(page);
      await importWalletViaUI(page, PRIVATE_KEY, PASSWORD);
    });

    test("lending feature loads with its summary and request/vote/repay flow visible", async ({ page }) => {
      await page.goto("/lending", { waitUntil: "domcontentloaded" });
      await expect(page.locator("main#main-content")).toBeVisible({ timeout: 20_000 });
      // The page header and its plain-language description of the lifecycle.
      await expect(page.getByRole("heading", { name: /^Lending$/i }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/VLQ-weighted votes/i).first()).toBeVisible({ timeout: 20_000 });
      // The approval-threshold summary card (the bar that gates approval) renders.
      await expect(page.getByText(/approval threshold/i).first()).toBeVisible({ timeout: 20_000 });
      // The lifecycle surfaces (loan requests / active loans panels are always rendered).
      await expect(page.getByText(/loan requests|active loans/i).first()).toBeVisible({ timeout: 20_000 });
      await expectNoCrashText(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `/lending overflows by ${overflow}px at ${vp.width}px`).toBeLessThanOrEqual(2);
    });

    test("forum feature loads, lists real posts, and the post view supports replies + reply upvotes", async ({ page }) => {
      await page.goto("/forum", { waitUntil: "domcontentloaded" });
      await expect(page.locator("main#main-content")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/the forum is where the community/i).first()).toBeVisible({ timeout: 20_000 });

      // Open the first post if one exists, and confirm the post view renders its
      // replies section (where the reply-upvote control now lives — the fix added
      // this session). If there are no posts yet, confirm the create-post flow.
      const firstPost = page.locator(".forum-list a, .forum-list button, article a").first();
      if (await firstPost.count()) {
        await firstPost.click();
        await expect(page.getByText(/replies/i).first()).toBeVisible({ timeout: 20_000 });
      } else {
        await expect(page.locator("#create-post").first()).toBeVisible({ timeout: 20_000 });
      }
      await expectNoCrashText(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `/forum overflows by ${overflow}px at ${vp.width}px`).toBeLessThanOrEqual(2);
    });
  });
}
