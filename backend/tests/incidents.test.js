const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const app = require("../index");

describe("incident routes", () => {
  let tempDir;
  let incidentsFile;
  const originalAdminToken = process.env.ADMIN_TOKEN;
  const originalIncidentsFile = process.env.INCIDENTS_FILE;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-incidents-"));
    incidentsFile = path.join(tempDir, "incidents.json");
    process.env.INCIDENTS_FILE = incidentsFile;
    delete process.env.ADMIN_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalAdminToken === undefined) {
      delete process.env.ADMIN_TOKEN;
    } else {
      process.env.ADMIN_TOKEN = originalAdminToken;
    }
    if (originalIncidentsFile === undefined) {
      delete process.env.INCIDENTS_FILE;
    } else {
      process.env.INCIDENTS_FILE = originalIncidentsFile;
    }
  });

  test("public incident reads return an empty list by default", async () => {
    const response = await request(app).get("/api/incidents");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.incidents).toEqual([]);
  });

  test("incidents safe load recovers from backup when main file is corrupt", async () => {
    fs.writeFileSync(incidentsFile, "{bad json");
    fs.writeFileSync(
      `${incidentsFile}.bak`,
      JSON.stringify({
        incidents: [
          {
            id: "incident-1",
            title: "Recovered",
            description: "Recovered from backup.",
            severity: "minor",
            status: "monitoring",
            affected_services: [],
            created_at: "2026-05-20T00:00:00.000Z",
            updated_at: "2026-05-20T00:00:00.000Z",
            resolved_at: null,
          },
        ],
      })
    );

    const response = await request(app).get("/api/incidents");

    expect(response.status).toBe(200);
    expect(response.body.incidents[0].title).toBe("Recovered");
    expect(fs.readdirSync(tempDir).some((file) => file.startsWith("incidents.json.corrupt."))).toBe(true);
  });

  test("creating an incident without ADMIN_TOKEN is rejected safely", async () => {
    const response = await request(app)
      .post("/api/incidents")
      .send({ title: "Test", description: "Test", severity: "minor" });

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("ADMIN_TOKEN_HERE");
  });

  test("creating with ADMIN_TOKEN is accepted and does not expose the token", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";

    const response = await request(app)
      .post("/api/incidents")
      .set("Authorization", "Bearer test-admin-token")
      .send({ title: "Minor maintenance", description: "Investigating a small issue.", severity: "minor" });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.incident.title).toBe("Minor maintenance");
    expect(response.body.incident.status).toBe("investigating");
    expect(JSON.stringify(response.body)).not.toContain("test-admin-token");
  });

  test("updating status and resolving are accepted with token", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    const created = await request(app)
      .post("/api/incidents")
      .set("x-admin-token", "test-admin-token")
      .send({ title: "Major incident", description: "A service is degraded.", severity: "major" });
    const incidentId = created.body.incident.id;

    const updated = await request(app)
      .patch(`/api/incidents/${incidentId}`)
      .set("x-admin-token", "test-admin-token")
      .send({ status: "monitoring" });

    expect(updated.status).toBe(200);
    expect(updated.body.incident.status).toBe("monitoring");

    const resolved = await request(app)
      .post(`/api/incidents/${incidentId}/resolve`)
      .set("x-admin-token", "test-admin-token")
      .send();

    expect(resolved.status).toBe(200);
    expect(resolved.body.incident.status).toBe("resolved");
    expect(resolved.body.incident.resolved_at).toBeTruthy();
  });

  test("active incidents excludes resolved incidents", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    const active = await request(app)
      .post("/api/incidents")
      .set("x-admin-token", "test-admin-token")
      .send({ title: "Active incident", description: "Still active.", severity: "critical" });
    const resolved = await request(app)
      .post("/api/incidents")
      .set("x-admin-token", "test-admin-token")
      .send({ title: "Resolved incident", description: "Done.", severity: "minor" });

    await request(app)
      .post(`/api/incidents/${resolved.body.incident.id}/resolve`)
      .set("x-admin-token", "test-admin-token")
      .send();

    const response = await request(app).get("/api/incidents/active");

    expect(response.status).toBe(200);
    expect(response.body.incidents).toHaveLength(1);
    expect(response.body.incidents[0].id).toBe(active.body.incident.id);
    expect(response.body.incidents[0].status).not.toBe("resolved");
  });
});
