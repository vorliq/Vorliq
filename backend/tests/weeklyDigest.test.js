const axios = require("axios");

jest.mock("axios");
jest.mock("../mailer", () => ({ sendEmail: jest.fn(async () => "logged") }));

const { sendEmail } = require("../mailer");
const digest = require("../weeklyDigest");

const NOW = 1_800_000_000; // fixed "now" in seconds
const WEEK = 7 * 24 * 60 * 60;
const thisWeek = NOW - 1000; // inside the window
const lastMonth = NOW - 40 * 24 * 60 * 60; // outside the window

function route(url) {
  // Map a Flask URL to a canned response.
  if (url.endsWith("/notifications/digest-recipients")) {
    return { data: { recipients: [
      { wallet_address: "ACTIVE", email: "active@example.com" },
      { wallet_address: "QUIET", email: "quiet@example.com" },
    ] } };
  }
  if (url.includes("/forum/posts")) {
    return { data: { posts: [
      { title: "Hot post", vote_count: 5, replies: [{ timestamp: thisWeek }], timestamp: thisWeek },
      { title: "Old post", vote_count: 1, replies: [], timestamp: lastMonth },
    ] } };
  }
  if (url.endsWith("/balance")) return { data: { balance: 42 } };
  return { data: {} };
}

function addrFor(wallet) {
  if (wallet === "ACTIVE") {
    return { data: { confirmed_incoming: [
      { amount: 3, block_timestamp: thisWeek, category: "transfer" },
      { amount: 9, block_timestamp: lastMonth, category: "transfer" }, // filtered out
    ] } };
  }
  return { data: { confirmed_incoming: [{ amount: 9, block_timestamp: lastMonth }] } }; // all old => no activity
}

beforeEach(() => {
  sendEmail.mockClear();
  axios.get.mockReset();
  axios.get.mockImplementation((url, opts) => {
    if (url.endsWith("/chain/address")) return Promise.resolve(addrFor(opts.params.address));
    if (url.endsWith("/governance/my")) return Promise.resolve({ data: { voted: [] } });
    if (url.endsWith("/lending/my")) return Promise.resolve({ data: { borrowed: [], voted: [] } });
    if (url.endsWith("/balance")) return Promise.resolve({ data: { balance: 42 } });
    return Promise.resolve(route(url));
  });
});

describe("weekly digest", () => {
  test("emails members with activity this week and skips those without", async () => {
    process.env.ADMIN_TOKEN = "test-admin";
    const result = await digest.runWeeklyDigest(NOW);
    expect(result.recipients).toBe(2);
    expect(result.sent).toBe(1); // only ACTIVE
    expect(result.skippedNoActivity).toBe(1); // QUIET
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("active@example.com");
  });

  test("buildMemberDigest only counts this-week receipts and includes balance + top posts", async () => {
    const topPosts = await digest.topForumPosts(NOW - WEEK);
    const built = await digest.buildMemberDigest("ACTIVE", NOW, topPosts);
    expect(built.balance).toBe(42);
    expect(built.received).toHaveLength(1); // the old receipt is filtered out
    expect(built.received[0].amount).toBe(3);
    expect(built.hasActivity).toBe(true);
    expect(built.topPosts[0].title).toBe("Hot post");
  });

  test("a member with only old activity has hasActivity=false (no email)", async () => {
    const built = await digest.buildMemberDigest("QUIET", NOW, []);
    expect(built.received).toHaveLength(0);
    expect(built.hasActivity).toBe(false);
  });

  test("renderDigest produces a subject and includes balance + sections", () => {
    const out = digest.renderDigest({
      wallet: "W", balance: 42,
      received: [{ amount: 3, category: "transfer" }],
      proposals: [{ title: "P1", status: "passed" }],
      loans: [{ amount: 10, status: "active" }],
      topPosts: [{ title: "Hot post", score: 6 }],
      hasActivity: true,
    });
    expect(out.subject).toMatch(/week in review/i);
    expect(out.text).toMatch(/42 VLQ/);
    expect(out.text).toMatch(/P1/);
    expect(out.text).toMatch(/Hot post/);
  });
});
