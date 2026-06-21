// Verifies the admin dashboard against the local stack (Node started with
// ADMIN_TOKEN): token gate, Wallets and Treasury panels load, a write action
// shows the confirmation dialog before firing, and no horizontal overflow at
// mobile and desktop. Run: node verify-admin.js
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const TOKEN = process.env.E2E_ADMIN_TOKEN || "e2e-admin-token-12345";

(async () => {
  const browser = await chromium.launch();
  for (const viewport of [
    { width: 375, height: 812, name: "mobile" },
    { width: 768, height: 1024, name: "tablet" },
    { width: 1280, height: 900, name: "desktop" },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });

    // Token gate (separate from wallet auth).
    await page.getByLabel(/admin token/i).fill(TOKEN);
    await page.getByRole("button", { name: /open operator dashboard/i }).click();
    await page.getByRole("heading", { name: /operator dashboard/i }).waitFor({ timeout: 15000 });

    // Wallets panel.
    await page.getByRole("button", { name: /^Wallets$/ }).click();
    await page.getByRole("heading", { name: /registered wallets/i }).waitFor({ timeout: 15000 });

    // Treasury panel.
    await page.getByRole("button", { name: /^Treasury$/ }).click();
    await page.getByText(/treasury balance/i).waitFor({ timeout: 15000 });

    // A write action must show the confirmation dialog before firing.
    await page.getByRole("button", { name: /^Indexes$/ }).click();
    await page.getByRole("button", { name: /rebuild indexes/i }).click();
    await page.getByRole("alertdialog", { name: /confirm action/i }).waitFor({ timeout: 8000 });
    await page.getByRole("button", { name: /^Cancel$/ }).click(); // do not actually fire

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 2) throw new Error(`admin horizontal overflow ${overflow}px at ${viewport.width}px`);

    // eslint-disable-next-line no-console
    console.log(`admin OK at ${viewport.name} (${viewport.width}px): token gate + wallets + treasury + confirm dialog, no overflow`);
    await context.close();
  }
  await browser.close();
})().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("ADMIN VERIFY FAILED:", error.message);
  process.exit(1);
});
