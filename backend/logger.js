const fs = require("fs");
const path = require("path");

const logDir = path.join(__dirname, "data");
const logFile = path.join(logDir, "backend.log");

// Cap the active log so it can never fill the disk. When it grows past the cap
// we roll it to `backend.log.1` (keeping one previous generation), mirroring the
// rotation the Flask logger already does. Kept small and dependency-free.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (error) {
  // If the log directory cannot be created we still fall back to console below.
}

function rotateIfNeeded() {
  try {
    const { size } = fs.statSync(logFile);
    if (size < MAX_LOG_BYTES) return;
    fs.renameSync(logFile, `${logFile}.1`);
  } catch (error) {
    // No existing file, or rotation failed — either way, just keep writing.
  }
}

// Logging must never crash the process. Every write is guarded, and we always
// echo to the console so systemd/journald captures errors in production without
// needing a live shell to read the log file. ERROR goes to stderr, INFO to
// stdout, so log aggregators can separate them by stream.
function writeLog(level, message) {
  const line = `${new Date().toISOString()} ${level} ${message}`;
  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }
  try {
    rotateIfNeeded();
    fs.appendFileSync(logFile, `${line}\n`, "utf8");
  } catch (error) {
    // Disk full / permission error: the console line above is still emitted.
  }
}

function logInfo(message) {
  writeLog("INFO", message);
}

function logError(message) {
  writeLog("ERROR", message);
}

module.exports = {
  logInfo,
  logError,
};
