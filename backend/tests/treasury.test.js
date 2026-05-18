const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("treasury lifecycle routes", () => {
  test("forwards treasury summary route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { current_balance: 125, active_proposal_count: 1 } },
    });

    const response = await request(app).get("/api/treasury/summary");

    expect(response.status).toBe(200);
    expect(response.body.summary.current_balance).toBe(125);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/treasury/summary");
  });

  test("forwards proposal detail route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, proposal: { proposal_id: "treasury-1", status: "payout_pending" } },
    });

    const response = await request(app).get("/api/treasury/proposal?proposal_id=treasury-1");

    expect(response.status).toBe(200);
    expect(response.body.proposal.status).toBe("payout_pending");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/treasury/proposal", {
      params: { proposal_id: "treasury-1" },
    });
  });

  test("forwards my treasury route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, created: [], voted: [], received: [], proposals: [] },
    });

    const response = await request(app).get("/api/treasury/my?address=VLQ_MEMBER");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/treasury/my", {
      params: { address: "VLQ_MEMBER" },
    });
  });

  test("forwards treasury ledger route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, entries: [{ ledger_id: "ledger-1", type: "reward_in" }] },
    });

    const response = await request(app).get("/api/treasury/ledger?limit=10");

    expect(response.status).toBe(200);
    expect(response.body.entries[0].type).toBe("reward_in");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/treasury/ledger", {
      params: { limit: 10, offset: 0 },
    });
  });

  test("cancel validates required proposer address", async () => {
    const response = await request(app)
      .post("/api/treasury/cancel")
      .send({ proposal_id: "treasury-1" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/proposer address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("proposal validation rejects unsupported category", async () => {
    const response = await request(app)
      .post("/api/treasury/propose")
      .send({
        proposer_address: "VLQ_PROPOSER",
        recipient_address: "VLQ_RECIPIENT",
        title: "Bad category",
        description: "A treasury proposal with a bad category.",
        category: "private",
        requested_amount: 10,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/category/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("vote validation rejects invalid vote", async () => {
    const response = await request(app)
      .post("/api/treasury/vote")
      .send({ proposal_id: "treasury-1", voter_address: "VLQ_VOTER", vote: "maybe" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/vote/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("safe responses do not expose secrets", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { current_balance: 1, latest_ledger_entries: [] } },
    });

    const response = await request(app).get("/api/treasury/summary");

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/private|password|secret|token/i);
  });
});
