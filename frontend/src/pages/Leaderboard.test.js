import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

import Leaderboard from "./Leaderboard";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn() } }));

function mockLeaderboard(overrides = {}) {
  api.get.mockImplementation((path) => {
    if (path === "/leaderboard") {
      return Promise.resolve({
        data: {
          active: [{ address: "VLQ_ACTIVE_ADDRESS", value: 12 }],
          holders: [],
          miners: [{ address: "VLQ_MINER_ADDRESS", value: 4 }],
          lenders: [],
          ...overrides,
        },
      });
    }
    if (path === "/profiles/top") return Promise.resolve({ data: { profiles: [] } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Leaderboard />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("loads and shows the most-active wallets by default", async () => {
  mockLeaderboard();
  renderPage();
  expect(await screen.findByRole("heading", { name: /^leaderboard$/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /most active wallets/i })).toBeInTheDocument();
});

test("switching tabs shows the corresponding board (and empty states)", async () => {
  mockLeaderboard();
  renderPage();
  await screen.findByRole("heading", { name: /most active wallets/i });

  await userEvent.click(screen.getByRole("button", { name: /top holders/i }));
  expect(screen.getByRole("heading", { name: /top holders/i })).toBeInTheDocument();
  expect(screen.getByText(/no leaderboard data is available yet/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /top reputation/i }));
  expect(screen.getByText(/no public profiles have reputation yet/i)).toBeInTheDocument();
});

test("surfaces an error when the leaderboard cannot load", async () => {
  api.get.mockRejectedValue({});
  renderPage();
  expect(await screen.findByText(/unable to load the community leaderboard/i)).toBeInTheDocument();
});
