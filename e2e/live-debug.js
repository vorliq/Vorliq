const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE.ERROR:", m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  page.on("requestfailed", (r) => { if (r.url().includes("/api/")) console.log("REQFAILED:", r.url(), r.failure()?.errorText); });
  page.on("response", (r) => { if (r.url().includes("/api/")) console.log("API RESP:", r.status(), r.url().replace("https://vorliq.org","")); });
  await page.goto("https://vorliq.org/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(13000);
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
