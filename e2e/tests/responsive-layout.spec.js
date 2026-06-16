const { expect, test } = require("@playwright/test");
const { expectNoHorizontalOverflow, prepareReadOnlyPage, safeGoto } = require("./helpers");

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-414", width: 414, height: 896 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-820", width: 820, height: 1180 },
  { name: "tablet-1024", width: 1024, height: 1366 },
  { name: "desktop", width: 1366, height: 768 },
  { name: "desktop-1440", width: 1440, height: 1100 },
  { name: "wide", width: 1920, height: 1080 },
];

const keyRoutes = ["/", "/wallet", "/mine", "/registry", "/health", "/treasury", "/exchange"];

test.describe("responsive layout and visual guardrails", () => {
  for (const viewport of viewports) {
    for (const route of keyRoutes) {
      test(`${route} has no horizontal overflow at ${viewport.name}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await prepareReadOnlyPage(page);
        await safeGoto(page, route);

        await expectNoHorizontalOverflow(page);
        if (route === "/" && ["mobile", "desktop", "wide"].includes(viewport.name)) {
          await testInfo.attach(`dashboard-${viewport.name}`, {
            body: await page.screenshot({ animations: "disabled", fullPage: false, timeout: 30_000 }),
            contentType: "image/png",
          });
        }
      });
    }
  }

  test("mobile drawer is a focus-managed dialog that closes via Escape, backdrop, and link", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const hamburger = page.locator('button[aria-controls="vn-mobile-navigation"]');
    const drawer = page.locator("#vn-mobile-navigation");
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");

    // Open: it is a modal dialog and focus moves into it (to the close button).
    await hamburger.click();
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(drawer.getByRole("button", { name: /close navigation menu/i })).toBeFocused();

    // Drawer sits above page content.
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).toBeTruthy();
    const topElementId = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("#vn-mobile-navigation")?.id || "";
    }, { x: drawerBox.x + 24, y: drawerBox.y + 24 });
    expect(topElementId).toBe("vn-mobile-navigation");

    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");

    // Backdrop click closes it.
    await hamburger.click();
    await expect(drawer).toBeVisible();
    await page.locator(".vn-drawer-backdrop").click({ position: { x: 12, y: 12 } });
    await expect(drawer).toHaveCount(0);

    // A drawer link navigates (into a marketing page) and dismisses the drawer.
    await hamburger.click();
    await drawer.getByRole("link", { name: /^Features$/i }).click();
    await expect(page).toHaveURL(/\/features$/);
    await expect(drawer).toHaveCount(0);
  });

  test("desktop navigation exposes primary links without an old More menu", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const navbar = page.locator(".vn-nav");
    await expect(navbar).toBeVisible();
    await expect(navbar.getByRole("link", { name: "Features" })).toBeVisible();
    await expect(navbar.getByRole("link", { name: "Create Account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^More/i })).toHaveCount(0);
    await expect(page.locator("#more-navigation")).toHaveCount(0);
  });

  test("footer social links render once as the official allowlist", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const footer = page.locator("footer.site-footer");
    await expect(footer).toBeVisible();
    await expect(footer.locator(".social-links")).toHaveCount(1);
    await expect(footer.locator(".social-links a")).toHaveCount(3);
    await expect(footer.locator(".social-links a svg")).toHaveCount(3);
    await expect(footer.locator(".social-links a.x")).toHaveAttribute("href", "https://x.com/Vorliq");
    await expect(footer.locator(".social-links a.github")).toHaveAttribute("href", "https://github.com/vorliq/Vorliq");
    await expect(footer.locator(".social-links a.reddit")).toHaveCount(0);
    await expect(footer.locator(".social-links a.facebook")).toHaveCount(0);
  });

  test("top logo is visible and the landing does not repeat a giant middle logo", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const navLogo = page.locator(".vn-nav .vn-brand img");
    await expect(navLogo).toBeVisible();
    const logoBox = await navLogo.boundingBox();
    expect(logoBox.width).toBeGreaterThanOrEqual(30);
    expect(logoBox.height).toBeGreaterThanOrEqual(30);

    const pageBackground = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
    expect(pageBackground).toMatch(/rgb\((0|[1-2]?\d|3[0-5]),\s*(0|[1-2]?\d|3[0-5]),\s*(0|[1-2]?\d|3[0-5])\)/);
    await expect(page.locator("main img[alt*='logo' i]")).toHaveCount(0);
  });
});
