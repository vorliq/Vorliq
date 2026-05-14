const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");

describe("POST /api/wallet/create", () => {
  test("returns wallet data from the blockchain service", async () => {
    axios.post.mockResolvedValue({
      status: 201,
      data: {
        address: "wallet-address",
        public_key: "public-key",
        private_key: "private-key",
        private_key_warning: "Save this private key securely.",
      },
    });

    const response = await request(app).post("/api/wallet/create");

    expect(response.status).toBe(201);
    expect(response.body.address).toBe("wallet-address");
    expect(response.body.public_key).toBe("public-key");
    expect(response.body.private_key).toBe("private-key");
    expect(response.body.private_key_warning).toBeTruthy();
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/wallet");
  });
});
