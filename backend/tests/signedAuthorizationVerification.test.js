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

function testWallet() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const public_key = publicKey.export({ format: "pem", type: "spki" });
  return { privateKey, public_key, wallet: addressFromPublicKey(public_key) };
}

function signedBody(path, action, actorField, payload = {}, options = {}) {
  const signer = options.signer || testWallet();
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = options.nonce || `nonce-${crypto.randomUUID()}`;
  const body = { ...payload, [actorField]: options.actor || signer.wallet };
  const hash = bodyHash(body);
  const message = authorizationMessage({
    action: options.action || action,
    body_hash: options.body_hash || hash,
    nonce,
    timestamp,
    wallet: options.wallet || signer.wallet,
  });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), signer.privateKey).toString("hex");
  return {
    path,
    signer,
    body: {
      ...body,
      authorization: {
        wallet: options.wallet || signer.wallet,
        public_key: options.public_key || signer.public_key,
        signature: options.signature || signature,
        message: options.message || message,
        timestamp,
        nonce,
        action: options.action || action,
        body_hash: options.body_hash || hash,
        domain: AUTHORIZATION_DOMAIN,
      },
    },
  };
}

describe("signed authority authorization verification", () => {
  beforeEach(() => {
    axios.post.mockReset();
    resetUsedNoncesForTests();
  });

  const votePayload = { proposal_id: "proposal-1", vote: "yes" };

  test("uses the canonical cross-runtime signing vector", () => {
    const payload = { amount: 10, reason: "Community work", requester_address: "3MNQE1X7T4Bz9kLmNpQrStUvWx" };
    expect(bodyHash(payload)).toBe("306a764ac47e83ec1a6366464338434e9d8f91b172a872f418ce37e17aace7bc");
    expect(
      authorizationMessage({
        action: "lending.request",
        body_hash: bodyHash(payload),
        nonce: "nonce-example-1234",
        timestamp: 1700000000,
        wallet: payload.requester_address,
      })
    ).toBe(
      '{"action":"lending.request","body_hash":"306a764ac47e83ec1a6366464338434e9d8f91b172a872f418ce37e17aace7bc","domain":"vorliq.authority.v1","nonce":"nonce-example-1234","timestamp":1700000000,"wallet":"3MNQE1X7T4Bz9kLmNpQrStUvWx"}'
    );
  });

  test("accepts a valid signed request and proxies the unchanged envelope", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true } });
    const signed = signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload);

    const response = await request(app).post(signed.path).send(signed.body);

    expect(response.status).toBe(200);
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/governance/vote", signed.body);
  });

  test.each([
    ["/api/governance/propose", "governance.propose", "proposer_address", { title: "Rule", description: "A sufficiently detailed governance proposal.", category: "general", parameter: "note" }, "/governance/propose"],
    ["/api/governance/vote", "governance.vote", "voter_address", { proposal_id: "proposal-1", vote: "yes" }, "/governance/vote"],
    ["/api/governance/cancel", "governance.cancel", "proposer_address", { proposal_id: "proposal-1" }, "/governance/cancel"],
    ["/api/treasury/propose", "treasury.propose", "proposer_address", { recipient_address: testWallet().wallet, title: "Work", description: "Fund a useful piece of community work.", category: "security", requested_amount: 10 }, "/treasury/propose"],
    ["/api/treasury/vote", "treasury.vote", "voter_address", { proposal_id: "treasury-1", vote: "yes" }, "/treasury/vote"],
    ["/api/treasury/cancel", "treasury.cancel", "proposer_address", { proposal_id: "treasury-1" }, "/treasury/cancel"],
    ["/api/lending/request", "lending.request", "requester_address", { amount: 10, reason: "Useful work" }, "/lending/request"],
    ["/api/lending/vote", "lending.vote", "voter_address", { loan_id: "loan-1", vote: "yes" }, "/lending/vote"],
    ["/api/lending/repay", "lending.repay", "repayer_address", { loan_id: "loan-1" }, "/lending/repay"],
  ])("accepts valid authorization for %s", async (path, action, actorField, payload, flaskPath) => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true } });
    const signed = signedBody(path, action, actorField, payload);
    const response = await request(app).post(path).send(signed.body);
    expect(response.status).toBe(200);
    expect(axios.post).toHaveBeenCalledWith(`http://localhost:5001${flaskPath}`, signed.body);
  });

  test.each([
    ["malformed authorization", (signed) => ({ ...signed.body, authorization: { wallet: signed.signer.wallet } }), "AUTHORIZATION_MALFORMED"],
    ["expired timestamp", () => signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { timestamp: 1 }).body, "AUTHORIZATION_EXPIRED"],
    ["wrong action", () => signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { action: "treasury.vote" }).body, "AUTHORIZATION_ACTION_MISMATCH"],
    ["wrong body hash", () => signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { body_hash: "0".repeat(64) }).body, "AUTHORIZATION_BODY_HASH_MISMATCH"],
    ["wrong wallet", (signed) => signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { signer: signed.signer, wallet: testWallet().wallet }).body, "AUTHORIZATION_WALLET_MISMATCH"],
    ["wrong public key", (signed) => signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { signer: signed.signer, public_key: testWallet().public_key }).body, "AUTHORIZATION_WALLET_MISMATCH"],
    ["invalid signature", () => signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { signature: "abcdef" }).body, "AUTHORIZATION_SIGNATURE_INVALID"],
    ["payload actor mismatch", (signed) => signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { signer: signed.signer, actor: testWallet().wallet }).body, "AUTHORIZATION_ACTOR_MISMATCH"],
  ])("rejects %s", async (_name, mutate, code) => {
    const signed = signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload);
    const response = await request(app).post(signed.path).send(mutate(signed));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.error.code).toBe(code);
    expect(axios.post).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(signed.body.authorization.signature);
    expect(JSON.stringify(response.body)).not.toContain(signed.body.authorization.public_key);
  });

  test("rejects the wrong authorization domain", async () => {
    const signed = signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload);
    signed.body.authorization.domain = "wrong.domain";
    const response = await request(app).post(signed.path).send(signed.body);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHORIZATION_DOMAIN_MISMATCH");
  });

  test.each(["SYSTEM", "admin", "operator", "moderator"])("rejects reserved or role-like wallet %s", async (wallet) => {
    const signed = signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { wallet, actor: wallet });
    const response = await request(app).post(signed.path).send(signed.body);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects client-supplied authority overrides", async () => {
    const signed = signedBody("/api/governance/vote", "governance.vote", "voter_address", { ...votePayload, vote_weight: 999 });
    const response = await request(app).post(signed.path).send(signed.body);
    expect(response.status).toBe(400);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects a duplicate nonce", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true } });
    const nonce = `nonce-${crypto.randomUUID()}`;
    const signed = signedBody("/api/governance/vote", "governance.vote", "voter_address", votePayload, { nonce });
    expect((await request(app).post(signed.path).send(signed.body)).status).toBe(200);
    const replay = await request(app).post(signed.path).send(signed.body);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("AUTHORIZATION_REPLAYED");
  });
});
