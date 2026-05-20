const request = require("supertest");
const axios = require("axios");

jest.mock("axios");

const app = require("../index");
const { canonicalStringify, sha256Hex } = require("../routes/audit");

const forbiddenPattern = /PRIVATE KEY|BEGIN PRIVATE KEY|ADMIN_TOKEN|password|\/home\/vorliq|ssh-/i;

function block(index, previousHash, hash) {
  return {
    index,
    timestamp: 1715791000 + index,
    transactions: [],
    previous_hash: previousHash,
    nonce: index,
    miner_address: index ? "VLQ_MINER" : null,
    difficulty: 1,
    hash,
  };
}

describe("public audit exports", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;
  const originalSnapshotTtl = process.env.AUDIT_SNAPSHOT_TTL_MS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_TOKEN = "audit-admin-token";
    process.env.AUDIT_SNAPSHOT_TTL_MS = "0";
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/storage/health")) {
        return Promise.resolve({
          data: { success: true, overall_status: "ok", files: [] },
        });
      }
      if (url.endsWith("/audit/chain")) {
        return Promise.resolve({
          data: {
            success: true,
            audit_schema_version: 1,
            export_type: "chain",
            block_count: 2,
            chain_valid: true,
            difficulty: 1,
            current_reward: 50,
            genesis_hash: "genesis",
            latest_block_hash: "latest",
            blocks: [block(1, "genesis", "latest"), block(0, "0", "genesis")],
            private_key: "BEGIN PRIVATE KEY should not leak",
          },
        });
      }
      if (url.endsWith("/audit/treasury")) {
        return Promise.resolve({
          data: {
            success: true,
            treasury_address: "TREASURY",
            treasury_balance: 5,
            treasury_ledger: [{ type: "reward_in", amount: 5, tx_id: "tx1" }],
            treasury_proposals: [],
            payout_statuses: [],
          },
        });
      }
      if (url.endsWith("/audit/governance")) {
        return Promise.resolve({ data: { success: true, governance_proposals: [], rule_change_history: [], current_governance_settings: {}, public_vote_weights: [] } });
      }
      if (url.endsWith("/audit/lending")) {
        return Promise.resolve({ data: { success: true, summary: {}, loans: [] } });
      }
      if (url.endsWith("/audit/exchange")) {
        return Promise.resolve({ data: { success: true, summary: {}, offers: [] } });
      }
      if (url.endsWith("/audit/registry")) {
        return Promise.resolve({ data: { success: true, summary: { active_node_count: 1 }, nodes: [] } });
      }
      return Promise.reject(new Error(`unexpected URL ${url}`));
    });
  });

  afterEach(() => {
    if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdminToken;
    if (originalSnapshotTtl === undefined) delete process.env.AUDIT_SNAPSHOT_TTL_MS;
    else process.env.AUDIT_SNAPSHOT_TTL_MS = originalSnapshotTtl;
  });

  test("audit manifest returns success and export hashes", async () => {
    const response = await request(app).get("/api/audit/manifest");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.audit_schema_version).toBe(1);
    expect(response.body.exports.map((entry) => entry.name)).toEqual([
      "chain",
      "treasury",
      "governance",
      "lending",
      "exchange",
      "registry",
    ]);
    expect(response.body.exports[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("audit chain endpoint returns blocks and latest hash", async () => {
    const response = await request(app).get("/api/audit/chain");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.blocks).toHaveLength(2);
    expect(response.body.blocks[0].index).toBe(0);
    expect(response.body.latest_block_hash).toBe("latest");
    expect(response.body.chain_valid).toBe(true);
  });

  test("audit manifest hash matches an export payload", async () => {
    const manifest = await request(app).get("/api/audit/manifest");
    const chainEntry = manifest.body.exports.find((entry) => entry.name === "chain");
    const chain = await request(app).get(chainEntry.endpoint);

    expect(chainEntry.sha256).toBe(sha256Hex(canonicalStringify(chain.body)));
  });

  test("audit endpoints do not include forbidden secret strings", async () => {
    const [manifest, chain, treasury, governance, lending, exchange, registry] = await Promise.all([
      request(app).get("/api/audit/manifest"),
      request(app).get("/api/audit/chain"),
      request(app).get("/api/audit/treasury"),
      request(app).get("/api/audit/governance"),
      request(app).get("/api/audit/lending"),
      request(app).get("/api/audit/exchange"),
      request(app).get("/api/audit/registry"),
    ]);

    const body = JSON.stringify([manifest.body, chain.body, treasury.body, governance.body, lending.body, exchange.body, registry.body]);
    expect(body).not.toMatch(forbiddenPattern);
  });

  test("unknown audit route returns 404", async () => {
    const response = await request(app).get("/api/audit/not-a-real-export");
    expect(response.status).toBe(404);
  });
});
