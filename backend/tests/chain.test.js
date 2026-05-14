const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

describe("GET /api/chain", () => {
  test("returns the VLQ blockchain from the blockchain service", async () => {
    axios.get.mockResolvedValue({
      data: {
        coin: "VLQ",
        chain: [
          {
            index: 0,
            hash: "genesis-hash",
            transactions: [],
          },
        ],
      },
    });

    const response = await request(app).get("/api/chain");

    expect(response.status).toBe(200);
    expect(response.body.coin).toBe("VLQ");
    expect(Array.isArray(response.body.chain)).toBe(true);
    expect(response.body.chain).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/chain");
  });
});
