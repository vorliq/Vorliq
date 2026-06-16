// Regression guard for a real mobile bug: long inline text was clipped inside
// the app-shell content column at 375px because the global sticky-footer rule
// `#main-content { flex: 1 0 auto }` (column layout) overrode the row-flex app
// shell and let the content column grow to its content width. The page never
// scrolled (body is overflow:hidden), so the page-level overflow check could
// not catch it. This asserts, per app-shell page, that the content column fits
// the viewport and no element overflows the right edge — except content inside
// an intentional horizontal-scroll region such as a code block.
const { expect, test } = require("@playwright/test");
const { prepareReadOnlyPage, safeGoto } = require("./helpers");

// All flipped routes that render the authenticated app shell (sidebar + content).
const appShellRoutes = [
  "/dashboard",
  "/wallet",
  "/send",
  "/receive",
  "/mine",
  "/lending",
  "/governance",
  "/faucet",
  "/settings",
];

test.describe("app-shell content has no clipped text at 375px (signed out)", () => {
  for (const route of appShellRoutes) {
    test(`${route} content column fits the viewport`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await prepareReadOnlyPage(page);
      await safeGoto(page, route);
      // Wait for the content column and for data to settle so the measurement is
      // taken against the final layout, not a mid-load reflow.
      await expect(page.locator("main#main-content")).toBeVisible();
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(700);

      const findings = await page.evaluate(() => {
        const vw = window.innerWidth;
        const inScrollRegion = (el) => {
          let p = el.parentElement;
          while (p) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === "auto" || ox === "scroll") return true;
            if (p.id === "main-content") break;
            p = p.parentElement;
          }
          return false;
        };
        const offRight = [];
        for (const el of document.querySelectorAll("main#main-content *")) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.right > vw + 1 && !inScrollRegion(el)) {
            offRight.push({
              tag: el.tagName.toLowerCase(),
              cls: String(el.className || "").slice(0, 50),
              right: Math.round(rect.right),
              text: (el.textContent || "").trim().slice(0, 40),
            });
          }
        }
        const main = document.querySelector("main#main-content");
        return {
          mainW: main ? Math.round(main.getBoundingClientRect().width) : null,
          offRight: offRight.slice(0, 12),
        };
      });

      expect(findings.mainW, `content column width on ${route}`).toBeLessThanOrEqual(vwTolerance());
      expect(findings.offRight, `elements clipped past the right edge on ${route}`).toEqual([]);
    });
  }
});

// 375 viewport + up to a 1px sub-pixel rounding tolerance.
function vwTolerance() {
  return 376;
}
