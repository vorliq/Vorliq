const crypto = require("crypto");
const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");
const {
  AUTHORIZATION_DOMAIN,
  addressFromPublicKey,
  authorizationMessage,
  bodyHash,
  resetUsedNoncesForTests,
} = require("../middleware/signedAuthorization");

// Profile updates are now owner-only signed writes, so the tests sign with a real
// secp256k1 wallet the same way the browser does.
function signedProfile(fields) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const public_key = publicKey.export({ format: "pem", type: "spki" });
  const wallet = addressFromPublicKey(public_key);
  const body = { ...fields, wallet_address: wallet };
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = `nonce-${crypto.randomUUID()}`;
  const hash = bodyHash(body);
  const message = authorizationMessage({ action: "profile.update", body_hash: hash, nonce, timestamp, wallet });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), privateKey).toString("hex");
  return {
    wallet,
    body: {
      ...body,
      authorization: { wallet, public_key, signature, message, timestamp, nonce, action: "profile.update", body_hash: hash, domain: AUTHORIZATION_DOMAIN },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  resetUsedNoncesForTests();
});

describe("profile routes", () => {
  test("rejects an unsigned profile write (owner signature required)", async () => {
    const response = await request(app)
      .post("/api/profiles/profile")
      .send({ wallet_address: "VLQ_PROFILE", display_name: "No Signature" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("SIGNED_AUTHORIZATION_REQUIRED");
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects invalid profile fields even when properly signed", async () => {
    const signed = signedProfile({ display_name: "ab", website: "javascript:alert(1)" });

    const response = await request(app).post("/api/profiles/profile").send(signed.body);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("proxies a valid signed create or update, bound to the signing wallet", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { success: true, profile: { display_name: "Profile User" } },
    });
    const signed = signedProfile({
      display_name: "Profile User",
      bio: "Community builder",
      avatar_style: "green",
      website: "https://example.com",
    });

    const response = await request(app).post("/api/profiles/profile").send(signed.body);

    expect(response.status).toBe(200);
    expect(response.body.profile.display_name).toBe("Profile User");
    // The forwarded body is the sanitized profile bound to the signer's wallet.
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/profiles/profile", {
      wallet_address: signed.wallet,
      display_name: "Profile User",
      bio: "Community builder",
      location: "",
      country: "",
      avatar_style: "green",
      website: "https://example.com",
      x_link: "",
      telegram_link: "",
      discord_name: "",
    });
  });

  test("forwards profile search route with pagination", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, profiles: [{ wallet_address: "VLQ_ONE", display_name: "One" }] },
    });

    const response = await request(app).get("/api/profiles/search?q=one&limit=5&offset=10");

    expect(response.status).toBe(200);
    expect(response.body.profiles).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/profiles/search", {
      params: { limit: 5, offset: 10, q: "one" },
    });
  });

  test("forwards top profiles route with bounded limit", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, profiles: [{ wallet_address: "VLQ_TOP", reputation_score: 42 }] },
    });

    const response = await request(app).get("/api/profiles/top?limit=500");

    expect(response.status).toBe(200);
    expect(response.body.profiles[0].reputation_score).toBe(42);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/profiles/top", {
      params: { limit: 100 },
    });
  });
});
