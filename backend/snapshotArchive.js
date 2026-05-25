const fs = require("fs");
const path = require("path");

const { getLatestSnapshot, hasForbiddenSecretMarker } = require("./snapshot");
const { sanitizePublicPayload } = require("./routes/audit");
const { snapshotHash, verifySnapshotSignature } = require("./snapshotSigner");

const ARCHIVE_VERSION = 1;
const DEFAULT_RETENTION = 30;
const DEFAULT_ARCHIVE_DIR = path.join(__dirname, "data", "snapshots");
const LATEST_POINTER = "latest.json";

function archiveDir() {
  return process.env.VORLIQ_SNAPSHOT_ARCHIVE_DIR || DEFAULT_ARCHIVE_DIR;
}

function ensureArchiveDir(directory = archiveDir()) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function safeTimestamp(value = new Date().toISOString()) {
  return String(value).replace(/[:.]/g, "-");
}

function archiveFileName(item) {
  return `${safeTimestamp(item.created_at)}-${item.snapshot_hash}.json`;
}

function archivePath(fileName, directory = archiveDir()) {
  const base = path.basename(fileName);
  return path.join(directory, base);
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
  fs.renameSync(temporaryPath, filePath);
}

function archiveMetadata(item) {
  return sanitizePublicPayload({
    archive_version: item.archive_version,
    created_at: item.created_at,
    snapshot_hash: item.snapshot_hash,
    signature_status: item.signature_status,
    signature_verified_at_archive_time: item.signature_verified_at_archive_time,
    public_key_id: item.public_key_id,
    chain_height: item.chain_height,
    latest_block_hash: item.latest_block_hash,
    confirmed_transaction_count: item.confirmed_transaction_count,
    treasury_balance: item.treasury_balance,
    active_node_count: item.active_node_count,
    deployment_commit: item.deployment_commit,
  });
}

function buildArchiveItem(snapshot, options = {}) {
  const createdAt = options.createdAt || new Date().toISOString();
  const hash = snapshotHash(snapshot);
  const signatureVerification = verifySnapshotSignature(snapshot, {
    requireSignature: options.requireSignature ?? true,
    publicKey: snapshot.signature?.public_key,
  });
  const item = sanitizePublicPayload({
    archive_version: ARCHIVE_VERSION,
    created_at: createdAt,
    snapshot_hash: hash,
    signature_status: signatureVerification.status,
    signature_verified_at_archive_time: signatureVerification.signature_verified === true,
    public_key_id: signatureVerification.public_key_id || snapshot.signature?.public_key_id || null,
    chain_height: snapshot.chain_height,
    latest_block_hash: snapshot.latest_block_hash,
    confirmed_transaction_count: snapshot.confirmed_transaction_count,
    treasury_balance: snapshot.treasury_balance,
    active_node_count: snapshot.active_node_count,
    deployment_commit: snapshot.deployment_commit || null,
    snapshot,
  });

  if (hasForbiddenSecretMarker(item)) {
    throw new Error("Snapshot archive item failed forbidden secret scan.");
  }

  if (item.snapshot?.signature?.snapshot_hash !== hash) {
    throw new Error("Snapshot archive hash does not match signed snapshot hash.");
  }

  return item;
}

function archiveFileNames(directory = archiveDir()) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json") && fileName !== LATEST_POINTER)
    .sort()
    .reverse();
}

function readArchiveFile(fileName, directory = archiveDir()) {
  const filePath = archivePath(fileName, directory);
  const item = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return sanitizePublicPayload(item);
}

