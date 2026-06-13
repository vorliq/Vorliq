const { chromium } = require("@playwright/test");
(async () => {
  const base = "https://vorliq.org";
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 } });
  const page = await ctx.newPage();
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const h1 = (await page.locator("h1").first().innerText()).replace(/\n/g, " ");
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const socials = await page.$$eval("footer .social-links a", (as) => as.map((a) => a.getAttribute("aria-label")));
  const badSocials = await page.$$eval("a[href]", (as) => as.map(a=>a.href).filter(h=>/reddit|facebook|t\.me|telegram/i.test(h)));
  const heroScene = await page.locator(".vq-scene").count();
  // live cards: read stat values, see if any real (non Unavailable/loading) present
  const liveVals = await page.$$eval(".vq-live-grid .stat-value", (els) => els.map((e) => e.textContent.trim()));
  const footerLogo = await page.locator('footer img[alt="Vorliq logo"]').count();
  console.log("HOME h1:", JSON.stringify(h1));
  console.log("overflowPx:", ov, "| heroScene:", heroScene, "| footerLogo:", footerLogo);
  console.log("footer socials:", JSON.stringify(socials));
  console.log("bad social links anywhere:", JSON.stringify(badSocials));
  console.log("live card values:", JSON.stringify(liveVals));
  // routes
  for (const r of ["/register", "/login", "/dashboard", "/blockchain", "/features"]) {
    await page.goto(base + r, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(900);
    const t = (await page.locator("h1").first().innerText().catch(() => "(no h1)")).replace(/\n/g, " ").slice(0, 70);
    const status = await page.evaluate(() => document.title);
    console.log(`route ${r} -> h1="${t}"`);
  }
  // pitch.html served + no telegram
  const presp = await page.goto(base + "/pitch.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  const ptel = await page.$$eval("a[href]", (as) => as.filter(a=>/t\.me|telegram/i.test(a.href)).length).catch(()=>0);
  console.log(`/pitch.html status=${presp.status()} telegramLinks=${ptel}`);
  await browser.close();
})().catch((e) => { console.error("LIVE CHECK ERROR", e.message); process.exit(1); });
