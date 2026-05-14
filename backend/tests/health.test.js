const request = require("supertest");

const app = require("../index");

describe("GET /api/health", () => {
  test("returns backend health status", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Vorliq backend is running");
  });
});
