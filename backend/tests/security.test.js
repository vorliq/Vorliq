const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

function forwarded(ip) {
  return { "X-Forwarded-For": ip };
}

describe("security validation", () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
  });

  test("rejects invalid wallet balance requests", async () => {
    const response = await request(app)
      .get("/api/wallet/balance")
      .set(forwarded("203.0.113.11"));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/wallet address/i);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("rejects invalid mining requests", async () => {
    const response = await request(app)
      .post("/api/mine")
      .set(forwarded("203.0.113.12"))
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/miner address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects invalid forum posts", async () => {
    const response = await request(app)
      .post("/api/forum/post")
      .set(forwarded("203.0.113.13"))
      .send({ author_address: "VLQ_AUTHOR", title: "", body: "hello", category: "general" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/title/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("allows forum detail reads without create-post body validation", async () => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: { success: true, post: { post_id: "post-1", title: "Community update", replies: [] } },
    });

    const response = await request(app)
      .get("/api/forum/post")
      .query({ post_id: "post-1" })
      .set(forwarded("203.0.113.14"));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.post.title).toBe("Community update");
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/forum/post"), {
      params: { post_id: "post-1" },
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("retires forum post tipping without forwarding unsafe signing fields", async () => {
    const dummyMarker = "REDACTED_DUMMY_SIGNING_MATERIAL";

    const response = await request(app)
      .post("/api/forum/tip/post")
      .set(forwarded("203.0.113.18"))
      .send({
        post_id: "post-1",
        sender_address: "VLQ_SENDER",
        sender_private_key: dummyMarker,
        receiver_address: "VLQ_RECEIVER",
        amount: 1,
      });

    expect(response.status).toBe(410);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORUM_TIPPING_RETIRED");
    expect(response.body.message).toMatch(/retired/i);
    expect(JSON.stringify(response.body)).not.toContain(dummyMarker);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("retires forum reply tipping without forwarding unsafe signing fields", async () => {
    const dummyMarker = "REDACTED_DUMMY_SIGNING_MATERIAL";

    const response = await request(app)
      .post("/api/forum/tip/reply")
      .set(forwarded("203.0.113.19"))
      .send({
        post_id: "post-1",
        reply_id: "reply-1",
        sender_address: "VLQ_SENDER",
        sender_private_key: dummyMarker,
        receiver_address: "VLQ_RECEIVER",
        amount: 1,
      });

    expect(response.status).toBe(410);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORUM_TIPPING_RETIRED");
    expect(response.body.message).toMatch(/retired/i);
    expect(JSON.stringify(response.body)).not.toContain(dummyMarker);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects invalid exchange offers", async () => {
    const response = await request(app)
      .post("/api/exchange/offer")
      .set(forwarded("203.0.113.14"))
      .send({
        creator_address: "VLQ_CREATOR",
        offer_type: "swap",
        amount: 10,
        price: "5 GBP",
        description: "Local trade",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/offer type/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects invalid governance proposals", async () => {
    const response = await request(app)
      .post("/api/governance/propose")
      .set(forwarded("203.0.113.15"))
      .send({
        proposer_address: "VLQ_PROPOSER",
        title: "Bad",
        description: "Bad proposal",
        category: "admin",
        parameter: 1,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/category/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects fake system transactions", async () => {
    const response = await request(app)
      .post("/api/transaction/send")
      .set(forwarded("203.0.113.16"))
      .send({
        sender_address: "SYSTEM",
        receiver_address: "VLQ_RECEIVER",
        amount: 10,
        timestamp: Date.now() / 1000,
        signature: "abcdef",
        sender_public_key: "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/system-controlled/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("security status returns safe public information", async () => {
    const response = await request(app)
      .get("/api/security/status")
      .set(forwarded("203.0.113.17"));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.rate_limiting_enabled).toBe(true);
    expect(response.body.security_headers_enabled).toBe(true);
    expect(response.body).not.toHaveProperty("secrets");
    expect(response.body).not.toHaveProperty("FLASK_URL");
  });

  test("mining route returns a clean JSON rate limit response", async () => {
    axios.post.mockResolvedValue({ status: 201, data: { success: true, block: { index: 1 } } });

    let lastResponse;
    for (let index = 0; index < 7; index += 1) {
      lastResponse = await request(app)
        .post("/api/mine")
        .set(forwarded("203.0.113.18"))
        .send({ miner_address: "VLQ_MINER" });
    }

    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.success).toBe(false);
    expect(lastResponse.body.message).toMatch(/rate limited/i);
  });
});
