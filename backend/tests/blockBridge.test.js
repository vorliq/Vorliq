const axios = require("axios");

jest.mock("axios");

const realtime = require("../realtime");
const bridge = require("../blockBridge");

function summaryResp(height) {
  return { data: { summary: { block_height: height } } };
}
function blockResp(index) {
  return { data: { block: { index, hash: `hash-${index}`, timestamp: 1000 + index, transactions: [
    { receiver_address: `wallet-${index}`, amount: 5, tx_id: `tx-${index}`, type: "transfer" },
  ] } } };
}

describe("block bridge: Flask-mined blocks fan out to realtime", () => {
  let emitted;
  beforeEach(() => {
    emitted = [];
    // Capture realtime emissions without a socket.io server.
    realtime.setIo({ emit: (event, payload) => emitted.push({ event, payload }) });
    // Reset the shared watermark by noting a very negative height is impossible;
    // instead drive it through the public surface: a fresh module-level value is
    // not resettable, so we baseline explicitly per test via the first poll.
    axios.get.mockReset();
  });

  test("first poll baselines to the tip and emits nothing (no history replay)", async () => {
    axios.get.mockResolvedValueOnce(summaryResp(100));
    await bridge.poll();
    expect(emitted).toHaveLength(0);
    expect(realtime.getLastEmittedBlockHeight()).toBe(100);
  });

  test("a newly mined block is fetched and fanned out as block:new + wallet:credit", async () => {
    // Baseline at 100 (from the previous test's shared watermark is 100; make the
    // intent explicit by baselining here too).
    axios.get.mockResolvedValueOnce(summaryResp(100));
    await bridge.poll();
    emitted.length = 0;

    // Tip advances to 102: blocks 101 and 102 should each fan out.
    axios.get
      .mockResolvedValueOnce(summaryResp(102)) // /chain/summary
      .mockResolvedValueOnce(blockResp(101)) // /chain/block/101
      .mockResolvedValueOnce(blockResp(102)); // /chain/block/102
    await bridge.poll();

    const blockEvents = emitted.filter((e) => e.event === "block:new").map((e) => e.payload.index);
    const creditEvents = emitted.filter((e) => e.event === "wallet:credit").map((e) => e.payload.address);
    expect(blockEvents).toEqual([101, 102]);
    expect(creditEvents).toEqual(["wallet-101", "wallet-102"]);
    expect(realtime.getLastEmittedBlockHeight()).toBe(102);
  });

  test("no new blocks => no emissions (idempotent at the same tip)", async () => {
    axios.get.mockResolvedValueOnce(summaryResp(102));
    await bridge.poll();
    expect(emitted).toHaveLength(0);
  });

  test("a block already announced by the manual mine route is not re-emitted", async () => {
    // Simulate the /api/mining route having broadcast block 103.
    realtime.emitMinedBlock({ index: 103, hash: "h103", timestamp: 1, transactions: [] });
    emitted.length = 0;
    // The bridge sees the tip at 103 — already at the watermark — and stays quiet.
    axios.get.mockResolvedValueOnce(summaryResp(103));
    await bridge.poll();
    expect(emitted.filter((e) => e.event === "block:new")).toHaveLength(0);
  });
});
