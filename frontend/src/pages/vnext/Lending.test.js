import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import Lending from "./Lending";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";
import { postSignedAuthority } from "../../helpers/signedAuthority";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));
jest.mock("../../helpers/signedAuthority", () => ({
  authorityErrorMessage: jest.fn((_error, fallback) => fallback),
  postSignedAuthority: jest.fn(),
}));

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

// Ported from the legacy Lending page suite: loan requests and votes are signed
// locally with the wallet password (never a raw POST with key material).
test("loan request and vote actions use local signed authority submission", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockLending([{ ...LOAN, status: "pending_vote", yes_vote_weight: 10, no_vote_weight: 0, votes: {} }]);
  postSignedAuthority.mockResolvedValue({ data: { success: true } });
  renderPage();

  // Vote yes on the open request, authorising with the wallet password.
  await userEvent.click(await screen.findByRole("button", { name: /vote yes/i }));
  const voteSubmit = screen.getByRole("button", { name: /sign and submit yes vote/i });
  expect(voteSubmit).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/wallet password/i), "vote-password");
  await userEvent.click(voteSubmit);

  await waitFor(() => {
    expect(postSignedAuthority).toHaveBeenCalledWith({
      action: "lending.vote",
      walletPassword: "vote-password",
      body: { loan_id: "l1", vote: "yes" },
    });
  });

  // Open a new loan request and sign it locally too.
  await userEvent.click(screen.getByRole("button", { name: /new request/i }));
  await userEvent.type(screen.getByLabelText(/amount in vlq/i), "25");
  await userEvent.type(screen.getByLabelText(/^reason$/i), "Build shared community tools");
  await userEvent.type(screen.getByLabelText(/wallet password/i), "local-password");
  await userEvent.click(screen.getByRole("button", { name: /sign and submit request/i }));

  await waitFor(() => {
    expect(postSignedAuthority).toHaveBeenCalledWith({
      action: "lending.request",
      walletPassword: "local-password",
      body: { amount: 25, reason: "Build shared community tools" },
    });
  });
  expect(api.post).not.toHaveBeenCalled();
});

// Ported from the legacy Lending page suite: the borrower repays an active loan
// through the signed authority path, not an unauthenticated lending endpoint.
test("active loan repayment is signed locally by the borrower", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_REQUESTER_ADDRESS" } });
  mockLending([{ ...LOAN, status: "active", votes: {} }]);
  postSignedAuthority.mockResolvedValue({ data: { success: true } });
  renderPage();

  expect(await screen.findByText(/new mining rig/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /issuance tx/i })).toHaveAttribute("href", "/tx/tx_issue_1");

  await userEvent.click(screen.getByRole("button", { name: /^repay/i }));
  await userEvent.type(screen.getByLabelText(/wallet password/i), "local-password");
  await userEvent.click(screen.getByRole("button", { name: /sign and submit repayment/i }));

  await waitFor(() => {
    expect(postSignedAuthority).toHaveBeenCalledWith({
      action: "lending.repay",
      walletPassword: "local-password",
      body: { loan_id: "l1" },
    });
  });
  expect(api.post).not.toHaveBeenCalledWith("/lending/repay", expect.anything());
});

// Ported from the legacy Lending page suite: missing summary figures render as
// "Unavailable" rather than fake zeroes.
test("missing summary fields are marked unavailable instead of fake zeroes", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/lending/summary") return Promise.resolve({ data: { summary: { pending_vote_count: 1 } } });
    if (path === "/lending/loans") return Promise.resolve({ data: { loans: [] } });
    return Promise.resolve({ data: {} });
  });
  renderPage();

  expect(await screen.findByText(/open for voting/i)).toBeInTheDocument();
  expect(screen.getByText("1")).toBeInTheDocument();
  // "VLQ active" and "Approval threshold" are absent from the summary payload.
  expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThanOrEqual(2);
});
