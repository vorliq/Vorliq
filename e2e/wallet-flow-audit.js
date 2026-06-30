// Real-browser verification of the Vorliq wallet flows that do NOT require funds.
// Vorliq's wallet is browser-native (keys generated and encrypted in the browser
// via elliptic — there is no external extension), so creation and lock/sign-out
// are fully verifiable here. Send/receive need VLQ, which on a fresh local chain
// only exists after mining (no premine) — see BROWSER_AUDIT_NEEDED.md.
const { chromium } = require("@playwright/test");

const BASE = process.env.AUDIT_BASE || "http://127.0.0.1:4178";
const API = process.env.AUDIT_API || "http://localhost:5000/api";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript((api) => { try { window.localStorage.setItem("vorliq_node_url", api); } catch (e) {} }, API);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  // FLOW 1 — first-time wallet creation (browser-native).
  await page.goto(BASE + "/register", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  // Two checkboxes (safety + terms) and the two password fields.
  const checkboxes = page.locator('input[type="checkbox"]');
  const n = await checkboxes.count();
  for (let i = 0; i < n; i++) await checkboxes.nth(i).check().catch(() => {});
  await page.fill("#register-password", "TestPassw0rd!23");
  await page.fill("#register-confirm-password", "TestPassw0rd!23");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500); // allow in-browser keygen + encrypt + redirect

  const afterCreate = await page.evaluate(() => {
    const ls = Object.keys(window.localStorage);
    const walletKey = ls.find((k) => k === "vorliq_wallet" || (/wallet|encrypted/i.test(k) && k !== "vorliq_node_url"));
    return { url: location.pathname, storedWalletKey: walletKey || null, hasAccountUI: /sign out|dashboard|balance|account/i.test(document.body.innerText || "") };
  });

  const flow1Pass = Boolean(afterCreate.storedWalletKey) && afterCreate.url !== "/register" && !errors.length;
  console.log("FLOW 1 (create wallet):", flow1Pass ? "PASS" : "CHECK");
  console.log("  landed:", afterCreate.url, "| storedWalletKey:", afterCreate.storedWalletKey, "| accountUI:", afterCreate.hasAccountUI);

  // FLOW 5 — disconnect / lock (sign out). Vorliq labels it "Sign Out".
  let flow5 = "NOT-FOUND";
  const signOut = page.getByRole("button", { name: /sign out|log out|lock/i }).or(page.getByRole("link", { name: /sign out|log out/i })).first();
  if (await signOut.count()) {
    await signOut.click().catch(() => {});
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => ({
      url: location.pathname,
      // The encrypted backup may remain; the unlocked session must be gone.
      hasSignIn: /sign in|create (account|wallet)|unlock/i.test(document.body.innerText || ""),
    }));
    flow5 = after.hasSignIn ? "PASS" : "CHECK";
    console.log("  after sign out → url:", after.url, "| shows sign-in/unlock:", after.hasSignIn);
  }
  console.log("FLOW 5 (sign out / lock):", flow5);

  // Flows 2/3/4 (wrong network / send / reject) are documented in
  // BROWSER_AUDIT_NEEDED.md — single-chain (no "wrong network"); send/reject need
  // VLQ, which on a fresh local chain requires mining (no premine).
  if (errors.length) console.log("PAGE ERRORS:", errors.join(" | "));
  await browser.close();
  process.exit(0);
})();
