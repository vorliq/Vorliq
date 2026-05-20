const express = require("express");
const { API_STABILITY, API_VERSION, success } = require("../utils/apiResponse");

const router = express.Router();

function sdkVersion() {
  try {
    return require("../../sdk/package.json").version;
  } catch {
    return null;
  }
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
        sdk_version: sdkVersion(),
      },
      "Vorliq API v1 is stable."
    )
  );
});

module.exports = router;
