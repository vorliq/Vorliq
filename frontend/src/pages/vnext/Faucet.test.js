import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import Faucet from "./Faucet";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));
jest.mock("../../helpers/deviceFingerprint", () => ({
  deviceFingerprint: jest.fn(() => Promise.resolve("test-device-fingerprint")),
}));

function mockFaucet(claims = []) {
  api.get.mockImplementation((path) => {
    if (path === "/faucet/summary") return Promise.resolve({ data: { summary: { starter_amount: 1, treasury_balance: 1000 } } });
    if (path === "/faucet/claims") return Promise.resolve({ data: { claims } });
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 5 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <Faucet />
      </NotificationProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({ isLoggedIn: false, wallet: null });
  mockFaucet();
});

test("shows the sign-in call to action for signed-out visitors", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: /starter vlq faucet/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /sign in to claim/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/faucet/summary", expect.anything());
});

test("shows a claim button for a signed-in member with no active claim", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockFaucet([]);
  renderPage();
  expect(await screen.findByRole("heading", { name: /starter vlq faucet/i })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /claim/i })).toBeInTheDocument();
});

// Ported from the legacy Faucet page suite: a successful claim shows the
// pending transaction with a link to the explorer record.
test("a successful claim shows the submitted transaction link", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  mockFaucet([]);
  api.post.mockResolvedValueOnce({
    data: {
      success: true,
      claim: {
        claim_id: "claim-success",
        wallet_address: "VLQ_ME_ADDRESS",
        amount: 1,
        status: "pending",
        tx_id: "faucet-tx-success",
        reason: "Starter VLQ transaction submitted from the community treasury.",
      },
    },
  });
  renderPage();

  // The button exists while the summary is still loading but stays disabled
  // until the load settles — wait for it to enable before clicking.
  const claimButton = await screen.findByRole("button", { name: /claim/i });
  await waitFor(() => expect(claimButton).toBeEnabled());
  await userEvent.click(claimButton);

  // The claim awaits the async device fingerprint before posting, so wait for
  // the visible outcome first, then assert on the POST.
  expect(await screen.findByText(/starter vlq claim submitted/i)).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith(
    "/faucet/claim",
    expect.objectContaining({ wallet_address: "VLQ_ME_ADDRESS" })
  );
  // The link text is a truncated hash (formatHash); the href carries the full id.
  const txLink = await screen.findByRole("link", { name: /faucet-tx/i });
  expect(txLink).toHaveAttribute("href", "/tx/faucet-tx-success");
});
