const request = require("supertest");
const crypto = require("crypto");

jest.mock("axios");
const axios = require("axios");

const app = require("../index");
const { clearSnapshotCache, generateSnapshot, hasForbiddenSecretMarker, verifySnapshot } = require("../snapshot");
const { hashNetworkManifest } = require("../routes/manifest");

jest.setTimeout(15000);

const originalCommit = process.env.VORLIQ_COMMIT;
const originalPrivateKey = process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY;
const originalPublicKey = process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY;
const originalRequireSignature = process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE;

function testKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function mockSnapshotDependencies(mockOptions = {}) {
  let diagnosticsCalls = 0;
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
      diagnosticsCalls += 1;
      return Promise.resolve({
        data: {
          success: true,
          block_height: 42,
          chain_valid: true,
          pending_transactions: 2,
          active_registry_nodes: 3,
          last_block_hash: "0000hash",
          uptime_seconds: mockOptions.dynamicDiagnostics ? 1000 + diagnosticsCalls : 1000,
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
    delete process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY;
    delete process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY;
    delete process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE;
    mockSnapshotDependencies();
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
    expect(response.body.snapshot.signature).toMatchObject({
      enabled: false,
      algorithm: "Ed25519",
      status: "unsigned",
      signature: null,
    });
    expect(response.body.snapshot.signature.snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("snapshot verify returns verified true when dependencies are healthy", async () => {
    const response = await request(app).get("/api/snapshot/verify");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.verified).toBe(true);
    expect(response.body.checks.some((check) => check.id === "audit_manifest_hash_matches_current" && check.passed)).toBe(true);
    expect(response.body.checks.some((check) => check.id === "network_manifest_hash_matches_current" && check.passed)).toBe(true);
    expect(response.body.errors).toEqual([]);
    expect(response.body.signature_enabled).toBe(false);
    expect(response.body.signature_verified).toBe(false);
    expect(response.body.warnings).toContain("Snapshot is unsigned; deterministic verification passed but production signing is not configured.");
  });

  test("snapshot verify fails unsigned when signature is required", async () => {
    process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE = "true";

    const response = await request(app).get("/api/snapshot/verify");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.verified).toBe(false);
    expect(response.body.signature_enabled).toBe(false);
    expect(response.body.signature_status).toBe("missing_required_signature");
    expect(response.body.errors).toContain("Snapshot signature is required but no valid signature is present.");
  });

  test("snapshot verify passes signed snapshot with test key", async () => {
    const keys = testKeypair();
    process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = keys.privateKey;
    process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = keys.publicKey;

    const response = await request(app).get("/api/snapshot/verify");

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.signature_enabled).toBe(true);
    expect(response.body.signature_verified).toBe(true);
    expect(response.body.signature_status).toBe("verified");
    expect(response.body.snapshot.signature.signature).toEqual(expect.any(String));
    expect(response.body.snapshot.signature.public_key).toContain("BEGIN PUBLIC KEY");
    expect(JSON.stringify(response.body)).not.toContain(keys.privateKey);
  });

  test("snapshot public key endpoint returns unsigned safe metadata only", async () => {
    const response = await request(app).get("/api/snapshot/public-key");

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      "algorithm",
      "public_key",
      "public_key_id",
      "signature_enabled",
      "signature_required",
      "success",
    ]);
    expect(response.body).toMatchObject({
      success: true,
      algorithm: "Ed25519",
      public_key_id: null,
      public_key: null,
      signature_required: false,
      signature_enabled: false,
    });
  });

  test("snapshot public key endpoint returns public metadata without private key", async () => {
    const keys = testKeypair();
    process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = keys.privateKey;
    process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = keys.publicKey;
    process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE = "true";

    const response = await request(app).get("/api/snapshot/public-key");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.algorithm).toBe("Ed25519");
    expect(response.body.public_key_id).toMatch(/^ed25519:[a-f0-9]{16}$/);
    expect(response.body.public_key).toBe(keys.publicKey);
    expect(response.body.signature_required).toBe(true);
    expect(response.body.signature_enabled).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(keys.privateKey);
    expect(JSON.stringify(response.body)).not.toMatch(/VORLIQ_SNAPSHOT_PRIVATE_KEY|BEGIN PRIVATE KEY/);
  });

  test("snapshot latest and verify use the same canonical network manifest hash", async () => {
    mockSnapshotDependencies({ dynamicDiagnostics: true });
    const generatedAt = "2026-05-25T12:00:00.000Z";
    const latest = await generateSnapshot({ generatedAt, includeReadinessStatus: false });
    const verified = await verifySnapshot({ generatedAt, includeReadinessStatus: false });

    expect(verified.verified).toBe(true);
    expect(verified.snapshot.hashes.network_manifest).toBe(latest.hashes.network_manifest);
    expect(verified.checks.some((check) => check.id === "network_manifest_hash_matches_current" && check.passed)).toBe(true);
  });

  test("dynamic network manifest fields do not break verification", async () => {
    mockSnapshotDependencies({ dynamicDiagnostics: true });
    const response = await request(app).get("/api/snapshot/verify");

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.errors).toEqual([]);
  });

  test("network manifest hash mismatch is detected if the manifest actually changes", () => {
    const baseManifest = {
      success: true,
      generated_at: "2026-05-25T12:00:00.000Z",
      project: { name: "Vorliq" },
      deployment: { commit_hash: "snapshot-test-commit" },
      diagnostics: { block_height: 42, uptime_seconds: 1000, last_block_hash: "0000hash" },
    };
    const changedManifest = {
      ...baseManifest,
      generated_at: "2026-05-25T12:10:00.000Z",
      diagnostics: { ...baseManifest.diagnostics, uptime_seconds: 2000, last_block_hash: "0001realchange" },
    };
    const dynamicOnlyManifest = {
      ...baseManifest,
      success: true,
      request_id: "dynamic-request-id",
      generated_at: "2026-05-25T12:10:00.000Z",
      diagnostics: { ...baseManifest.diagnostics, uptime_seconds: 2000 },
    };

    expect(hashNetworkManifest(dynamicOnlyManifest)).toBe(hashNetworkManifest(baseManifest));
    expect(hashNetworkManifest(changedManifest)).not.toBe(hashNetworkManifest(baseManifest));
  });

  test("snapshot output does not contain forbidden strings, paths, or secrets", async () => {
    const snapshot = await generateSnapshot({ generatedAt: "2026-05-25T12:00:00.000Z" });
    const text = JSON.stringify(snapshot);

    expect(hasForbiddenSecretMarker(snapshot)).toBe(false);
    expect(text).not.toMatch(/should-not-leak|private_key|server_path|\/home\/vorliq|ADMIN_TOKEN|ssh-ed25519|raw_ip|user_agent|password|Bearer |BEGIN PRIVATE KEY/i);
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

    expect(combined).not.toMatch(/\/home\/vorliq|private_key|server_path|ADMIN_TOKEN|SERVER_SSH_KEY|ssh-ed25519|raw_ip|user_agent|password|Bearer /i);
  });
});
