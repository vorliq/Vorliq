// Error/empty-state audit: for representative data-driven routes, intercept the
// backend API and force (a) a 500 error and (b) an empty payload, then verify the
// page degrades gracefully — it must not go blank, must not surface a raw stack
// trace, and must not throw an uncaught render error. Run with the SPA build
// served (the backend does NOT need to be up since all API calls are intercepted).
const { chromium } = require("@playwright/test");

const BASE = process.env.AUDIT_BASE || "http://127.0.0.1:4178";
const API = process.env.AUDIT_API || "http://localhost:5000/api";
const ROUTES = ["/blockchain", "/governance", "/treasury", "/leaderboard", "/economics", "/network-health", "/exchange", "/forum"];

async function check(context, route, mode) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

  await page.route("**/api/**", (r) => {
    if (mode === "error") return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: "forced upstream failure" }) });
    // empty
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, items: [], proposals: [], offers: [], posts: [], chain: [], loans: [], nodes: [] }) });
  });

  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const text = (document.body.innerText || "").trim();
    return {
      visibleTextLen: text.length,
      blank: text.length < 20,
      // crude leak check: raw axios/stack markers that must never reach the user
      leaksInternal: /(at Object\.|\.js:\d+:\d+|AxiosError|ECONNREFUSED|Traceback|http:\/\/localhost:5000)/.test(text),
      mentionsError: /(unavailable|could not|couldn't|try again|failed|error|no .* yet|nothing|empty)/i.test(text),
    };
  });
  // A pure render crash (uncaught exception that blanks the app) is the failure
  // we care about; benign network-error console logs are expected in error mode.
  const renderCrash = consoleErrors.some((e) => e.startsWith("PAGEERROR:"));
  await page.close();
  return { route, mode, ...info, renderCrash };
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const results = [];
  for (const mode of ["error", "empty"]) {
    for (const route of ROUTES) results.push(await check(context, route, mode));
  }
  await browser.close();

  let fails = 0;
  for (const r of results) {
    const bad = r.blank || r.leaksInternal || r.renderCrash;
    if (bad) fails++;
    const flags = [r.blank ? "BLANK" : "", r.leaksInternal ? "LEAKS-INTERNAL" : "", r.renderCrash ? "RENDER-CRASH" : ""].filter(Boolean).join(",");
    console.log(`${bad ? "FAIL" : "ok  "} [${r.mode}] ${r.route}  textLen=${r.visibleTextLen} mentionsState=${r.mentionsError} ${flags}`);
  }
  console.log(fails === 0 ? "\nALL STATE CHECKS PASSED (no blank, no internal leak, no render crash)" : `\n${fails} STATE CHECK(S) FAILED`);
  process.exit(0);
})();
