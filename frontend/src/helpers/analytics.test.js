import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import AnalyticsRouteTracker from "../components/AnalyticsRouteTracker";
import api from "./api";
import {
  ANALYTICS_ENABLED_KEY,
  ANALYTICS_SESSION_KEY,
  buildAnalyticsPayload,
  isAnalyticsEnabled,
  setAnalyticsEnabled,
} from "./analytics";

jest.mock("./api", () => ({
  post: jest.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  api.post.mockResolvedValue({ data: { success: true } });
});

test("analytics helper respects opt-out", async () => {
  setAnalyticsEnabled(false);

  expect(isAnalyticsEnabled()).toBe(false);
  expect(buildAnalyticsPayload("page_view", { route: "/wallet" })).toBeNull();
  expect(window.localStorage.getItem(ANALYTICS_SESSION_KEY)).toBeNull();
});

test("page view send is not called when disabled", async () => {
  window.localStorage.setItem(ANALYTICS_ENABLED_KEY, "false");

  render(
    <MemoryRouter initialEntries={["/mine"]}>
      <AnalyticsRouteTracker />
    </MemoryRouter>
  );

  expect(api.post).not.toHaveBeenCalled();
});

test("analytics payload strips unsafe metadata and private key field values", () => {
  const payload = buildAnalyticsPayload("page_view", {
    route: "/send",
    category: "wallet",
    metadata: {
      route_category: "wallet",
      private_key: "PRIVATE_KEY_SHOULD_NOT_SEND",
      password: "PASSWORD_SHOULD_NOT_SEND",
    },
  });

  expect(payload.metadata).toEqual({ route_category: "wallet" });
  expect(JSON.stringify(payload)).not.toContain("PRIVATE_KEY_SHOULD_NOT_SEND");
  expect(JSON.stringify(payload)).not.toContain("PASSWORD_SHOULD_NOT_SEND");
});
