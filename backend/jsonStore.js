const fs = require("fs");
const path = require("path");

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function backupPath(filePath) {
  return `${filePath}.bak`;
}

function atomicWait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(filePath, callback, timeoutMs = 5000) {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();
  let descriptor = null;

  while (descriptor === null) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
      fs.writeSync(descriptor, String(process.pid));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out waiting for storage lock ${path.basename(lockPath)}`);
      }
      atomicWait(50);
    }
  }

  try {
    return callback();
  } finally {
    fs.closeSync(descriptor);
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function atomicWriteJson(filePath, data, options = {}) {
  const createBackup = options.createBackup !== false;
  ensureDirectory(filePath);
  return withLock(filePath, () => {
    if (createBackup && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath(filePath));
    }

    const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const descriptor = fs.openSync(tmpPath, "w");
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(tmpPath, filePath);
  });
}

function safeReadJson(filePath, fallback) {
  ensureDirectory(filePath);
  if (!fs.existsSync(filePath)) {
    atomicWriteJson(filePath, fallback);
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const bak = backupPath(filePath);
    if (fs.existsSync(bak)) {
      try {
        const backup = JSON.parse(fs.readFileSync(bak, "utf8"));
        try {
          fs.renameSync(filePath, `${filePath}.corrupt.${Math.floor(Date.now() / 1000)}`);
        } catch (moveError) {
          // If the corrupt file cannot be moved, leave it in place until the replacement succeeds.
        }
        atomicWriteJson(filePath, backup, { createBackup: false });
        return backup;
      } catch (backupError) {
        return fallback;
      }
    }
    return fallback;
  }
}

function fileHealth(filePath) {
  const exists = fs.existsSync(filePath);
  let validJson = false;
  let message = exists ? "file is valid" : "file has not been created yet";
  let status = "ok";
  let sizeBytes = 0;
  let lastModified = null;

  if (exists) {
    const stats = fs.statSync(filePath);
    sizeBytes = stats.size;
    lastModified = stats.mtime.toISOString();
    try {
      JSON.parse(fs.readFileSync(filePath, "utf8"));
      validJson = true;
    } catch (error) {
      status = "warning";
      message = `invalid JSON: ${error.message}`;
    }
  }

  return {
    file_name: path.basename(filePath),
    exists,
    valid_json: validJson,
    has_backup: fs.existsSync(backupPath(filePath)),
    size_bytes: sizeBytes,
    last_modified: lastModified,
    status,
    message,
  };
}

function backendStorageHealth(files) {
  const checked = files.map(fileHealth);
  const errors = checked.filter((item) => item.status === "error").length;
  const warnings = checked.filter((item) => item.status === "warning").length;
  return {
    success: true,
    overall_status: errors ? "error" : warnings ? "warning" : "ok",
    critical_files_ok: checked.filter((item) => item.status === "ok").length,
    warnings_count: warnings,
    errors_count: errors,
    backup_available: checked.some((item) => item.has_backup),
    files: checked,
  };
}

module.exports = {
  atomicWriteJson,
  backendStorageHealth,
  safeReadJson,
};
