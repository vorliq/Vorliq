const {
  ACTIVE_WINDOW_SECONDS,
  STALE_WINDOW_SECONDS,
  applyNodeLifecycle,
  classifyNodeLifecycle,
  summarizeNodeLifecycle,
} = require("../nodeLifecycle");

describe("node lifecycle classifier", () => {
  const now = 1_800_000_000;

  test("classifies active, stale, and inactive nodes", () => {
    expect(classifyNodeLifecycle({ last_seen: now - ACTIVE_WINDOW_SECONDS + 1 }, now).lifecycle_status).toBe("active");
    expect(classifyNodeLifecycle({ last_seen: now - ACTIVE_WINDOW_SECONDS - 1 }, now).lifecycle_status).toBe("stale");
    expect(classifyNodeLifecycle({ last_seen: now - STALE_WINDOW_SECONDS - 1 }, now).lifecycle_status).toBe("inactive");
  });

  test("explicit archived and retired statuses are not recalculated", () => {
    expect(classifyNodeLifecycle({ lifecycle_status: "archived", last_seen: now }, now).lifecycle_status).toBe("archived");
    expect(classifyNodeLifecycle({ lifecycle_status: "retired", last_seen: now }, now).lifecycle_status).toBe("retired");
  });

  test("apply lifecycle records safe lifecycle history", () => {
    const updated = applyNodeLifecycle({ last_seen: now }, {
      lifecycle_status: "archived",
      reason: "old test node",
      changed_by: "admin",
      timestamp: "2026-05-27T12:00:00Z",
    });

    expect(updated.lifecycle_status).toBe("archived");
    expect(updated.lifecycle_history[0]).toMatchObject({
      from_status: "active",
      to_status: "archived",
      reason: "old test node",
      changed_by: "admin",
    });
  });

  test("summarizes lifecycle counts", () => {
    const summary = summarizeNodeLifecycle([
      { last_seen: now },
      { last_seen: now - ACTIVE_WINDOW_SECONDS - 10 },
      { last_seen: now - STALE_WINDOW_SECONDS - 10 },
      { lifecycle_status: "archived", last_seen: now },
      { lifecycle_status: "retired", last_seen: now },
    ], now);

    expect(summary).toMatchObject({
      active_count: 1,
      stale_count: 1,
      inactive_count: 1,
      archived_count: 1,
      retired_count: 1,
      visible_public_count: 3,
      total_count: 5,
    });
  });
});
