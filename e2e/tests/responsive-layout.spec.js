const { expect, test } = require("@playwright/test");
const { expectNoHorizontalOverflow, prepareReadOnlyPage, safeGoto } = require("./helpers");

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
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

    const hamburger = page.locator('button[aria-controls="mobile-navigation"]');
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await hamburger.evaluate((button) => button.click());
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");

    const drawer = page.locator("#mobile-navigation");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");

    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).toBeTruthy();
    const topElementClass = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("#mobile-navigation")?.id || "";
    }, { x: drawerBox.x + 24, y: drawerBox.y + 24 });
    expect(topElementClass).toBe("mobile-navigation");

    await drawer.getByRole("link", { name: /^Wallet$/i }).evaluate((link) => link.click());
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
  });

  test("desktop More menu opens, layers above content, and closes", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepareReadOnlyPage(page);
    await safeGoto(page, "/mine");

    const more = page.getByRole("button", { name: /^More/i });
    await more.evaluate((button) => button.click());
    await expect(more).toHaveAttribute("aria-expanded", "true");

    const menu = page.locator("#more-navigation");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Treasury" })).toBeVisible();

    const menuBox = await menu.boundingBox();
    expect(menuBox).toBeTruthy();
    const topElementId = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("#more-navigation")?.id || "";
    }, { x: menuBox.x + Math.min(40, menuBox.width / 2), y: menuBox.y + 20 });
    expect(topElementId).toBe("more-navigation");

    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
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

    await expect(page.locator(".brand-background")).toBeVisible();
    await expect(page.locator("main img[alt*='logo' i]")).toHaveCount(0);
  });
});
