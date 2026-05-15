const express = require("express");
const { generateWeeklyReport } = require("../reports");
const { logError } = require("../logger");

const router = express.Router();

router.get("/api/reports/weekly", async (req, res) => {
  try {
    const report = await generateWeeklyReport({ sendEmail: false });
    res.json(report);
  } catch (error) {
    logError(`GET /api/reports/weekly failed: ${error.message}`);
    res.status(503).json({
      success: false,
      message: "Unable to generate the weekly report because one or more Vorliq services are unavailable.",
    });
  }
});

module.exports = router;
