const express = require("express");

const router = express.Router();

const operatorGuide = Object.freeze({
  success: true,
  trusted_node_url: "https://vorliq.org",
  public_node_url: "https://node.vorliq.org",
  status_url: "https://status.vorliq.org",
  docs_url: "https://vorliq.github.io/Vorliq/run-your-own-node.html",
  bootstrap_verification_url: "https://vorliq.github.io/Vorliq/bootstrap-verification.html",
  registry_url: "https://vorliq.org/registry",
  readiness_url: "https://vorliq.org/readiness",
});

router.get("/api/node/operator-guide", (req, res) => {
  res.json(operatorGuide);
});

module.exports = router;
