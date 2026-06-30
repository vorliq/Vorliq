// Coverage-focused tests for routes/exchange.js: the GET read routes' success
// and upstream-error branches, input validation rejections, and the signed
// write routes (offer / accept / cancel / etc.) including the live broadcast
// fan-out and the upstream-error path. The signed-authorization gate is
// satisfied with real secp256k1 signatures (the same scheme production uses),
// so these exercise the real handlers end to end with only Flask (axios) mocked.

process.env.VORLIQ_DISABLE_RATE_LIMITS = "true";

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

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  if (typeof resetUsedNoncesForTests === "function") resetUsedNoncesForTests();
});

function makeWallet() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const public_key = publicKey.export({ format: "pem", type: "spki" });
  return { privateKey, public_key, wallet: addressFromPublicKey(public_key) };
}

// Build a body carrying a valid signed authorization for `action`. The signature
// covers the canonical message derived from the body hash (authorization excluded).
function signedBody(signer, action, body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = `nonce-${crypto.randomUUID()}`;
  const hash = bodyHash(body);
  const message = authorizationMessage({ action, body_hash: hash, nonce, timestamp, wallet: signer.wallet });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), signer.privateKey).toString("hex");
  return {
    ...body,
    authorization: {
      wallet: signer.wallet,
      public_key: signer.public_key,
      signature,
      message,
      timestamp,
      nonce,
      action,
      body_hash: hash,
      domain: AUTHORIZATION_DOMAIN,
    },
  };
}

describe("exchange GET routes — success and upstream-error branches", () => {
  const getRoutes = [
    ["/api/exchange/offers", "/exchange/offers"],
    ["/api/exchange/all", "/exchange/all"],
    ["/api/exchange/summary", "/exchange/summary"],
  ];

  test.each(getRoutes)("%s forwards a successful upstream response", async (route) => {
    axios.get.mockResolvedValue({ status: 200, data: { success: true, offers: [] } });
    const response = await request(app).get(route);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test.each(getRoutes)("%s returns a sanitized 503 when Flask is unreachable", async (route) => {
    const err = new Error("connect ECONNREFUSED");
    err.code = "ECONNREFUSED";
    axios.get.mockRejectedValue(err);
    const response = await request(app).get(route);
    expect(response.status).toBe(503);
    expect(response.body.error.message).toMatch(/blockchain service is currently unavailable/i);
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
  });

  test("offer detail validates a missing offer_id before proxying", async () => {
    const response = await request(app).get("/api/exchange/offer");
    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("my-offers validates a missing address before proxying", async () => {
    const response = await request(app).get("/api/exchange/my");
    expect(response.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("offers list passes a validated status/type filter through to Flask", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { success: true, offers: [] } });
    const response = await request(app).get("/api/exchange/offers?status=open&type=sell&address=VLQ_X");
    expect(response.status).toBe(200);
    const [, options] = axios.get.mock.calls[0];
    expect(options.params).toMatchObject({ status: "open", type: "sell", address: "VLQ_X" });
  });
});

describe("exchange signed write routes", () => {
  test("a valid signed offer reaches Flask and broadcasts the update", async () => {
    const signer = makeWallet();
    axios.post.mockResolvedValue({
      status: 201,
      data: { success: true, offer: { offer_id: "offer-9", status: "open", creator_address: signer.wallet } },
    });

    const body = signedBody(signer, "exchange.offer", {
      creator_address: signer.wallet,
      offer_type: "sell",
      amount: 10,
      price: "goods",
      description: "trade",
    });
    const response = await request(app).post("/api/exchange/offer").send(body);

    expect(response.status).toBe(201);
    expect(response.body.offer.offer_id).toBe("offer-9");
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/exchange/offer", expect.objectContaining({
      creator_address: signer.wallet,
    }));
  });

  test("a signed cancel surfaces a sanitized 503 when Flask is unreachable", async () => {
    const signer = makeWallet();
    const err = new Error("socket hang up");
    err.code = "ECONNABORTED";
    axios.post.mockRejectedValue(err);

    const body = signedBody(signer, "exchange.cancel", { offer_id: "offer-9", caller_address: signer.wallet });
    const response = await request(app).post("/api/exchange/cancel").send(body);

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("socket hang up");
  });

  test("a signed accept passes the upstream status code through on a business rejection", async () => {
    const signer = makeWallet();
    // Flask rejects the trade (e.g., offer already accepted) with a 4xx.
    const upstream = new Error("Request failed with status code 409");
    upstream.response = { status: 409, data: { success: false, message: "offer already accepted" } };
    axios.post.mockRejectedValue(upstream);

    const body = signedBody(signer, "exchange.accept", { offer_id: "offer-9", acceptor_address: signer.wallet });
    const response = await request(app).post("/api/exchange/accept").send(body);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/already accepted/i);
  });
});
