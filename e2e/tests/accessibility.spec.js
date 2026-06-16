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

// The vnext design layer expresses secondary text as the primary colour at an
// opacity (spec: 55%). The probe above reads computed color which DROPS alpha,
// so it cannot judge a translucent token honestly. This composites the token's
// real alpha over the vnext background and checks the actual ratio — the case
// where the literal opacity rule and the accessibility gate disagree (light
// secondary text at 55% is ~4.36:1, below AA), and the gate must win.
function parseRgba(value) {
  const nums = value.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return { rgb: [nums[0], nums[1], nums[2]], a: nums.length > 3 ? nums[3] : 1 };
}
function composite(fg, bgRgb) {
  return fg.rgb.map((c, i) => Math.round(c * fg.a + bgRgb[i] * (1 - fg.a)));
}

for (const theme of ["dark", "light"]) {
  test(`vnext secondary text meets WCAG AA over the design-layer background (${theme} theme)`, async ({ page }) => {
    await prepareReadOnlyPage(page);
    await page.addInitScript((t) => {
      window.localStorage.setItem("vorliq_theme", t);
    }, theme);
    await safeGoto(page, "/settings"); // an app-shell route, so a .vnext element exists
    // The app shell is lazy-loaded; wait for it to render before reading tokens
    // (under live latency a fixed timeout is not enough).
    await page.waitForSelector(".vnext", { timeout: 15_000 });
    await page.waitForTimeout(300);

    const resolved = await page.evaluate(() => {
      const vn = document.querySelector(".vnext");
      if (!vn) return null;
      // Resolve each token by letting the browser compute `color: var(--token)`
      // on a fresh element inside the .vnext scope, then reading the rgb()/rgba().
      const paint = (token) => {
        const p = document.createElement("span");
        p.style.color = `var(${token})`;
        vn.appendChild(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      };
      return { bg: paint("--vn-bg"), text2: paint("--vn-text-2") };
    });

    expect(resolved, "a .vnext element should exist on /settings").not.toBeNull();
    const bgRgb = parseRgba(resolved.bg).rgb;
    const text2 = parseRgba(resolved.text2);
    const ratio = contrastRatio(composite(text2, bgRgb), bgRgb);
    expect(
      ratio,
      `--vn-text-2 composited over --vn-bg in ${theme} = ${ratio.toFixed(2)}:1 (needs >= 4.5:1)`
    ).toBeGreaterThanOrEqual(4.5);
  });
}

// Status / state colours sit on small badges and pills — exactly the elements
// the alpha-blind probe used to miss. Each fill is checked against the text that
// actually sits on it, and each text-only "ink" against the page background, in
// BOTH themes. The brand-new tokens (in-progress, category-buy, category-sell)
// have no track record, so they are gated explicitly here too.
const STATUS_TOKENS = [
  "--success", "--in-progress", "--category-buy", "--category-sell",
  "--warning", "--danger", "--on-light-fill", "--on-sell", "--on-status",
  "--success-ink", "--warning-ink", "--danger-ink", "--bg-deep",
];
// [fill, text-on-fill] pairs.
const STATUS_FILL_PAIRS = [
  ["--success", "--on-light-fill"],
  ["--in-progress", "--on-light-fill"],
  ["--category-buy", "--on-light-fill"],
  ["--category-sell", "--on-sell"],
  ["--warning", "--on-status"],
  ["--danger", "--on-status"],
];
// text-only inks read against the page background.
const STATUS_INKS = ["--success-ink", "--warning-ink", "--danger-ink"];

for (const theme of ["dark", "light"]) {
  test(`status colours meet WCAG AA (badges + ink) (${theme} theme)`, async ({ page }) => {
    await prepareReadOnlyPage(page);
    await page.addInitScript((t) => {
      window.localStorage.setItem("vorliq_theme", t);
    }, theme);
    await safeGoto(page, "/readiness"); // renders status badges / readiness scores

    const tokens = await readTokens(page, STATUS_TOKENS);
    for (const name of STATUS_TOKENS) {
      expect(tokens[name], `${name} should resolve in ${theme}`).not.toBeNull();
    }
    for (const [fill, text] of STATUS_FILL_PAIRS) {
      const ratio = contrastRatio(tokens[text], tokens[fill]);
      expect(
        ratio,
        `${text} on ${fill} in ${theme} = ${ratio.toFixed(2)}:1 (needs >= 4.5:1)`
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const ink of STATUS_INKS) {
      const ratio = contrastRatio(tokens[ink], tokens["--bg-deep"]);
      expect(
        ratio,
        `${ink} on --bg-deep in ${theme} = ${ratio.toFixed(2)}:1 (needs >= 4.5:1)`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}
