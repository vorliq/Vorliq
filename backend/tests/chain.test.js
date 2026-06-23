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
      timeout: 5000,
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
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain/summary", { timeout: 5000 });
  });

  test("returns index health through the public safe endpoint", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        exists: true,
        valid: true,
        status: "ok",
        chain_height: 3,
        latest_block_hash: "0000abc",
        rebuild_needed: false,
      },
    });

    const response = await request(app).get("/api/indexes/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(JSON.stringify(response.body)).not.toMatch(/ADMIN_TOKEN|secret|\/home\/vorliq/i);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/indexes/health");
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

  test("forwards block detail lookup", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, block: { index: 1, hash: "0000abc", transactions: [] } },
    });

    const response = await request(app).get("/api/chain/block/0000abc");

    expect(response.status).toBe(200);
    expect(response.body.block.hash).toBe("0000abc");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain/block/0000abc");
  });

  test("forwards pending transactions with validation", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, transactions: [{ tx_id: "tx1", status: "pending" }], total: 1 },
    });

    const response = await request(app).get("/api/transactions/pending?limit=5&offset=0&address=VLQ_TEST");

    expect(response.status).toBe(200);
    expect(response.body.transactions[0].status).toBe("pending");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/transactions/pending", {
      params: { limit: 5, offset: 0, address: "VLQ_TEST" },
    });
  });

  test("forwards transaction detail lookup", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, transaction: { tx_id: "abc123", status: "confirmed" } },
    });

    const response = await request(app).get("/api/transactions/abc123");

    expect(response.status).toBe(200);
    expect(response.body.transaction.tx_id).toBe("abc123");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/transactions/abc123");
  });

  test("forwards transaction list filters", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, transactions: [], total: 0 },
    });

    const response = await request(app).get("/api/transactions?limit=10&offset=2&address=VLQ_TEST&type=transfer&status=confirmed");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/transactions", {
      params: { limit: 10, offset: 2, address: "VLQ_TEST", type: "transfer", status: "confirmed" },
    });
  });

  test("rejects invalid transaction status before forwarding", async () => {
    const response = await request(app).get("/api/transactions?status=unknown");

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/status/i);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("validates transaction pagination before forwarding", async () => {
    const response = await request(app).get("/api/transactions/pending?limit=0");

    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
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

  test("admin index health requires token", async () => {
    const response = await request(app).get("/api/admin/indexes");

    expect(response.status).toBe(401);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("admin index rebuild requires token", async () => {
    const response = await request(app).post("/api/admin/indexes/rebuild");

    expect(response.status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
