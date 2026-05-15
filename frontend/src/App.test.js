import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import IncidentBanner from "./components/IncidentBanner";
import { ONBOARDING_KEY } from "./components/Onboarding";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { ThemeProvider } from "./context/ThemeContext";
import api from "./helpers/api";
import Account from "./pages/Account";
import Login from "./pages/Login";
import Mine from "./pages/Mine";
import ProtectedRoute from "./components/ProtectedRoute";
import Send from "./pages/Send";
import Wallet from "./pages/Wallet";

jest.mock("./helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("./components/QRPayment", () => function MockQRPayment() {
  return <div data-testid="qr-payment" />;
});

jest.mock("react-toastify", () => ({
  ToastContainer: () => null,
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const walletResponse = {
  address: "VLQ_TEST_ADDRESS_123456",
  public_key: "TEST_PUBLIC_KEY",
  private_key: "TEST_PRIVATE_KEY",
};

function defaultApiGet(path) {
  if (path === "/health") {
    return Promise.resolve({ data: { success: true, status: "ok" } });
  }

  if (path === "/incidents/active") {
    return Promise.resolve({ data: { success: true, incidents: [] } });
  }

  if (path === "/chain") {
    return Promise.resolve({ data: { success: true, chain: [], is_valid: true } });
  }

  if (path === "/chain/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          block_height: 0,
          total_blocks: 1,
          total_transactions: 0,
          current_mining_reward: 50,
          total_issued: 0,
          chain_valid: true,
        },
      },
    });
  }

  if (path === "/chain/blocks") {
    return Promise.resolve({ data: { success: true, blocks: [], total_blocks: 0, has_more: false } });
  }

  if (path === "/chain/address") {
    return Promise.resolve({ data: { success: true, transactions: [], total: 0, has_more: false } });
  }

  if (path === "/leaderboard") {
    return Promise.resolve({ data: { success: true, holders: [], miners: [], lenders: [] } });
  }

  if (path === "/economics") {
    return Promise.resolve({
      data: {
        success: true,
        current_block_height: 0,
        current_mining_reward: 50,
        total_issued: 0,
      },
    });
  }

  if (path === "/forum/featured") {
    return Promise.resolve({ data: { success: true, posts: [] } });
  }

  return Promise.resolve({ data: { success: true } });
}

function renderWithProviders(ui, route = "/") {
  return render(
    <ThemeProvider>
      <NotificationProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AuthProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
  jest.clearAllMocks();
  api.get.mockImplementation(defaultApiGet);
  api.post.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

test("App renders without crashing inside its providers", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  expect(await screen.findByRole("heading", { name: /welcome to vorliq/i })).toBeInTheDocument();
  expect(screen.getByRole("navigation")).toBeInTheDocument();
});

test("onboarding appears for a first-time visitor and can be skipped", async () => {
  render(<App />);

  expect(await screen.findByRole("dialog")).toHaveTextContent(/welcome to vorliq/i);

  await userEvent.click(screen.getByRole("button", { name: /^skip$/i }));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe("true");
});

test("Login page shows wallet creation when no wallet is stored", () => {
  renderWithProviders(<Login />, "/login");

  expect(screen.getAllByText(/create your vorliq wallet/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /create wallet and set password/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /import wallet backup/i })).toBeInTheDocument();
});

test("wallet safety confirmation blocks wallet creation until checked", async () => {
  api.post.mockResolvedValueOnce({ data: walletResponse });
  renderWithProviders(<Wallet />, "/wallet");

  const createButton = screen.getByRole("button", { name: /create new wallet/i });
  expect(createButton).toBeDisabled();

  await userEvent.click(createButton);
  expect(api.post).not.toHaveBeenCalled();

  await userEvent.click(screen.getByLabelText(/private key cannot be recovered by vorliq/i));
  expect(createButton).toBeEnabled();

  await userEvent.click(createButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith("/wallet/create");
  });
});

test("wallet backup import rejects invalid JSON", async () => {
  renderWithProviders(<Login />, "/login");

  fireEvent.change(screen.getByLabelText(/wallet backup json/i), {
    target: {
      files: [
        {
          name: "vorliq-wallet-backup.json",
          text: jest.fn().mockResolvedValue("{not-json"),
        },
      ],
    },
  });

  fireEvent.change(screen.getByLabelText(/backup password/i), {
    target: { value: "correct horse battery staple" },
  });
  await userEvent.click(screen.getByRole("button", { name: /^import wallet backup$/i }));

  expect(await screen.findByText(/wallet backup is invalid or the password is incorrect/i)).toBeInTheDocument();
});

test("wallet backup import rejects invalid wallet backup structure", async () => {
  renderWithProviders(<Login />, "/login");

  fireEvent.change(screen.getByLabelText(/wallet backup json/i), {
    target: {
      files: [
        {
          name: "vorliq-wallet-backup.json",
          text: jest.fn().mockResolvedValue(JSON.stringify({ address: "VLQ_ONLY_ADDRESS" })),
        },
      ],
    },
  });

  fireEvent.change(screen.getByLabelText(/backup password/i), {
    target: { value: "correct horse battery staple" },
  });
  await userEvent.click(screen.getByRole("button", { name: /^import wallet backup$/i }));

  expect(await screen.findByText(/wallet backup is invalid or the password is incorrect/i)).toBeInTheDocument();
});

test("Account protected route redirects to login behavior when no wallet is loaded", async () => {
  renderWithProviders(
    <Routes>
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <Account />
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<Login />} />
    </Routes>,
    "/account"
  );

  expect(await screen.findByRole("heading", { name: /import wallet backup/i })).toBeInTheDocument();
  expect(screen.getAllByText(/create your vorliq wallet/i).length).toBeGreaterThan(0);
});

test("Send page logged-out manual mode shows the private-key safety warning", () => {
  renderWithProviders(<Send />, "/send");

  expect(screen.getByText(/pasting private keys into any website is risky/i)).toBeInTheDocument();
});

test("Mine page displays a cooldown message when the API returns a mining cooldown error", async () => {
  api.post.mockRejectedValueOnce({
    response: {
      status: 429,
      data: {
        message: "Mining cooldown active.",
        wait_seconds: 12,
      },
    },
  });

  render(
    <NotificationProvider>
      <Mine />
    </NotificationProvider>
  );

  fireEvent.change(screen.getByLabelText(/miner address/i), {
    target: { value: "VLQ_MINER_ADDRESS_123456" },
  });
  await userEvent.click(screen.getByRole("button", { name: /mine block/i }));

  expect(await screen.findByText(/cooling down\. ready to mine in 12 seconds/i)).toBeInTheDocument();
});

test("IncidentBanner does not render when no active incidents are returned", async () => {
  api.get.mockResolvedValueOnce({ data: { success: true, incidents: [] } });

  render(<IncidentBanner />);

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith("/incidents/active", { timeout: 5000 });
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("IncidentBanner renders a warning when an active major incident is returned", async () => {
  api.get.mockResolvedValueOnce({
    data: {
      success: true,
      incidents: [
        {
          id: "incident-1",
          title: "Public node degraded",
          severity: "major",
          status: "investigating",
        },
      ],
    },
  });

  render(<IncidentBanner />);

  expect(await screen.findByText(/public node degraded/i)).toBeInTheDocument();
  expect(screen.getByText(/major incident: investigating/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view status/i })).toHaveAttribute("href", "https://status.vorliq.org");
});
