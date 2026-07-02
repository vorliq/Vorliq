import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Mining from "./Mining";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));

function mockMining() {
  api.get.mockImplementation((path) => {
    if (path === "/mining/status") {
      return Promise.resolve({
        data: { status: { enabled: true }, current_mining_reward: 50, pending_transactions: 2, block_height: 8046, chain_valid: true },
      });
    }
    if (path === "/mining/history") {
      return Promise.resolve({
        data: { history: [{ block_index: 8046, reward: 50, timestamp: Math.floor(Date.now() / 1000) }], blocks: [] },
      });
    }
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 200 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <Mining />
      </NotificationProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({ isLoggedIn: false, wallet: null });
  mockMining();
});

test("renders the mining page and loads status (signed out)", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: /^mining$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/mining/status", expect.anything());
});

test("renders the signed-in mining experience", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockMining();
  renderPage();
  expect(await screen.findByRole("heading", { name: /^mining$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/wallet/balance", expect.anything());
});

// Ported from the legacy Mine page suite: the header figures come from the real
// /mining/status split — the displayed block reward is the miner share plus the
// treasury share, alongside the real difficulty and block-time target.
test("header cards compute the block reward from the miner and treasury shares", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/mining/status") {
      return Promise.resolve({
        data: {
          status: {
            enabled: true,
            current_block_height: 12,
            current_difficulty: 3,
            miner_reward_after_treasury: 47.5,
            treasury_reward_per_block: 2.5,
            block_time_target: 60,
          },
        },
      });
    }
    if (path === "/mining/history") return Promise.resolve({ data: { history: [] } });
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 200 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
  renderPage();

  expect(await screen.findByText(/current block reward/i)).toBeInTheDocument();
  // 47.5 VLQ to the miner + 2.5 VLQ to the treasury = 50 VLQ per block.
  expect(await screen.findByText("50 VLQ")).toBeInTheDocument();
  expect(screen.getByText(/network difficulty/i)).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText(/block time target/i)).toBeInTheDocument();
  expect(screen.getByText("60s")).toBeInTheDocument();
});
