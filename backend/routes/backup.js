const express = require("express");
const fs = require("fs");
const path = require("path");
const { logError } = require("../logger");

const router = express.Router();
const BACKUP_NAME_PATTERN = /^vorliq-backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/;

function backupDirectory() {
  return process.env.VORLIQ_BACKUP_DIR || "/home/vorliq/backups";
}

function publicBackupStatus() {
  const directory = backupDirectory();
  const configured = Boolean(directory);
  const exists = fs.existsSync(directory);

  if (!exists) {
    return {
      success: true,
      backup_monitoring_configured: configured,
      backup_directory_exists: false,
      latest_backup: null,
    };
  }

  const backups = fs
    .readdirSync(directory)
    .filter((fileName) => BACKUP_NAME_PATTERN.test(fileName))
    .map((fileName) => {
      const stats = fs.statSync(path.join(directory, fileName));
      return {
        file_name: fileName,
        size_bytes: stats.size,
        size_mb: Number((stats.size / 1024 / 1024).toFixed(2)),
        modified_time: stats.mtime.toISOString(),
        modified_timestamp: stats.mtimeMs,
      };
    })
    .sort((left, right) => right.modified_timestamp - left.modified_timestamp);

  const latest = backups[0] || null;
  if (latest) {
    delete latest.modified_timestamp;
  }

  return {
    success: true,
    backup_monitoring_configured: configured,
    backup_directory_exists: true,
    latest_backup: latest,
    retention_days: 14,
  };
}

router.get("/api/backup/status", (req, res) => {
  try {
    res.json(publicBackupStatus());
  } catch (error) {
    logError(`GET /api/backup/status failed: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Backup status is currently unavailable.",
    });
  }
});

module.exports = router;
module.exports.publicBackupStatus = publicBackupStatus;
