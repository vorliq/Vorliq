const { expect } = require("@playwright/test");

const crashTextPattern =
  /Minified React error|Application error|Unhandled Runtime Error|Cannot read properties|TypeError:|ReferenceError:|SyntaxError:/i;

const secretTextPattern = /ADMIN_TOKEN|SERVER_SSH_KEY|private_key|BEGIN EC PRIVATE KEY|\/home\/vorliq|stack trace|Traceback/i;

async function prepareReadOnlyPage(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("vorliq_onboarding_complete", "true");
    const disableMotion = () => {
      const style = document.createElement("style");
      style.setAttribute("data-e2e", "disable-motion");
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 1ms !important;
          animation-delay: 0ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 1ms !important;
          transition-delay: 0ms !important;
        }
      `;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", disableMotion, { once: true });
    } else {
      disableMotion();
    }
  });
}

async function disableMotion(page) {
  await page.addInitScript(() => {
    const install = () => {
      const style = document.createElement("style");
      style.setAttribute("data-e2e", "disable-motion");
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 1ms !important;
          animation-delay: 0ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 1ms !important;
          transition-delay: 0ms !important;
        }
      `;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  });
}

async function expectNoCrashText(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
  expect(bodyText).not.toMatch(crashTextPattern);
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return {
      htmlOverflow: documentElement.scrollWidth - documentElement.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      width: documentElement.clientWidth,
    };
  });
  expect(overflow.htmlOverflow, `html horizontal overflow at ${overflow.width}px`).toBeLessThanOrEqual(2);
  expect(overflow.bodyOverflow, `body horizontal overflow at ${overflow.width}px`).toBeLessThanOrEqual(2);
}

async function expectMainContent(page, expectedText) {
  await expect(page.locator("main#main-content")).toBeVisible();
  if (expectedText) {
    await expect(page.locator("main#main-content")).toContainText(expectedText);
  }
}

async function safeGoto(page, route) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
}

function safeApiJson(json) {
  const text = JSON.stringify(json);
  expect(text).not.toMatch(secretTextPattern);
}

module.exports = {
  crashTextPattern,
  disableMotion,
  expectMainContent,
  expectNoCrashText,
  expectNoHorizontalOverflow,
  prepareReadOnlyPage,
  safeApiJson,
  safeGoto,
};
