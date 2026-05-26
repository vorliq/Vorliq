import { render, screen } from "@testing-library/react";

import Bootstrap from "./Bootstrap";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    const responses = {
      "/bootstrap/package": {
        success: true,
        source_node_url: "https://vorliq.org",
        snapshot_signature_verified: true,
        chain_height: 42,
        latest_block_hash: "0000latest",
        snapshot_hash: "snapshothash",
        audit_chain_hash: "audithash",
      },
      "/bootstrap/status": {
        success: true,
        chain_valid: true,
        last_bootstrap_marker: { has_run: false },
      },
      "/snapshot/verify": {
        success: true,
        verified: true,
        signature_verified: true,
      },
      "/readiness": {
        success: true,
        overall_status: "pass",
      },
    };
    return Promise.resolve({ data: responses[path] || { success: true } });
  });
});

test("Bootstrap page renders verified bootstrap status and commands", async () => {
  render(<Bootstrap />);

  expect(await screen.findByRole("heading", { name: /bootstrap node/i })).toBeInTheDocument();
  expect(await screen.findByText(/0000latest/i)).toBeInTheDocument();
  expect(screen.getAllByText(/python3\.12 tools\/bootstrap_chain_from_public_node\.py --trusted-node https:\/\/vorliq\.org --data-dir \.\/blockchain\/data/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/--write/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /bootstrap chain guide/i })).toHaveAttribute("href", "/docs/bootstrap-chain.html");
});
