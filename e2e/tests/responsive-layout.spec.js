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

  test("mobile drawer sits above page content and closes on link click", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const hamburger = page.locator('button[aria-controls="mobile-product-navigation"]');
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await hamburger.evaluate((button) => button.click());
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");

    const drawer = page.locator("#mobile-product-navigation");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");

    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).toBeTruthy();
    const topElementClass = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("#mobile-product-navigation")?.id || "";
    }, { x: drawerBox.x + 24, y: drawerBox.y + 24 });
    expect(topElementClass).toBe("mobile-product-navigation");

    await drawer.getByRole("link", { name: /^Features$/i }).evaluate((link) => link.click());
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
  });

  test("desktop rebuilt navigation exposes primary links without old More menu", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/mine");

    const navbar = page.locator(".navbar");
    await expect(navbar).toBeVisible();
    await expect(navbar.getByRole("link", { name: "Features" })).toBeVisible();
    await expect(navbar.getByRole("link", { name: "Create Account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^More/i })).toHaveCount(0);
    await expect(page.locator("#more-navigation")).toHaveCount(0);
  });

  test("footer social links render once with SVG icon buttons", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const footer = page.locator("footer.site-footer");
    await expect(footer).toBeVisible();
    await expect(footer.locator(".social-links")).toHaveCount(1);
    await expect(footer.locator(".social-links a")).toHaveCount(5);
    await expect(footer.locator(".social-links a svg")).toHaveCount(5);
    await expect(footer.locator(".social-links a.reddit")).toHaveAttribute("href", "https://www.reddit.com/r/VorliqOfficial/");
    await expect(footer.locator(".social-links a.facebook")).toHaveAttribute("href", "https://www.facebook.com/people/Vorliq/61590708960405/");
    await expect(footer.locator(".social-links a.github")).toHaveCount(0);
  });

  test("top logo is visible and dashboard does not repeat a giant middle logo", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/");

    const navLogo = page.locator(".navbar .brand-logo");
    await expect(navLogo).toBeVisible();
    const logoBox = await navLogo.boundingBox();
    expect(logoBox.width).toBeGreaterThanOrEqual(30);
    expect(logoBox.height).toBeGreaterThanOrEqual(30);

    const pageBackground = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
    expect(pageBackground).toMatch(/rgb\((0|[1-2]?\d|3[0-5]),\s*(0|[1-2]?\d|3[0-5]),\s*(0|[1-2]?\d|3[0-5])\)/);
    await expect(page.locator("main img[alt*='logo' i]")).toHaveCount(0);
  });
});
