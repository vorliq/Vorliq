const request = require("supertest");
const axios = require("axios");

jest.mock("axios");
jest.mock("../snapshot", () => ({
  verifySnapshot: jest.fn(),
}));

const app = require("../index");
const { verifySnapshot } = require("../snapshot");
const {
  buildNetworkMonitor,
  shouldSendOperatorAlert,
  updateAlertState,
} = require("../nodeMonitor");
const { clearCache } = require("../cache");

const now = 1_800_000_000;
const checkedAt = new Date(now * 1000).toISOString();

function comparison(nodes, overrides = {}) {
  return {
    success: true,
    checked_at: checkedAt,
    trusted_node_url: "https://vorliq.org",
    trusted_chain_height: 42,
    trusted_latest_hash: "0000trusted",
    trusted_snapshot_hash: "snapshot-hash",
    trusted_signature_verified: true,
    active_node_count: nodes.filter((node) => node.active).length,
    summary: {
      synced_count: nodes.filter((node) => node.sync_status === "synced").length,
      behind_count: nodes.filter((node) => node.sync_status === "behind").length,
      ahead_count: nodes.filter((node) => node.sync_status === "ahead").length,
      forked_count: nodes.filter((node) => node.sync_status === "forked").length,
      stale_count: nodes.filter((node) => node.sync_status === "stale").length,
      unreachable_count: nodes.filter((node) => node.sync_status === "unreachable").length,
      active_node_count: nodes.filter((node) => node.active).length,
    },
    nodes,
    ...overrides,
  };
}

function node(overrides = {}) {
  return {
    node_url: "https://node.vorliq.org",
    display_name: "Vorliq Public Node",
    region: "London",
    country: "United Kingdom",
    last_seen: now,
    active: true,
    chain_height: 42,
    latest_block_hash: "0000trusted",
    chain_valid: true,
    response_time_ms: 22,
    sync_status: "synced",
    sync_label: "Synced",
    sync_message: "Node matches trusted state.",
    height_difference: 0,
    same_latest_hash: true,
    risk_level: "low",
    snapshot_hash: "snapshot-hash",
    snapshot_signature_verified: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("node monitor helper", () => {
  test("reports ok when trusted node is synced and no alerts exist", () => {
    const monitor = buildNetworkMonitor(comparison([node()]), {
      checkedAt,
      trustedPublicNodeUrl: "https://node.vorliq.org",
    });
    expect(monitor).toMatchObject({
      success: true,
      overall_status: "ok",
      trusted_public_node_status: "synced",
      warning_count: 0,
      critical_count: 0,
    });
  });

  test("reports warning for a stale non-critical node", () => {
    const monitor = buildNetworkMonitor(
      comparison([
        node(),
        node({
          node_url: "https://community.example.org",
          display_name: "Community Node",
          active: false,
          sync_status: "stale",
          snapshot_hash: "",
          snapshot_signature_verified: null,
        }),
      ]),
      { checkedAt, trustedPublicNodeUrl: "https://node.vorliq.org" }
    );
    expect(monitor.overall_status).toBe("warning");
    expect(monitor.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "stale_node", severity: "warning" })]));
  });

  test("reports warning for an ahead node without trusting it", () => {
    const monitor = buildNetworkMonitor(
      comparison([node(), node({ node_url: "https://ahead.example.org", display_name: "Ahead", sync_status: "ahead", chain_height: 43 })]),
      { checkedAt, trustedPublicNodeUrl: "https://node.vorliq.org" }
    );
    expect(monitor.overall_status).toBe("warning");
    expect(monitor.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "ahead_node", severity: "warning" })]));
  });

  test("reports critical for active forked node", () => {
    const monitor = buildNetworkMonitor(
      comparison([node(), node({ node_url: "https://fork.example.org", display_name: "Fork", sync_status: "forked", risk_level: "high" })]),
      { checkedAt, trustedPublicNodeUrl: "https://node.vorliq.org" }
    );
    expect(monitor.overall_status).toBe("critical");
    expect(monitor.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "active_forked_node", severity: "critical" })]));
  });

  test("reports critical for trusted node unreachable", () => {
    const monitor = buildNetworkMonitor(
      comparison([node({ sync_status: "unreachable", risk_level: "warning" })]),
      { checkedAt, trustedPublicNodeUrl: "https://node.vorliq.org" }
    );
    expect(monitor.overall_status).toBe("critical");
    expect(monitor.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "trusted_public_node_unreachable", severity: "critical" })]));
  });

  test("forbidden marker scan rejects unsafe public output", () => {
    expect(() =>
      buildNetworkMonitor(
        comparison([node({ node_url: "https://example.org/?token=ADMIN_TOKEN", sync_status: "stale", active: false })]),
        { checkedAt, trustedPublicNodeUrl: "https://node.vorliq.org" }
      )
    ).toThrow(/forbidden public markers/i);
  });

  test("duplicate suppression waits for warning threshold and alert window", () => {
    const first = updateAlertState({}, [{ code: "stale_node", node_url: "https://node.example.org", severity: "warning" }], checkedAt);
    expect(shouldSendOperatorAlert(first.alerts[0], new Date(checkedAt), 1800, 3)).toBe(false);
    const third = updateAlertState(
      updateAlertState(first, [{ code: "stale_node", node_url: "https://node.example.org", severity: "warning" }], checkedAt),
      [{ code: "stale_node", node_url: "https://node.example.org", severity: "warning" }],
      checkedAt
    );
    expect(shouldSendOperatorAlert(third.alerts[0], new Date(checkedAt), 1800, 3)).toBe(true);
  });
});

describe("node monitor routes", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;
  const originalNodeUrl = process.env.VORLIQ_NODE_URL;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = "node-monitor-admin-token";
    process.env.VORLIQ_NODE_URL = "https://node.vorliq.org";
    verifySnapshot.mockResolvedValue({
      success: true,
      verified: true,
      signature_verified: true,
      signature_status: "verified",
      signature_required: true,
      snapshot: {
        chain_height: 42,
        latest_block_hash: "0000trusted",
        signature: { snapshot_hash: "snapshot-hash" },
      },
    });
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        nodes: [
          {
            node_url: "https://node.vorliq.org",
            display_name: "Vorliq Public Node",
            last_seen: now,
            active: true,
            last_chain_height: 42,
            last_block_hash: "0000trusted",
            last_diagnostics_status: "valid",
            snapshot_hash: "snapshot-hash",
            snapshot_signature_verified: true,
          },
        ],
      },
    });
  });

  afterEach(() => {
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;
    if (originalNodeUrl === undefined) delete process.env.VORLIQ_NODE_URL;
    else process.env.VORLIQ_NODE_URL = originalNodeUrl;
  });

  test("GET /api/nodes/monitor returns public safe monitor output", async () => {
    const response = await request(app).get("/api/nodes/monitor");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      overall_status: "ok",
      trusted_public_node_status: "synced",
      active_node_count: 1,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/node-monitor-admin-token|ADMIN_TOKEN|private[_-]?key|\/home\/vorliq|raw[_-]?ip|user[_-]?agent/i);
  });

  test("admin node monitor route requires token", async () => {
    const response = await request(app).get("/api/admin/nodes/monitor");
    expect(response.status).toBe(401);
  });
});
