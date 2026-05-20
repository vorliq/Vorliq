const express = require("express");

const adminAuth = require("../middleware/adminAuth");
const { adminSummary, appendEvent, summary } = require("../analytics");

const router = express.Router();

router.post("/api/analytics/event", (req, res) => {
  try {
    appendEvent(req.body || {});
    return res.json({ success: true });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message || "Analytics event was rejected.",
    });
  }
});

router.get("/api/analytics/summary", (req, res) => {
  res.json(summary());
});

router.get("/api/admin/analytics", adminAuth, (req, res) => {
  res.json(adminSummary());
});

module.exports = router;
