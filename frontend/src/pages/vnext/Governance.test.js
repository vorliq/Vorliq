import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Governance from "./Governance";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
// Passthrough provider + controllable useAuth so we can render both the
// signed-out and signed-in branches of the page.
jest.mock("../../context/AuthContext", () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }) => children,
}));

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({ isLoggedIn: false, wallet: null });
  api.get.mockImplementation((path) => {
    if (path === "/governance/proposals") return Promise.resolve({ data: { proposals: [] } });
    if (path === "/governance/all") return Promise.resolve({ data: { proposals: [] } });
    if (path === "/governance/summary") return Promise.resolve({ data: { summary: { active_count: 0 } } });
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 100 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <Governance />
      </NotificationProvider>
    </MemoryRouter>
  );
}

test("renders the governance page and loads proposals (signed out)", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: /^governance$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/governance/proposals", expect.anything());
});

test("renders active and closed proposals for a signed-in member", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  const proposal = {
    proposal_id: "p1",
    status: "active",
    title: "Raise the block reward",
    description: "Increase the mining reward to grow participation.",
    proposer_address: "VLQ_PROPOSER_ADDRESS",
    parameter: "mining_reward",
    proposed_value: 60,
    current_value: 50,
    votes_for: 120,
    votes_against: 30,
    yes_weight: 120,
    no_weight: 30,
    total_weight: 150,
    quorum: 100,
    approval_threshold: 0.6,
    deadline: Math.floor(Date.now() / 1000) + 86400,
    created_at: Math.floor(Date.now() / 1000) - 3600,
    my_vote: null,
  };
  const closed = { ...proposal, proposal_id: "p2", status: "executed", title: "Lower difficulty" };
  api.get.mockImplementation((path) => {
    if (path === "/governance/proposals") return Promise.resolve({ data: { proposals: [proposal] } });
    if (path === "/governance/all") return Promise.resolve({ data: { proposals: [proposal, closed] } });
    if (path === "/governance/summary") {
      return Promise.resolve({ data: { summary: { active_count: 1, quorum: 100, approval_threshold: 0.6 } } });
    }
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 500 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });

  renderPage();

  expect(await screen.findByText(/raise the block reward/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /active proposals/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /closed proposals/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/wallet/balance", expect.anything());
});
