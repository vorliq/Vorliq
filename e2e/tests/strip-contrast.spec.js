// Pre/post-deploy verification that the live-activity strip pills are readable in
// BOTH themes. It measures the real rendered pill background vs its title text and
// the page background vs the "Live on the network" label, computing the WCAG
// contrast ratio. INJECT_FIX=1 injects the proposed CSS over the live (still-buggy)
// page so the fix can be proven before deploying; without it, it tests as-deployed.
const { test, expect } = require("@playwright/test");

const INJECT = process.env.INJECT_FIX === "1";

// The proposed fix, mirrored from styles/vnext.css, for pre-deploy verification.
const FIX_CSS = `
.vnext .vn-activity-strip__label { color: var(--vn-teal); }
html[data-theme="light"] .vnext .vn-activity-strip__label { color: var(--vn-teal-text); }
.vnext .vn-activity-strip__item { background: var(--vn-card); border: 1px solid rgba(0,168,150,0.32); }
.vnext .vn-activity-strip__title { color: var(--vn-text); }
.vnext .vn-activity-strip__age { color: var(--vn-text-2); }
`;

for (const theme of ["dark", "light"]) {
  test(`activity strip is readable in ${theme} mode`, async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Drive the theme the way the app persists it (localStorage), then reload so
    // the app re-applies it on mount — a bare setAttribute is reverted by the
    // app's own theme effect.
    await page.evaluate((t) => window.localStorage.setItem("vorliq_theme", t), theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme, { timeout: 10_000 });
    if (INJECT) await page.addStyleTag({ content: FIX_CSS });

    await expect(page.locator(".vn-activity-strip__item").first()).toBeVisible({ timeout: 25_000 });

    const result = await page.evaluate(() => {
      function rgb(str) {
        const m = str.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(",").map((x) => parseFloat(x.trim()));
        return [p[0], p[1], p[2]];
      }
      function lum([r, g, b]) {
        const a = [r, g, b].map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      }
      function contrast(c1, c2) {
        const L1 = lum(c1), L2 = lum(c2);
        return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      }
      function bgOf(el) {
        // walk up until a non-transparent background is found
        let node = el;
        while (node) {
          const c = getComputedStyle(node).backgroundColor;
          const v = rgb(c);
          if (v && !(c.includes("rgba") && c.trim().endsWith(", 0)"))) return v;
          node = node.parentElement;
        }
        return [255, 255, 255];
      }
      const item = document.querySelector(".vn-activity-strip__item");
      const title = document.querySelector(".vn-activity-strip__title");
      const label = document.querySelector(".vn-activity-strip__label");
      const titleColor = rgb(getComputedStyle(title).color);
      const itemBg = bgOf(item);
      const labelColor = rgb(getComputedStyle(label).color);
      const labelBg = bgOf(label);
      return {
        itemBg, titleColor, labelColor, labelBg,
        titleContrast: contrast(titleColor, itemBg),
        labelContrast: contrast(labelColor, labelBg),
      };
    });

    console.log(`[${theme}]`, JSON.stringify(result));
    expect(result.titleContrast, `pill text contrast in ${theme}`).toBeGreaterThanOrEqual(4.5);
    expect(result.labelContrast, `label contrast in ${theme}`).toBeGreaterThanOrEqual(3.0);
  });
}
