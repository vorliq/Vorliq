const express = require("express");
const { sendCachedJson } = require("../cache");
const { createReport } = require("../communityReports");
const { generateWeeklyReport } = require("../reports");
const { logError } = require("../logger");

const router = express.Router();

router.post("/api/reports", (req, res) => {
  try {
    const report = createReport({ ...(req.body || {}), source: req.get("referer") ? "web" : "api" });
    return res.status(201).json({
      success: true,
      report,
      message: "Report received for moderator review. Content is not removed automatically.",
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message || "Report could not be created.",
    });
  }
});

router.get("/api/reports/weekly", async (req, res) => {
  try {
    return sendCachedJson(req, res, "weekly-report", 60_000, async () => {
      const report = await generateWeeklyReport({ sendEmail: false });
      return { status: 200, data: report };
    });
  } catch (error) {
    logError(`GET /api/reports/weekly failed: ${error.message}`);
    res.status(503).json({
      success: false,
      message: "Unable to generate the weekly report because one or more Vorliq services are unavailable.",
    });
  }
});

module.exports = router;
