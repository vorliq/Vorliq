// Unit tests for referralStore: the member-to-member invite ledger. These cover
// the first-write-wins invariant, self/missing-address guards, the one-time
// bonus payout state machine, earnings aggregation, and the invited-by listing.
// The store path is redirected to a temp file per test via VORLIQ_REFERRAL_FILE.

const fs = require("fs");
const os = require("os");
const path = require("path");

let store;
let referralFilePath;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-referrals-"));
  referralFilePath = path.join(dir, "referrals.json");
  process.env.VORLIQ_REFERRAL_FILE = referralFilePath;
  jest.resetModules();
  store = require("../referralStore");
});

afterEach(() => {
  delete process.env.VORLIQ_REFERRAL_FILE;
  try {
    fs.rmSync(path.dirname(referralFilePath), { recursive: true, force: true });
  } catch (_e) {
    /* best effort */
  }
});

describe("recordReferral", () => {
  test("records a new referral and is then readable via getReferrer", () => {
    const result = store.recordReferral("memberA", "referrerX");
    expect(result).toEqual({ recorded: true, referrer: "referrerX" });
    expect(store.getReferrer("memberA")).toBe("referrerX");
  });

  test("first write wins — a second referrer is ignored and the original kept", () => {
    store.recordReferral("memberA", "referrerX");
    const second = store.recordReferral("memberA", "referrerY");
    expect(second).toEqual({ recorded: false, referrer: "referrerX", alreadyRecorded: true });
    expect(store.getReferrer("memberA")).toBe("referrerX");
  });

  test("rejects self-referral", () => {
    const result = store.recordReferral("memberA", "memberA");
    expect(result).toEqual({ recorded: false, referrer: null, reason: "self_referral" });
    expect(store.getReferrer("memberA")).toBeNull();
  });

  test("rejects missing addresses", () => {
    expect(store.recordReferral("", "referrerX").reason).toBe("missing_address");
    expect(store.recordReferral("memberA", "  ").reason).toBe("missing_address");
  });

  test("persists across a fresh module load (real file round-trip)", () => {
    store.recordReferral("memberA", "referrerX");
    jest.resetModules();
    const reloaded = require("../referralStore");
    expect(reloaded.getReferrer("memberA")).toBe("referrerX");
  });
});

describe("getReferrer", () => {
  test("returns null for an unknown or blank address", () => {
    expect(store.getReferrer("nobody")).toBeNull();
    expect(store.getReferrer("")).toBeNull();
  });
});

describe("bonus payout state machine", () => {
  test("markBonusPaid pays exactly once and records the tx", () => {
    store.recordReferral("memberA", "referrerX");
    const first = store.markBonusPaid("memberA", "tx-123");
    expect(first).toEqual({ paid: true, referrer: "referrerX" });
    expect(store.isBonusPaid("memberA")).toBe(true);

    const second = store.markBonusPaid("memberA", "tx-456");
    expect(second).toEqual({ paid: false, reason: "already_paid", referrer: "referrerX" });
  });

  test("markBonusPaid refuses a member with no referrer", () => {
    expect(store.markBonusPaid("ghost", "tx-1")).toEqual({ paid: false, reason: "no_referrer" });
    expect(store.markBonusPaid("", "tx-1")).toEqual({ paid: false, reason: "missing_address" });
  });

  test("isBonusPaid is false before payout", () => {
    store.recordReferral("memberA", "referrerX");
    expect(store.isBonusPaid("memberA")).toBe(false);
  });
});

describe("referralEarnings", () => {
  test("totals paid bonuses and counts paid vs pending", () => {
    store.recordReferral("m1", "ref");
    store.recordReferral("m2", "ref");
    store.recordReferral("m3", "ref");
    store.markBonusPaid("m1", "tx1");
    store.markBonusPaid("m2", "tx2");
    // m3 invited but bonus not yet paid -> pending

    const earnings = store.referralEarnings("ref");
    expect(earnings.paid_count).toBe(2);
    expect(earnings.pending_count).toBe(1);
    expect(earnings.bonus_per_referral).toBe(store.REFERRAL_BONUS);
    expect(earnings.total_vlq).toBe(2 * store.REFERRAL_BONUS);
  });

  test("an address with no invitees earns nothing", () => {
    expect(store.referralEarnings("nobody")).toEqual({
      total_vlq: 0,
      paid_count: 0,
      pending_count: 0,
      bonus_per_referral: store.REFERRAL_BONUS,
    });
  });
});

describe("invitedBy", () => {
  test("lists invited members newest first", () => {
    // Control recorded_at deterministically: new Date() honours the fake system
    // time, so the two entries get distinct, ordered ISO timestamps.
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      store.recordReferral("older", "ref");
      jest.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
      store.recordReferral("newer", "ref");
    } finally {
      jest.useRealTimers();
    }

    const invited = store.invitedBy("ref").map((entry) => entry.address);
    expect(invited).toEqual(["newer", "older"]);
  });

  test("returns an empty list for a blank or unknown address", () => {
    expect(store.invitedBy("")).toEqual([]);
    expect(store.invitedBy("nobody")).toEqual([]);
  });
});
