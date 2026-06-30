// Coverage for the read-heavy Flask-proxy routes (treasury, chain, network,
// network-health, activity). Each GET handler validates/forwards and renders the
// upstream response; the error branch sanitizes upstream/connection failures.
// Only Flask (axios) is mocked. These assert the success path and, for handlers
// that use handleRouteError, the sanitized failure path.

const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  // Default: every upstream GET resolves with a generic successful envelope.
  axios.get.mockResolvedValue({ status: 200, data: { success: true, items: [], chain: [], summary: {} } });
});

// GET routes that simply proxy and render an upstream success.
const successRoutes = [
  "/api/treasury/balance",
  "/api/treasury/summary",
  "/api/treasury/transparency",
  "/api/treasury/proposals",
  "/api/treasury/all",
  "/api/treasury/proposal?proposal_id=p1",
  "/api/treasury/my?address=VLQ_X",
  "/api/treasury/ledger",
  "/api/chain",
  "/api/economics",
  "/api/economics/overview",
  "/api/chain/blocks",
  "/api/chain/summary",
  "/api/community/stats",
  "/api/indexes/health",
  "/api/chain/address?address=VLQ_X",
  "/api/chain/block/1",
  "/api/leaderboard",
  "/api/peers",
  "/api/peers/propagation/status",
  "/api/peers/propagation/events",
  "/api/network-health",
  "/api/activity",
];

describe("read routes — success path", () => {
  test.each(successRoutes)("%s forwards an upstream success", async (route) => {
    const response = await request(app).get(route);
    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalled();
  });
});

// A subset whose handlers sanitize failures via handleRouteError (HTTP 503,
// no raw connection detail leaked).
const sanitizedErrorRoutes = [
  "/api/treasury/summary",
  "/api/treasury/proposals",
  "/api/treasury/ledger",
  "/api/peers/propagation/status",
];

describe("read routes — sanitized upstream-error path", () => {
  test.each(sanitizedErrorRoutes)("%s returns a sanitized 503 when Flask is down", async (route) => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:5001");
    err.code = "ECONNREFUSED";
    axios.get.mockRejectedValue(err);

    const response = await request(app).get(route);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
  });
});

describe("read routes — input validation", () => {
  test("treasury proposal requires a proposal id", async () => {
    const response = await request(app).get("/api/treasury/proposal");
    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("treasury my requires an address", async () => {
    const response = await request(app).get("/api/treasury/my");
    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("network-health degrades gracefully when a dependency fails", () => {
  test("still responds when one upstream call rejects", async () => {
    // Promise.allSettled-style aggregation: a single failing dependency must not
    // 500 the whole panel.
    axios.get.mockImplementation((url) => {
      if (String(url).includes("/registry/nodes")) return Promise.reject(new Error("registry down"));
      return Promise.resolve({ status: 200, data: { success: true } });
    });
    const response = await request(app).get("/api/network-health");
    expect(response.status).toBeLessThan(500);
  });
});
