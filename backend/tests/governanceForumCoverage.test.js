// Coverage for the governance and forum GET read routes: success forwarding and
// the sanitized upstream-error (503) branch. Only Flask (axios) is mocked.

const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  axios.get.mockResolvedValue({ status: 200, data: { success: true, proposals: [], posts: [] } });
});

const readRoutes = [
  "/api/governance/proposals",
  "/api/governance/all",
  "/api/governance/summary",
  "/api/governance/settings",
  "/api/governance/rule-changes",
  "/api/governance/settings/history",
  "/api/forum/posts",
  "/api/forum/featured",
];

describe("governance + forum reads — success", () => {
  test.each(readRoutes)("%s forwards an upstream success", async (route) => {
    const response = await request(app).get(route);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

describe("governance + forum reads — sanitized upstream error", () => {
  test.each(readRoutes)("%s returns a sanitized 503 when Flask is down", async (route) => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:5001");
    err.code = "ECONNREFUSED";
    axios.get.mockRejectedValue(err);
    const response = await request(app).get(route);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(response.body)).not.toContain("5001");
  });
});
