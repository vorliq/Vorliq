import { act, fireEvent, render, screen } from "@testing-library/react";

import SnapshotArchive from "./SnapshotArchive";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

const archiveItem = {
  archive_version: 1,
  created_at: "2026-05-25T12:00:00.000Z",
  snapshot_hash: "a".repeat(64),
  signature_status: "signed",
  signature_verified_at_archive_time: true,
  public_key_id: "ed25519:test",
  chain_height: 42,
  latest_block_hash: "b".repeat(64),
  confirmed_transaction_count: 100,
  treasury_balance: 25,
  active_node_count: 3,
  deployment_commit: "abcdef123456",
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: jest.fn().mockResolvedValue(undefined),
    },
  });
  api.get.mockImplementation((path) => {
    if (path === "/snapshot/archive/latest") {
      return Promise.resolve({ data: { success: true, archive: archiveItem } });
    }
    if (path === "/snapshot/archive?limit=30&offset=0") {
      return Promise.resolve({ data: { success: true, archives: [archiveItem], total: 1 } });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
});

test("SnapshotArchive page renders latest archive and copy controls", async () => {
  render(<SnapshotArchive />);

  expect(await screen.findByRole("heading", { name: /snapshot archive/i })).toBeInTheDocument();
  expect(screen.getByText(/verification aid only/i)).toBeInTheDocument();
  expect(await screen.findByText("ed25519:test")).toBeInTheDocument();
  expect(screen.getAllByText("b".repeat(64)).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: /current snapshot/i })).toHaveAttribute("href", "/snapshot");

  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /copy/i })[0]);
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("a".repeat(64));
  expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
});
