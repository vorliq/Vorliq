import { act, fireEvent, render, screen } from "@testing-library/react";

import Snapshot from "./Snapshot";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: jest.fn().mockResolvedValue(undefined),
    },
  });
  api.get.mockImplementation((path) => {
    if (path === "/snapshot/latest") {
      return Promise.resolve({
        data: {
          success: true,
          snapshot: {
            generated_at: "2026-05-25T12:00:00.000Z",
            chain_height: 42,
            latest_block_hash: "0000latest",
            confirmed_transaction_count: 100,
            treasury_balance: 25,
            active_node_count: 3,
            deployment_commit: "abcdef123456",
            storage_status: { overall_status: "ok" },
            readiness_status: { overall_status: "pass" },
            hashes: {
              chain_summary: "a".repeat(64),
              latest_block: "b".repeat(64),
            },
          },
        },
      });
    }
    if (path === "/snapshot/verify") {
      return Promise.resolve({
        data: {
          success: true,
          verified: true,
          snapshot: {
            generated_at: "2026-05-25T12:00:00.000Z",
            chain_height: 42,
            latest_block_hash: "0000latest",
            confirmed_transaction_count: 100,
            treasury_balance: 25,
            active_node_count: 3,
            deployment_commit: "abcdef123456",
            storage_status: { overall_status: "ok" },
            readiness_status: { overall_status: "pass" },
            hashes: {
              chain_summary: "a".repeat(64),
              latest_block: "b".repeat(64),
            },
          },
          checks: [{ id: "chain_valid_true", passed: true, message: "Snapshot reports chain_valid true." }],
          warnings: [],
          errors: [],
        },
      });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
});

test("Snapshot page renders", async () => {
  render(<Snapshot />);

  expect(await screen.findByRole("heading", { name: /snapshot/i })).toBeInTheDocument();
  expect(await screen.findByText(/chain height/i)).toBeInTheDocument();
  expect(screen.getByText(/0000latest/i)).toBeInTheDocument();
  expect(screen.getByText(/not a legal, financial, or investment guarantee/i)).toBeInTheDocument();
});

test("Snapshot page renders copy controls and hash list", async () => {
  render(<Snapshot />);

  expect(await screen.findByText(/hash list/i)).toBeInTheDocument();
  expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /copy/i })[0]);
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("0000latest");
});
