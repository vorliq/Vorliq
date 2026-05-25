const request = require("supertest");

jest.mock("axios");
const axios = require("axios");

const app = require("../index");
const { clearSnapshotCache, generateSnapshot, hasForbiddenSecretMarker, verifySnapshot } = require("../snapshot");

jest.setTimeout(15000);

const originalCommit = process.env.VORLIQ_COMMIT;

function mockSnapshotDependencies() {
  axios.get.mockImplementation((url, options = {}) => {
    if (url.endsWith("/chain/summary")) {
      return Promise.resolve({
        data: {
          success: true,
          summary: {
            block_height: 42,
            total_blocks: 43,
            total_transactions: 100,
            last_block_hash: "0000hash",
            chain_valid: true,
            private_key: "should-not-leak",
          },
        },
      });
    }
    if (url.endsWith("/diagnostics")) {
      return Promise.resolve({
        data: {
          success: true,
          block_height: 42,
          chain_valid: true,
          pending_transactions: 2,
          active_registry_nodes: 3,
          last_block_hash: "0000hash",
          server_path: "/home/vorliq/app",
        },
      });
    }
    if (url.endsWith("/chain/blocks")) {
      return Promise.resolve({
        data: {
          success: true,
          blocks: [{ index: 42, hash: "0000hash", previous_hash: "0000prev", transactions: [], nonce: 1 }],
          total_blocks: 43,
        },
      });
    }
    if (url.endsWith("/transactions")) {
      return Promise.resolve({
        data: {
          success: true,
          total: options.params?.status === "confirmed" ? 100 : 102,
          transactions: [],
        },
      });
    }
    if (url.endsWith("/transactions/pending")) {
      return Promise.resolve({ data: { success: true, total: 2, transactions: [] } });
    }
    if (url.endsWith("/treasury/summary")) {
      return Promise.resolve({ data: { success: true, summary: { current_balance: 25, payout_count: 1 } } });
    }
    if (url.endsWith("/governance/summary")) {
      return Promise.resolve({ data: { success: true, summary: { active_count: 1, settings_version: 2 } } });
    }
    if (url.endsWith("/lending/summary")) {
      return Promise.resolve({ data: { success: true, summary: { active_loans: 0, total_loans: 4 } } });
    }
    if (url.endsWith("/exchange/summary")) {
      return Promise.resolve({ data: { success: true, summary: { open_offers: 2, total_offers: 8 } } });
    }
    if (url.endsWith("/registry/summary")) {
      return Promise.resolve({ data: { success: true, summary: { active_node_count: 3, total_registered_node_count: 4, synced_node_count: 3 } } });
    }
    if (url.endsWith("/storage/health")) {
      return Promise.resolve({
        data: {
          success: true,
          overall_status: "ok",
          critical_files_ok: 8,
          warnings_count: 0,
          errors_count: 0,
          backup_available: true,
          storage_backend: "json",
          active_storage_adapter: "json",
          files: [{ file_name: "chain.json", status: "ok", path: "/home/vorliq/private/chain.json" }],
        },
      });
    }
    if (url.endsWith("/indexes/health")) {
      return Promise.resolve({
        data: {
          success: true,
          status: "ok",
          exists: true,
          valid: true,
          chain_height: 42,
          latest_block_hash: "0000hash",
          rebuild_needed: false,
          index_chain_match: true,
        },
      });
    }
    if (url.endsWith("/mining/status")) {
      return Promise.resolve({ data: { success: true, status: { can_mine_now: true, current_block_height: 42 } } });
    }
    if (url.endsWith("/faucet/summary")) {
      return Promise.resolve({ data: { success: true, summary: { enabled: true } } });
    }
    if (url.endsWith("/audit/chain")) {
      return Promise.resolve({
        data: {
          success: true,
          block_count: 43,
          chain_valid: true,
          latest_block_hash: "0000hash",
          blocks: [{ index: 42, hash: "0000hash", previous_hash: "0000prev", transactions: [], nonce: 1 }],
        },
      });
    }
    if (url.endsWith("/audit/treasury")) {
      return Promise.resolve({ data: { success: true, treasury_balance: 25, treasury_ledger: [], treasury_proposals: [], payout_statuses: [] } });
    }
    if (url.endsWith("/audit/governance")) {
      return Promise.resolve({ data: { success: true, governance_proposals: [], rule_change_history: [], public_vote_weights: [] } });
    }
    if (url.endsWith("/audit/lending")) {
      return Promise.resolve({ data: { success: true, loans: [] } });
    }
    if (url.endsWith("/audit/exchange")) {
      return Promise.resolve({ data: { success: true, offers: [] } });
    }
    if (url.endsWith("/audit/registry")) {
      return Promise.resolve({ data: { success: true, nodes: [], summary: { active_node_count: 3 } } });
    }
    return Promise.reject(new Error(`unexpected URL ${url}`));
  });
}

