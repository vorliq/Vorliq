// Journey 2: an existing user signs in by importing a private key and sees their
// real address and balance loaded.
const { test, expect } = require("./fixtures");
const { createWallet, fundWalletSpendable, getBalance, importWalletViaUI, assertNoHorizontalOverflow } = require("./helpers");

test("existing user imports a wallet by private key and sees address + balance", async ({ page }) => {
  // Arrange: a wallet that already exists on-chain with a real spendable balance.
  const wallet = await createWallet();
  await fundWalletSpendable(wallet.address);
  const balance = await getBalance(wallet.address);
  expect(balance, "the wallet should hold a balance before import").toBeGreaterThan(0);

  // Act: import it through the real private-key tab on the sign-in page.
  await importWalletViaUI(page, wallet.private_key, "e2e-import-pass-1");
  await assertNoHorizontalOverflow(page, "post-import");

  // Assert: the account page shows the imported address.
  await page.goto("/account", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText(wallet.address, { exact: false }),
    "the imported wallet address should be displayed on the account page"
  ).toBeVisible({ timeout: 20_000 });
  await assertNoHorizontalOverflow(page, "account");

  // Assert: the wallet page loads a real balance for the imported wallet (scoped
  // to the visible main content, since the sidebar balance is hidden on mobile).
  await page.goto("/wallet", { waitUntil: "domcontentloaded" });
  await expect(
    page.locator("main#main-content").getByText(/\bVLQ\b/i).first(),
    "the wallet page should load a balance for the imported wallet"
  ).toBeVisible({ timeout: 20_000 });
  await assertNoHorizontalOverflow(page, "wallet");
});
