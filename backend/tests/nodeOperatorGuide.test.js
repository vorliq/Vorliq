const request = require("supertest");

const app = require("../index");

describe("node operator guide metadata", () => {
  test("returns safe public onboarding metadata only", async () => {
    const response = await request(app).get("/api/node/operator-guide");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      trusted_node_url: "https://vorliq.org",
      public_node_url: "https://node.vorliq.org",
      status_url: "https://status.vorliq.org",
      docs_url: "https://vorliq.github.io/Vorliq/run-your-own-node.html",
    });

    const body = JSON.stringify(response.body).toLowerCase();
    expect(body).not.toContain("admin_token");
    expect(body).not.toContain("private_key");
    expect(body).not.toContain("password");
    expect(body).not.toContain("ssh");
    expect(body).not.toContain("/home/");
    expect(body).not.toContain("\\users\\");
  });
});
