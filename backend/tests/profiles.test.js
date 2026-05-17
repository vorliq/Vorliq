const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("profile routes", () => {
  test("rejects invalid profile fields before proxying", async () => {
    const response = await request(app)
      .post("/api/profiles/profile")
      .send({
        wallet_address: "VLQ_PROFILE",
        display_name: "ab",
        website: "javascript:alert(1)",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("proxies valid create or update profile requests", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        profile: { wallet_address: "VLQ_PROFILE", display_name: "Profile User" },
      },
    });

    const response = await request(app)
      .post("/api/profiles/profile")
      .send({
        wallet_address: "VLQ_PROFILE",
        display_name: "Profile User",
        bio: "Community builder",
        avatar_style: "green",
        website: "https://example.com",
      });

    expect(response.status).toBe(200);
    expect(response.body.profile.display_name).toBe("Profile User");
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/profiles/profile", {
      wallet_address: "VLQ_PROFILE",
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
