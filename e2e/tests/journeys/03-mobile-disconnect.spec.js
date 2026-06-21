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
  // on the tablet rail and desktop sidebar it is directly in the side nav.
  const moreTab = page.getByRole("button", { name: /^more$/i });
  if ((await moreTab.count()) > 0) {
    await moreTab.click();
    await expect(page.getByRole("dialog", { name: /more navigation/i })).toBeVisible();
    await assertNoHorizontalOverflow(page, "more drawer");
  }

  const disconnect = page.getByRole("button", { name: /disconnect/i }).filter({ visible: true });
  await expect(disconnect, "a Disconnect control should be reachable at this viewport").toHaveCount(1);
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
