// Verifies the production build's PWA wiring against the local static server:
// the manifest is linked and fetchable, and the service worker registers and
// activates without console errors. Run: node verify-pwa.js
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(BASE, { waitUntil: "load" });

  // Manifest link present and fetchable.
  const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
  if (!manifestHref) throw new Error("manifest <link> missing");
  const manifestResp = await page.request.get(new URL(manifestHref, BASE).toString());
  if (manifestResp.status() !== 200) throw new Error(`manifest fetch ${manifestResp.status()}`);
  const manifest = await manifestResp.json();
  const has192 = manifest.icons.some((i) => i.sizes === "192x192");
  const has512 = manifest.icons.some((i) => i.sizes === "512x512");
  if (!has192 || !has512) throw new Error("manifest missing 192/512 icons");
  if (manifest.theme_color !== "#00A896") throw new Error(`theme_color ${manifest.theme_color}`);

  // Service worker registers and activates.
  const active = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg.active);
  });
  if (!active) throw new Error("service worker did not activate");

  const swErrors = errors.filter((e) => /service worker|sw\.js|serviceworker/i.test(e));
  if (swErrors.length) throw new Error(`SW console errors: ${swErrors.join("; ")}`);

  // eslint-disable-next-line no-console
  console.log(`PWA OK: manifest linked (192+512, theme ${manifest.theme_color}), service worker active, ${errors.length} console error(s).`);
  if (errors.length) {
    // eslint-disable-next-line no-console
    console.log("non-SW console errors:", errors.slice(0, 5));
  }
  await browser.close();
})().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("PWA VERIFY FAILED:", error.message);
  process.exit(1);
});
