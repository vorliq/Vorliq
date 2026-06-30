// Real-browser accessibility + responsive audit driven by Playwright/Chromium
// against the served production build talking to a local backend. Checks, per
// route: horizontal overflow at five viewport widths, touch-target sizes at
// mobile widths, and keyboard focus visibility. Failures are screenshotted.
//
// Usage (full stack must be up — node:5001, backend:5000, SPA build served):
//   E2E_STATIC_PORT=4178 node static-server.js &
//   AUDIT_BASE=http://127.0.0.1:4178 AUDIT_API=http://localhost:5000/api \
//     node browser-audit.js
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const BASE = process.env.AUDIT_BASE || "http://127.0.0.1:4178";
const API = process.env.AUDIT_API || "http://localhost:5000/api";
const OUT = process.env.AUDIT_OUT || path.join(__dirname, "audit-results");
const WIDTHS = [320, 375, 768, 1024, 1440];

// Public + app routes. Parameterized routes use a representative value.
const ROUTES = [
  "/", "/features", "/blockchain", "/economics", "/leaderboard", "/governance",
  "/treasury", "/community-treasury", "/lending", "/exchange", "/forum", "/chat",
  "/faucet", "/mine", "/network", "/network-health", "/nodes/compare", "/registry",
  "/peers/propagation", "/price", "/vlq", "/stats", "/status", "/health",
  "/readiness", "/snapshot", "/snapshot-archive", "/audit", "/bootstrap",
  "/migration-readiness", "/transparency", "/roadmap", "/releases", "/whitepaper",
  "/privacy", "/terms", "/login", "/register", "/dashboard", "/account", "/wallet",
  "/send", "/receive", "/settings", "/profile", "/profiles", "/achievements",
  "/notifications", "/community", "/ambassador", "/growth", "/admin",
];

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  // Point the app at the local backend regardless of hostname, before app JS runs.
  await context.addInitScript((api) => {
    try { window.localStorage.setItem("vorliq_node_url", api); } catch (e) {}
  }, API);

  const overflow = [];
  const touch = [];
  const focus = [];

  for (const route of ROUTES) {
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(600); // allow first render + data fetch settle

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(120);
        const m = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        }));
        const past = m.sw - m.iw;
        const ok = past <= 1;
        overflow.push({ route, width, past, ok });
        if (!ok) await page.screenshot({ path: path.join(OUT, `overflow_${route.replace(/\W+/g, "_")}_${width}.png`) });
      }

      // Touch targets at 320px.
      await page.setViewportSize({ width: 320, height: 900 });
      await page.waitForTimeout(120);
      const small = await page.evaluate(() => {
        const els = [...document.querySelectorAll('a[href], button, input, select, [role="button"]')];
        const bad = [];
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue; // hidden
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (r.width < 44 || r.height < 44) {
            bad.push({ tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24) });
          }
        }
        return bad;
      });
      touch.push({ route, smallCount: small.length, sample: small.slice(0, 6) });

      // Focus visibility: first 5 Tab stops at desktop width.
      await page.setViewportSize({ width: 1440, height: 900 });
      const stops = [];
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const outline = parseFloat(s.outlineWidth) || 0;
          const shadow = s.boxShadow && s.boxShadow !== "none";
          return { tag: el.tagName.toLowerCase(), visible: outline > 0 || shadow };
        });
        if (f) stops.push(f);
      }
      const invisible = stops.filter((s) => !s.visible).length;
      focus.push({ route, stops: stops.length, invisible });
    } catch (e) {
      overflow.push({ route, width: 0, past: -1, ok: false, error: e.message });
    }
    await page.close();
  }
  await browser.close();

  const overflowFails = overflow.filter((o) => !o.ok);
  const touchFails = touch.filter((t) => t.smallCount > 0);
  const focusFails = focus.filter((f) => f.invisible > 0);

  const summary = {
    routes: ROUTES.length,
    overflow: { checks: overflow.length, fails: overflowFails.length, failing: overflowFails },
    touchTargets: { routesWithSmall: touchFails.length, detail: touchFails },
    focus: { routesWithInvisible: focusFails.length, detail: focusFails },
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`Routes audited: ${ROUTES.length}`);
  console.log(`Overflow: ${overflow.length - overflowFails.length}/${overflow.length} viewport checks pass`);
  if (overflowFails.length) overflowFails.forEach((o) => console.log(`  OVERFLOW ${o.route} @${o.width}px: +${o.past}px ${o.error || ""}`));
  console.log(`Touch targets: ${touch.length - touchFails.length}/${touch.length} routes clean at 320px`);
  if (touchFails.length) touchFails.forEach((t) => console.log(`  TOUCH ${t.route}: ${t.smallCount} small — ${t.sample.map((s) => `${s.tag}(${s.w}x${s.h} "${s.text}")`).join(", ")}`));
  console.log(`Focus: ${focus.length - focusFails.length}/${focus.length} routes with all-visible first stops`);
  if (focusFails.length) focusFails.forEach((f) => console.log(`  FOCUS ${f.route}: ${f.invisible}/${f.stops} stops without visible focus`));
  console.log(`\nFull summary: ${path.join(OUT, "summary.json")}`);
  process.exit(0);
})();
