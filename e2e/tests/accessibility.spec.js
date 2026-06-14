const { test, expect } = require("@playwright/test");
const { prepareReadOnlyPage, safeGoto } = require("./helpers");

// Contrast regression guard. Reads the theme tokens as the browser actually
// resolves them (not source strings) and computes real WCAG 2.1 contrast
// ratios. Body text must clear 4.5:1 (AA, normal text) against the page
// background in BOTH themes. This locks in the light-theme --text-muted fix
// (was 4.20:1, below AA) and prevents future token edits from regressing it.

function relativeLuminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Read resolved CSS custom properties and parse rgb()/hex into [r,g,b].
async function readTokens(page, names) {
  return page.evaluate((tokenNames) => {
    const styles = getComputedStyle(document.documentElement);
    // Resolve a custom property to a concrete rgb triple by painting it.
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
    const out = {};
    for (const name of tokenNames) {
      probe.style.color = styles.getPropertyValue(name).trim();
      const computed = getComputedStyle(probe).color; // always rgb(...) form
      const match = computed.match(/(\d+(?:\.\d+)?)/g);
      out[name] = match ? match.slice(0, 3).map(Number) : null;
    }
    probe.remove();
    return out;
  }, names);
}

const TOKENS = ["--text-primary", "--text-secondary", "--text-muted", "--bg-deep"];

for (const theme of ["dark", "light"]) {
  test(`body text meets WCAG AA contrast on the page background (${theme} theme)`, async ({ page }) => {
    await prepareReadOnlyPage(page);
    await page.addInitScript((t) => {
      window.localStorage.setItem("vorliq_theme", t);
    }, theme);
    await safeGoto(page, "/settings");

    const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(applied).toBe(theme);

    const tokens = await readTokens(page, TOKENS);
    for (const name of TOKENS) {
      expect(tokens[name], `${name} should resolve in ${theme}`).not.toBeNull();
    }

    const bg = tokens["--bg-deep"];
    for (const textToken of ["--text-primary", "--text-secondary", "--text-muted"]) {
      const ratio = contrastRatio(tokens[textToken], bg);
      expect(
        ratio,
        `${textToken} vs --bg-deep in ${theme} = ${ratio.toFixed(2)}:1 (needs >= 4.5:1)`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}
