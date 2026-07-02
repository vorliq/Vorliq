// Journey 4: a user sends VLQ to another address, it confirms with a block link,
// and the recipient is notified in real time (the bell count becomes nonzero).
const { test, expect } = require("./fixtures");
const {
  api,
  createWallet,
  fundWalletSpendable,
  importWalletViaUI,
  prepPage,
  mineSome,
  assertNoHorizontalOverflow,
} = require("./helpers");

test("user sends VLQ, it confirms with a block link, and the recipient is notified", async ({ page, browser }) => {
  const sender = await createWallet();
  const recipient = await createWallet();
  const balance = await fundWalletSpendable(sender.address);
  expect(balance, "sender should hold spendable VLQ from the faucet").toBeGreaterThan(0);

  // Sender: sign in and fill the send form.
  await importWalletViaUI(page, sender.private_key, "e2e-send-pass-1");
  await page.goto("/send", { waitUntil: "domcontentloaded" });
  await assertNoHorizontalOverflow(page, "send");
  await page.getByLabel(/recipient address/i).fill(recipient.address);
  await page.getByLabel(/amount in VLQ/i).fill("0.5");

  // Wallet flow 4 (reject): Vorliq's wallet is browser-native, so "rejecting in
  // the wallet" is refusing to authorize the local signing. A wrong wallet
  // password must fail decryption, show an error, and broadcast NOTHING.
  await page.getByLabel(/wallet password/i).fill("not-the-right-password");
  await page.getByRole("button", { name: /send VLQ/i }).click();
  await expect(
    page.locator('[role="alert"]').first(),
    "a refused signing must surface an error to the user"
  ).toBeVisible({ timeout: 20_000 });
  const { data: mempoolAfterReject } = await api(
    `/transactions/pending?address=${encodeURIComponent(sender.address)}`
  );
  expect(
    (mempoolAfterReject.transactions || []).length,
    "a refused signing must not broadcast anything"
  ).toBe(0);

  // Wallet flow 3 (send): authorize with the correct password; the key is
  // decrypted locally to sign and the transaction broadcasts.
  await page.getByLabel(/wallet password/i).fill("e2e-send-pass-1");
  await page.getByRole("button", { name: /send VLQ/i }).click();
  await expect(
    page.getByText(/transaction hash/i),
    "the send should broadcast and show a transaction hash"
  ).toBeVisible({ timeout: 20_000 });

  // Recipient: a separate signed-in browser context, watching the bell.
  const recipientContext = await browser.newContext({ viewport: page.viewportSize() });
  const recipientPage = await recipientContext.newPage();
  await prepPage(recipientPage);
  await importWalletViaUI(recipientPage, recipient.private_key, "e2e-recv-pass-1");
  await recipientPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await recipientPage.waitForTimeout(1500); // let the realtime socket connect

  // Mine: this confirms the send (sender side) and fires wallet:credit for the
  // recipient over the socket.
  await mineSome(3);

  // Sender sees the transaction confirmed with a block link.
  await expect(
    page.getByText(/confirmed in block/i),
    "the transaction should confirm in a block after mining"
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("a.vn-block-link").first()).toHaveAttribute("href", /\/block\//);

  // Recipient's notification bell shows a nonzero count without a page reload.
  await expect(
    recipientPage.getByTestId("bell-badge"),
    "the recipient's bell should show a nonzero count after receiving VLQ"
  ).toBeVisible({ timeout: 20_000 });
  await expect(recipientPage.getByTestId("bell-badge")).not.toHaveText("0");
  await assertNoHorizontalOverflow(recipientPage, "recipient dashboard (bell)");
  await recipientContext.close();

  // The sender now has both a received (faucet) and a sent transaction. On the
  // Wallet page, filtering to "Sent" must show only outgoing rows.
  await page.goto("/wallet", { waitUntil: "domcontentloaded" });
  const history = page.locator(".vn-card", { has: page.getByRole("tab", { name: /^sent$/i }) });
  await expect(history.locator(".vn-tx-type").first()).toBeVisible({ timeout: 20_000 });
  await history.getByRole("tab", { name: /^sent$/i }).click();
  await expect(history.locator(".vn-tx-type--out").first(), "a sent row should remain after filtering").toBeVisible();
  await expect(history.locator(".vn-tx-type--in"), "no received rows should show under the Sent filter").toHaveCount(0);
  await assertNoHorizontalOverflow(page, "wallet sent filter");
});
