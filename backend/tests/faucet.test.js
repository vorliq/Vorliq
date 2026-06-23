const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");
const { requestFingerprint } = require("../routes/faucet");

const validWallet = "3MNQE1X7T4Bz9kLmNpQrStUvWx";

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("faucet routes", () => {
  test("forwards faucet summary route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { starter_amount: 1, treasury_balance: 25 } },
    });

    const response = await request(app).get("/api/faucet/summary");

    expect(response.status).toBe(200);
    expect(response.body.summary.starter_amount).toBe(1);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/faucet/summary");
  });

  test("claim validation requires wallet address", async () => {
    const response = await request(app).post("/api/faucet/claim").send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/wallet address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("claim validation blocks system addresses", async () => {
    const response = await request(app).post("/api/faucet/claim").send({ wallet_address: "VORLIQ_TREASURY" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/system-controlled/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("claim validation rejects malformed wallet addresses before proxying", async () => {
    const response = await request(app).post("/api/faucet/claim").send({ wallet_address: "not_an_address!" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/base58|wallet address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("claim forwards hashed fingerprint without raw request details", async () => {
    axios.post.mockResolvedValue({
      status: 201,
      data: { success: true, claim: { status: "pending", tx_id: "tx123" } },
    });

    const response = await request(app)
      .post("/api/faucet/claim")
      .set("User-Agent", "jest-faucet-agent")
      .send({ wallet_address: validWallet });

    expect(response.status).toBe(201);
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:5001/faucet/claim",
      {
        wallet_address: validWallet,
        fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      // The route forwards with validateStatus so it can pass Flask's 4xx/429
      // bodies straight through and only record genuine 2xx successes.
      expect.objectContaining({ validateStatus: expect.any(Function) })
    );
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/jest-faucet-agent/i);
    expect(body).not.toMatch(/127\.0\.0\.1|::ffff/i);
  });

  test("claims route validates and forwards address", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, claims: [] },
    });

    const response = await request(app).get(`/api/faucet/claims?address=${validWallet}`);

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/faucet/claims", {
      params: { address: validWallet },
    });
  });

  test("recent route forwards pagination", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, claims: [], total: 0 },
    });

    const response = await request(app).get("/api/faucet/recent?limit=5&offset=10");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/faucet/recent", {
      params: { limit: 5, offset: 10 },
    });
  });

  test("request fingerprint is deterministic and hides raw input", () => {
    const req = {
      ip: "203.0.113.10",
      get: () => "secret-browser",
    };

    const fingerprint = requestFingerprint(req);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("203.0.113.10");
    expect(fingerprint).not.toContain("secret-browser");
    expect(fingerprint).toBe(requestFingerprint(req));
  });
});
