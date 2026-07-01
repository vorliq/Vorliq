import {
  deviceBucket,
  featureEventForRoute,
  flushAnalytics,
  routeCategory,
  setAnalyticsEnabled,
  track,
  trackApiFailure,
  trackClick,
} from "./analytics";
import api from "./api";

jest.mock("./api", () => ({ __esModule: true, default: { post: jest.fn(), defaults: { baseURL: "/api" } } }));

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  flushAnalytics(); // drain any queued events from a previous test
  setAnalyticsEnabled(true);
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
});

describe("route helpers", () => {
  test("routeCategory buckets known routes", () => {
    expect(routeCategory("/")).toBe("dashboard");
    expect(routeCategory("/wallet")).toBe("wallet");
    expect(routeCategory("/blockchain")).toBe("network");
    expect(routeCategory("/forum")).toBe("community");
    expect(routeCategory("/lending")).toBe("coordination");
    expect(routeCategory("/registry")).toBe("registry");
    expect(routeCategory("/anything-else")).toBe("general");
  });

  test("featureEventForRoute maps known pages and returns null otherwise", () => {
    expect(featureEventForRoute("/wallet")).toBe("wallet_page_opened");
    expect(featureEventForRoute("/governance")).toBe("governance_page_opened");
    expect(featureEventForRoute("/unknown")).toBeNull();
  });

  test("deviceBucket classifies the viewport width", () => {
    window.innerWidth = 500;
    expect(deviceBucket()).toBe("mobile");
    window.innerWidth = 800;
    expect(deviceBucket()).toBe("tablet");
    window.innerWidth = 1400;
    expect(deviceBucket()).toBe("desktop");
  });
});

describe("event queue", () => {
  test("track queues an allowed event and flush posts it", () => {
    expect(track("page_view", { route: "/" })).toBe(true);
    flushAnalytics();
    expect(global.fetch).toHaveBeenCalledWith("/api/analytics/events", expect.objectContaining({ method: "POST" }));
  });

  test("track refuses disallowed event types", () => {
    expect(track("definitely_not_allowed")).toBe(false);
  });

  test("track does nothing when analytics is disabled", () => {
    setAnalyticsEnabled(false);
    expect(track("page_view")).toBe(false);
    expect(trackClick("cta", "create-account")).toBe(false);
  });

  test("trackApiFailure enqueues an api_failure event", () => {
    expect(trackApiFailure("/chain/summary", "timeout", 1234)).toBe(true);
  });

  test("flushAnalytics is a no-op with an empty queue", () => {
    flushAnalytics();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
