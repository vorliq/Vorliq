const crypto = require("crypto");

const {
  publicKeyId,
  signingMetadata,
  snapshotHash,
  verifySnapshotHashSignature,
  verifySnapshotSignature,
} = require("../snapshotSigner");

const ORIGINAL_ENV = {
  VORLIQ_SNAPSHOT_PRIVATE_KEY: process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY,
  VORLIQ_SNAPSHOT_PUBLIC_KEY: process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY,
  VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE: process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE,
};

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

describe("snapshot signer", () => {
  beforeEach(() => {
    delete process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY;
    delete process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY;
    delete process.env.VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("signing utilities generate and verify valid signatures", () => {
    const keys = keypair();
    process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = keys.privateKey;
    process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = keys.publicKey;
    const snapshot = { success: true, chain_height: 42, hashes: { network_manifest: "a".repeat(64) } };

    const signature = signingMetadata(snapshot, { signedAt: "2026-05-25T12:00:00.000Z" });
    const signedSnapshot = { ...snapshot, signature };

    expect(signature.enabled).toBe(true);
    expect(signature.public_key_id).toBe(publicKeyId(keys.publicKey));
    expect(signature.signature).toEqual(expect.any(String));
    expect(verifySnapshotHashSignature(signature.snapshot_hash, signature.signature, keys.publicKey)).toBe(true);
    expect(verifySnapshotSignature(signedSnapshot).verified).toBe(true);
  });

  test("invalid signature fails", () => {
    const keys = keypair();
    process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = keys.privateKey;
    process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = keys.publicKey;
    const snapshot = { success: true, chain_height: 42 };
    const signedSnapshot = { ...snapshot, signature: signingMetadata(snapshot) };
    signedSnapshot.chain_height = 43;

    const result = verifySnapshotSignature(signedSnapshot);

    expect(result.hash_matches).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.status).toBe("invalid");
  });

  test("unsigned snapshots pass only when signature is not required", () => {
    const snapshot = {
      success: true,
      chain_height: 42,
      signature: {
        enabled: false,
        algorithm: "Ed25519",
        snapshot_hash: snapshotHash({ success: true, chain_height: 42 }),
        signature: null,
        status: "unsigned",
      },
    };

    expect(verifySnapshotSignature(snapshot).verified).toBe(true);
    expect(verifySnapshotSignature(snapshot, { requireSignature: true }).verified).toBe(false);
  });

  test("private key never appears in safe signing metadata", () => {
    const keys = keypair();
    process.env.VORLIQ_SNAPSHOT_PRIVATE_KEY = keys.privateKey;
    process.env.VORLIQ_SNAPSHOT_PUBLIC_KEY = keys.publicKey;

    const metadata = signingMetadata({ success: true });

    expect(JSON.stringify(metadata)).not.toContain(keys.privateKey);
    expect(JSON.stringify(metadata)).not.toMatch(/BEGIN PRIVATE KEY|PRIVATE KEY/);
    expect(metadata.public_key).toContain("BEGIN PUBLIC KEY");
  });
});
