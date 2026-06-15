const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/wallet/history", () => {
  const ADDRESS = "VLQ_ME";

  test("requires an address", async () => {
    const response = await request(app).get("/api/wallet/history");
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("aggregates sent/received totals and a cumulative balance series", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        has_more: false,
        transactions: [
          { tx_id: "t1", receiver_address: ADDRESS, sender_address: "VLQ_OTHER", amount: 100, block_index: 1, timestamp: 10 },
          { tx_id: "t2", receiver_address: ADDRESS, sender_address: "VLQ_FAUCET", amount: 25, block_index: 2, timestamp: 20 },
          { tx_id: "t3", receiver_address: "VLQ_FRIEND", sender_address: ADDRESS, amount: 40, block_index: 3, timestamp: 30 },
        ],
      },
    });

    const response = await request(app).get(`/api/wallet/history?address=${ADDRESS}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.transaction_count).toBe(3);
    expect(response.body.total_received).toBe(125);
    expect(response.body.total_sent).toBe(40);
    expect(response.body.balance_history).toHaveLength(3);
    expect(response.body.balance_history[0].balance).toBe(100);
    expect(response.body.balance_history[2].balance).toBe(85);
  });

  test("pages through results until has_more is false", async () => {
    const firstPage = Array.from({ length: 200 }, (_, i) => ({
      tx_id: `a${i}`,
      receiver_address: ADDRESS,
      sender_address: "VLQ_X",
      amount: 1,
      block_index: i,
      timestamp: i,
    }));
    axios.get
      .mockResolvedValueOnce({ data: { success: true, has_more: true, transactions: firstPage } })
      .mockResolvedValueOnce({
        data: {
          success: true,
          has_more: false,
          transactions: [
            { tx_id: "b1", receiver_address: ADDRESS, sender_address: "VLQ_X", amount: 5, block_index: 999, timestamp: 999 },
          ],
        },
      });

    const response = await request(app).get(`/api/wallet/history?address=${ADDRESS}`);

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(response.body.transaction_count).toBe(201);
    expect(response.body.total_received).toBe(205);
  });

  test("returns an upstream error when the chain service is unavailable", async () => {
    axios.get.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "ECONNREFUSED" }));

    const response = await request(app).get(`/api/wallet/history?address=${ADDRESS}`);

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
  });
});
