// Journey 5 (loan lifecycle): borrower requests a loan, a second wallet funds it
// (votes to approve), the borrower repays, and the loan card shows the closed
// state.
//
// STATUS: enumerated but not yet automated end-to-end, and deliberately marked
// fixme rather than left as a silent gap or a fake pass.
//
// Why deferred: the full lifecycle needs two chain fixtures that are not cheap to
// reproduce deterministically in a fast suite, and getting them wrong gives a
// flaky test, which is worse than an honest skip:
//   1. Approval quorum: lending.py voting_threshold = 100 VLQ of *confirmed*
//      voter weight before a loan moves from pending_vote -> approved. A funding
//      wallet must therefore hold 100+ confirmed VLQ (≈3 mined blocks), mined in
//      under the relaxed block-time.
//   2. Issuance liquidity: approve_loan issues the principal FROM the
//      LENDING_POOL address, which has no funding source except prior repayments
//      (chicken-and-egg on a fresh chain) — so the pool must be seeded before the
//      issuance transaction can confirm and the loan can reach "active" and then
//      "repaid"/closed.
//
// The request-creation half is already exercised by the lending route's unit
// tests; this file tracks the remaining UI lifecycle so it is visible in the
// suite and can be enabled once a pool-seeding test fixture exists.
const { test } = require("./fixtures");

test.fixme("borrower requests a loan, it is funded, repaid, and shows closed", async () => {
  // See the file header for the fixtures required to enable this journey.
});
