import { act, fireEvent, render, screen } from "@testing-library/react";

import Snapshot from "./Snapshot";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

function snapshotFixture(overrides = {}) {
  return {
    generated_at: "2026-05-25T12:00:00.000Z",
    chain_height: 42,
    latest_block_hash: "0000latest",
    confirmed_transaction_count: 100,
    treasury_balance: 25,
    active_node_count: 3,
    deployment_commit: "abcdef123456",
    storage_status: { overall_status: "ok" },
    readiness_status: { overall_status: "pass" },
    signature: {
      enabled: false,
      algorithm: "Ed25519",
      public_key_id: null,
      public_key: null,
      snapshot_hash: "c".repeat(64),
      signature: null,
      signed_at: null,
      status: "unsigned",
    },
    hashes: {
      chain_summary: "a".repeat(64),
      latest_block: "b".repeat(64),
    },
    ...overrides,
  };
}

function mockSnapshotApi(snapshot = snapshotFixture(), verification = {}) {
  api.get.mockImplementation((path) => {
    if (path === "/snapshot/latest") {
      return Promise.resolve({ data: { success: true, snapshot } });
    }
    if (path === "/snapshot/verify") {
      return Promise.resolve({
        data: {
          success: true,
          verified: true,
          signature_enabled: snapshot.signature?.enabled === true,
          signature_verified: snapshot.signature?.enabled === true,
          signature_status: snapshot.signature?.enabled ? "verified" : "unsigned",
          signature_required: false,
          snapshot,
          checks: [{ id: "chain_valid_true", passed: true, message: "Snapshot reports chain_valid true." }],
          warnings: [],
          errors: [],
          ...verification,
        },
      });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: jest.fn().mockResolvedValue(undefined),
    },
  });
  mockSnapshotApi();
});

test("Snapshot page renders", async () => {
  render(<Snapshot />);

  expect(await screen.findByRole("heading", { name: /snapshot/i })).toBeInTheDocument();
  expect(await screen.findByText(/chain height/i)).toBeInTheDocument();
  expect(screen.getByText(/0000latest/i)).toBeInTheDocument();
  expect(screen.getByText(/not a legal, financial, or investment guarantee/i)).toBeInTheDocument();
  expect(screen.getByText(/unsigned snapshot/i)).toBeInTheDocument();
  expect(screen.getByText(/production snapshot signing is not configured/i)).toBeInTheDocument();
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

test("Snapshot page renders signed status and copy controls", async () => {
  const signedSnapshot = snapshotFixture({
    signature: {
      enabled: true,
      algorithm: "Ed25519",
      public_key_id: "ed25519:testkey",
      public_key: "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----",
      snapshot_hash: "d".repeat(64),
      signature: "signed-payload",
      signed_at: "2026-05-25T12:00:00.000Z",
      status: "signed",
    },
  });
  mockSnapshotApi(signedSnapshot, {
    signature_enabled: true,
    signature_verified: true,
    signature_status: "verified",
  });

  render(<Snapshot />);

  expect(await screen.findByText(/ed25519:testkey/i)).toBeInTheDocument();
  expect(screen.getByText(/signature verified/i)).toBeInTheDocument();
  expect(screen.getByText(/signed snapshots help verify/i)).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /copy/i }).length).toBeGreaterThanOrEqual(5);
});
