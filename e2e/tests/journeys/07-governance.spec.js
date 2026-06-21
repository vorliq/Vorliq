// Journey 6 (governance): a user submits a proposal, both wallets vote, and the
// outcome is recorded.
//
// STATUS: enumerated but not yet automated end-to-end, marked fixme rather than
// left as a silent gap or a fake pass.
//
// Why deferred: "the outcome is recorded" means a *concluded* proposal (passed /
// rejected), and a proposal only concludes after its voting deadline elapses.
// Forcing deadline expiry deterministically in a fast suite needs either a
// time-travel/clock fixture on the Flask core or a configurable voting window
// (neither exists yet). The proposal-creation and vote-casting steps are covered
// by the governance route's unit tests; this file tracks the remaining UI
// conclude-and-record step so it is visible and can be enabled once the core
// exposes a test-configurable voting window.
const { test } = require("./fixtures");

test.fixme("proposer submits a proposal, both wallets vote, and the outcome is recorded", async () => {
  // See the file header for the core fixture required to enable this journey.
});
