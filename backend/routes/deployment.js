const express = require("express");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { logError } = require("../logger");

const router = express.Router();
const execFileAsync = promisify(execFile);
const appDirectory = process.env.VORLIQ_APP_DIR || "/home/vorliq/app";

router.get("/api/deployment", async (req, res) => {
  try {
    const [hashResult, timestampResult] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: appDirectory }),
      execFileAsync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: appDirectory }),
    ]);

    res.json({
      success: true,
      commit_hash: hashResult.stdout.trim(),
      commit_timestamp: timestampResult.stdout.trim(),
    });
  } catch (error) {
    logError(`GET /api/deployment failed: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Deployment information is currently unavailable.",
    });
  }
});

module.exports = router;
