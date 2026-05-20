const {
  canonicalStringify,
  containsForbiddenString,
  sha256Hex,
  verifyChain,
  verifyTreasury,
} = require("../../tools/verify_audit");

function publicBlock(index, previousHash, hash) {
  return {
    index,
    timestamp: 1715791000 + index,
    transactions: [],
    previous_hash: previousHash,
    nonce: index,
    miner_address: index ? "VLQ_MINER" : null,
    hash,
  };
}

describe("verify_audit tool helpers", () => {
  test("forbidden string detection works", () => {
    expect(containsForbiddenString({ note: "BEGIN PRIVATE KEY" })).toBe(true);
    expect(containsForbiddenString({ note: "public chain state" })).toBe(false);
  });

  test("canonical hashes are stable for sorted keys", () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };
    expect(sha256Hex(canonicalStringify(left))).toBe(sha256Hex(canonicalStringify(right)));
  });

  test("chain verifier catches link mismatches", () => {
    const chain = {
      chain_valid: true,
      latest_block_hash: "bad-latest",
      block_count: 2,
      blocks: [publicBlock(0, "0", "genesis"), publicBlock(1, "wrong", "latest")],
    };

    expect(verifyChain(chain).issues.join("\n")).toMatch(/previous_hash/);
  });

  test("treasury verifier passes matching reward and payout ledger", () => {
    const issues = verifyTreasury({
      treasury_balance: 7,
      treasury_ledger: [
        { type: "reward_in", amount: 10 },
        { type: "payout_paid", amount: 3 },
      ],
    });

    expect(issues).toEqual({ issues: [], warnings: [] });
  });
});
