import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import IncidentBanner from "./components/IncidentBanner";
import { ONBOARDING_KEY } from "./components/Onboarding";
import { AuthProvider } from "./context/AuthContext";
import { AuthContext } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { ThemeProvider } from "./context/ThemeContext";
import api from "./helpers/api";
import Account from "./pages/Account";
import AddressIdentity from "./components/AddressIdentity";
import Login from "./pages/Login";
import Mine from "./pages/Mine";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import Send from "./pages/Send";
import Transparency from "./pages/Transparency";
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

  if (path === "/profiles/top") {
    return Promise.resolve({ data: { success: true, profiles: [] } });
  }

  if (path === "/profiles/profile") {
    return Promise.reject({ response: { status: 404, data: { success: false, message: "profile not found" } } });
  }

  if (path === "/network/manifest") {
    return Promise.resolve({
      data: {
        success: true,
        project: { name: "Vorliq", version: "1.0.0" },
        urls: {
          website: "https://vorliq.org",
          github: "https://github.com/vorliq/Vorliq",
        },
        deployment: { commit_hash: "abc123" },
        chain_summary: {
          available: true,
          block_height: 12,
          total_blocks: 13,
          total_transactions: 27,
          chain_valid: true,
        },
        diagnostics: {
          available: true,
          node_url: "https://vorliq.org",
          known_peers: 3,
        },
        incidents: { active: false, active_count: 0 },
        sdk: { supported_version: "1.0.0" },
        generated_at: "2026-05-16T12:00:00.000Z",
      },
    });
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

  expect(await screen.findByRole("heading", { level: 1, name: /vorliq/i })).toBeInTheDocument();
  expect(screen.getByRole("navigation")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^more/i })).toBeInTheDocument();
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

test("App exposes a keyboard skip link to the main content", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  expect(await screen.findByRole("link", { name: /skip to main content/i })).toHaveAttribute(
    "href",
    "#main-content"
  );
  expect(document.querySelector("main#main-content")).toBeInTheDocument();
});

test("onboarding dialog has ARIA semantics and progress text", async () => {
  render(<App />);

  const dialog = await screen.findByRole("dialog");

  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAttribute("aria-labelledby", "onboarding-title");
  expect(dialog).toHaveAttribute("aria-describedby", "onboarding-description");
  expect(screen.getAllByText(/step 1 of 4/i).length).toBeGreaterThan(0);
});

test("onboarding supports keyboard next, previous, and escape close", async () => {
  render(<App />);

  expect(await screen.findByRole("dialog")).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "ArrowRight" });
  expect(await screen.findByText(/create your wallet/i)).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(await within(screen.getByRole("dialog")).findByText(/welcome to vorliq/i)).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Enter" });
  expect(await screen.findByText(/create your wallet/i)).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe("true");
});

test("Dashboard shows a first-user Get Started section with core actions", async () => {
  renderWithProviders(<Dashboard />);

  expect(screen.queryByRole("img", { name: /vorliq logo/i })).not.toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /get started with vorliq/i })).toBeInTheDocument();
  const getStarted = screen.getByRole("heading", { name: /get started with vorliq/i }).closest("section");

  expect(within(getStarted).getByText(/read the safety notice/i)).toBeInTheDocument();
  expect(within(getStarted).getByRole("link", { name: /read transparency/i })).toHaveAttribute("href", "/transparency");
  expect(within(getStarted).getByRole("link", { name: /mine vlq/i })).toHaveAttribute("href", "/mine");
  expect(within(getStarted).getByRole("link", { name: /governance/i })).toHaveAttribute("href", "/governance");
});

test("mobile hamburger announces expanded state when opened", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /vorliq/i });
  const hamburger = screen.getByRole("button", { name: /open navigation menu/i });

  expect(hamburger).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(hamburger);
  expect(hamburger).toHaveAttribute("aria-expanded", "true");
  expect(hamburger).toHaveAttribute("aria-controls", "mobile-navigation");
});

test("More menu opens, exposes grouped links, and closes with Escape", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /vorliq/i });
  const moreButton = screen.getByRole("button", { name: /^more/i });

  expect(moreButton).toHaveAttribute("aria-haspopup", "menu");
  expect(moreButton).toHaveAttribute("aria-expanded", "false");

  await userEvent.click(moreButton);

  expect(moreButton).toHaveAttribute("aria-expanded", "true");
  const moreMenu = screen.getByRole("menu", { name: /more navigation/i });
  expect(moreMenu).toHaveClass("open");
  expect(within(moreMenu).getByRole("menuitem", { name: /chat/i })).toHaveAttribute("href", "/chat");
  expect(within(moreMenu).getByRole("menuitem", { name: /whitepaper/i })).toHaveAttribute("href", "/whitepaper");

  fireEvent.keyDown(document, { key: "Escape" });

  expect(moreButton).toHaveAttribute("aria-expanded", "false");
});

