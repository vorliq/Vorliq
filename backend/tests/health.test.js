const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

describe("GET /api/health (liveness)", () => {
  test("returns backend health status without depending on Flask", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Vorliq backend is running");
  });
});

describe("GET /api/health/ready (dependency probe)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("reports healthy and 200 when Flask answers", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { status: "ok", coin: "VLQ" } });

    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("healthy");
    expect(response.body.flask).toBe("up");
    expect(response.body.node).toBe("up");
  });

  test("reports degraded and 503 when Flask is unreachable", async () => {
    const connError = new Error("connect ECONNREFUSED 127.0.0.1:5001");
    connError.code = "ECONNREFUSED";
    axios.get.mockRejectedValue(connError);

    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("degraded");
    expect(response.body.flask).toBe("down");
    expect(response.body.node).toBe("up");
    // The raw connection string must never leak through the probe.
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED/);
  });
});
