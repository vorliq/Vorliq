import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Faucet from "./Faucet";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));

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
