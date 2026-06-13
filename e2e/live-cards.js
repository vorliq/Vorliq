const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
  await page.goto("https://vorliq.org/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(12000); // let the 8 public API calls resolve
  const labels = await page.$$eval(".vq-live-grid .stat-card", (cards) =>
    cards.map((c) => ({
      label: c.querySelector(".stat-label")?.textContent.trim(),
      value: c.querySelector(".stat-value")?.textContent.trim(),
    }))
  );
  console.log("LIVE NETWORK CARDS (production):");
  labels.forEach((l) => console.log(`  ${l.label}: ${l.value}`));
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
