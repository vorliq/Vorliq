const express = require("express");

const { getLatestSnapshot, verifySnapshot } = require("../snapshot");
const { logError } = require("../logger");
const { ALGORITHM, configuredPublicKeyPem, envFlag, publicKeyId } = require("../snapshotSigner");
const adminAuth = require("../middleware/adminAuth");
const {
  archiveMetadata,
  createSnapshotArchive,
  getArchiveByHash,
  latestArchive,
  listArchives,
  verifyArchiveItem,
} = require("../snapshotArchive");

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

router.get("/api/snapshot/archive", (req, res) => {
  try {
    res.json(listArchives({ limit: req.query.limit, offset: req.query.offset }));
  } catch (error) {
    logError(`GET /api/snapshot/archive failed: ${error.message}`);
    const parsedLimit = Number(req.query.limit ?? 20);
    const parsedOffset = Number(req.query.offset ?? 0);
    res.status(503).json({
      success: false,
      archives: [],
      total: 0,
      limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20,
      offset: Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0,
      has_more: false,
      message: "Snapshot archive is currently unavailable.",
    });
  }
});

router.get("/api/snapshot/archive/latest", (req, res) => {
  try {
    const item = latestArchive();
    if (!item) {
      return res.json({
        success: true,
        archive: null,
        verification: null,
        message: "No archived snapshots are available yet.",
      });
    }
    return res.json({ success: true, archive: item, verification: verifyArchiveItem(item) });
  } catch (error) {
    logError(`GET /api/snapshot/archive/latest failed: ${error.message}`);
    return res.status(503).json({
      success: false,
      archive: null,
      verification: { verified: false, errors: ["Snapshot archive is currently unavailable."] },
    });
  }
});

router.get("/api/snapshot/archive/:snapshot_hash", (req, res) => {
  try {
    const item = getArchiveByHash(req.params.snapshot_hash);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Archived snapshot was not found.",
      });
    }
    return res.json({ success: true, archive: item, verification: verifyArchiveItem(item) });
  } catch (error) {
    logError(`GET /api/snapshot/archive/:snapshot_hash failed: ${error.message}`);
    return res.status(503).json({
      success: false,
      archive: null,
      verification: { verified: false, errors: ["Snapshot archive is currently unavailable."] },
    });
  }
});

router.post("/api/admin/snapshot/archive", adminAuth, async (req, res) => {
  try {
    const item = await createSnapshotArchive();
    res.status(201).json({
      success: true,
      archive: item,
      metadata: archiveMetadata(item),
      verification: verifyArchiveItem(item),
    });
  } catch (error) {
    logError(`POST /api/admin/snapshot/archive failed: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Snapshot archive generation failed.",
    });
  }
});

module.exports = router;
