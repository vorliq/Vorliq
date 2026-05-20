const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { API_STABILITY, API_VERSION, success } = require("../utils/apiResponse");
const { sendError } = require("../utils/apiResponse");
const { logError } = require("../logger");

const router = express.Router();
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..", "..");
const appDirectory = process.env.VORLIQ_APP_DIR || repoRoot;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function sdkVersion() {
  try {
    return require("../../sdk/package.json").version;
  } catch {
    return null;
  }
}

async function deploymentCommit() {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: appDirectory });
    return result.stdout.trim();
  } catch (error) {
    logError(`Version metadata commit lookup failed: ${error.message}`);
    return null;
  }
}

function safeVersionMetadata(commitHash = null) {
  const metadata = readJson("version.json");
  return {
    ...metadata,
    deployment_commit: commitHash || metadata.deployment_commit || null,
    current_deployment_commit: commitHash || null,
    sdk_version: sdkVersion() || metadata.sdk_version,
  };
}

router.get("/api/version", (req, res) => {
  res.json(
    success(
      {
        api_version: Number(API_VERSION),
        stability: API_STABILITY,
        supported_versions: [Number(API_VERSION)],
        default_version: Number(API_VERSION),
        deprecation_policy_url: "https://vorliq.github.io/Vorliq/api-versioning.html",
        docs_url: "https://vorliq.github.io/Vorliq/api.html",
        metadata_url: "https://vorliq.org/api/version/metadata",
        changelog_url: "https://vorliq.org/api/changelog",
        roadmap_url: "https://vorliq.org/api/roadmap",
        sdk_version: sdkVersion(),
      },
      "Vorliq API v1 is stable."
    )
  );
});

router.get("/api/version/metadata", async (req, res) => {
  try {
    const commitHash = await deploymentCommit();
    return res.json(success(safeVersionMetadata(commitHash), "Vorliq version metadata."));
  } catch (error) {
    logError(`GET /api/version/metadata failed: ${error.message}`);
    return sendError(res, 500, "VERSION_METADATA_UNAVAILABLE", "Version metadata is currently unavailable.");
  }
});

router.get("/api/changelog", (req, res) => {
  try {
    const changelog = readJson("docs/changelog.json");
    return res.json(success(changelog, "Vorliq changelog."));
  } catch (error) {
    logError(`GET /api/changelog failed: ${error.message}`);
    return sendError(res, 500, "CHANGELOG_UNAVAILABLE", "Changelog is currently unavailable.");
  }
});

router.get("/api/roadmap", (req, res) => {
  try {
    const roadmap = readJson("docs/roadmap.json");
    return res.json(success(roadmap, "Vorliq roadmap."));
  } catch (error) {
    logError(`GET /api/roadmap failed: ${error.message}`);
    return sendError(res, 500, "ROADMAP_UNAVAILABLE", "Roadmap is currently unavailable.");
  }
});

module.exports = router;
