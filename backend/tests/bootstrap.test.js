const request = require("supertest");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("axios");
const axios = require("axios");

const app = require("../index");
const { clearSnapshotCache } = require("../snapshot");

const originalCommit = process.env.VORLIQ_COMMIT;
const originalPrivateKey = process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY;
const originalPublicKey = process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY;
const originalRequireSignature = process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE;
const originalDataDir = process.env.VORLIQ_DATA_DIR;

const FORBIDDEN = /(PRIVATE KEY|ADMIN_TOKEN|VORLIQ_SNAPSHOT_PRIVATE_KEY|SERVER_SSH_KEY|password|admin[_-]?token|private[_-]?key|raw[_-]?ip|ip_address|server[_-]?path|user[_-]?agent|\/home\/vorliq|ssh-ed25519|Bearer\s+)/i;

function testKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function mockFlaskDependencies() {
  axios.get.mockImplementation((url, options = {}) => {
    if (url.endsWith("/chain/summary")) {
      return Promise.resolve({
        data: {
          success: true,
          summary: {
            block_height: 7,
            total_blocks: 8,
            total_transactions: 12,
            last_block_hash: "0000bootstraphash",
            chain_valid: true,
          },
        },
      });
    }
    if (url.endsWith("/diagnostics")) {
      return Promise.resolve({
        data: {
          success: true,
          block_height: 7,
          chain_valid: true,
          pending_transactions: 0,
          active_registry_nodes: 2,
          last_block_hash: "0000bootstraphash",
          uptime_seconds: 100,
          server_path: "/home/vorliq/private",
        },
      });
    }
    if (url.endsWith("/chain/blocks")) {
      return Promise.resolve({
        data: {
          success: true,
          blocks: [{ index: 7, hash: "0000bootstraphash", previous_hash: "0000prev", transactions: [], nonce: 1 }],
        },
      });
    }
    if (url.endsWith("/transactions")) {
      return Promise.resolve({ data: { success: true, total: options.params?.status === "confirmed" ? 12 : 12, transactions: [] } });
    }
    if (url.endsWith("/transactions/pending")) {
      return Promise.resolve({ data: { success: true, total: 0, transactions: [] } });
    }
    if (url.endsWith("/treasury/summary")) {
      return Promise.resolve({ data: { success: true, summary: { current_balance: 5 } } });
    }
    if (url.endsWith("/governance/summary")) {
      return Promise.resolve({ data: { success: true, summary: { active_count: 0 } } });
    }
    if (url.endsWith("/lending/summary")) {
      return Promise.resolve({ data: { success: true, summary: { active_loans: 0 } } });
    }
    if (url.endsWith("/exchange/summary")) {
      return Promise.resolve({ data: { success: true, summary: { open_offers: 0 } } });
    }
    if (url.endsWith("/registry/summary")) {
      return Promise.resolve({ data: { success: true, summary: { active_node_count: 2, synced_node_count: 2 } } });
    }
    if (url.endsWith("/indexes/health")) {
      return Promise.resolve({
        data: {
          success: true,
          status: "ok",
          exists: true,
          valid: true,
          chain_height: 7,
          latest_block_hash: "0000bootstraphash",
          rebuild_needed: false,
          index_chain_match: true,
        },
      });
    }
    if (url.endsWith("/audit/chain")) {
      return Promise.resolve({
        data: {
          success: true,
          block_count: 8,
          chain_valid: true,
          latest_block_hash: "0000bootstraphash",
          blocks: [{ index: 7, hash: "0000bootstraphash", previous_hash: "0000prev", transactions: [], nonce: 1 }],
        },
      });
    }
    if (url.endsWith("/audit/treasury")) {
      return Promise.resolve({ data: { success: true, treasury_ledger: [], treasury_proposals: [], payout_statuses: [] } });
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
      return Promise.resolve({ data: { success: true, nodes: [], summary: { active_node_count: 2 } } });
    }
    if (url.endsWith("/mining/status")) {
      return Promise.resolve({ data: { success: true, status: { can_mine_now: true } } });
    }
    if (url.endsWith("/faucet/summary")) {
      return Promise.resolve({ data: { success: true, summary: { enabled: true } } });
    }
    return Promise.reject(new Error(`unexpected URL ${url}`));
  });
}

describe("verified bootstrap metadata", () => {
  let dataDir;

  beforeEach(() => {
    jest.clearAllMocks();
    clearSnapshotCache();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-bootstrap-status-"));
    process.env.VORLIQ_DATA_DIR = dataDir;
    process.env.VORLIQ_COMMIT = "bootstrap-test-commit";
    const keypair = testKeypair();
    process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = keypair.privateKey;
    process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = keypair.publicKey;
    process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE = "true";
    mockFlaskDependencies();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalCommit === undefined) delete process.env.VORLIQ_COMMIT;
    else process.env.VORLIQ_COMMIT = originalCommit;
    if (originalPrivateKey === undefined) delete process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY;
    else process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = originalPrivateKey;
    if (originalPublicKey === undefined) delete process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY;
    else process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = originalPublicKey;
    if (originalRequireSignature === undefined) delete process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE;
    else process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE = originalRequireSignature;
    if (originalDataDir === undefined) delete process.env.VORLIQ_DATA_DIR;
    else process.env.VORLIQ_DATA_DIR = originalDataDir;
  });

  test("GET /api/bootstrap/package returns safe verified metadata and audit URLs", async () => {
    const response = await request(app).get("/api/bootstrap/package");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.package_version).toBe(1);
    expect(response.body.snapshot_signature_verified).toBe(true);
    expect(response.body.snapshot_signature_status).toBe("verified");
    expect(response.body.chain_height).toBe(7);
    expect(response.body.latest_block_hash).toBe("0000bootstraphash");
    expect(response.body.audit_manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.audit_chain_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.chain_export_url).toMatch(/\/api\/audit\/chain\?export_timestamp=/);
    expect(response.body.snapshot_verify_url).toBe("https://vorliq.org/api/snapshot/verify");
    expect(response.body.audit_manifest_url).toMatch(/\/api\/audit\/manifest\?export_timestamp=/);
    expect(JSON.stringify(response.body)).not.toMatch(FORBIDDEN);
    expect(response.body.blocks).toBeUndefined();
  });

  test("GET /api/bootstrap/status returns safe local metadata without paths", async () => {
    const response = await request(app).get("/api/bootstrap/status");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.chain_height).toBe(7);
    expect(response.body.latest_block_hash).toBe("0000bootstraphash");
    expect(response.body.chain_valid).toBe(true);
    expect(response.body.bootstrap_package_available).toBe(true);
    expect(response.body.snapshot_verify_available).toBe(true);
    expect(response.body.audit_export_available).toBe(true);
    expect(response.body.last_bootstrap_marker).toMatchObject({ has_run: false });
    expect(JSON.stringify(response.body)).not.toMatch(FORBIDDEN);
  });

  test("bootstrap package route is read-only", async () => {
    const response = await request(app).post("/api/bootstrap/package").send({ write: true });

    expect(response.status).toBe(404);
  });
});
