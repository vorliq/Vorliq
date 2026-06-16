const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { SIGNED_AUTHORIZATION_MESSAGE, UNSIGNED_AUTHORITY_WRITE_PATHS } = require("../middleware/signedAuthorization");

describe("signed authority write containment", () => {
  const validWallet = "3MNQE1X7T4Bz9kLmNpQrStUvWx";
  const recipientWallet = "7YWHMfk9JZe9LMQaPq2X3B4C5D";
  const validBodies = {
    "/api/governance/propose": {
      proposer_address: validWallet,
      title: "Community rule proposal",
      description: "A sufficiently detailed community governance proposal for authorization testing.",
      category: "general",
      parameter: "documented-value",
    },
    "/api/governance/vote": { proposal_id: "proposal-1", voter_address: validWallet, vote: "yes" },
    "/api/governance/cancel": { proposal_id: "proposal-1", proposer_address: validWallet },
    "/api/treasury/propose": {
      proposer_address: validWallet,
      recipient_address: recipientWallet,
      title: "Community work",
      description: "Fund a documented piece of useful community work.",
      category: "security",
      requested_amount: 10,
    },
    "/api/treasury/vote": { proposal_id: "treasury-1", voter_address: validWallet, vote: "yes" },
    "/api/treasury/cancel": { proposal_id: "treasury-1", proposer_address: validWallet },
    "/api/lending/request": { requester_address: validWallet, amount: 10, reason: "Community work" },
    "/api/lending/vote": { loan_id: "loan-1", voter_address: validWallet, vote: "yes" },
    "/api/lending/repay": { loan_id: "loan-1", repayer_address: validWallet },
    "/api/forum/post": { author_address: validWallet, title: "Community update", body: "A forum post body for authorization testing.", category: "general" },
    "/api/forum/reply": { post_id: "post-1", author_address: validWallet, body: "A forum reply body for authorization testing." },
    "/api/forum/feature": { post_id: "post-1", voter_address: validWallet },
    "/api/profiles/profile": { wallet_address: validWallet, display_name: "Tester Name" },
  };

  test.each(Array.from(UNSIGNED_AUTHORITY_WRITE_PATHS))("blocks unsigned authority write %s", async (path) => {
    const response = await request(app).post(path).send(validBodies[path]);

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(SIGNED_AUTHORIZATION_MESSAGE);
    expect(response.body.error.code).toBe("SIGNED_AUTHORIZATION_REQUIRED");
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("keeps read-only authority records available", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { active_count: 0 } },
    });

    const response = await request(app).get("/api/governance/summary");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test("blocks unsigned authority writes through the stable v1 alias", async () => {
    const response = await request(app)
      .post("/api/v1/governance/vote")
      .send(validBodies["/api/governance/vote"]);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("SIGNED_AUTHORIZATION_REQUIRED");
    expect(axios.post).not.toHaveBeenCalled();
  });
});
