const request = require("supertest");
const axios = require("axios");

jest.mock("axios");
jest.mock("../snapshot", () => ({
  verifySnapshot: jest.fn(),
}));

const app = require("../index");
const { verifySnapshot } = require("../snapshot");
const {
  classifySyncStatus,
  compareNodeToTrustedState,
  hasForbiddenPublicMarker,
  summarizeNetworkSync,
} = require("../nodeCompare");
const { clearCache } = require("../cache");

const now = 1_800_000_000;
const trustedState = {
  trusted_chain_height: 42,
  trusted_latest_hash: "0000trusted",
  active_window_seconds: 30 * 60,
  now_seconds: now,
};

function node(overrides = {}) {
  return {
    node_url: "https://node.example.org",
    display_name: "Example Node",
    region: "Europe",
    country: "UK",
    last_seen: now,
    active: true,
    last_chain_height: 42,
    last_block_hash: "0000trusted",
    last_diagnostics_status: "valid",
    response_time_ms: 21,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("node sync comparison helpers", () => {
  test("classifies synced nodes", () => {
    expect(classifySyncStatus(node(), trustedState)).toBe("synced");
    expect(compareNodeToTrustedState(node(), trustedState)).toMatchObject({
      sync_status: "synced",
      risk_level: "low",
      same_latest_hash: true,
      height_difference: 0,
    });
  });

  test("classifies behind nodes", () => {
    expect(classifySyncStatus(node({ last_chain_height: 39, last_block_hash: "0000old" }), trustedState)).toBe("behind");
  });

  test("classifies ahead nodes as warning", () => {
    const comparison = compareNodeToTrustedState(node({ last_chain_height: 43, last_block_hash: "0000new" }), trustedState);
    expect(comparison.sync_status).toBe("ahead");
    expect(comparison.risk_level).toBe("warning");
  });

  test("classifies same-height hash mismatches as forked", () => {
    const comparison = compareNodeToTrustedState(node({ last_block_hash: "0000fork" }), trustedState);
    expect(comparison.sync_status).toBe("forked");
    expect(comparison.risk_level).toBe("high");
  });

  test("classifies stale nodes outside the active window", () => {
    expect(classifySyncStatus(node({ active: false, last_seen: now - 4000 }), trustedState)).toBe("stale");
  });

  test("classifies unreachable nodes when diagnostics cannot be checked", () => {
    expect(
      classifySyncStatus(
        node({
          last_chain_height: null,
          last_block_hash: "",
          last_diagnostics_status: "invalid",
          status_history: [{ status: "offline" }],
        }),
        trustedState
      )
    ).toBe("unreachable");
  });

  test("classifies unknown nodes with missing enough data", () => {
    expect(classifySyncStatus(node({ last_chain_height: null }), trustedState)).toBe("unknown");
  });

  test("classifies missing latest hash as unknown", () => {
    expect(classifySyncStatus(node({ last_block_hash: "" }), trustedState)).toBe("unknown");
  });

  test("summarizes network sync statuses", () => {
    const summary = summarizeNetworkSync([
      compareNodeToTrustedState(node(), trustedState),
      compareNodeToTrustedState(node({ last_chain_height: 43, last_block_hash: "0000new" }), trustedState),
    ]);
    expect(summary).toMatchObject({ total_node_count: 2, active_node_count: 2, synced_count: 1, ahead_count: 1, warning_count: 1 });
  });

  test("forbidden marker scan detects secrets and server markers", () => {
    expect(hasForbiddenPublicMarker({ message: "ADMIN_TOKEN=secret" })).toBe(true);
    expect(hasForbiddenPublicMarker({ node_url: "https://node.example.org", sync_status: "synced" })).toBe(false);
  });
});

describe("node compare routes", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = "node-compare-admin-token";
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
      data: { success: true, nodes: [node()] },
    });
  });

  afterEach(() => {
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;
  });

  test("GET /api/nodes/compare returns public safe node comparison", async () => {
    const response = await request(app).get("/api/nodes/compare");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      trusted_chain_height: 42,
      trusted_latest_hash: "0000trusted",
      trusted_snapshot_hash: "snapshot-hash",
      trusted_signature_verified: true,
      active_node_count: 1,
    });
    expect(response.body.nodes[0]).toMatchObject({
      node_url: "https://node.example.org",
      sync_status: "synced",
      risk_level: "low",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/node-compare-admin-token|ADMIN_TOKEN|private[_-]?key|\/home\/vorliq|raw[_-]?ip|user[_-]?agent/i);
  });

  test("admin route requires token", async () => {
    const response = await request(app).get("/api/admin/nodes/compare");
    expect(response.status).toBe(401);
  });

  test("admin route returns safe diagnostic metadata with token", async () => {
    const response = await request(app)
      .get("/api/admin/nodes/compare")
      .set("Authorization", "Bearer node-compare-admin-token");
    expect(response.status).toBe(200);
    expect(response.body.diagnostics).toMatchObject({
      registry_node_count: 1,
      snapshot_verified: true,
      snapshot_signature_status: "verified",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/node-compare-admin-token|ADMIN_TOKEN|private[_-]?key|\/home\/vorliq|raw[_-]?ip|user[_-]?agent/i);
  });
});
