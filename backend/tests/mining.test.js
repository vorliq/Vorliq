const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

jest.mock("axios");
const axios = require("axios");

const app = require("../index");
const { clearCache } = require("../cache");
const { mineOnce, safeText } = require("../miner");

describe("mining routes", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    process.env.ADMIN_TOKEN = "admin-mining-token";
  });

  afterEach(() => {
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;
    delete process.env.VORLIQ_MINER_STATUS_FILE;
    delete process.env.VORLIQ_PUBLIC_MINER_ENABLED;
    delete process.env.VORLIQ_PUBLIC_MINER_ADDRESS;
  });

  test("GET /api/mining/status returns safe public fields", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        status: {
          current_block_height: 4,
          chain_valid: true,
          current_difficulty: 3,
          miner_reward_after_treasury: 47.5,
          treasury_reward_per_block: 2.5,
        },
      },
    });

    const response = await request(app).get("/api/mining/status");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status.current_block_height).toBe(4);
    expect(JSON.stringify(response.body)).not.toMatch(/private|secret|token/i);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/mining/status");
  });

  test("GET /api/mining/history validates limit and offset", async () => {
    const response = await request(app).get("/api/mining/history?limit=0");

    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("GET /api/mining/history forwards pagination", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, history: [], total: 0, limit: 5, offset: 2 },
    });

    const response = await request(app).get("/api/mining/history?limit=5&offset=2");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/mining/history", {
      params: { limit: 5, offset: 2 },
    });
  });

  test("POST /api/mine preserves the mining-disabled application code", async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 503,
        data: {
          success: false,
          code: "MINING_DISABLED",
          message: "Mining is disabled on this node.",
        },
      },
    });

    const response = await request(app)
      .post("/api/mine")
      .send({ miner_address: "3brk5dNy9mn4Pk8YjQaqRtmTBTXG" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      code: "MINING_DISABLED",
      message: "Mining is disabled on this node.",
    });
  });

  test("admin mining status requires token", async () => {
    const response = await request(app).get("/api/admin/mining/status");

    expect(response.status).toBe(401);
  });

  test("admin mining status returns configured public miner state", async () => {
    const statusFile = path.join(os.tmpdir(), `vorliq-miner-${Date.now()}.json`);
    process.env.VORLIQ_MINER_STATUS_FILE = statusFile;
    process.env.VORLIQ_PUBLIC_MINER_ENABLED = "true";
    process.env.VORLIQ_PUBLIC_MINER_ADDRESS = "VLQ_MINER";
    fs.writeFileSync(
      statusFile,
      JSON.stringify({
        last_mining_attempt_timestamp: "2026-05-18T10:00:00.000Z",
        last_mining_result: "Mined block 5.",
      })
    );
    axios.get.mockResolvedValue({ status: 200, data: { success: true, status: { chain_valid: true } } });

    const response = await request(app)
      .get("/api/admin/mining/status")
      .set("Authorization", "Bearer admin-mining-token");

    fs.rmSync(statusFile, { force: true });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.autominers.public_node_miner_enabled).toBe(true);
    expect(response.body.last_mining_result).toBe("Mined block 5.");
    expect(JSON.stringify(response.body)).not.toContain("admin-mining-token");
  });
});

describe("public miner tool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("miner.js does not mine when disabled", async () => {
    const statusFile = path.join(os.tmpdir(), `vorliq-miner-disabled-${Date.now()}.json`);
    const result = await mineOnce({ enabled: false, statusFile });

    expect(result.mined).toBe(false);
    expect(result.reason).toBe("disabled");
    expect(axios.post).not.toHaveBeenCalled();
    fs.rmSync(statusFile, { force: true });
  });

  test("miner.js does not mine without miner address", async () => {
    const statusFile = path.join(os.tmpdir(), `vorliq-miner-no-address-${Date.now()}.json`);
    const result = await mineOnce({ enabled: true, minerAddress: "", statusFile });

    expect(result.mined).toBe(false);
    expect(result.reason).toBe("missing miner address");
    expect(axios.post).not.toHaveBeenCalled();
    fs.rmSync(statusFile, { force: true });
  });

  test("miner.js respects can_mine_now false", async () => {
    const statusFile = path.join(os.tmpdir(), `vorliq-miner-wait-${Date.now()}.json`);
    axios.get.mockResolvedValue({
      data: { success: true, status: { chain_valid: true, can_mine_now: false, reason_if_not: "Wait 20 seconds." } },
    });

    const result = await mineOnce({
      enabled: true,
      minerAddress: "VLQ_MINER",
      apiUrl: "http://localhost:5000",
      statusFile,
    });

    expect(result.mined).toBe(false);
    expect(result.reason).toBe("Wait 20 seconds.");
    expect(axios.post).not.toHaveBeenCalled();
    fs.rmSync(statusFile, { force: true });
  });

  test("miner.js no longer skips itself when it mined the latest block", async () => {
    // The old client-side permanent skip ("this address mined the last block, so
    // stop") is exactly what halted a single-miner network and stranded pending
    // transactions. The client must now attempt; the core grants the block or
    // defers it with a time-bounded cooldown (SAME_MINER_MIN_GAP).
    const statusFile = path.join(os.tmpdir(), `vorliq-miner-same-${Date.now()}.json`);
    axios.get.mockResolvedValue({
      data: {
        success: true,
        status: { chain_valid: true, can_mine_now: true, last_miner_address: "VLQ_MINER" },
      },
    });
    axios.post.mockResolvedValue({ data: { block: { index: 7, hash: "deadbeef" } } });

    const result = await mineOnce({
      enabled: true,
      minerAddress: "VLQ_MINER",
      apiUrl: "http://localhost:5000",
      statusFile,
    });

    expect(axios.post).toHaveBeenCalled();
    expect(result.mined).toBe(true);
    fs.rmSync(statusFile, { force: true });
  });

  test("miner.js surfaces the core's time-bounded cooldown rejection without crashing", async () => {
    const statusFile = path.join(os.tmpdir(), `vorliq-miner-cooldown-${Date.now()}.json`);
    axios.get.mockResolvedValue({
      data: {
        success: true,
        status: { chain_valid: true, can_mine_now: true, last_miner_address: "VLQ_MINER" },
      },
    });
    axios.post.mockRejectedValue({
      response: { data: { message: "the same address cannot mine two consecutive blocks yet; wait 42 seconds" } },
    });

    const result = await mineOnce({
      enabled: true,
      minerAddress: "VLQ_MINER",
      apiUrl: "http://localhost:5000",
      statusFile,
    });

    expect(result.mined).toBe(false);
    expect(result.reason).toMatch(/two consecutive blocks/i);
    fs.rmSync(statusFile, { force: true });
  });

  test("miner.js sanitizes secret-looking error text", () => {
    const sanitized = safeText("ADMIN_TOKEN=hidden password=bad private_key=secret");

    expect(sanitized).not.toContain("hidden");
    expect(sanitized).not.toContain("bad");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).toMatch(/redacted/);
  });
});
