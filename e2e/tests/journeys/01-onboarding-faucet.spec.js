// Journey 1: a new user visits the landing page, navigates to sign up, creates a
// wallet, lands in the app, claims from the faucet, and sees a real balance on
// the dashboard. Runs at mobile / tablet / desktop via the config projects.
const { test, expect } = require("./fixtures");
const { assertNoHorizontalOverflow } = require("./helpers");

test("new user: landing -> sign up -> create wallet -> faucet -> dashboard balance", async ({ page }) => {
  // 1. Landing page.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page, "landing page should load with the Vorliq brand").toHaveTitle(/Vorliq/i);
  await assertNoHorizontalOverflow(page, "landing");

  // 2. Navigate to sign up (the page is reachable from the app; go directly to be
  //    robust across viewports where the nav is behind a drawer).
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /create your vorliq account/i })).toBeVisible();
  await assertNoHorizontalOverflow(page, "register");

  // 3. Create the wallet. Both consent checkboxes (key-safety + terms) must be
  //    ticked before the submit button enables.
  await page.getByLabel(/private key cannot be recovered/i).check();
  await page.getByLabel(/terms of service/i).check();
  await page.getByLabel(/^password$/i).fill("e2e-strong-pass-1");
  await page.getByLabel(/confirm password/i).fill("e2e-strong-pass-1");
  await page.getByRole("button", { name: /create account/i }).click();

  // 4. Lands in the authenticated app (account page).
  await page.waitForURL(/\/account/, { timeout: 20_000 });
  await assertNoHorizontalOverflow(page, "account");

  // 5. Claim from the faucet.
  await page.goto("/faucet", { waitUntil: "domcontentloaded" });
  const claimButton = page.getByRole("button", { name: /claim .* VLQ/i });
  await expect(claimButton, "faucet claim button should be available to a signed-in user").toBeVisible();
  await claimButton.click();
  await expect(
    page.getByText(/starter VLQ claim submitted/i),
    "faucet should confirm the claim was submitted"
  ).toBeVisible({ timeout: 20_000 });
  await assertNoHorizontalOverflow(page, "faucet");

  // 6. Dashboard shows a real (pending-inclusive) balance, not a placeholder.
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })).toBeVisible();
  // The faucet starter is 1 VLQ; it is pending-inclusive so it shows immediately.
  await expect(
    page.getByText(/\b1(\.0+)?\s*VLQ\b/i).first(),
    "dashboard should reflect the claimed faucet balance"
  ).toBeVisible({ timeout: 20_000 });
  await assertNoHorizontalOverflow(page, "dashboard");
});
