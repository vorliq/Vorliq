import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Account from "./Account";
import { NotificationProvider } from "../context/NotificationContext";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ wallet: { address: "VLQ_ME_ADDRESS" }, clearLocalWallet: jest.fn(), logout: jest.fn() }),
}));

const TX = { amount: 5, direction: "in", other: "VLQ_OTHER", block_index: 10, block: 10, block_timestamp: Math.floor(Date.now() / 1000), confirmations: 3 };
const LOAN = { loan_id: "l1", requester_address: "VLQ_ME_ADDRESS", amount: 100, status: "active", due_block: 9000, blocks_until_due: 500, repayment_amount: 110, yes_vote_weight: 50, no_vote_weight: 5, issuance_tx_id: "tx1", repayment_tx_id: null, votes: [] };
const CLAIM = { claim_id: "c1", amount: 1, reason: "starter", status: "confirmed", tx_id: "txc1" };
const ACHIEVEMENT = { achievement_id: "a1", id: "a1", title: "First Send", description: "Sent your first VLQ", badge_color: "#5c8" };
const PROPOSAL = { proposal_id: "p1", title: "Payout", status: "active", proposer_address: "VLQ_ME_ADDRESS", recipient_address: "VLQ_R", requested_amount: 10, rule_change_id: null, yes_vote_weight: 10, no_vote_weight: 1, votes: [], payout_tx_id: null };

function mockAccount() {
  api.get.mockImplementation((path) => {
    switch (path) {
      case "/wallet/balance":
        return Promise.resolve({ data: { balance: 42 } });
      case "/chain/address":
        return Promise.resolve({ data: { transactions: [TX], confirmed_incoming: [TX], confirmed_outgoing: [] } });
      case "/lending/my":
        return Promise.resolve({ data: { loans: [LOAN], funded: [] } });
      case "/exchange/my":
        return Promise.resolve({ data: { created: [], accepted: [], offers: [] } });
      case "/governance/my":
        return Promise.resolve({ data: { proposals: [PROPOSAL], votes: [], created: [] } });
      case "/treasury/my":
        return Promise.resolve({ data: { payouts: [], proposals: [] } });
      case "/faucet/claims":
        return Promise.resolve({ data: { claims: [CLAIM] } });
      case "/achievements":
        return Promise.resolve({ data: { achievements: [ACHIEVEMENT] } });
      case "/achievements/all":
        return Promise.resolve({ data: { achievements: [ACHIEVEMENT] } });
      default:
        return Promise.resolve({ data: { profile: null } });
    }
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <Account />
      </NotificationProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
});

test("renders the account dashboard for a signed-in wallet", async () => {
  mockAccount();
  renderPage();
  expect(await screen.findByRole("heading", { name: /^account$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/wallet/balance", expect.anything());
});

test("surfaces an error when the account data cannot load", async () => {
  api.get.mockRejectedValue({});
  renderPage();
  expect(await screen.findByText(/unable to load account dashboard/i)).toBeInTheDocument();
});
