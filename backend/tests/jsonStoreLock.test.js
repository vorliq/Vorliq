const fs = require("fs");
const os = require("os");
const path = require("path");

const { withLock, atomicWriteJson } = require("../jsonStore");

// Regression test for the production outage where an orphaned *.lock file (left
// by a worker killed mid-write) made every acquisition time out, 500'ing all
// writes — wallet creation, faucet, transactions, governance, exchange. The lock
// now breaks a provably stale orphan instead of wedging forever.
describe("jsonStore withLock stale-lock recovery", () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-lock-"));
    file = path.join(dir, "data.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("breaks a lock held by a dead pid and proceeds", () => {
    // A dead pid: a very high pid almost certainly not running.
    fs.writeFileSync(`${file}.lock`, "2147480000");
    const start = Date.now();
    const result = withLock(file, () => "done", 5000);
    expect(result).toBe("done");
    expect(Date.now() - start).toBeLessThan(2000); // broke immediately, not after timeout
    expect(fs.existsSync(`${file}.lock`)).toBe(false); // released cleanly
  });

  test("breaks an empty orphan lock once it is past the grace period", () => {
    fs.writeFileSync(`${file}.lock`, ""); // died before writing its pid
    const old = Date.now() - 120000;
    fs.utimesSync(`${file}.lock`, old / 1000, old / 1000); // sat untouched for 2 min
    const result = withLock(file, () => "ok", 5000);
    expect(result).toBe("ok");
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  test("respects a lock held by a live process (does not preempt)", () => {
    // The current process is alive, so a lock bearing our own... use a different
    // live pid: process.pid is treated as re-entrant-not-stale only when equal to
    // ours, so use a guaranteed-live foreign-looking value — our own pid works
    // because lockIsStale returns false for pid === process.pid.
    fs.writeFileSync(`${file}.lock`, String(process.pid));
    const start = Date.now();
    expect(() => withLock(file, () => "never", 300)).toThrow(/Timed out waiting for storage lock/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(250); // waited out the timeout
    expect(fs.existsSync(`${file}.lock`)).toBe(true); // the holder's lock survived
  });

  test("atomicWriteJson succeeds through a stale orphan lock", () => {
    fs.writeFileSync(`${file}.lock`, "2147480001"); // dead pid
    atomicWriteJson(file, { ok: true });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ ok: true });
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });
});
