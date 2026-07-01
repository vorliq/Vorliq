import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Lending from "./Lending";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));

const LOAN = {
  loan_id: "l1",
  requester_address: "VLQ_REQUESTER_ADDRESS",
  amount: 100,
  reason: "New mining rig",
  status: "active",
  due_block: 9000,
  repayment_amount: 110,
  yes_vote_weight: 50,
  no_vote_weight: 10,
  issuance_tx_id: "tx_issue_1",
  repayment_tx_id: null,
};

function mockLending(loans = [LOAN]) {
  api.get.mockImplementation((path) => {
    if (path === "/lending/summary") return Promise.resolve({ data: { summary: { pool_balance: 1000, active_loans: loans.length } } });
    if (path === "/lending/loans") return Promise.resolve({ data: { loans } });
    if (path === "/lending/my") return Promise.resolve({ data: { loans: [], votes: [] } });
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 300 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <Lending />
      </NotificationProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({ isLoggedIn: false, wallet: null });
  mockLending();
});

test("renders the lending page and loads the pool (signed out)", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: /^lending$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/lending/summary", expect.anything());
});

test("renders open loan requests for a signed-in member", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockLending();
  renderPage();
  expect(await screen.findByRole("heading", { name: /^lending$/i })).toBeInTheDocument();
  expect(await screen.findByText(/new mining rig/i)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/wallet/balance", expect.anything());
});
