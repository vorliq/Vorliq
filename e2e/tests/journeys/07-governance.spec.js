// Journey 6 (governance): a proposer submits a proposal, both wallets vote within
// the (test-shortened) voting window, the window expires, and the recorded
// outcome shows on the proposal card.
const { test, expect } = require("./fixtures");
const {
  createWallet,
  fundWalletSpendable,
  createProposal,
  voteOnProposal,
  importWalletViaUI,
  api,
  assertNoHorizontalOverflow,
} = require("./helpers");

const CONCLUDED = ["expired", "executed", "passed_pending_execution", "rejected"];

test("proposal is submitted, both wallets vote, and the outcome is recorded", async ({ page }) => {
  // Proposing and voting both require a positive VLQ balance.
  const proposer = await createWallet();
  await fundWalletSpendable(proposer.address);
  const voter = await createWallet();
  await fundWalletSpendable(voter.address);

  const title = `E2E governance proposal ${Date.now()}`;
  const proposalId = await createProposal(proposer, {
    title,
    description: "An end-to-end proposal to verify the voting lifecycle and the recorded outcome.",
  });
  await voteOnProposal(proposer, proposalId, "yes");
  await voteOnProposal(voter, proposalId, "yes");

  // Wait for the test-shortened (3s) voting window to elapse, then a read
  // triggers expiry-on-read so the proposal reaches a recorded outcome.
  await new Promise((resolve) => setTimeout(resolve, 4500));
  const all = await api("/governance/all?limit=100");
  const recorded = (all.data.proposals || []).find((p) => p.proposal_id === proposalId);
  expect(recorded, "the proposal should be retrievable").toBeTruthy();
  expect(CONCLUDED, `proposal should have a recorded outcome, got "${recorded?.status}"`).toContain(recorded.status);

  // The proposer sees the concluded proposal card with its recorded outcome.
  await importWalletViaUI(page, proposer.private_key, "e2e-gov-pass-1");
  await page.goto("/governance", { waitUntil: "domcontentloaded" });
  const card = page.locator(".vn-prop", { hasText: title });
  await expect(card, "the proposal card should be shown").toBeVisible({ timeout: 20_000 });
  await expect(
    card.locator(".vn-badge--muted"),
    "the concluded proposal should show a recorded-outcome (closed) badge"
  ).toBeVisible();
  await assertNoHorizontalOverflow(page, "governance outcome");
});
