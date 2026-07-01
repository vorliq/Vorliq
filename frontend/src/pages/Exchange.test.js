import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Exchange from "./Exchange";
import { useAuth } from "../context/AuthContext";
import { NotificationProvider } from "../context/NotificationContext";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));

const OFFER = {
  offer_id: "o1",
  offer_type: "buy",
  amount: 10,
  price: "5 USD",
  status: "open",
  creator_address: "VLQ_CREATOR_ADDRESS",
  description: "Buying VLQ for USD",
  timestamp: Math.floor(Date.now() / 1000),
  created_at: Math.floor(Date.now() / 1000),
};

function mockExchange(offers = [OFFER]) {
  api.get.mockImplementation((path) => {
    if (path === "/exchange/offers") return Promise.resolve({ data: { offers } });
    if (path === "/exchange/summary") return Promise.resolve({ data: { summary: { open_count: offers.length } } });
    if (path === "/exchange/my") return Promise.resolve({ data: { created: [], accepted: [], offers: [] } });
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 100 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <Exchange />
      </NotificationProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({ wallet: null });
  mockExchange();
});

test("renders the community exchange and lists open requests", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: /community exchange requests/i })).toBeInTheDocument();
  expect(await screen.findByText(/buying vlq for usd/i)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/exchange/offers", expect.anything());
});

test("renders the exchange for a signed-in member", async () => {
  useAuth.mockReturnValue({ wallet: { address: "VLQ_ME_ADDRESS" } });
  mockExchange();
  renderPage();
  expect(await screen.findByRole("heading", { name: /community exchange requests/i })).toBeInTheDocument();
});

test("surfaces an error when the exchange fails to load", async () => {
  api.get.mockRejectedValue({});
  renderPage();
  expect(await screen.findByText(/unable to load exchange lifecycle/i)).toBeInTheDocument();
});
