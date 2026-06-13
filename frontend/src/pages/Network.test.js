import { render, screen } from "@testing-library/react";

import Network from "./Network";
import api from "../helpers/api";

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
    if (path === "/peers") {
      return Promise.resolve({ data: { success: true, peers: ["https://private-node.example.org"] } });
    }
    if (path === "/registry/nodes") {
      return Promise.resolve({
        data: {
          success: true,
          nodes: [
            {
              node_url: "https://node.example.org",
              display_name: "Community Node",
              sync_status: "synced",
              last_chain_height: 42,
              reliability_score: 98,
            },
          ],
        },
      });
    }
    if (path === "/registry/summary") {
      return Promise.resolve({
        data: {
          success: true,
          summary: {
            total_registered_node_count: 2,
            active_node_count: 1,
            synced_node_count: 1,
            behind_node_count: 0,
          },
        },
      });
    }
    if (path === "/registry/lifecycle") {
      return Promise.resolve({
        data: {
          success: true,
          nodes: [
            { node_url: "https://active.example.org", lifecycle_status: "active" },
            { node_url: "https://old.example.org", lifecycle_status: "archived" },
          ],
        },
      });
    }
    if (path === "/nodes/compare") {
      return Promise.resolve({
        data: {
          success: true,
          trusted_chain_height: 42,
          trusted_latest_hash: "0000trustedhash",
          trusted_snapshot_hash: "snapshothash",
          trusted_signature_verified: true,
          summary: {
            total_node_count: 2,
            active_node_count: 1,
            synced_count: 1,
            behind_count: 0,
            ahead_count: 0,
            forked_count: 0,
            stale_count: 1,
            unreachable_count: 0,
            overall_status: "synced",
          },
        },
      });
    }
    if (path === "/nodes/monitor") {
      return Promise.resolve({ data: { success: true, overall_status: "ok", warning_count: 0, critical_count: 0 } });
    }
    if (path === "/peers/propagation/status") {
      return Promise.resolve({
        data: {
          success: true,
          receive_enabled: true,
          broadcast_enabled: false,
          eligible_broadcast_peer_count: 0,
          quarantined: 0,
        },
      });
    }
    if (path === "/bootstrap/status") {
      return Promise.resolve({ data: { success: true, chain_valid: true } });
    }
    if (path === "/bootstrap/package") {
      return Promise.resolve({ data: { success: true, snapshot_signature_verified: true } });
    }
    if (path === "/snapshot/verify") {
      return Promise.resolve({ data: { success: true, verified: true, signature_verified: true } });
    }
    if (path === "/audit/manifest") {
      return Promise.resolve({ data: { success: true, exports: [{ name: "chain" }, { name: "registry" }] } });
    }
    if (path === "/readiness") {
      return Promise.resolve({ data: { success: true, overall_status: "pass" } });
    }
    if (path === "/network/manifest") {
      return Promise.resolve({ data: { success: true } });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("Network page shows public decentralization status and Node Operator Tools", async () => {
  render(<Network />);

  expect(await screen.findByRole("heading", { name: /public network overview/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /trusted chain sync/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /peer propagation/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /bootstrap, snapshot, audit/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /registry lifecycle/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /node operator tools/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /node guide/i })).toHaveAttribute("href", "/docs/run-your-own-node.html");
  expect(screen.getByRole("link", { name: /setup docs/i })).toHaveAttribute("href", "/docs/setup.html");
  expect(screen.getByRole("link", { name: /bootstrap docs/i })).toHaveAttribute("href", "/docs/bootstrap-chain.html");
  expect(screen.getByRole("link", { name: /bootstrap verification/i })).toHaveAttribute("href", "/docs/bootstrap-verification.html");
  expect(screen.getByRole("link", { name: /node sync docs/i })).toHaveAttribute("href", "/docs/node-sync.html");
  expect(screen.getByRole("link", { name: /propagation docs/i })).toHaveAttribute("href", "/docs/peer-propagation.html");
  expect(screen.getByRole("link", { name: /audit docs/i })).toHaveAttribute("href", "/docs/audit.html");
  expect(screen.getByRole("link", { name: /readiness page/i })).toHaveAttribute("href", "/readiness");
  expect(screen.getAllByRole("link", { name: /peer propagation/i })[0]).toHaveAttribute("href", "/peers/propagation");
  expect(screen.getByRole("link", { name: /bootstrap node/i })).toHaveAttribute("href", "/bootstrap");
  expect(screen.getByText(/no serious public decentralization warnings/i)).toBeInTheDocument();
});

test("Network page hides raw peer endpoints in rendered public lists", async () => {
  render(<Network />);

  expect(await screen.findByText(/known peers/i)).toBeInTheDocument();
  // Wait for the async public node/peer data to load before asserting on the
  // rendered labels, so the check does not race the network request.
  expect((await screen.findAllByText(/endpoint hidden/i)).length).toBeGreaterThan(0);
  expect(screen.queryByText("https://private-node.example.org")).not.toBeInTheDocument();
  expect(screen.queryByText("https://node.example.org")).not.toBeInTheDocument();
});

test("Network page keeps sections visible when optional status APIs are unavailable", async () => {
  api.get.mockImplementation((path) => {
    if (["/nodes/compare", "/peers/propagation/status", "/bootstrap/package"].includes(path)) {
      return Promise.reject(new Error("unavailable"));
    }
    if (path === "/peers") return Promise.resolve({ data: { success: true, peers: [] } });
    if (path === "/registry/nodes") return Promise.resolve({ data: { success: true, nodes: [] } });
    if (path === "/registry/summary") {
      return Promise.resolve({ data: { success: true, summary: { total_registered_node_count: 1, active_node_count: 1 } } });
    }
    if (path === "/registry/lifecycle") {
      return Promise.resolve({ data: { success: false } });
    }
    return Promise.resolve({ data: { success: true } });
  });

  render(<Network />);

  expect(await screen.findByRole("heading", { name: /public network overview/i })).toBeInTheDocument();
  expect(screen.getByText(/node comparison is unavailable/i)).toBeInTheDocument();
  expect(screen.getByText(/peer propagation status is unavailable/i)).toBeInTheDocument();
  expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
});
