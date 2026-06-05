const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

const validProposer = "3MNQE1X7T4Bz9kLmNpQrStUvWx";
const validRecipient = "7YWHMfk9JZe9LMQaPq2X3B4C5D";
const otherValidWallet = "9ABcDefGhJKLMNPQrSTUvwxYZ12345";

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
        proposer_address: validProposer,
        recipient_address: validRecipient,
        title: "Bad category",
        description: "A treasury proposal with a bad category.",
        category: "private",
        requested_amount: 10,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/category/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("proposal validation rejects reserved treasury recipient before proxying", async () => {
    const response = await request(app)
      .post("/api/treasury/propose")
      .send({
        proposer_address: validProposer,
        recipient_address: "VORLIQ_TREASURY",
        title: "Reserved recipient",
        description: "A treasury proposal with a reserved recipient.",
        category: "security",
        requested_amount: 10,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/reserved system|system-controlled/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("proposal validation rejects malformed proposer before proxying", async () => {
    const response = await request(app)
      .post("/api/treasury/propose")
      .send({
        proposer_address: "not_an_address!",
        recipient_address: validRecipient,
        title: "Bad proposer",
        description: "A treasury proposal with a malformed proposer.",
        category: "security",
        requested_amount: 10,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/base58|address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("proposal validation rejects client supplied treasury balance before proxying", async () => {
    const response = await request(app)
      .post("/api/treasury/propose")
      .send({
        proposer_address: validProposer,
        proposer_wallet_address: validProposer,
        recipient_address: validRecipient,
        title: "Balance override",
        description: "A treasury proposal with a client supplied balance.",
        category: "security",
        requested_amount: 10,
        treasury_balance: 999999,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/derived by the server/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("vote validation rejects invalid vote", async () => {
    const response = await request(app)
      .post("/api/treasury/vote")
      .send({ proposal_id: "treasury-1", voter_address: validProposer, vote: "maybe" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/vote/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("vote validation rejects reserved voter before proxying", async () => {
    const response = await request(app)
      .post("/api/treasury/vote")
      .send({ proposal_id: "treasury-1", voter_address: "SYSTEM", vote: "yes" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/reserved system|system-controlled/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("vote validation rejects mismatched voter wallet source before proxying", async () => {
    const response = await request(app)
      .post("/api/treasury/vote")
      .send({
        proposal_id: "treasury-1",
        voter_address: validProposer,
        voter_wallet_address: otherValidWallet,
        vote: "yes",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/must match voter address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("vote validation rejects client supplied voter balance before proxying", async () => {
    const response = await request(app)
      .post("/api/treasury/vote")
      .send({
        proposal_id: "treasury-1",
        voter_address: validProposer,
        voter_wallet_address: validProposer,
        voter_balance: 1000000,
        vote: "yes",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/derived by the server/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("cancel validation rejects mismatched proposer wallet source before proxying", async () => {
    const response = await request(app)
      .post("/api/treasury/cancel")
      .send({
        proposal_id: "treasury-1",
        proposer_address: validProposer,
        proposer_wallet_address: otherValidWallet,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/must match proposer address/i);
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
