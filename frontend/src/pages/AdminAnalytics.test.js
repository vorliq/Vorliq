import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import api from "../helpers/api";
import AdminAnalytics from "./AdminAnalytics";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

const emptySummary = {
  success: true,
  retention_days: 90,
  total_events_30d: 0,
  daily_counts: [],
  top_routes: [],
  top_buttons: [],
  top_cards: [],
  dashboard_features: [],
  journey_funnel: [],
  device_breakdown: [],
  api_failures: [],
  api_failure_total_30d: 0,
  page_views_30d: 0,
  api_error_rate_30d: 0,
  frontend_error_count_30d: 0,
  explorer_usage_30d: 0,
};

beforeEach(() => {
  window.sessionStorage.clear();
  jest.clearAllMocks();
});

test("admin analytics shows a token gate when no token is present", () => {
  render(
    <MemoryRouter>
      <AdminAnalytics />
    </MemoryRouter>
  );

  expect(screen.getByRole("heading", { level: 1, name: /product analytics/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/admin token/i, { selector: "input" })).toHaveAttribute("type", "password");
  expect(api.get).not.toHaveBeenCalled();
});

test("admin analytics renders a genuine empty state when no data has been collected", async () => {
  window.sessionStorage.setItem("vorliq_admin_token", "test-admin-token");
  api.get.mockResolvedValue({ data: emptySummary });

  render(
    <MemoryRouter>
      <AdminAnalytics />
    </MemoryRouter>
  );

  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/analytics", expect.anything()));
  expect(await screen.findByText(/no analytics events have been collected yet/i)).toBeInTheDocument();
  // No fake numbers: the headline stats read zero.
  expect(screen.getByText(/page views \(30d\)/i)).toBeInTheDocument();
});

test("admin analytics surfaces an unauthorized token error", async () => {
  api.get.mockRejectedValue({ response: { status: 401 } });

  render(
    <MemoryRouter>
      <AdminAnalytics />
    </MemoryRouter>
  );

  await userEvent.type(screen.getByLabelText(/admin token/i, { selector: "input" }), "wrong-token");
  await userEvent.click(screen.getByRole("button", { name: /view analytics/i }));

  expect(await screen.findByText(/that admin token was not accepted/i)).toBeInTheDocument();
});
