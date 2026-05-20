const { test, expect } = require("@playwright/test");
const { expectNoCrashText, prepareReadOnlyPage, safeGoto } = require("./helpers");

test("send page review UI is reachable without submitting a transaction", async ({ page }) => {
  await prepareReadOnlyPage(page);
  await safeGoto(page, "/send");

  await page.getByLabel(/sender address/i).fill("3MNQE1X7T4Bz9kLmNpQrStUvWx");
  await page.getByLabel(/sender private key/i).fill("DO_NOT_SUBMIT_E2E_PRIVATE_KEY");
  await page.getByLabel(/sender public key/i).fill("E2E_PUBLIC_KEY");
  await page.getByLabel(/receiver address/i).fill("7YWHMfk9JZe9LMQaPq2X3B4C5D");
  await page.getByLabel(/amount of vlq/i).fill("0.000001");
  await page.getByRole("button", { name: /review transaction/i }).click();

  await expect(page.getByRole("heading", { name: /review transaction/i })).toBeVisible();
  await expect(page.getByText(/transactions cannot be reversed/i)).toBeVisible();
  await expect(page.getByText(/pending until mined/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /confirm and send/i })).toBeVisible();
  await expectNoCrashText(page);
});
