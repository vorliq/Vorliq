// Journey 5 (loan lifecycle): a borrower requests a loan, a second wallet funds
// it (votes to approve, paid from the seeded pool), the borrower repays, and the
// loan card shows the closed (repaid) state.
const { test, expect } = require("./fixtures");
const {
  createWallet,
  fundWalletSpendable,
  fundWalletToThreshold,
  createLoanRequest,
  voteOnLoan,
  repayLoan,
  mineSome,
  importWalletViaUI,
  api,
  assertNoHorizontalOverflow,
} = require("./helpers");

test("loan is requested, funded from the pool, repaid, and shows closed", async ({ page }) => {
  // Borrower needs a small spendable balance to cover the repayment interest;
  // the voter needs >=100 confirmed VLQ so a single yes vote clears the
  // 100-VLQ approval threshold.
  const borrower = await createWallet();
  await fundWalletSpendable(borrower.address);
  const voter = await createWallet();
  const voterBalance = await fundWalletToThreshold(voter.address, 110);
  expect(voterBalance, "voter should hold enough VLQ to approve the loan").toBeGreaterThanOrEqual(100);

  // Request -> approve (vote) -> issue (mine) -> repay (mine).
  const loanId = await createLoanRequest(borrower, { amount: 1, reason: "E2E community loan" });
  await voteOnLoan(voter, loanId, "yes");
  await mineSome(2); // confirm the issuance so the loan becomes active
  await api("/lending/loans?limit=1"); // trigger loan-status sync on read
  await repayLoan(borrower, loanId);
  await mineSome(2); // confirm the repayment

  // The loan reached the closed state on-chain.
  const loanRes = await api(`/lending/loan?loan_id=${encodeURIComponent(loanId)}`);
  expect(loanRes.data.loan?.status, "loan should be repaid on-chain").toBe("repaid");

  // The borrower sees the closed loan card at this viewport.
  await importWalletViaUI(page, borrower.private_key, "e2e-loan-pass-1");
  await page.goto("/lending", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: /closed loans/i }),
    "a Closed loans section should list the repaid loan"
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator("main#main-content").getByText(/^repaid$/i).first(),
    "the loan card should show the repaid (closed) status"
  ).toBeVisible();
  await assertNoHorizontalOverflow(page, "lending closed loan");
});
