// Journey 7: a signed-in user opens the More drawer (on mobile), uses Disconnect,
// and lands on the landing page with no authenticated content visible. Adapts to
// each viewport: mobile/tablet use the tab-bar "More" drawer; desktop uses the
// sidebar Disconnect directly.
const { test, expect } = require("./fixtures");
const { createWallet, importWalletViaUI, assertNoHorizontalOverflow } = require("./helpers");

test("signed-in user disconnects via More drawer / sidebar and returns to landing", async ({ page }) => {
  // Disconnect needs only a signed-in session, not a balance — import a fresh
  // wallet (no chain record) via the "sign in anyway" path to keep the run light.
  const wallet = await createWallet();
  await importWalletViaUI(page, wallet.private_key, "e2e-disconnect-pass-1");

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await assertNoHorizontalOverflow(page, "dashboard (signed in)");

  // On the mobile tab bar the Disconnect control lives behind the More drawer;
  // on the tablet rail and desktop sidebar it is directly in the side nav. Retry
  // the open-and-find so a not-yet-painted tab bar can't race the lookup.
  const moreTab = page.getByRole("button", { name: /^more$/i });
  const disconnect = page.getByRole("button", { name: /disconnect/i }).filter({ visible: true });
  await expect(async () => {
    if (await moreTab.isVisible().catch(() => false)) {
      await moreTab.click();
    }
    expect(await disconnect.count(), "a Disconnect control should be reachable at this viewport").toBe(1);
  }).toPass({ timeout: 20_000 });
  await assertNoHorizontalOverflow(page, "disconnect control reachable");
  await disconnect.click();

  // Lands on the landing page.
  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
  await assertNoHorizontalOverflow(page, "landing (signed out)");

  // No authenticated content remains: no visible Disconnect, and a sign-in entry
  // point is offered instead.
  await expect(
    page.getByRole("button", { name: /disconnect/i }).filter({ visible: true }),
    "no Disconnect control should remain after signing out"
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /sign in|get started|create/i }).first()).toBeVisible();
});