test("Footer renders one social link group", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /vorliq/i });
  const footer = document.querySelector("footer");

  expect(footer.querySelectorAll(".social-links")).toHaveLength(1);
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

  expect(screen.getByLabelText(/risk notice/i)).toHaveTextContent(/vlq has no guaranteed market value/i);

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

test("Footer exposes a public Risk Notice link", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /vorliq/i });
  const footer = document.querySelector("footer");

  expect(within(footer).getByRole("link", { name: /risk notice/i })).toHaveAttribute(
    "href",
    "https://vorliq.github.io/Vorliq/terms.html#risk-notice"
  );
});

test("Profile page renders a public member profile", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/profiles/profile") {
      return Promise.resolve({
        data: {
          success: true,
          profile: {
            wallet_address: "VLQ_MEMBER",
            display_name: "Mina VLQ",
            avatar_style: "cyan",
            reputation_score: 22,
            badges: ["Node Runner"],
            activity_summary: { forum_posts: 1 },
          },
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Profile />, "/profile?address=VLQ_MEMBER");

  expect(await screen.findByRole("heading", { name: /mina vlq/i })).toBeInTheDocument();
  expect(screen.getByText("22")).toBeInTheDocument();
  expect(screen.getByText(/reputation score/i)).toBeInTheDocument();
});

test("Profile form validation blocks short display names", async () => {
  api.get.mockImplementation(defaultApiGet);
  render(
    <ThemeProvider>
      <NotificationProvider>
        <AuthContext.Provider value={{ wallet: { address: "VLQ_ME" }, isLoggedIn: true }}>
          <MemoryRouter initialEntries={["/profile?address=VLQ_ME"]}>
            <Profile />
          </MemoryRouter>
        </AuthContext.Provider>
      </NotificationProvider>
    </ThemeProvider>
  );

  expect(await screen.findByRole("heading", { name: /create your public profile/i })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "ab" } });
  await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

  expect(await screen.findByText(/display name must be 3 to 32 characters/i)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalledWith("/profiles/profile", expect.anything());
});

test("AddressIdentity falls back to a shortened address when no profile exists", async () => {
  api.get.mockRejectedValueOnce({ response: { status: 404 } });

  renderWithProviders(<AddressIdentity address="VLQ_LONG_ADDRESS_123456789" />);

  expect(await screen.findByText(/VLQ_LONG_ADD/i)).toBeInTheDocument();
});

test("AddressIdentity shows profile display name when a profile exists", async () => {
  api.get.mockResolvedValueOnce({
    data: { success: true, profile: { wallet_address: "VLQ_MEMBER", display_name: "Profile Name", avatar_style: "green" } },
  });

  renderWithProviders(<AddressIdentity address="VLQ_MEMBER" />);

  expect(await screen.findByText(/profile name/i)).toBeInTheDocument();
});

test("Leaderboard includes a Top Reputation tab", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/leaderboard") {
      return Promise.resolve({ data: { success: true, holders: [], miners: [], lenders: [] } });
    }
    if (path === "/profiles/top") {
      return Promise.resolve({
        data: {
          success: true,
          profiles: [{ wallet_address: "VLQ_TOP", display_name: "Top Member", avatar_style: "blue", reputation_score: 55, badges: [] }],
        },
      });
    }
    if (path === "/profiles/profile") {
      return Promise.resolve({
        data: { success: true, profile: { wallet_address: "VLQ_TOP", display_name: "Top Member", avatar_style: "blue" } },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Leaderboard />, "/leaderboard");

  await userEvent.click(await screen.findByRole("button", { name: /top reputation/i }));

  expect(screen.getByRole("heading", { name: /top reputation/i })).toBeInTheDocument();
  expect(await screen.findByText(/top member/i)).toBeInTheDocument();
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

test("Transparency page renders experimental and self custody notices from the manifest flow", async () => {
  renderWithProviders(<Transparency />, "/transparency");

  expect(await screen.findByRole("heading", { name: /experimental software/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /self custody/i })).toBeInTheDocument();
  expect(screen.getByText(/lost keys cannot be recovered by vorliq/i)).toBeInTheDocument();
  expect(await screen.findByText(/abc123/i)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/network/manifest", { timeout: 8000 });
});
