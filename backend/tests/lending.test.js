const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

const validVoter = "3MNQE1X7T4Bz9kLmNpQrStUvWx";
const otherValidVoter = "7YWHMfk9JZe9LMQaPq2X3B4C5D";

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("lending routes", () => {
  test("forwards lending summary route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { active_count: 2, pending_vote_count: 1 } },
    });

    const response = await request(app).get("/api/lending/summary");

    expect(response.status).toBe(200);
    expect(response.body.summary.active_count).toBe(2);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/lending/summary");
  });

  test("forwards my loans route with address validation", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, borrowed: [], voted: [], loans: [] },
    });

    const response = await request(app).get("/api/lending/my?address=VLQ_MEMBER");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/lending/my", {
      params: { address: "VLQ_MEMBER" },
    });
  });

  test("rejects invalid lending filters before proxying", async () => {
    const response = await request(app).get("/api/lending/loans?status=approved&limit=5");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("forwards valid lending filters", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, loans: [], total: 0 },
    });

    const response = await request(app).get("/api/lending/loans?status=active&address=VLQ_A&limit=10&offset=5");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/lending/loans", {
      params: { limit: 10, offset: 5, status: "active", address: "VLQ_A" },
    });
  });

  test("forwards loan detail route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, loan: { loan_id: "loan-1", status: "active" } },
    });

    const response = await request(app).get("/api/lending/loan?loan_id=loan-1");

    expect(response.status).toBe(200);
    expect(response.body.loan.status).toBe("active");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/lending/loan", {
      params: { loan_id: "loan-1" },
    });
  });

  test("blocks unsigned repayment requests", async () => {
    const response = await request(app)
      .post("/api/lending/repay")
      .send({ loan_id: "loan-1", repayer_address: "VLQ_BORROWER" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("SIGNED_AUTHORIZATION_REQUIRED");
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects reserved lending vote identity before proxying", async () => {
    const response = await request(app)
      .post("/api/lending/vote")
      .send({ loan_id: "loan-1", voter_address: "LENDING_POOL", vote: "yes" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/reserved system|system-controlled/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects client supplied lending vote weight before proxying", async () => {
    const response = await request(app)
      .post("/api/lending/vote")
      .send({ loan_id: "loan-1", voter_address: validVoter, vote: "yes", voter_balance: 1000000 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/derived by the server/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects mismatched lending vote balance source before proxying", async () => {
    const response = await request(app)
      .post("/api/lending/vote")
      .send({
        loan_id: "loan-1",
        voter_address: validVoter,
        voter_wallet_address: otherValidVoter,
        vote: "yes",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/must match voter address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("blocks validated but unsigned lending votes", async () => {
    const body = {
      loan_id: "loan-1",
      voter_address: validVoter,
      voter_wallet_address: validVoter,
      vote: "yes",
    };

    const response = await request(app).post("/api/lending/vote").send(body);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("SIGNED_AUTHORIZATION_REQUIRED");
    expect(axios.post).not.toHaveBeenCalled();
  });
});
