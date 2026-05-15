const express = require("express");
const {
  createIncident,
  listActiveIncidents,
  listIncidents,
  pageIncidents,
  resolveIncident,
  updateIncident,
} = require("../incidents");
const { logError } = require("../logger");
const { paginationParams } = require("../pagination");

const router = express.Router();

function requireAdmin(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return res.status(503).json({
      success: false,
      message: "Incident write API is disabled because ADMIN_TOKEN is not configured.",
    });
  }

  const authorization = req.get("authorization") || "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const providedToken = req.get("x-admin-token") || bearerToken;

  if (providedToken !== adminToken) {
    return res.status(401).json({
      success: false,
      message: "A valid admin token is required.",
    });
  }

  return next();
}

router.get("/api/incidents", (req, res) => {
  try {
    res.json({ success: true, ...pageIncidents(listIncidents(), paginationParams(req)) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    logError(`GET /api/incidents failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Incidents are currently unavailable." });
  }
});

router.get("/api/incidents/active", (req, res) => {
  try {
    res.json({ success: true, ...pageIncidents(listActiveIncidents(), paginationParams(req)) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    logError(`GET /api/incidents/active failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Active incidents are currently unavailable." });
  }
});

router.post("/api/incidents", requireAdmin, (req, res) => {
  try {
    const incident = createIncident(req.body || {});
    res.status(201).json({ success: true, incident });
  } catch (error) {
    logError(`POST /api/incidents failed: ${error.message}`);
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch("/api/incidents/:id", requireAdmin, (req, res) => {
  try {
    const incident = updateIncident(req.params.id, req.body || {});
    if (!incident) {
      return res.status(404).json({ success: false, message: "Incident was not found." });
    }
    return res.json({ success: true, incident });
  } catch (error) {
    logError(`PATCH /api/incidents/${req.params.id} failed: ${error.message}`);
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/api/incidents/:id/resolve", requireAdmin, (req, res) => {
  try {
    const incident = resolveIncident(req.params.id);
    if (!incident) {
      return res.status(404).json({ success: false, message: "Incident was not found." });
    }
    return res.json({ success: true, incident });
  } catch (error) {
    logError(`POST /api/incidents/${req.params.id}/resolve failed: ${error.message}`);
    return res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
