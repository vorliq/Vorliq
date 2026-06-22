const {
  clearFailures,
  lockedSecondsRemaining,
  recordFailure,
  resetAuthLockoutForTests,
} = require("../middleware/authLockout");

function reqFrom(ip) {
  return { ip };
}

describe("wallet-auth failed-attempt lockout", () => {
  beforeEach(() => resetAuthLockoutForTests());

  test("locks a client after five credential failures within the window", () => {
    const req = reqFrom("10.0.0.1");
    for (let i = 0; i < 4; i += 1) {
      expect(recordFailure(req, "AUTHORIZATION_SIGNATURE_INVALID")).toBe(0);
      expect(lockedSecondsRemaining(req)).toBe(0);
    }
    const lockSeconds = recordFailure(req, "AUTHORIZATION_SIGNATURE_INVALID");
    expect(lockSeconds).toBeGreaterThan(0);
    expect(lockSeconds).toBeLessThanOrEqual(600);
    expect(lockedSecondsRemaining(req)).toBeGreaterThan(0);
  });

  test("a successful authorization clears the failure count", () => {
    const req = reqFrom("10.0.0.2");
    recordFailure(req, "AUTHORIZATION_SIGNATURE_INVALID");
    recordFailure(req, "AUTHORIZATION_SIGNATURE_INVALID");
    clearFailures(req);
    for (let i = 0; i < 4; i += 1) {
      expect(recordFailure(req, "AUTHORIZATION_SIGNATURE_INVALID")).toBe(0);
    }
    expect(lockedSecondsRemaining(req)).toBe(0);
  });

  test("transient envelope failures do not count toward the lockout", () => {
    const req = reqFrom("10.0.0.3");
    for (let i = 0; i < 10; i += 1) {
      expect(recordFailure(req, "AUTHORIZATION_EXPIRED")).toBe(0);
      expect(recordFailure(req, "AUTHORIZATION_REPLAYED")).toBe(0);
    }
    expect(lockedSecondsRemaining(req)).toBe(0);
  });

  test("different clients are tracked independently", () => {
    const a = reqFrom("10.0.0.4");
    const b = reqFrom("10.0.0.5");
    for (let i = 0; i < 5; i += 1) recordFailure(a, "AUTHORIZATION_SIGNATURE_INVALID");
    expect(lockedSecondsRemaining(a)).toBeGreaterThan(0);
    expect(lockedSecondsRemaining(b)).toBe(0);
  });
});
