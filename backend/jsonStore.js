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

// Liveness check for the pid recorded in a lock file. ESRCH => the process is
// gone; EPERM => it exists but is owned by another user (treat as alive).
function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "EPERM") return true;
    return false;
  }
}

// Decide whether an existing lock file is an orphan left by a dead holder.
// Conservative: only break a lock when we have positive evidence the holder is
// gone (recorded pid maps to no live process), or the file is empty/garbage and
// has sat untouched past a grace period (covering a holder that died in the
// window between creating the lock and writing its pid). Any uncertainty returns
// false so a live holder is never preempted.
function lockIsStale(lockPath) {
  let content;
  try {
    content = fs.readFileSync(lockPath, "utf8").trim();
  } catch (error) {
    return false;
  }
  if (/^\d+$/.test(content)) {
    const pid = Number(content);
    if (pid === process.pid) return false;
    return !pidIsAlive(pid);
  }
  try {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    return ageMs > 30000;
  } catch (error) {
    return false;
  }
}

function withLock(filePath, callback, timeoutMs = 5000) {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();
  let descriptor = null;

  while (descriptor === null) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
      // Record the holder pid so a competing process can tell whether this lock
      // belongs to a live holder or a dead one. No fsync: the pid is immediately
      // visible cross-process via the page cache, and durability across a crash is
      // pointless for a transient lock file (a crash orphans it, which the
      // staleness check below reclaims). fsync here would add a disk flush to
      // every storage write on a very hot path.
      fs.writeSync(descriptor, String(process.pid));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // A lock left behind by a process killed mid-operation (a worker terminated
      // at SIGTERM during a write, an OOM, a crash) would otherwise wedge ALL
      // writes through this store forever: every acquisition sees the orphan and
      // times out after timeoutMs. That is exactly what took down production
      // writes (an orphaned rate-limits.json.lock 500'd wallet/create, faucet,
      // transactions, governance and exchange). Break a provably stale lock and
      // retry immediately instead of timing out.
      if (lockIsStale(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
        continue;
      }
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
  withLock,
};
