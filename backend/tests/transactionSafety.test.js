const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

const validSender = "3MNQE1X7T4Bz9kLmNpQrStUvWx";
const validReceiver = "7YWHMfk9JZe9LMQaPq2X3B4C5D";
const validBody = {
  sender_address: validSender,
  receiver_address: validReceiver,
  amount: 1.5,
  signature: "abcdef123456",
  sender_public_key: "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/transaction/send safety validation", () => {
  test("rejects invalid body before forwarding", async () => {
    const response = await request(app).post("/api/transaction/send").send({
      ...validBody,
      receiver_address: "not_an_address",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/base58|address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects same sender and receiver", async () => {
    const response = await request(app).post("/api/transaction/send").send({
      ...validBody,
      receiver_address: validSender,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/same address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects reserved sender", async () => {
    const response = await request(app).post("/api/transaction/send").send({
      ...validBody,
      sender_address: "SYSTEM",
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/system/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects invalid amount with a clean error response", async () => {
    const response = await request(app).post("/api/transaction/send").send({
      ...validBody,
      amount: 0,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false });
    expect(response.body.message).toMatch(/amount/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("forwards valid public transaction body", async () => {
    axios.post.mockResolvedValue({
      status: 201,
      data: { success: true, tx_id: "tx-safe", transaction: { tx_id: "tx-safe", status: "pending" } },
    });

    const response = await request(app).post("/api/transaction/send").send(validBody);

    expect(response.status).toBe(201);
    expect(response.body.tx_id).toBe("tx-safe");
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/transaction", validBody);
  });
});
