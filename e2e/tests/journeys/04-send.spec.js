// Journey 4: a user sends VLQ to another address, waits for confirmation, and
// sees it confirmed with a block link.
const { test, expect } = require("./fixtures");
const { createWallet, fundWalletSpendable, importWalletViaUI, mineSome, assertNoHorizontalOverflow } = require("./helpers");

test("user sends VLQ, it confirms, and shows a block link", async ({ page }) => {
  const sender = await createWallet();
  const recipient = await createWallet();
  const balance = await fundWalletSpendable(sender.address);
  expect(balance, "sender should hold spendable VLQ from the faucet").toBeGreaterThan(0);

  await importWalletViaUI(page, sender.private_key, "e2e-send-pass-1");

  // Fill in and submit the send.
  await page.goto("/send", { waitUntil: "domcontentloaded" });
  await assertNoHorizontalOverflow(page, "send");
  await page.getByLabel(/recipient address/i).fill(recipient.address);
  await page.getByLabel(/amount in VLQ/i).fill("0.5");
  await page.getByLabel(/wallet password/i).fill("e2e-send-pass-1");
  await page.getByRole("button", { name: /send VLQ/i }).click();

  // The transaction is broadcast (a hash appears); then a miner includes it.
  await expect(
    page.getByText(/transaction hash/i),
    "the send should broadcast and show a transaction hash"
  ).toBeVisible({ timeout: 20_000 });
  await mineSome(3);

  // It confirms with a block link.
  await expect(
    page.getByText(/confirmed in block/i),
    "the transaction should confirm in a block after mining"
  ).toBeVisible({ timeout: 30_000 });
  const blockLink = page.locator("a.vn-block-link").first();
  await expect(blockLink, "a clickable block link should be shown for the confirmed tx").toBeVisible();
  await expect(blockLink).toHaveAttribute("href", /\/block\//);
  await assertNoHorizontalOverflow(page, "send confirmed");
});
