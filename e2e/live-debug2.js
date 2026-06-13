const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  const apiResp = [];
  const allErr = [];
  page.on("console", (m) => { if (m.type()==="error") allErr.push(m.text()); });
  page.on("pageerror", (e) => allErr.push("PAGEERROR: "+e.message));
  page.on("response", (r) => { const u=r.url(); if (u.includes("/api/")) apiResp.push(r.status()+" "+u.replace("https://vorliq.org","")); });
  page.on("requestfailed", (r) => { const u=r.url(); if (u.includes("/api/")) apiResp.push("FAIL "+u.replace("https://vorliq.org","")+" "+(r.failure()&&r.failure().errorText)); });
  await page.goto("https://vorliq.org/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(13000);
  const apiBase = await page.evaluate(() => {
    // surface what the app thinks its API base is, and force a probe
    return fetch("/api/health").then(r=>r.status+"").catch(e=>"fetcherr:"+e.message);
  });
  console.log("manual /api/health fetch from page:", apiBase);
  console.log("API responses seen (" + apiResp.length + "):");
  apiResp.forEach((x) => console.log("  " + x));
  console.log("JS errors (" + allErr.length + "):");
  allErr.forEach((x) => console.log("  " + x));
  // read the live card values
  const vals = await page.$$eval(".vq-live-grid .stat-value", els=>els.map(e=>e.textContent.trim())).catch(()=>[]);
  console.log("card values:", JSON.stringify(vals));
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
