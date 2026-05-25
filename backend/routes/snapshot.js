const express = require("express");

const { getLatestSnapshot, verifySnapshot } = require("../snapshot");
const { logError } = require("../logger");
const { ALGORITHM, configuredPublicKeyPem, envFlag, publicKeyId } = require("../snapshotSigner");

const router = express.Router();

router.get("/api/snapshot/latest", async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    res.json({ success: true, snapshot });
  } catch (error) {
    logError(`GET /api/snapshot/latest failed: ${error.message}`);
    res.status(503).json({
      success: false,
      message: "Snapshot is currently unavailable.",
    });
  }
});

router.get("/api/snapshot/verify", async (req, res) => {
  try {
    res.json(await verifySnapshot());
  } catch (error) {
    logError(`GET /api/snapshot/verify failed: ${error.message}`);
    res.status(503).json({
      success: false,
      verified: false,
      signature_verified: false,
      signature_enabled: false,
      snapshot: null,
      checks: [],
      warnings: [],
      errors: ["Snapshot verification is currently unavailable."],
    });
  }
});

router.get("/api/snapshot/public-key", async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    const signature = snapshot.signature || {};
    let configuredPublicKey = null;
    try {
      configuredPublicKey = configuredPublicKeyPem();
    } catch (error) {
      configuredPublicKey = null;
    }
    const publicKey = signature.public_key || configuredPublicKey || null;
    res.json({
      success: true,
      algorithm: signature.algorithm || ALGORITHM,
      public_key_id: signature.public_key_id || publicKeyId(publicKey),
      public_key: publicKey,
      signature_required: envFlag("VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE"),
      signature_enabled: signature.enabled === true,
    });
  } catch (error) {
    logError(`GET /api/snapshot/public-key failed: ${error.message}`);
    res.status(503).json({
      success: false,
      algorithm: ALGORITHM,
      public_key_id: null,
      public_key: null,
      signature_required: envFlag("VORLIQ_REQUIRE_SNAPSHOT_SIGNATURE"),
      signature_enabled: false,
    });
  }
});

module.exports = router;
