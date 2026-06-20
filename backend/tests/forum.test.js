const crypto = require("crypto");
const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const {
  AUTHORIZATION_DOMAIN,
  addressFromPublicKey,
  authorizationMessage,
  bodyHash,
  resetUsedNoncesForTests,
} = require("../middleware/signedAuthorization");

// Build a fully-signed forum.feature vote the same way the browser does, so we
// can exercise the VLQ-floor Sybil gate behind a real signature.
function signedFeatureVote() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const public_key = publicKey.export({ format: "pem", type: "spki" });
  const wallet = addressFromPublicKey(public_key);
  const body = { post_id: "post-1", voter_address: wallet };
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = `nonce-${crypto.randomUUID()}`;
  const hash = bodyHash(body);
  const message = authorizationMessage({ action: "forum.feature", body_hash: hash, nonce, timestamp, wallet });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), privateKey).toString("hex");
  return {
    wallet,
    body: {
      ...body,
      authorization: { wallet, public_key, signature, message, timestamp, nonce, action: "forum.feature", body_hash: hash, domain: AUTHORIZATION_DOMAIN },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetUsedNoncesForTests();
});

describe("forum feature-vote Sybil floor", () => {
  test("rejects a signed feature vote from a wallet below the VLQ floor", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { balance: 4 } }); // /balance lookup
    const signed = signedFeatureVote();

    const response = await request(app).post("/api/forum/feature").send(signed.body);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FEATURE_VOTE_INSUFFICIENT_VLQ");
    // The amplifying write must never reach the core when under the floor.
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("forwards a signed feature vote from a wallet at or above the VLQ floor", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { balance: 25 } });
    axios.post.mockResolvedValue({ status: 200, data: { success: true, featured: true } });
    const signed = signedFeatureVote();

    const response = await request(app).post("/api/forum/feature").send(signed.body);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/forum/feature", expect.objectContaining({
      post_id: "post-1",
      voter_address: signed.wallet,
    }));
  });

  test("treats an unreadable balance as below the floor (fails closed)", async () => {
    const connError = new Error("connect ECONNREFUSED 127.0.0.1:5001");
    connError.code = "ECONNREFUSED";
    axios.get.mockRejectedValue(connError);
    const signed = signedFeatureVote();

    const response = await request(app).post("/api/forum/feature").send(signed.body);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FEATURE_VOTE_INSUFFICIENT_VLQ");
    expect(axios.post).not.toHaveBeenCalled();
  });
});
