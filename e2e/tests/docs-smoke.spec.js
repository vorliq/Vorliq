const { expect, test } = require("@playwright/test");
const { expectNoCrashText, expectNoHorizontalOverflow, safeGoto } = require("./helpers");

test("node lifecycle docs page loads", async ({ page }) => {
  await safeGoto(page, "/docs/node-lifecycle.html");
  await expect(page.locator("body")).toContainText(/Node lifecycle and archival/i);
  await expect(page.locator("body")).toContainText(/Do not manually edit registry\.json/i);
  await expectNoCrashText(page);
  await expectNoHorizontalOverflow(page);
});

test("peer propagation docs page loads", async ({ page }) => {
  await safeGoto(page, "/docs/peer-propagation.html");
  await expect(page.locator("body")).toContainText(/Peer propagation/i);
  await expect(page.locator("body")).toContainText(/Do not manually edit chain\.json/i);
  await expectNoCrashText(page);
  await expectNoHorizontalOverflow(page);
});
