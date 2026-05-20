import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Audit from "./Audit";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({
    data: {
      success: true,
      audit_schema_version: 1,
      deployment_commit: "abc123def456789",
      chain_height: 12,
      latest_block_hash: "0000latest",
      storage_health_status: "ok",
      active_node_count: 2,
      active_incident_count: 0,
      export_timestamp: "2026-05-20T10:00:00.000Z",
      exports: [
        { name: "chain", endpoint: "/api/audit/chain", sha256: "hash1" },
        { name: "treasury", endpoint: "/api/audit/treasury", sha256: "hash2" },
      ],
    },
  });
});

test("Audit page renders manifest summary", async () => {
  render(
    <MemoryRouter>
      <Audit />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 1, name: /audit/i })).toBeInTheDocument();
  expect(screen.getByText(/deployment commit/i)).toBeInTheDocument();
  expect(screen.getByText(/chain height/i)).toBeInTheDocument();
  expect(screen.getByText(/0000latest/i)).toBeInTheDocument();
});

test("Audit page renders export links and safe warning", async () => {
  render(
    <MemoryRouter>
      <Audit />
    </MemoryRouter>
  );

  expect(await screen.findByRole("link", { name: /live audit manifest/i })).toHaveAttribute("href", "/api/audit/manifest");
  expect(screen.getByRole("link", { name: /chain export/i })).toHaveAttribute("href", "/api/audit/chain");
  expect(screen.getByText(/do not include private wallet keys/i)).toBeInTheDocument();
  expect(screen.getByText(/cannot recover private wallet keys/i)).toBeInTheDocument();
});
