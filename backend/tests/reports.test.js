// Tests for the weekly network report aggregator. Only the HTTP boundary
// (axios) is mocked; the real aggregation logic — 7-day windowing, SYSTEM-issued
// VLQ totals, status/time predicates, and the HTML rendering — is exercised for
// real. generateWeeklyReport({ sendEmail: false }) skips the Formspree POST.

jest.mock("axios");
const axios = require("axios");
const reports = require("../reports");

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0); // fixed "now"
const DAY = 24 * 60 * 60 * 1000;
const recentTs = Math.floor((NOW - 2 * DAY) / 1000); // within 7 days (seconds)
const oldTs = Math.floor((NOW - 30 * DAY) / 1000); // outside 7 days (seconds)

function fixtureFor(path) {
  switch (path) {
    case "/api/chain":
      return {
        chain: [
          { index: 0, timestamp: oldTs, transactions: [{ sender_address: "SYSTEM", amount: 50, timestamp: oldTs }] },
          {
            index: 1,
            timestamp: recentTs,
            transactions: [
              { sender_address: "SYSTEM", amount: 25, timestamp: recentTs }, // counts as issued
              { sender_address: "alice", amount: 5, timestamp: recentTs }, // recent, not SYSTEM
            ],
          },
        ],
      };
    case "/api/lending/loans":
      return {
        loans: [
          { status: "approved", timestamp: recentTs },
          { status: "pending", timestamp: recentTs },
          { status: "approved", timestamp: oldTs }, // too old
        ],
      };
    case "/api/exchange/all":
      return {
        offers: [
          { status: "completed", timestamp: recentTs, accepted_timestamp: recentTs },
          { status: "open", timestamp: recentTs },
        ],
      };
    case "/api/governance/all":
      return { proposals: [{ timestamp: recentTs }, { timestamp: oldTs }] };
    case "/api/treasury/balance":
      return { balance: 1234.5 };
    case "/api/treasury/all":
      return { proposals: [{ timestamp: recentTs }] };
    case "/api/diagnostics":
      return { block_height: 2, chain_valid: true, current_mining_reward: 25 };
    default:
      throw new Error(`unexpected path ${path}`);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
  axios.get.mockImplementation((url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return Promise.resolve({ data: fixtureFor(path) });
  });
  axios.post.mockResolvedValue({ status: 200, data: { ok: true } });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("generateWeeklyReport", () => {
  test("aggregates only activity inside the 7-day window", async () => {
    const report = await reports.generateWeeklyReport({ sendEmail: false });
    const { stats } = report;

    expect(report.success).toBe(true);
    expect(stats.new_blocks_mined).toBe(1); // only the recent block
    expect(stats.new_transactions).toBe(2); // both txs in the recent block
    expect(stats.new_vlq_issued).toBe(25); // only the recent SYSTEM tx
    expect(stats.new_loan_requests).toBe(2); // two recent loans
    expect(stats.new_loans_approved).toBe(1); // one recent + approved
    expect(stats.new_exchange_offers).toBe(2);
    expect(stats.new_exchange_trades_completed).toBe(1);
    expect(stats.new_governance_proposals).toBe(1);
    expect(stats.new_treasury_proposals).toBe(1);
    expect(stats.current_treasury_balance).toBe(1234.5);
    expect(stats.block_height).toBe(2);
    expect(stats.chain_valid).toBe(true);
    expect(stats.current_mining_reward).toBe(25);
  });

  test("renders an HTML body containing the computed figures and ISO date subject", async () => {
    const report = await reports.generateWeeklyReport({ sendEmail: false });
    expect(report.subject).toBe("Vorliq Weekly Network Report 2026-06-30");
    expect(report.html).toContain("Vorliq Weekly Network Report");
    expect(report.html).toContain("1,234.5"); // treasury balance formatted
    expect(report.html).toContain("valid"); // chain status
  });

  test("does not POST to Formspree when sendEmail is false", async () => {
    await reports.generateWeeklyReport({ sendEmail: false });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("POSTs the report to Formspree when sendEmail is true (default)", async () => {
    await reports.generateWeeklyReport();
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [endpoint, body] = axios.post.mock.calls[0];
    expect(endpoint).toMatch(/formspree\.io/);
    expect(body.subject).toMatch(/Vorliq Weekly Network Report/);
    expect(typeof body.message).toBe("string");
  });
});

describe("sendWeeklyReport", () => {
  test("rethrows and logs when the underlying generation fails", async () => {
    axios.get.mockRejectedValue(new Error("flask down"));
    await expect(reports.sendWeeklyReport()).rejects.toThrow("flask down");
  });
});
