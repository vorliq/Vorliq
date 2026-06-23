const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("axios");
const axios = require("axios");

const monitors = require("../monitors");
let dir;

// Each test gets a clean alerts store + log and a reset edge-trigger state, and
// no email provider configured (so delivery falls back to the alerts log).
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-monitors-"));
  process.env.VORLIQ_ALERTS_FILE = path.join(dir, "alerts.json");
  process.env.VORLIQ_ALERTS_LOG = path.join(dir, "alerts.log");
  delete process.env.VORLIQ_EMAIL_API_URL;
  delete process.env.VORLIQ_EMAIL_API_KEY;
  delete process.env.VORLIQ_EMAIL_FROM;
  axios.get.mockReset();
  axios.post.mockReset();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function load() {
  monitors._resetMonitorStateForTests();
  return monitors;
}

describe("production monitors", () => {
  test("chain check fires when the mempool has stuck pending transactions", async () => {
    const m = load();
    axios.get.mockResolvedValue({ data: { stuck_pending_count: 2, last_block_age_seconds: 5 } });
    await m.checkChain();
    const alerts = m.getRecentAlerts(20);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].monitor).toBe("chain");
    expect(alerts[0].status).toBe("firing");
    expect(alerts[0].message).toMatch(/stuck pending/i);
  });

  test("chain check fires when the last block is older than ten minutes", async () => {
    const m = load();
    axios.get.mockResolvedValue({ data: { stuck_pending_count: 0, last_block_age_seconds: 11 * 60 } });
    await m.checkChain();
    const alerts = m.getRecentAlerts(20);
    expect(alerts[0].message).toMatch(/min old/i);
  });

  test("chain check stays quiet when healthy", async () => {
    const m = load();
    axios.get.mockResolvedValue({ data: { stuck_pending_count: 0, last_block_age_seconds: 30 } });
    await m.checkChain();
    expect(m.getRecentAlerts(20)).toHaveLength(0);
  });

  test("chain alert is edge-triggered (one firing entry while the fault persists)", async () => {
    const m = load();
    axios.get.mockResolvedValue({ data: { stuck_pending_count: 1, last_block_age_seconds: 5 } });
    await m.checkChain();
    await m.checkChain();
    await m.checkChain();
    const firing = m.getRecentAlerts(20).filter((a) => a.status === "firing");
    expect(firing).toHaveLength(1);
  });

  test("chain alert records a resolved entry when the fault clears", async () => {
    const m = load();
    axios.get.mockResolvedValueOnce({ data: { stuck_pending_count: 1, last_block_age_seconds: 5 } });
    await m.checkChain();
    axios.get.mockResolvedValueOnce({ data: { stuck_pending_count: 0, last_block_age_seconds: 5 } });
    await m.checkChain();
    const statuses = m.getRecentAlerts(20).map((a) => a.status);
    expect(statuses).toContain("resolved");
  });

  test("backend check fires when Flask is unreachable", async () => {
    const m = load();
    axios.get.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5001"));
    await m.checkBackend();
    const alerts = m.getRecentAlerts(20);
    expect(alerts[0].monitor).toBe("backend");
    expect(alerts[0].message).toMatch(/unreachable/i);
  });

  test("disk check fires when free space is below 1GB", async () => {
    const m = load();
    const spy = jest.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 100, bsize: 1024 }); // ~100KB free
    await m.checkDisk();
    spy.mockRestore();
    const alerts = m.getRecentAlerts(20);
    expect(alerts[0].monitor).toBe("disk");
    expect(alerts[0].message).toMatch(/Low disk space/i);
  });

  test("disk check stays quiet with ample free space", async () => {
    const m = load();
    const spy = jest.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 5_000_000, bsize: 4096 }); // ~20GB
    await m.checkDisk();
    spy.mockRestore();
    expect(m.getRecentAlerts(20)).toHaveLength(0);
  });

  test("with no email provider configured, an alert is written to the alerts log instead of crashing", async () => {
    const m = load();
    const channel = await m.deliverAlert("[Vorliq alert] test", "body");
    expect(channel).toBe("logged");
    const logged = fs.readFileSync(process.env.VORLIQ_ALERTS_LOG, "utf8");
    expect(logged).toMatch(/\[Vorliq alert\] test/);
  });
});
