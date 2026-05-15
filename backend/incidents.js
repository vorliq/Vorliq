const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VALID_STATUSES = new Set(["investigating", "identified", "monitoring", "resolved"]);
const VALID_SEVERITIES = new Set(["minor", "major", "critical"]);

function incidentsFilePath() {
  return process.env.INCIDENTS_FILE || path.join(__dirname, "data", "incidents.json");
}

function ensureStore() {
  const filePath = incidentsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ incidents: [] }, null, 2));
  }
  return filePath;
}

function readIncidents() {
  const filePath = ensureStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || !Array.isArray(parsed.incidents)) {
    throw new Error("incident store must contain an incidents array");
  }
  return parsed.incidents;
}

function writeIncidents(incidents) {
  const filePath = ensureStore();
  fs.writeFileSync(filePath, JSON.stringify({ incidents }, null, 2));
}

function publicIncident(incident) {
  return {
    id: incident.id,
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    status: incident.status,
    created_at: incident.created_at,
    updated_at: incident.updated_at,
    resolved_at: incident.resolved_at,
  };
}

function listIncidents() {
  return readIncidents()
    .map(publicIncident)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

function listActiveIncidents() {
  return listIncidents().filter((incident) => incident.status !== "resolved");
}

function requireText(value, fieldName, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function requireSeverity(value) {
  const severity = requireText(value, "severity", 20).toLowerCase();
  if (!VALID_SEVERITIES.has(severity)) {
    throw new Error("severity must be minor, major, or critical");
  }
  return severity;
}

function requireStatus(value) {
  const status = requireText(value, "status", 20).toLowerCase();
  if (!VALID_STATUSES.has(status)) {
    throw new Error("status must be investigating, identified, monitoring, or resolved");
  }
  return status;
}

function createIncident(input) {
  const now = new Date().toISOString();
  const incidents = readIncidents();
  const incident = {
    id: crypto.randomUUID(),
    title: requireText(input.title, "title", 160),
    description: requireText(input.description, "description", 3000),
    severity: requireSeverity(input.severity),
    status: input.status ? requireStatus(input.status) : "investigating",
    created_at: now,
    updated_at: now,
    resolved_at: null,
  };

  if (incident.status === "resolved") {
    incident.resolved_at = now;
  }

  incidents.push(incident);
  writeIncidents(incidents);
  return publicIncident(incident);
}

function updateIncident(id, input) {
  const incidents = readIncidents();
  const incident = incidents.find((candidate) => candidate.id === id);
  if (!incident) {
    return null;
  }

  if (input.title !== undefined) {
    incident.title = requireText(input.title, "title", 160);
  }
  if (input.description !== undefined) {
    incident.description = requireText(input.description, "description", 3000);
  }
  if (input.severity !== undefined) {
    incident.severity = requireSeverity(input.severity);
  }
  if (input.status !== undefined) {
    incident.status = requireStatus(input.status);
    incident.resolved_at = incident.status === "resolved" ? new Date().toISOString() : null;
  }

  incident.updated_at = new Date().toISOString();
  writeIncidents(incidents);
  return publicIncident(incident);
}

function resolveIncident(id) {
  return updateIncident(id, { status: "resolved" });
}

module.exports = {
  VALID_SEVERITIES,
  VALID_STATUSES,
  createIncident,
  listActiveIncidents,
  listIncidents,
  resolveIncident,
  updateIncident,
};