function readLatestPointer(directory = archiveDir()) {
  const pointerPath = path.join(directory, LATEST_POINTER);
  if (!fs.existsSync(pointerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function latestArchive(directory = archiveDir()) {
  const pointer = readLatestPointer(directory);
  if (pointer?.file_name && fs.existsSync(archivePath(pointer.file_name, directory))) {
    return readArchiveFile(pointer.file_name, directory);
  }
  const [first] = archiveFileNames(directory);
  return first ? readArchiveFile(first, directory) : null;
}

function listArchives(options = {}) {
  const directory = options.directory || archiveDir();
  const parsedLimit = Number(options.limit ?? 20);
  const parsedOffset = Number(options.offset ?? 0);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
  const files = archiveFileNames(directory);
  const page = files.slice(offset, offset + limit).map((fileName) => archiveMetadata(readArchiveFile(fileName, directory)));
  return {
    success: true,
    archives: page,
    total: files.length,
    limit,
    offset,
    has_more: offset + limit < files.length,
  };
}

function getArchiveByHash(snapshotHashValue, directory = archiveDir()) {
  const wanted = String(snapshotHashValue || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(wanted)) return null;
  for (const fileName of archiveFileNames(directory)) {
    const item = readArchiveFile(fileName, directory);
    if (String(item.snapshot_hash).toLowerCase() === wanted) return item;
  }
  return null;
}

function pruneArchives(directory = archiveDir(), retention = DEFAULT_RETENTION) {
  const parsedRetention = Number(retention);
  const safeRetention = Number.isFinite(parsedRetention) ? Math.max(parsedRetention, 1) : DEFAULT_RETENTION;
  const files = archiveFileNames(directory);
  for (const fileName of files.slice(safeRetention)) {
    fs.rmSync(archivePath(fileName, directory), { force: true });
  }
}

async function createSnapshotArchive(options = {}) {
  const directory = ensureArchiveDir(options.directory || archiveDir());
  const snapshot = await getLatestSnapshot({ force: true });
  const item = buildArchiveItem(snapshot, options);
  const fileName = archiveFileName(item);
  writeJsonAtomic(archivePath(fileName, directory), item);
  writeJsonAtomic(path.join(directory, LATEST_POINTER), {
    archive_version: ARCHIVE_VERSION,
    created_at: item.created_at,
    snapshot_hash: item.snapshot_hash,
    file_name: fileName,
  });
  pruneArchives(directory, options.retention || process.env.VORLIQ_SNAPSHOT_ARCHIVE_RETENTION || DEFAULT_RETENTION);
  return item;
}

function verifyArchiveItem(item = {}) {
  const errors = [];
  const snapshot = item.snapshot || {};
  const hash = snapshotHash(snapshot);
  const signature = verifySnapshotSignature(snapshot, {
    requireSignature: true,
    publicKey: snapshot.signature?.public_key,
  });

  if (item.snapshot_hash !== hash) errors.push("archive snapshot hash does not match snapshot payload");
  if (snapshot.signature?.snapshot_hash !== hash) errors.push("signed snapshot hash does not match snapshot payload");
  if (signature.signature_verified !== true) errors.push("archived snapshot signature did not verify");
  if (item.signature_verified_at_archive_time !== true) errors.push("archive was not signature-verified at archive time");
  if (item.public_key_id !== (signature.public_key_id || snapshot.signature?.public_key_id)) errors.push("archive public key id does not match snapshot");
  if (item.chain_height !== snapshot.chain_height) errors.push("archive chain height does not match snapshot");
  if (item.latest_block_hash !== snapshot.latest_block_hash) errors.push("archive latest block hash does not match snapshot");
  if (item.confirmed_transaction_count !== snapshot.confirmed_transaction_count) errors.push("archive confirmed transaction count does not match snapshot");
  if (item.treasury_balance !== snapshot.treasury_balance) errors.push("archive treasury balance does not match snapshot");
  if (item.active_node_count !== snapshot.active_node_count) errors.push("archive active node count does not match snapshot");
  if ((item.deployment_commit || null) !== (snapshot.deployment_commit || null)) errors.push("archive deployment commit does not match snapshot");
  if (hasForbiddenSecretMarker(item)) errors.push("archive contains a forbidden secret marker");

  return {
    verified: errors.length === 0,
    signature_verified: signature.signature_verified === true,
    signature_status: signature.status,
    snapshot_hash: hash,
    public_key_id: signature.public_key_id || null,
    errors,
  };
}

module.exports = {
  ARCHIVE_VERSION,
  DEFAULT_ARCHIVE_DIR,
  archiveMetadata,
  buildArchiveItem,
  createSnapshotArchive,
  getArchiveByHash,
  latestArchive,
  listArchives,
  verifyArchiveItem,
};
