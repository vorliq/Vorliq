const { test, expect } = require("@playwright/test");
const { expectMainContent, expectNoCrashText, prepareReadOnlyPage, safeGoto } = require("./helpers");

// The redesigned Send page signs locally with the unlocked saved wallet and never
// accepts a pasted private key. Read-only (logged out) it shows a sign-in prompt;
// this verifies the page renders safely without submitting a transaction.
test("send page renders the local-signing flow without submitting a transaction", async ({ page }) => {
  await prepareReadOnlyPage(page);
  await safeGoto(page, "/send");

  await expectMainContent(page, /Send VLQ/i);
  await expect(page.locator("main#main-content")).toContainText(/sign in|signed locally/i);
  // The new flow never collects a raw private key.
  await expect(page.getByLabel(/private key/i)).toHaveCount(0);
  await expectNoCrashText(page);
});
