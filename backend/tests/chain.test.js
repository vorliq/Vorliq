const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("GET /api/chain", () => {
  test("returns the VLQ blockchain from the blockchain service", async () => {
    axios.get.mockResolvedValue({
      data: {
        coin: "VLQ",
        chain: [
          {
            index: 0,
            hash: "genesis-hash",
            transactions: [],
          },
        ],
      },
    });

    const response = await request(app).get("/api/chain");

    expect(response.status).toBe(200);
    expect(response.body.coin).toBe("VLQ");
    expect(Array.isArray(response.body.chain)).toBe(true);
    expect(response.body.chain).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain");
  });
});

describe("scalable chain routes", () => {
  test("validates pagination limit before forwarding", async () => {
    const response = await request(app).get("/api/chain/blocks?limit=0");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("enforces max limit on paginated blocks", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, blocks: [], total_blocks: 0, limit: 200, offset: 0, has_more: false },
    });

    const response = await request(app).get("/api/chain/blocks?limit=500&offset=0");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain/blocks", {
      params: { limit: 200, offset: 0 },
    });
  });

  test("returns chain summary through the lightweight endpoint", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { block_height: 3, total_blocks: 4, chain_valid: true } },
    });

    const response = await request(app).get("/api/chain/summary");

    expect(response.status).toBe(200);
    expect(response.body.summary.block_height).toBe(3);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain/summary");
  });

  test("forwards address transaction lookup with pagination", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, transactions: [], total: 0, limit: 5, offset: 10, has_more: false },
    });

    const response = await request(app).get("/api/chain/address?address=VLQ_TEST&limit=5&offset=10");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain/address", {
      params: { limit: 5, offset: 10, address: "VLQ_TEST" },
    });
  });

  test("returns leaderboard route from the blockchain service", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        holders: [{ address: "VLQ_A", value: 10 }],
        miners: [],
        lenders: [],
      },
    });

    const response = await request(app).get("/api/leaderboard?limit=10");

    expect(response.status).toBe(200);
    expect(response.body.holders).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/leaderboard", {
      params: { limit: 10, offset: 0 },
    });
  });
});
