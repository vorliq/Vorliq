import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Admin from "./Admin";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/admin/overview") {
      return Promise.resolve({
        data: {
          success: true,
          deployment: { commit_hash: "abcdef1234567890" },
          blockchain: { height: 1, chain_valid: true, pending_transaction_count: 0 },
          treasury: { balance: 0 },
          backups: { latest_backup: null },
          incidents: { active_count: 0 },
          services: {},
          server_uptime_seconds: 1,
        },
      });
    }
    if (path === "/registry/lifecycle") {
      return Promise.resolve({
        data: {
          success: true,
          summary: { active_count: 1, stale_count: 0, inactive_count: 1, archived_count: 0, retired_count: 0, visible_public_count: 2 },
          nodes: [{ node_url: "https://old.example.org", display_name: "Old Example", lifecycle_status: "inactive" }],
        },
      });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("Admin registry lifecycle section renders protected controls", async () => {
  render(<Admin />);

  fireEvent.change(screen.getByLabelText(/admin token/i), { target: { value: "good-token" } });
  await userEvent.click(screen.getByRole("button", { name: /open operator dashboard/i }));
  await userEvent.click(await screen.findByRole("button", { name: /registry lifecycle/i }));

  expect(await screen.findByText(/registry lifecycle actions do not delete registry history/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/node url/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /restore/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
  expect(await screen.findByText(/old example/i)).toBeInTheDocument();
  expect(screen.queryByText("good-token")).not.toBeInTheDocument();
});
