const assert = require("assert");
const VorliqSDK = require("../src");

const validAddress = "3MNQE1X7T4Bz9kLmNpQrStUvWx";

assert.strictEqual(VorliqSDK.validateAddress(validAddress).valid, true);
assert.strictEqual(VorliqSDK.isReservedAddress("SYSTEM"), true);

const review = VorliqSDK.createTransactionReview(validAddress, "7YWHMfk9JZe9LMQaPq2X3B4C5D", 1.25);
assert.strictEqual(review.canSubmit, true);
assert.strictEqual(review.status, "pending until mined");

const sameAddressReview = VorliqSDK.createTransactionReview(validAddress, validAddress, 1);
assert.strictEqual(sameAddressReview.canSubmit, false);
assert.match(sameAddressReview.errors.join(" "), /same address/i);

const sdk = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
assert.strictEqual(typeof sdk.getProfileVerificationChallenge, "function");
assert.strictEqual(typeof sdk.submitProfileVerification, "function");
assert.strictEqual(typeof sdk.reportContent, "function");
assert.strictEqual(typeof sdk.getAPIVersion, "function");
assert.strictEqual(typeof sdk.getVersionMetadata, "function");
assert.strictEqual(typeof sdk.getChangelog, "function");
assert.strictEqual(typeof sdk.getRoadmap, "function");
assert.strictEqual(typeof sdk.getReadiness, "function");
assert.strictEqual(typeof sdk.getIndexHealth, "function");
assert.strictEqual(typeof sdk.getMigrationReadiness, "function");
assert.strictEqual(typeof sdk.getLatestSnapshot, "function");
assert.strictEqual(typeof sdk.verifySnapshot, "function");
assert.strictEqual(typeof sdk.setRequestId, "function");
sdk
  .sendTransaction("SYSTEM", "not-used", "not-used", validAddress, 1)
  .then(() => {
    throw new Error("reserved sender should be rejected before signing or network calls");
  })
  .catch((error) => {
    assert.match(error.message, /reserved system address/i);
  });

const originalFetch = global.fetch;
const calls = [];
global.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  const ok = !String(url).includes("/api/v1/reports");
  return {
    ok,
    status: ok ? 200 : 400,
    headers: {
      get(name) {
        return name.toLowerCase() === "x-request-id" ? "sdk-smoke-request" : "";
      },
    },
    async json() {
      if (!ok) {
        return {
          success: false,
          message: "description is required.",
          error: { code: "VALIDATION_ERROR", message: "description is required.", details: {} },
          request_id: "sdk-smoke-request",
        };
      }
      if (String(url).endsWith("/api/v1/version")) {
        return { success: true, api_version: 1, supported_versions: [1] };
      }
      if (String(url).endsWith("/api/v1/version/metadata")) {
        return { success: true, current_version: "1.0.0", release_channel: "stable" };
      }
      if (String(url).endsWith("/api/v1/changelog")) {
        return { success: true, entries: [{ version: "1.0.0", title: "Compatibility" }] };
      }
      if (String(url).endsWith("/api/v1/roadmap")) {
        return { success: true, items: [{ status: "completed", title: "API v1" }] };
      }
      if (String(url).endsWith("/api/v1/readiness")) {
        return { success: true, overall_status: "pass", score: 100, checks: [] };
      }
      if (String(url).endsWith("/api/v1/indexes/health")) {
        return { success: true, status: "ok", rebuild_needed: false };
      }
      if (String(url).endsWith("/api/v1/migration/readiness")) {
        return { success: true, storage_backend: "json", database_enabled: false, migration_supported: "dry_run_only" };
      }
      if (String(url).endsWith("/api/v1/snapshot/latest")) {
        return { success: true, snapshot: { chain_height: 42, latest_block_hash: "0000snapshot" } };
      }
      if (String(url).endsWith("/api/v1/snapshot/verify")) {
        return { success: true, verified: true, snapshot: { chain_height: 42, latest_block_hash: "0000snapshot" }, checks: [] };
      }
      return { success: true, summary: { height: 1 } };
    },
  };
};

(async () => {
  const v1Client = new VorliqSDK({ nodeUrl: "https://example.invalid" });
  v1Client.setRequestId("sdk-smoke");
  const version = await v1Client.getAPIVersion();
  assert.strictEqual(version.api_version, 1);
  const metadata = await v1Client.getVersionMetadata();
  assert.strictEqual(metadata.current_version, "1.0.0");
  const changelog = await v1Client.getChangelog();
  assert.strictEqual(changelog.entries[0].version, "1.0.0");
  const roadmap = await v1Client.getRoadmap();
  assert.strictEqual(roadmap.items[0].status, "completed");
  const readiness = await v1Client.getReadiness();
  assert.strictEqual(readiness.overall_status, "pass");
  const summary = await v1Client.getChainSummary();
  assert.strictEqual(summary.height, 1);
  const indexHealth = await v1Client.getIndexHealth();
  assert.strictEqual(indexHealth.status, "ok");
  const migrationReadiness = await v1Client.getMigrationReadiness();
  assert.strictEqual(migrationReadiness.storage_backend, "json");
  assert.strictEqual(migrationReadiness.database_enabled, false);
  const latestSnapshot = await v1Client.getLatestSnapshot();
  assert.strictEqual(latestSnapshot.snapshot.latest_block_hash, "0000snapshot");
  const snapshotVerification = await v1Client.verifySnapshot();
  assert.strictEqual(snapshotVerification.verified, true);
  assert.strictEqual(calls[0].url, "https://example.invalid/api/v1/version");
  assert.strictEqual(calls[1].url, "https://example.invalid/api/v1/version/metadata");
  assert.strictEqual(calls[2].url, "https://example.invalid/api/v1/changelog");
  assert.strictEqual(calls[3].url, "https://example.invalid/api/v1/roadmap");
  assert.strictEqual(calls[4].url, "https://example.invalid/api/v1/readiness");
  assert.strictEqual(calls[5].url, "https://example.invalid/api/v1/chain/summary");
  assert.strictEqual(calls[6].url, "https://example.invalid/api/v1/indexes/health");
  assert.strictEqual(calls[7].url, "https://example.invalid/api/v1/migration/readiness");
  assert.strictEqual(calls[8].url, "https://example.invalid/api/v1/snapshot/latest");
  assert.strictEqual(calls[9].url, "https://example.invalid/api/v1/snapshot/verify");
  assert.strictEqual(calls[5].options.headers["X-Request-ID"], "sdk-smoke");
  assert.strictEqual(v1Client.lastRequestId, "sdk-smoke-request");

  const legacyClient = new VorliqSDK({ nodeUrl: "https://example.invalid", apiVersion: "legacy" });
  await legacyClient.getChainSummary();
  assert.strictEqual(calls[10].url, "https://example.invalid/api/chain/summary");

  try {
    await v1Client.reportContent({ target_type: "profile", target_id: "x", reason: "other" });
    throw new Error("validation error should throw");
  } catch (error) {
    assert.strictEqual(error.status, 400);
    assert.strictEqual(error.code, "VALIDATION_ERROR");
    assert.strictEqual(error.requestId, "sdk-smoke-request");
    assert.match(error.message, /description is required/i);
  } finally {
    global.fetch = originalFetch;
  }

  console.log("SDK safety smoke passed");
})().catch((error) => {
  global.fetch = originalFetch;
  throw error;
});
