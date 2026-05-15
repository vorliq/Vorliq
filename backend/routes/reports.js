const express = require("express");
const { sendCachedJson } = require("../cache");
const { generateWeeklyReport } = require("../reports");
const { logError } = require("../logger");

const router = express.Router();

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
