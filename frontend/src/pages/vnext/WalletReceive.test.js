import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Wallet from "./Wallet";
import Receive from "./Receive";
import { useAuth } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";

jest.mock("../../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_ME_ADDRESS" } });
  api.get.mockImplementation((path) => {
    if (path === "/wallet/balance") return Promise.resolve({ data: { balance: 42 } });
    if (path === "/transactions/pending") return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
});

test("Wallet renders inside the app shell for a signed-in member", async () => {
  render(
    <MemoryRouter><NotificationProvider><Wallet /></NotificationProvider></MemoryRouter>
  );
  expect(await screen.findByRole("heading", { name: /^wallet$/i })).toBeInTheDocument();
});

test("Receive renders the receive-VLQ page", async () => {
  render(
    <MemoryRouter><NotificationProvider><Receive /></NotificationProvider></MemoryRouter>
  );
  expect(await screen.findByRole("heading", { name: /receive vlq/i })).toBeInTheDocument();
});
