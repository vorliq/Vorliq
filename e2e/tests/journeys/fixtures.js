// Shared test fixture for the local journeys: disables animations (so reveal
// transitions never make controls "unstable" for clicks) and marks onboarding
// complete, on every navigation. Import { test, expect } from here in specs.
const base = require("@playwright/test");

const test = base.test.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("vorliq_onboarding_complete", "true");
      } catch (error) {
        /* storage may be unavailable pre-load */
      }
      const install = () => {
        const style = document.createElement("style");
        style.setAttribute("data-e2e", "disable-motion");
        style.textContent =
          "*,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;" +
          "animation-iteration-count:1!important;transition-duration:1ms!important;" +
          "transition-delay:0ms!important;scroll-behavior:auto!important}";
        (document.head || document.documentElement).appendChild(style);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, { once: true });
      } else {
        install();
      }
    });
    await use(page);
  },
});

module.exports = { test, expect: base.expect };
