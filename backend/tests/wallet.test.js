const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

// Isolate the wallet-creation abuse ledger to a fresh temp data dir (the same
// mechanism faucetAbuse.test.js uses). Otherwise it writes to the real
// backend/data/faucet-abuse.json and repeated local runs accumulate
// creations for 127.0.0.1 until the abuse guard returns HTTP 429.
let savedDataDir;
beforeAll(() => {
  savedDataDir = process.env.VORLIQ_BACKEND_DATA_DIR;
  process.env.VORLIQ_BACKEND_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vlq-wallet-"));
});
afterAll(() => {
  if (savedDataDir === undefined) delete process.env.VORLIQ_BACKEND_DATA_DIR;
  else process.env.VORLIQ_BACKEND_DATA_DIR = savedDataDir;
});

describe("POST /api/wallet/create", () => {
  test("returns wallet data from the blockchain service", async () => {
    axios.post.mockResolvedValue({
      status: 201,
      data: {
        address: "wallet-address",
        public_key: "public-key",
        private_key: "private-key",
        private_key_warning: "Save this private key securely.",
      },
    });

    const response = await request(app).post("/api/wallet/create");

    expect(response.status).toBe(201);
    expect(response.body.address).toBe("wallet-address");
    expect(response.body.public_key).toBe("public-key");
    expect(response.body.private_key).toBe("private-key");
    expect(response.body.private_key_warning).toBeTruthy();
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/wallet");
  });
});
