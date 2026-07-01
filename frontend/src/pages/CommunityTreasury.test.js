import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import CommunityTreasury from "./CommunityTreasury";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn() } }));

const TREASURY = {
  balance: 1200,
  total_inflow: 5000,
  total_outflow: 3800,
  faucet_outflow_total: 900,
  inflow_count: 120,
  outflow_count: 40,
  treasury_address: "VLQ_TREASURY_ADDRESS",
  balance_series: [
    { timestamp: 1700000000, balance: 100 },
    { timestamp: 1700003600, balance: 1200 },
  ],
  recent_inflows: [{ block_index: 10, amount: 5, kind: "mining" }],
  recent_outflows: [{ block_index: 12, amount: 1, kind: "faucet" }],
};

beforeEach(() => {
  jest.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CommunityTreasury />
    </MemoryRouter>
  );
}

test("renders treasury balances and recent flows once loaded", async () => {
  api.get.mockResolvedValue({ data: { treasury: TREASURY } });
  renderPage();

  expect(await screen.findByRole("heading", { name: /the community treasury/i })).toBeInTheDocument();
  expect(await screen.findByText(/current balance/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /recent inflows/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /recent outflows/i })).toBeInTheDocument();
  expect(screen.getByText(/VLQ_TREASURY_ADDRESS/)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/treasury/transparency");
});

test("shows a friendly status when the treasury data is unavailable", async () => {
  api.get.mockRejectedValue(new Error("down"));
  renderPage();
  expect(await screen.findByText(/treasury data is temporarily unavailable/i)).toBeInTheDocument();
});
