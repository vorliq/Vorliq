import { render, screen } from "@testing-library/react";

import NodeSync from "./NodeSync";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/nodes/compare") {
      return Promise.resolve({
        data: {
          success: true,
          active_node_count: 1,
          trusted_node_url: "https://vorliq.org",
          trusted_chain_height: 42,
          trusted_latest_hash: "0000hash",
          trusted_snapshot_hash: "snap",
          trusted_signature_verified: true,
          summary: { overall_status: "synced", synced_count: 1, behind_count: 0, ahead_count: 0, forked_count: 0 },
          nodes: [{
            node_url: "https://node.example.org",
            display_name: "Lifecycle Node",
            lifecycle_status: "stale",
            sync_status: "stale",
            sync_label: "Stale",
            risk_level: "warning",
            active: false,
            last_seen: 1,
          }],
        },
      });
    }
    if (path === "/nodes/monitor") {
      return Promise.resolve({ data: { success: true, overall_status: "warning", warning_count: 1, critical_count: 0, alerts: [] } });
    }
    if (path === "/readiness") {
      return Promise.resolve({ data: { success: true, overall_status: "pass" } });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("NodeSync renders lifecycle status in comparison table", async () => {
  render(<NodeSync />);

  expect(await screen.findByRole("heading", { name: /node comparison/i })).toBeInTheDocument();
  expect(await screen.findByText(/lifecycle node/i)).toBeInTheDocument();
  expect(screen.getAllByText(/stale/i).length).toBeGreaterThan(0);
});
