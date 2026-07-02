import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import Governance from "./Governance";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";
import { authorityErrorMessage, postSignedAuthority } from "../../helpers/signedAuthority";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
// Passthrough provider + controllable useAuth so we can render both the
// signed-out and signed-in branches of the page.
jest.mock("../../context/AuthContext", () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }) => children,
}));
jest.mock("../../helpers/signedAuthority", () => ({
  authorityErrorMessage: jest.fn((_error, fallback) => fallback),
  postSignedAuthority: jest.fn(),
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

// Shared fixtures for the ported legacy Governance tests below.
const ACTIVE_PROPOSAL = {
  proposal_id: "proposal-active-1",
  status: "active",
  title: "Adjust mining reward",
  description: "A sufficiently detailed proposal used across the signed-action tests below.",
  proposer_address: "VLQ_PROPOSER_ADDRESS",
  category: "mining_reward",
  parameter: "40",
  votes: {},
  yes_vote_weight: 0,
  no_vote_weight: 0,
  quorum: 100,
  voting_deadline: Math.floor(Date.now() / 1000) + 86400,
  created_at: Math.floor(Date.now() / 1000) - 3600,
};

function mockGovernance(active = [ACTIVE_PROPOSAL], all = active) {
  api.get.mockImplementation((path) => {
    if (path === "/governance/proposals") return Promise.resolve({ data: { proposals: active } });
    if (path === "/governance/all") return Promise.resolve({ data: { proposals: all } });
    if (path === "/governance/summary") {
      return Promise.resolve({ data: { summary: { active_count: active.length, quorum: 100, approval_threshold: 0.6 } } });
    }
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 100 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
}

// Ported from the legacy Governance page suite: the propose form shows per-
// category validation guidance for the real governable settings.
test("propose form shows category validation guidance", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockGovernance();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: /new proposal/i }));

  expect(await screen.findByText(/mining reward must be greater than 0/i)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText(/category/i), "exchange_limit");
  expect(await screen.findByText(/community request limit must be between 1 and 1000/i)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText(/category/i), "general");
  expect(await screen.findByText(/general proposals are advisory/i)).toBeInTheDocument();
});

// Ported from the legacy Governance page suite: proposing and voting both go
// through local signed authority submission (wallet password signs locally).
test("propose and vote actions use local signed authority submission", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockGovernance();
  postSignedAuthority.mockResolvedValue({ data: { success: true } });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: /vote yes/i }));
  const voteSubmit = screen.getByRole("button", { name: /sign and submit yes vote/i });
  expect(voteSubmit).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/wallet password/i), "vote-password");
  await userEvent.click(voteSubmit);

  await waitFor(() => {
    expect(postSignedAuthority).toHaveBeenCalledWith({
      action: "governance.vote",
      walletPassword: "vote-password",
      body: { proposal_id: "proposal-active-1", vote: "yes" },
    });
  });

  await userEvent.click(screen.getByRole("button", { name: /new proposal/i }));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Signed governance proposal");
  await userEvent.type(screen.getByLabelText(/proposed value/i), "40");
  await userEvent.type(
    screen.getByLabelText(/^description$/i),
    "A sufficiently detailed signed governance proposal for focused local testing."
  );
  await userEvent.type(screen.getByLabelText(/wallet password/i), "proposal-password");
  await userEvent.click(screen.getByRole("button", { name: /sign and submit proposal/i }));

  await waitFor(() => {
    expect(postSignedAuthority).toHaveBeenCalledWith({
      action: "governance.propose",
      walletPassword: "proposal-password",
      body: {
        title: "Signed governance proposal",
        description: "A sufficiently detailed signed governance proposal for focused local testing.",
        category: "mining_reward",
        parameter: "40",
      },
    });
  });
  expect(api.post).not.toHaveBeenCalled();
});

// Ported from the legacy Governance page suite: a rejected signed authorization
// surfaces as an error and never as a success state.
test("does not show success when signed authorization is rejected", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockGovernance();
  postSignedAuthority.mockRejectedValue(new Error("internal signing detail"));
  authorityErrorMessage.mockReturnValue("Signed wallet authorization was rejected.");
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: /vote yes/i }));
  await userEvent.type(screen.getByLabelText(/wallet password/i), "wrong-password");
  await userEvent.click(screen.getByRole("button", { name: /sign and submit yes vote/i }));

  expect(await screen.findByText("Signed wallet authorization was rejected.")).toBeInTheDocument();
  expect(screen.queryByText(/you voted/i)).not.toBeInTheDocument();
  // The raw internal error detail is never shown to the member.
  expect(screen.queryByText(/internal signing detail/i)).not.toBeInTheDocument();
});

// Ported from the legacy Governance page suite: only the proposal owner sees
// the cancel action, and cancellation is signed locally.
test("cancellation is shown only for the proposal owner and is signed locally", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  const owned = { ...ACTIVE_PROPOSAL, proposal_id: "proposal-owned-1", proposer_address: "VLQ_ME_ADDRESS", votes: {} };
  mockGovernance([owned]);
  postSignedAuthority.mockResolvedValue({ data: { success: true } });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: /cancel proposal/i }));
  await userEvent.type(screen.getByLabelText(/wallet password/i), "cancel-password");
  await userEvent.click(screen.getByRole("button", { name: /sign and submit cancellation/i }));

  await waitFor(() => {
    expect(postSignedAuthority).toHaveBeenCalledWith({
      action: "governance.cancel",
      walletPassword: "cancel-password",
      body: { proposal_id: "proposal-owned-1" },
    });
  });
});

test("a proposal someone else created offers no cancel action", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockGovernance();
  renderPage();

  expect(await screen.findByText(/adjust mining reward/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /cancel proposal/i })).not.toBeInTheDocument();
});

// Ported from the legacy "My Governance" view: a proposal this wallet already
// voted on shows the recorded vote instead of fresh vote buttons.
test("shows the wallet's recorded vote on a proposal it voted on", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  const votedProposal = {
    ...ACTIVE_PROPOSAL,
    proposal_id: "proposal-my-1",
    title: "My voted proposal",
    votes: { VLQ_ME_ADDRESS: { vote: "yes", weight: 20 } },
    yes_vote_weight: 20,
  };
  mockGovernance([votedProposal]);
  renderPage();

  expect(await screen.findByText(/my voted proposal/i)).toBeInTheDocument();
  expect(screen.getByText(/you voted yes/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /vote yes/i })).not.toBeInTheDocument();
});
