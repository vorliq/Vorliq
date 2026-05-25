import { render, screen } from "@testing-library/react";

import Health from "./Health";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    const responses = {
      "/diagnostics": { success: true, node_url: "https://vorliq.org", block_height: 42, chain_valid: true, pending_transactions: 2 },
      "/registry/nodes": { success: true, nodes: [] },
      "/registry/summary": { success: true, summary: { active_node_count: 3, synced_node_count: 3, behind_node_count: 0, invalid_node_count: 0, average_reliability_score: 98, highest_chain_height: 42 } },
      "/deployment": { success: true, commit_hash: "abcdef123456" },
      "/version/metadata": { success: true, current_version: "1.0.0", release_channel: "stable", api_version: 1, recommended_node_version: "1.0.0" },
      "/readiness": { success: true, overall_status: "pass", score: 100, checked_at: "2026-05-25T12:00:00.000Z", checks: [] },
      "/security/status": { success: true, rate_limiting_enabled: true },
      "/backup/status": { success: true, latest_backup: { file_name: "backup.tar.gz" } },
      "/storage/health": { success: true, overall_status: "ok", critical_files_ok: 8, warnings_count: 0, errors_count: 0, backup_available: true },
      "/indexes/health": { success: true, status: "ok", exists: true, valid: true, index_chain_match: true, rebuild_needed: false, chain_height: 42 },
      "/snapshot/verify": {
        success: true,
        verified: true,
        snapshot: { chain_height: 42, latest_block_hash: "0000latest" },
        checks: [{ id: "secret_scan_passed", passed: true }],
        warnings: [],
      },
      "/migration/readiness": { success: true, migration_supported: "dry_run_only", future_database_target: "postgresql", storage_backend: "json", database_enabled: false, postgres_active: false, postgres_schema_present: true, migration_phase: "preparation", chain_source_of_truth: "json", indexes_derived: true, rollback_plan_required: true },
      "/incidents/active": { success: true, incidents: [] },
      "/reports/weekly": { success: true, stats: { active_users: 1, transactions: 2 }, generated_at: "2026-05-25T12:00:00.000Z" },
      "/mining/status": { success: true, status: { current_block_height: 42, can_mine_now: true, seconds_until_next_allowed_block: 0, current_difficulty: 4, miner_reward_after_treasury: 45, treasury_reward_per_block: 5 } },
    };
    return Promise.resolve({ data: responses[path] || { success: true } });
  });
});

test("Health shows snapshot summary", async () => {
  render(<Health />);

  expect(await screen.findByRole("heading", { name: /snapshot verification/i })).toBeInTheDocument();
  expect(await screen.findByText(/0000latest/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open snapshot verification/i })).toHaveAttribute("href", "/snapshot");
});
