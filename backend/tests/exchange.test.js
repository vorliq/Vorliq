const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { clearCache } = require("../cache");

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("exchange lifecycle routes", () => {
  test("forwards exchange summary route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, summary: { open_count: 2, active_trades_count: 1 } },
    });

    const response = await request(app).get("/api/exchange/summary");

    expect(response.status).toBe(200);
    expect(response.body.summary.open_count).toBe(2);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/exchange/summary");
  });

  test("forwards exchange my route with address validation", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, created: [], accepted: [], offers: [] },
    });

    const response = await request(app).get("/api/exchange/my?address=VLQ_MEMBER");

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/exchange/my", {
      params: { address: "VLQ_MEMBER" },
    });
  });

  test("forwards offer detail route", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { success: true, offer: { offer_id: "offer-1", status: "accepted" } },
    });

    const response = await request(app).get("/api/exchange/offer?offer_id=offer-1");

    expect(response.status).toBe(200);
    expect(response.body.offer.status).toBe("accepted");
    expect(axios.get).toHaveBeenCalledWith("http://localhost:5001/exchange/offer", {
      params: { offer_id: "offer-1" },
    });
  });

  test("rejects invalid offer filters before proxying", async () => {
    const response = await request(app).get("/api/exchange/offers?status=done&type=sell");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("record tx route validates required fields", async () => {
    const response = await request(app)
      .post("/api/exchange/record-vlq-tx")
      .send({ offer_id: "offer-1", caller_address: "VLQ_MEMBER" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/transaction ID/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("confirm complete route validates caller address", async () => {
    const response = await request(app)
      .post("/api/exchange/confirm-complete")
      .send({ offer_id: "offer-1" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/caller address/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("dispute route validates reason", async () => {
    const response = await request(app)
      .post("/api/exchange/dispute")
      .send({ offer_id: "offer-1", caller_address: "VLQ_MEMBER" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/dispute reason/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("forwards valid record tx request", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { success: true, vlq_tx_id: "tx-1", offer: { status: "vlq_pending" } },
    });

    const response = await request(app)
      .post("/api/exchange/record-vlq-tx")
      .send({ offer_id: "offer-1", tx_id: "tx-1", caller_address: "VLQ_MEMBER" });

    expect(response.status).toBe(200);
    expect(response.body.vlq_tx_id).toBe("tx-1");
    expect(axios.post).toHaveBeenCalledWith("http://localhost:5001/exchange/record-vlq-tx", {
      offer_id: "offer-1",
      tx_id: "tx-1",
      caller_address: "VLQ_MEMBER",
    });
  });
});
