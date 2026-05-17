const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("governance lifecycle routes", () => {
  test("forwards governance summary route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { active_count: 2, executed_count: 1 } },
    });

    const response = await request(app).get("/api/governance/summary");

    expect(response.status).toBe(200);
    expect(response.body.summary.active_count).toBe(2);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/governance/summary");
  });

  test("forwards proposal detail route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, proposal: { proposal_id: "prop-1", status: "active" } },
    });

    const response = await request(app).get("/api/governance/proposal?proposal_id=prop-1");

    expect(response.status).toBe(200);
    expect(response.body.proposal.status).toBe("active");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/governance/proposal", {
      params: { proposal_id: "prop-1" },
    });
  });

  test("forwards my governance route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, created: [], voted: [], proposals: [] },
    });

    const response = await request(app).get("/api/governance/my?address=VLQ_MEMBER");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/governance/my", {
      params: { address: "VLQ_MEMBER" },
    });
  });

  test("cancel validates required proposer address", async () => {
    const response = await request(app)
      .post("/api/governance/cancel")
      .send({ proposal_id: "prop-1" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/proposer address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("forwards rule changes route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, rule_changes: [{ rule_change_id: "rule-1" }] },
    });

    const response = await request(app).get("/api/governance/rule-changes?limit=10");

    expect(response.status).toBe(200);
    expect(response.body.rule_changes[0].rule_change_id).toBe("rule-1");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/governance/rule-changes", {
      params: { limit: 10, offset: 0 },
    });
  });

  test("rejects unsafe governance parameter before proxying", async () => {
    const response = await request(app)
      .post("/api/governance/propose")
      .send({
        proposer_address: "VLQ_MEMBER",
        title: "Unsafe reward",
        description: "This proposal tries to set a mining reward outside the safe allowed range.",
        category: "mining_reward",
        parameter: 5000,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("validates pagination and status filters", async () => {
    const response = await request(app).get("/api/governance/proposals?status=done&limit=10");

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/status/i);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("forwards valid proposal filters", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, proposals: [], total: 0 },
    });

    const response = await request(app).get("/api/governance/proposals?status=active&category=general&limit=10&offset=5");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/governance/proposals", {
      params: { limit: 10, offset: 5, status: "active", category: "general" },
    });
  });
});
