const { test, expect } = require("@playwright/test");
const { expectNoCrashText, prepareReadOnlyPage, safeGoto } = require("./helpers");

test("moderation docs load and public report buttons are reachable without submitting", async ({ page }) => {
  await prepareReadOnlyPage(page);
  await safeGoto(page, "/profile");
  await expect(page.getByRole("heading", { name: /profiles/i })).toBeVisible();
  await expect(page.locator("main")).toContainText(/Wallet Verified|Unverified Wallet|profiles/i);
  await expectNoCrashText(page);

  await safeGoto(page, "/forum");
  await expect(page.getByRole("heading", { name: /forum/i })).toBeVisible();
  const reportButton = page.getByRole("button", { name: /^report$/i }).first();
  if (await reportButton.count()) {
    await reportButton.click();
    await expect(page.getByRole("form", { name: /report content/i })).toBeVisible();
  }

  await safeGoto(page, "/docs/moderation.html");
  await expect(page.getByRole("heading", { name: /community identity and moderation/i })).toBeVisible();
  await expect(page.locator("body")).toContainText(/without KYC|does not require KYC/i);
});
