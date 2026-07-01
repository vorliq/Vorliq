import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Settings from "./Settings";
import { AuthProvider } from "../../context/AuthContext";
import { NotificationProvider } from "../../context/NotificationContext";
import api from "../../helpers/api";

jest.mock("../../helpers/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  getNodeUrl: () => "/api",
  getDefaultNodeUrl: () => "/api",
  setNodeUrl: jest.fn((url) => url || "/api"),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/chain/summary") return Promise.resolve({ data: { summary: { block_height: 8046, chain_valid: true } } });
    return Promise.resolve({ data: { success: true } });
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <NotificationProvider>
          <Settings />
        </NotificationProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

test("renders the settings page inside the app shell", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: /^settings$/i })).toBeInTheDocument();
});
