const { test } = require("@playwright/test");
const {
  expectMainContent,
  expectNoCrashText,
  expectNoHorizontalOverflow,
  prepareReadOnlyPage,
  safeGoto,
} = require("./helpers");

const routes = [
  ["/", /Vorliq Dashboard/i],
  ["/wallet", /Wallet/i],
  ["/send", /Send VLQ/i],
  ["/mine", /Mine VLQ|Mining Status/i],
  ["/faucet", /Starter VLQ Faucet|Faucet/i],
  ["/blockchain", /Blockchain/i],
  ["/lending", /Lending/i],
  ["/exchange", /Exchange/i],
  ["/governance", /Governance/i],
  ["/treasury", /Treasury/i],
  ["/forum", /Forum/i],
  ["/chat", /Chat/i],
  ["/profile", /Profile/i],
  ["/leaderboard", /Leaderboard|Top Reputation/i],
  ["/registry", /Registry/i],
  ["/network", /Network/i],
  ["/stats", /Stats|Statistics/i],
  ["/health", /Health/i],
  ["/readiness", /Readiness/i],
  ["/migration-readiness", /Migration Readiness|Current Storage/i],
  ["/snapshot", /Snapshot/i],
  ["/growth", /Growth/i],
  ["/audit", /Audit/i],
  ["/transparency", /Transparency/i],
  ["/roadmap", /Roadmap/i],
  ["/releases", /Releases/i],
  ["/notifications", /Notifications/i],
  ["/login", /Create Your Vorliq Wallet|Welcome Back|Login/i],
];

const smokeViewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 375, height: 812 },
];

test.describe("public route smoke coverage", () => {
  for (const viewport of smokeViewports) {
    for (const [route, heading] of routes) {
      test(`${route} loads without crash or horizontal overflow on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await prepareReadOnlyPage(page);
        await safeGoto(page, route);

        await expectMainContent(page, heading);
        await expectNoCrashText(page);
        await expectNoHorizontalOverflow(page);
      });
    }
  }
});
