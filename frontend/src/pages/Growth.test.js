import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Growth from "./Growth";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/analytics/summary") {
      return Promise.resolve({
        data: {
          success: true,
          page_views_today: 3,
          page_views_7d: 12,
          unique_anonymous_sessions_today: 2,
          unique_anonymous_sessions_7d: 5,
          top_routes_7d: [{ name: "/forum", count: 4 }],
          top_features_7d: [{ name: "community", count: 6 }],
          onboarding_completed_7d: 1,
          faucet_interest_7d: 2,
          forum_page_views_7d: 4,
          mine_page_views_7d: 3,
        },
      });
    }
    if (path === "/registry/summary") {
      return Promise.resolve({ data: { success: true, summary: { active_node_count: 1, synced_node_count: 1 } } });
    }
    if (path === "/chain/summary") {
      return Promise.resolve({ data: { success: true, summary: { block_height: 9, pending_transaction_count: 0 } } });
    }
    if (path === "/mining/status") {
      return Promise.resolve({ data: { success: true, status: { current_mining_reward: 50, can_mine_now: true } } });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("Growth page renders summary", async () => {
  render(
    <MemoryRouter>
      <Growth />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 1, name: /growth/i })).toBeInTheDocument();
  expect(screen.getByText(/visits today/i)).toBeInTheDocument();
  expect(screen.getByText("/forum")).toBeInTheDocument();
  expect(screen.getByText(/active registry nodes/i)).toBeInTheDocument();
});
