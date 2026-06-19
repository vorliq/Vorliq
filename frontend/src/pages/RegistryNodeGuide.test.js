import { render, screen } from "@testing-library/react";

import Registry from "./Registry";
import api from "../helpers/api";
import { AuthProvider } from "../context/AuthContext";

// Registry reads the connected wallet (for the Verify Operator flow) via useAuth,
// so it must render inside an AuthProvider.
function renderRegistry() {
  return render(
    <AuthProvider>
      <Registry />
    </AuthProvider>
  );
}

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("react-toastify", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/registry/nodes") {
      return Promise.resolve({ data: { success: true, nodes: [] } });
    }
    if (path === "/registry/all") {
      return Promise.resolve({ data: { success: true, nodes: [] } });
    }
    if (path === "/registry/lifecycle") {
      return Promise.resolve({
        data: {
          success: true,
          summary: { active_count: 1, stale_count: 1, inactive_count: 0, archived_count: 1, retired_count: 0 },
          nodes: [
            { node_url: "https://active.example.org", display_name: "Active Example", lifecycle_status: "active", sync_status: "synced", reliability_score: 98, uptime_score: 98, last_seen: Date.now() / 1000 },
            { node_url: "https://archived.example.org", display_name: "Archived Example", lifecycle_status: "archived", sync_status: "unknown", reliability_score: 0, uptime_score: 0, last_seen: 1 },
          ],
        },
      });
    }
    if (path === "/registry/summary") {
      return Promise.resolve({ data: { success: true, summary: { active_node_count: 0, synced_node_count: 0, highest_chain_height: 0, average_reliability_score: 0 } } });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("Registry lifecycle filters and badges render", async () => {
  renderRegistry();

  await screen.findByRole("heading", { name: /run your own node/i });
  expect(screen.getByRole("button", { name: /all nodes/i })).toBeInTheDocument();

  screen.getByRole("button", { name: /all nodes/i }).click();

  expect(await screen.findByLabelText(/lifecycle/i)).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /all visible/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /archived/i })).toBeInTheDocument();
  expect(await screen.findByText(/archived and retired nodes are preserved/i)).toBeInTheDocument();
  expect(await screen.findByText(/active example/i)).toBeInTheDocument();
  expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0);
});

test("Registry page shows Run Your Own Node section", async () => {
  renderRegistry();

  expect(await screen.findByRole("heading", { name: /run your own node/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /node guide/i })).toHaveAttribute("href", "/docs/run-your-own-node.html");
  expect(screen.getByRole("link", { name: /bootstrap node/i })).toHaveAttribute("href", "/bootstrap");
  expect(screen.getByText(/verify first/i)).toBeInTheDocument();
  expect(screen.getAllByText(/install/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/register/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/check health/i)).toBeInTheDocument();
  expect(screen.getByText(/backups/i)).toBeInTheDocument();
});
