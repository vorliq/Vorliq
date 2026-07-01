import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Economics from "./Economics";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn() } }));

const ECONOMICS = {
  maximum_supply: 21000000,
  total_issued: 400000,
  percent_issued: 1.9048,
  remaining_to_issue: 20600000,
  current_mining_reward: 50,
  miner_reward_per_block: 45,
  treasury_reward_per_block: 5,
  treasury_percentage: 0.1,
  next_halving_block: 210000,
  blocks_until_halving: 201954,
  estimated_next_halving_at: 1800000000,
  current_block_height: 8046,
  seconds_per_block_estimate: 60,
  halving_interval: 210000,
  current_epoch: 0,
  supply_curve: [
    { block: 0, supply: 0 },
    { block: 210000, supply: 10500000 },
  ],
  supply_schedule: [
    { epoch: 0, start_block: 0, reward: 50, cumulative_supply_at_end: 10500000 },
    { epoch: 1, start_block: 210000, reward: 25, cumulative_supply_at_end: 15750000 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Economics />
    </MemoryRouter>
  );
}

test("renders the supply figures and halving schedule once loaded", async () => {
  api.get.mockResolvedValue({ data: { economics: ECONOMICS } });
  renderPage();

  expect(await screen.findByRole("heading", { name: /vlq economics/i })).toBeInTheDocument();
  expect(await screen.findByText(/maximum supply/i)).toBeInTheDocument();
  expect(screen.getByText(/issued so far/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /the halving schedule/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/economics/overview");
});

test("shows a friendly status when economics data is unavailable", async () => {
  api.get.mockRejectedValue(new Error("down"));
  renderPage();
  expect(await screen.findByText(/economics data is temporarily unavailable/i)).toBeInTheDocument();
});
