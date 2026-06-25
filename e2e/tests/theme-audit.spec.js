// Empirical light/dark theme audit: for each page at each theme, scan every
// element that renders its own text and flag any whose text-vs-background WCAG
// contrast is below 3.0 (severe — effectively invisible / unreadable). Reports
// offenders so they can be fixed; not a pass/fail gate (some third-party or
// decorative nodes may surface), it is a finder.
const { test } = require("@playwright/test");
const { importWalletViaUI } = require("./journeys/helpers");
const { disableMotion } = require("./helpers");

const PRIVATE_KEY = (process.env.E2E_PROD_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const PASSWORD = process.env.E2E_PROD_PASSWORD || "";

const PAGES = [
  "/", "/dashboard", "/wallet", "/send", "/receive", "/mine", "/lending",
  "/governance", "/forum", "/leaderboard", "/economics", "/faucet", "/settings",
  "/community", "/blockchain", "/community-treasury", "/vlq",
];

const SCAN = () => {
  function rgb(str) {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); }
  function effBg(el) { let n = el; while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; }
  const out = [];
  for (const el of document.querySelectorAll("main *, header *, footer *, nav *")) {
    let txt = "";
    for (const node of el.childNodes) if (node.nodeType === 3) txt += node.textContent;
    txt = txt.trim();
    if (txt.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.1) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const fg = rgb(cs.color);
    if (!fg || fg.a < 0.3) continue;
    const bg = effBg(el);
    const cr = ratio(fg, bg);
    if (cr < 3.0) {
      out.push({ cr: Math.round(cr * 100) / 100, cls: String(el.className || "").slice(0, 45), text: txt.slice(0, 32), fg: cs.color, bg: `rgb(${bg.r},${bg.g},${bg.b})` });
    }
  }
  const seen = new Set();
  return out.filter((o) => { const k = o.cls + "|" + o.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25);
};

test.describe("theme contrast audit", () => {
  test.skip(!PRIVATE_KEY || !PASSWORD, "needs prod creds");
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const theme of ["light", "dark"]) {
    test(`audit ${theme}`, async ({ page }) => {
      test.setTimeout(300_000);
      await disableMotion(page);
      // Set the persisted theme before any document loads, so EVERY full
      // navigation (page.goto) mounts the app in the right theme.
      await page.addInitScript((t) => window.localStorage.setItem("vorliq_theme", t), theme);
      try {
        await importWalletViaUI(page, PRIVATE_KEY, PASSWORD);
      } catch {
        console.log(`(login failed; auditing public surface only for ${theme})`);
      }
      for (const route of PAGES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await page.waitForFunction((t) => document.documentElement.getAttribute("data-theme") === t, theme, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const offenders = await page.evaluate(SCAN);
        if (offenders.length) {
          console.log(`\n### ${theme} ${route} — ${offenders.length} low-contrast:`);
          for (const o of offenders) console.log(`  ${o.cr}  "${o.text}"  fg=${o.fg} bg=${o.bg} cls=${o.cls}`);
        }
      }
    });
  }
});
