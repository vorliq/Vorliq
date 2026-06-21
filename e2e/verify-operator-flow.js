// Verifies the node operator onboarding flow in Settings against the local
// stack: an imported wallet registers a node, proves identity with the signed
// operator claim, and the flow's steps advance from remaining to done.
// Run: node verify-operator-flow.js
const { chromium } = require("playwright");
const { createWallet, importWalletViaUI, prepPage } = require("./tests/journeys/helpers");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await prepPage(page);

  const wallet = await createWallet();
  await importWalletViaUI(page, wallet.private_key, "e2e-operator-pass-1");

  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /run a node/i }).waitFor({ timeout: 15000 });

  const nodeUrl = `https://node-${Date.now()}.test.example`;
  await page.getByLabel(/your node url/i).fill(nodeUrl);
  await page.getByRole("button", { name: /detect status/i }).click();

  // Register step is current (node not found yet) -> register it.
  await page.getByLabel(/display name/i).fill("E2E community node");
  await page.getByRole("button", { name: /^register node$/i }).click();
  await page.getByText(/node registered/i).waitFor({ timeout: 15000 });

  // The register step should now be done.
  await page.getByText(/register your node in the network registry/i).waitFor();

  // Verify identity with the signed operator claim (scope to the operator field).
  await page.locator("#vn-op-pw").fill("e2e-operator-pass-1");
  await page.getByRole("button", { name: /^verify identity$/i }).click();
  await page.getByText(/operator identity verified/i).waitFor({ timeout: 20000 });

  // After verification, the verify step must show "Done".
  const verifyStepDone = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".vn-op-step"));
    const verify = items.find((el) => /verify your node identity/i.test(el.textContent || ""));
    return Boolean(verify && verify.classList.contains("is-done"));
  });
  if (!verifyStepDone) throw new Error("verify step did not reach done state");

  // No horizontal overflow at mobile.
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) throw new Error(`operator flow overflow ${overflow}px at 375px`);

  // eslint-disable-next-line no-console
  console.log("operator flow OK: register -> signed identity verify -> step done, no overflow at 375px");
  await browser.close();
})().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("OPERATOR FLOW VERIFY FAILED:", error.message);
  process.exit(1);
});