describe("chain snapshots", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSnapshotCache();
    process.env.VORLIQ_COMMIT = "snapshot-test-commit";
    mockSnapshotDependencies();
  });

  afterAll(() => {
    if (originalCommit === undefined) delete process.env.VORLIQ_COMMIT;
    else process.env.VORLIQ_COMMIT = originalCommit;
  });

  test("snapshot latest returns safe public metadata", async () => {
    const response = await request(app).get("/api/snapshot/latest");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.snapshot.network_name).toBe("Vorliq");
    expect(response.body.snapshot.chain_height).toBe(42);
    expect(response.body.snapshot.latest_block_hash).toBe("0000hash");
    expect(response.body.snapshot.confirmed_transaction_count).toBe(100);
    expect(response.body.snapshot.pending_transaction_count).toBe(2);
    expect(response.body.snapshot.treasury_balance).toBe(25);
    expect(response.body.snapshot.active_node_count).toBe(3);
    expect(response.body.snapshot.hashes.chain_summary).toMatch(/^[a-f0-9]{64}$/);
  });

  test("snapshot verify returns verified true when dependencies are healthy", async () => {
    const response = await request(app).get("/api/snapshot/verify");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.verified).toBe(true);
    expect(response.body.checks.some((check) => check.id === "audit_manifest_hash_matches_current" && check.passed)).toBe(true);
    expect(response.body.checks.some((check) => check.id === "network_manifest_hash_matches_current" && check.passed)).toBe(true);
    expect(response.body.errors).toEqual([]);
  });

  test("snapshot output does not contain forbidden strings, paths, or secrets", async () => {
    const snapshot = await generateSnapshot({ generatedAt: "2026-05-25T12:00:00.000Z" });
    const text = JSON.stringify(snapshot);

    expect(hasForbiddenSecretMarker(snapshot)).toBe(false);
    expect(text).not.toMatch(/should-not-leak|private_key|server_path|\/home\/vorliq|ADMIN_TOKEN|ssh-ed25519/i);
  });

  test("snapshot hashes are deterministic", async () => {
    const first = await generateSnapshot({ generatedAt: "2026-05-25T12:00:00.000Z", includeReadinessStatus: false });
    const second = await generateSnapshot({ generatedAt: "2026-05-25T12:00:00.000Z", includeReadinessStatus: false });

    expect(second.hashes).toEqual(first.hashes);
    expect(second.latest_block_hash).toBe(first.latest_block_hash);
  });

  test("snapshot endpoints do not expose paths or secrets", async () => {
    const latest = await request(app).get("/api/snapshot/latest");
    const verify = await request(app).get("/api/snapshot/verify");
    const combined = JSON.stringify({ latest: latest.body, verify: verify.body });

    expect(combined).not.toMatch(/\/home\/vorliq|private_key|server_path|ADMIN_TOKEN|SERVER_SSH_KEY|ssh-ed25519/i);
  });
});
