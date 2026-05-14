const fs = require("fs");
const path = require("path");

const logDir = path.join(__dirname, "data");
const logFile = path.join(logDir, "backend.log");

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function writeLog(level, message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `${timestamp} ${level} ${message}\n`, "utf8");
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
