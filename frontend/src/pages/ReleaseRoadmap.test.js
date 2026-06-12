import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Health from "./Health";
import Readiness from "./Readiness";
import Releases from "./Releases";
import Roadmap from "./Roadmap";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

const versionMetadata = {
  success: true,
  project_name: "Vorliq",
  current_version: "1.0.0",
  release_channel: "stable",
  deployment_commit: "abc123def456",
  api_version: 1,
  sdk_version: "1.0.0",
  mobile_version: "1.0.0",
  web_version: "0.1.0",
  recommended_node_version: "1.0.0",
  compatibility_notes: ["API v1 is stable and /api remains supported for existing clients."],
};

const changelog = {
  success: true,
  latest_version: "1.0.0",
  release_channel: "stable",
  entries: [
    {
      version: "1.0.0",
      title: "Roadmap releases and upgrade management",
      date: "2026-05-20",
      summary: "Added public release metadata, roadmap data, and upgrade guidance.",
      major_changes: ["Version metadata API", "Roadmap page"],
      compatibility_notes: ["No existing /api routes were removed."],
      docs_url: "https://vorliq.github.io/Vorliq/upgrades.html",
    },
  ],
};

const roadmap = {
  success: true,
  disclaimer: "Roadmap items can change based on community needs and technical reality.",
  items: [
    {
      id: "release-management-v1",
      status: "in_progress",
      category: "Developer ecosystem",
      title: "Release metadata and public roadmap",
      summary: "Expose current version, changelog, roadmap, and upgrade guidance.",
    },
    {
      id: "wallet-safety-v2",
      status: "completed",
      category: "Security audits",
      title: "Wallet and transaction safety v2",
      summary: "Improved send review, validation, and backup education.",
    },
  ],
};

const readiness = {
  success: true,
  overall_status: "warning",
  score: 86,
  checked_at: "2026-05-21T12:00:00.000Z",
  checks: [
    {
      id: "backend_health",
      name: "Backend health",
      category: "Core",
      status: "pass",
      severity: "critical",
      message: "Backend API responded.",
      safe_metadata: { endpoint: "/api/health" },
    },
    {
      id: "backup_recent",
      name: "Recent backup",
      category: "Storage",
      status: "warning",
      severity: "high",
      message: "Latest backup is older than the preferred window.",
      safe_metadata: { age_hours: 52 },
    },
  ],
};

function mockApiGet(path) {
  if (path === "/version/metadata") return Promise.resolve({ data: versionMetadata });
  if (path === "/changelog") return Promise.resolve({ data: changelog });
  if (path === "/roadmap") return Promise.resolve({ data: roadmap });
  if (path === "/readiness") return Promise.resolve({ data: readiness });
  if (path === "/diagnostics") {
    return Promise.resolve({
      data: {
        success: true,
        node_url: "https://vorliq.org",
        block_height: 12,
        chain_valid: true,
        pending_transactions: 0,
        known_peers: 1,
        active_registry_nodes: 1,
        uptime_seconds: 120,
        total_vlq_in_circulation: 1000,
        current_mining_reward: 50,
        last_block_hash: "0000abc",
        last_block_timestamp: 1715791000,
      },
    });
  }
  if (path === "/registry/nodes") return Promise.resolve({ data: { success: true, nodes: [] } });
  if (path === "/registry/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          active_node_count: 1,
          synced_node_count: 1,
          behind_node_count: 0,
          invalid_node_count: 0,
          average_reliability_score: 100,
          highest_chain_height: 12,
        },
      },
    });
  }
  if (path === "/deployment") {
    return Promise.resolve({
      data: { success: true, commit_hash: "abc123def456", commit_timestamp: "2026-05-20T12:00:00.000Z" },
    });
  }
  if (path === "/security/status") {
    return Promise.resolve({
      data: {
        success: true,
        rate_limiting_enabled: true,
        security_headers_enabled: true,
        production_mode: true,
        cors_restricted: true,
      },
    });
  }
  if (path === "/backup/status") {
    return Promise.resolve({ data: { success: true, backup_directory_exists: false } });
  }
  if (path === "/storage/health") {
    return Promise.resolve({
      data: { success: true, overall_status: "ok", critical_files_ok: 10, warnings_count: 0, errors_count: 0 },
    });
  }
  if (path === "/incidents/active") return Promise.resolve({ data: { success: true, incidents: [] } });
  if (path === "/reports/weekly") {
    return Promise.resolve({ data: { success: true, stats: { block_height: 12, generated_at: "now" } } });
  }
  if (path === "/mining/status") {
    return Promise.resolve({
      data: {
        success: true,
        status: {
          current_block_height: 12,
          can_mine_now: true,
          seconds_until_next_allowed_block: 0,
          current_difficulty: 3,
          miner_reward_after_treasury: 47.5,
          treasury_reward_per_block: 2.5,
        },
      },
    });
  }
  return Promise.resolve({ data: { success: true } });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation(mockApiGet);
});

test("Roadmap page renders public roadmap data", async () => {
  render(
    <MemoryRouter>
      <Roadmap />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 1, name: /roadmap/i })).toBeInTheDocument();
  expect(await screen.findByText(/Release metadata and public roadmap/i)).toBeInTheDocument();
  expect(await screen.findByText(/Wallet and transaction safety v2/i)).toBeInTheDocument();
  expect(screen.getByText(/can change based on community needs/i)).toBeInTheDocument();
});

test("Releases page renders current versions and changelog", async () => {
  render(
    <MemoryRouter>
      <Releases />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 1, name: /releases/i })).toBeInTheDocument();
  expect((await screen.findAllByText("1.0.0")).length).toBeGreaterThan(0);
  expect(screen.getByText(/abc123def456/)).toBeInTheDocument();
  expect(screen.getByText(/Roadmap releases and upgrade management/i)).toBeInTheDocument();
});

test("Health page renders version metadata", async () => {
  render(
    <MemoryRouter>
      <Health />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 2, name: /version metadata/i })).toBeInTheDocument();
  expect(await screen.findByText("Current Version")).toBeInTheDocument();
  expect(await screen.findByText("Recommended Node Version")).toBeInTheDocument();
});

test("Readiness page renders score, status, and checks", async () => {
  render(
    <MemoryRouter>
      <Readiness />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 1, name: /readiness/i })).toBeInTheDocument();
  expect(await screen.findByText("86")).toBeInTheDocument();
  expect(await screen.findByText("Backend health")).toBeInTheDocument();
  expect(await screen.findByText(/technical readiness signal only/i)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /how to read this/i })).toBeInTheDocument();
  expect(await screen.findByText(/known inactive historical nodes/i)).toBeInTheDocument();
  expect(await screen.findByText(/abc123def456/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /deploy docs/i })).toHaveAttribute("href", "/docs/deploy.html");
});

test("Health page renders readiness summary", async () => {
  render(
    <MemoryRouter>
      <Health />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 2, name: /production readiness/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /production hardening map/i })).toBeInTheDocument();
  expect((await screen.findAllByText("Warnings")).length).toBeGreaterThan(0);
});
