// Coverage for routes/invites.js: the invite-record flow (validation, self-invite
// guard, first-write-wins short-circuit, on-chain referrer check, success) and
// the invite summary read. referralStore is backed by a temp data dir; the
// on-chain existence check (Flask) is mocked via axios.

const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.VORLIQ_DISABLE_RATE_LIMITS = "true";
process.env.VORLIQ_BACKEND_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vlq-invites-"));

const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

beforeEach(() => {
  jest.clearAllMocks();
});

// Distinct addresses per test so referralStore state never collides.
let seq = 0;
function addr(prefix) {
  seq += 1;
  return `${prefix}_${seq}_${Date.now()}`;
}

describe("POST /api/invites/record", () => {
  test("requires both a wallet and a referrer", async () => {
    const response = await request(app).post("/api/invites/record").send({ wallet_address: addr("m") });
    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("rejects self-invite", async () => {
    const me = addr("self");
    const response = await request(app)
      .post("/api/invites/record")
      .send({ wallet_address: me, referrer_address: me });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/yourself/i);
  });

  test("rejects a referrer that has no on-chain history", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { transaction_count: 0 } });
    const response = await request(app)
      .post("/api/invites/record")
      .send({ wallet_address: addr("m"), referrer_address: addr("r") });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("REFERRER_NOT_ON_CHAIN");
  });

  test("records an invite when the referrer exists on chain", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { transaction_count: 3 } });
    const member = addr("m");
    const referrer = addr("r");
    const response = await request(app)
      .post("/api/invites/record")
      .send({ wallet_address: member, referrer_address: referrer });
    expect(response.status).toBe(200);
    expect(response.body.recorded).toBe(true);
    expect(response.body.referrer).toBe(referrer);
  });

  test("is idempotent — a second referrer is ignored (first write wins)", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { transaction_count: 5 } });
    const member = addr("m");
    const first = addr("r");
    await request(app).post("/api/invites/record").send({ wallet_address: member, referrer_address: first });

    const second = addr("r");
    const response = await request(app)
      .post("/api/invites/record")
      .send({ wallet_address: member, referrer_address: second });
    expect(response.status).toBe(200);
    expect(response.body.already_recorded).toBe(true);
    expect(response.body.referrer).toBe(first); // unchanged
    // The on-chain check is skipped entirely on the already-recorded short-circuit.
  });
});

describe("GET /api/invites/summary", () => {
  test("requires an address", async () => {
    const response = await request(app).get("/api/invites/summary");
    expect(response.status).toBe(400);
  });

  test("returns the invite graph for an address", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { transaction_count: 2 } });
    const referrer = addr("r");
    const member = addr("m");
    await request(app).post("/api/invites/record").send({ wallet_address: member, referrer_address: referrer });

    const response = await request(app).get(`/api/invites/summary?address=${referrer}`);
    expect(response.status).toBe(200);
    expect(response.body.invited_count).toBeGreaterThanOrEqual(1);
    expect(response.body.invited.map((i) => i.address)).toContain(member);
    expect(response.body.earnings).toBeDefined();
  });
});
