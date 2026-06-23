const os = require("os");
const path = require("path");
const fs = require("fs");

// Isolated shared-store file for this test.
process.env.VORLIQ_RATE_LIMIT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rlstore-")), "rate-limits.json");

const { SharedFileStore, recordHit, peekHit, resetStore } = require("../rateLimitStore");

beforeEach(() => resetStore());

describe("shared file rate-limit store", () => {
  test("two workers sharing the store both see the global count cross the threshold", async () => {
    // Two SharedFileStore instances stand in for two Node worker processes; they
    // point at the same file, so their counters are global, not per-worker.
    const workerA = new SharedFileStore("per-wallet-write");
    const workerB = new SharedFileStore("per-wallet-write");
    workerA.init({ windowMs: 60_000 });
    workerB.init({ windowMs: 60_000 });

    const key = "w:walletABC";
    const LIMIT = 10;

    // Split 10 hits across the two workers (5 each, interleaved).
    let last;
    for (let i = 0; i < 10; i += 1) {
      const worker = i % 2 === 0 ? workerA : workerB;
      last = await worker.increment(key);
    }

    // The combined count is 10 — the limit — regardless of which worker served
    // each request. With a per-process store each worker would have seen only 5.
    expect(last.totalHits).toBe(LIMIT);

    // An 11th hit on EITHER worker is over the global limit.
    const overA = await workerA.increment(key);
    expect(overA.totalHits).toBe(LIMIT + 1);
    const overB = await workerB.increment(key);
    expect(overB.totalHits).toBe(LIMIT + 2);
  });

  test("admin brute-force counters are shared across workers", () => {
    // Five failures recorded across "two workers" (the same shared file) trip the
    // threshold; a per-worker store would have needed five on a single worker.
    const ip = "203.0.113.50";
    let count = 0;
    for (let i = 0; i < 5; i += 1) {
      ({ count } = recordHit("admin-fail", ip, 10 * 60 * 1000));
    }
    expect(count).toBe(5);
    expect(peekHit("admin-fail", ip).count).toBe(5);
  });

  test("entries expire after their window so counts reset", async () => {
    const store = new SharedFileStore("expiry-test");
    store.init({ windowMs: 20 }); // 20ms window
    const r1 = await store.increment("k");
    expect(r1.totalHits).toBe(1);
    await new Promise((r) => setTimeout(r, 40));
    const r2 = await store.increment("k");
    expect(r2.totalHits).toBe(1); // window elapsed → fresh count
  });
});
