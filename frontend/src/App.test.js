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
import Lending from "./pages/Lending";
import Exchange from "./pages/Exchange";
import Governance from "./pages/Governance";
import Treasury from "./pages/Treasury";
import Faucet from "./pages/Faucet";
import Mine from "./pages/Mine";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import Send from "./pages/Send";
import Transparency from "./pages/Transparency";
import Wallet from "./pages/Wallet";
import Admin from "./pages/Admin";
import TransactionDetail from "./pages/TransactionDetail";
import BlockDetail from "./pages/BlockDetail";
import Blockchain from "./pages/Blockchain";
import Registry from "./pages/Registry";
import Health from "./pages/Health";

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

  if (path === "/reports/weekly") {
    return Promise.resolve({ data: { success: true, stats: { block_height: 12, generated_at: "now" } } });
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

  if (path.startsWith("/chain/block/")) {
    return Promise.resolve({
      data: {
        success: true,
        block: {
          index: 0,
          hash: "genesis-hash",
          previous_hash: "0",
          timestamp: 1715791000,
          nonce: 0,
          transaction_count: 0,
          transactions: [],
          confirmations: 1,
        },
      },
    });
  }

  if (path === "/chain/address") {
    return Promise.resolve({
      data: {
        success: true,
        transactions: [],
        total: 0,
        has_more: false,
        pending_incoming_total: 0,
        pending_outgoing_total: 0,
      },
    });
  }

  if (path === "/transactions/pending") {
    return Promise.resolve({ data: { success: true, transactions: [], total: 0, has_more: false } });
  }

  if (path === "/transactions") {
    return Promise.resolve({ data: { success: true, transactions: [], total: 0, has_more: false } });
  }

  if (path.startsWith("/transactions/")) {
    return Promise.resolve({
      data: {
        success: true,
        transaction: {
          tx_id: "tx-test-123",
          status: "confirmed",
          sender_address: "VLQ_SENDER",
          receiver_address: "VLQ_RECEIVER",
          amount: 4,
          type: "transfer",
          timestamp: 1715791000,
          block_index: 1,
          block_hash: "0000abc",
          confirmations: 2,
          signature_present: true,
          public_key_present: true,
          metadata: {},
        },
      },
    });
  }

  if (path === "/leaderboard") {
    return Promise.resolve({ data: { success: true, holders: [], miners: [], lenders: [] } });
  }

  if (path === "/lending/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          total_loans: 1,
          pending_vote_count: 1,
          approved_pending_issue_count: 0,
          active_count: 0,
          repayment_pending_count: 0,
          repaid_count: 0,
          overdue_count: 0,
          rejected_count: 0,
          total_vlq_active: 0,
          total_vlq_repaid: 0,
        },
      },
    });
  }

  if (path === "/lending/loans") {
    return Promise.resolve({
      data: {
        success: true,
        loans: [
          {
            loan_id: "loan-test-1",
            requester_address: "VLQ_BORROWER",
            amount: 100,
            repayment_amount: 110,
            reason: "Build a community tool",
            status: "pending_vote",
            created_at: 1715791000,
            timestamp: 1715791000,
            due_block: 1000,
            blocks_until_due: 1000,
            yes_vote_weight: 10,
            no_vote_weight: 0,
            votes: {},
            status_history: [{ status: "pending_vote", message: "Opened for voting." }],
          },
        ],
        total: 1,
      },
    });
  }

  if (path === "/lending/my") {
    return Promise.resolve({ data: { success: true, borrowed: [], voted: [], loans: [] } });
  }

  if (path === "/exchange/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          open_count: 1,
          active_trades_count: 1,
          completed_count: 0,
          disputed_count: 0,
        },
      },
    });
  }

  if (path === "/exchange/offers") {
    return Promise.resolve({
      data: {
        success: true,
        offers: [
          {
            offer_id: "offer-test-1",
            creator_address: "VLQ_SELLER",
            acceptor_address: null,
            offer_type: "sell",
            amount: 12,
            price: "local goods",
            description: "Community market trade",
            status: "open",
            created_at: 1715791000,
            timestamp: 1715791000,
            offchain_confirmation_creator: false,
            offchain_confirmation_acceptor: false,
            status_history: [{ status: "open", message: "Offer posted." }],
          },
          {
            offer_id: "offer-active-1",
            creator_address: "VLQ_CREATOR",
            acceptor_address: "VLQ_ACCEPTOR",
            offer_type: "sell",
            amount: 7,
            price: "services",
            description: "Active exchange trade",
            status: "accepted",
            created_at: 1715791000,
            accepted_at: 1715792000,
            offchain_confirmation_creator: false,
            offchain_confirmation_acceptor: false,
          },
        ],
        total: 2,
      },
    });
  }

  if (path === "/exchange/my") {
    return Promise.resolve({ data: { success: true, created: [], accepted: [], offers: [] } });
  }

  if (path === "/governance/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          active_count: 1,
          passed_pending_execution_count: 0,
          executed_count: 1,
          rejected_count: 0,
          expired_count: 0,
          total_proposals: 2,
          total_votes: 1,
          latest_executed_rule_change: { category: "mining_reward" },
          current_governable_settings: {},
        },
      },
    });
  }

  if (path === "/governance/proposals") {
    return Promise.resolve({
      data: {
        success: true,
        proposals: [
          {
            proposal_id: "proposal-active-1",
            proposer_address: "VLQ_GOVERNOR",
            title: "Adjust mining reward",
            description: "A serious proposal to adjust the reward within the allowed range.",
            category: "mining_reward",
            parameter: 25,
            current_value: 50,
            status: "active",
            created_at: 1715791000,
            voting_deadline: 2715791000,
            votes: {},
            yes_vote_weight: 100,
            no_vote_weight: 0,
            quorum: 500,
            approval_threshold: 0.6,
            status_history: [{ status: "active", timestamp: 1715791000, note: "Proposal opened." }],
          },
        ],
        total: 1,
      },
    });
  }

  if (path === "/governance/all") {
    return Promise.resolve({
      data: {
        success: true,
        proposals: [
          {
            proposal_id: "proposal-active-1",
            proposer_address: "VLQ_GOVERNOR",
            title: "Adjust mining reward",
            description: "A serious proposal to adjust the reward within the allowed range.",
            category: "mining_reward",
            parameter: 25,
            current_value: 50,
            status: "active",
            created_at: 1715791000,
            voting_deadline: 2715791000,
            votes: {},
            yes_vote_weight: 100,
            no_vote_weight: 0,
            quorum: 500,
            approval_threshold: 0.6,
            status_history: [{ status: "active", timestamp: 1715791000, note: "Proposal opened." }],
          },
          {
            proposal_id: "proposal-rule-1",
            proposer_address: "VLQ_GOVERNOR",
            title: "Executed reward change",
            description: "A completed proposal that changed a supported setting.",
            category: "mining_reward",
            parameter: 25,
            current_value: 50,
            status: "executed",
            created_at: 1715790000,
            voting_deadline: 2715791000,
            votes: { VLQ_VOTER: { vote: "yes", weight: 600 } },
            yes_vote_weight: 600,
            no_vote_weight: 0,
            quorum: 500,
            approval_threshold: 0.6,
            rule_change_id: "rule-1",
            execution_result: { message: "mining_reward changed from 50 to 25." },
            status_history: [{ status: "executed", timestamp: 1715791000, note: "Proposal executed." }],
          },
        ],
        total: 2,
      },
    });
  }

  if (path === "/governance/settings") {
    return Promise.resolve({
      data: {
        success: true,
        settings: {
          mining_reward: { default: 50, current: 25, changed: true },
          difficulty: { default: 4, current: 4, changed: false },
        },
      },
    });
  }

  if (path === "/governance/rule-changes") {
    return Promise.resolve({
      data: {
        success: true,
        rule_changes: [
          {
            rule_change_id: "rule-1",
            proposal_id: "proposal-rule-1",
            category: "mining_reward",
            old_value: 50,
            new_value: 25,
            applied_at: 1715791000,
            applied_block_height: 3,
            status: "executed",
          },
        ],
      },
    });
  }

  if (path === "/governance/my") {
    return Promise.resolve({ data: { success: true, created: [], voted: [], proposals: [] } });
  }

  if (path === "/treasury/balance") {
    return Promise.resolve({
      data: {
        success: true,
        address: "VORLIQ_TREASURY",
        balance: 250,
        treasury_percentage: 0.05,
      },
    });
  }

  if (path === "/treasury/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          current_balance: 250,
          total_received: 300,
          total_paid: 50,
          pending_payouts: 25,
          pending_payout_count: 1,
          paid_proposal_count: 1,
          active_proposal_count: 1,
          rejected_proposal_count: 0,
          expired_proposal_count: 0,
          latest_ledger_entries: [],
        },
      },
    });
  }

  if (path === "/treasury/proposals") {
    return Promise.resolve({
      data: {
        success: true,
        proposals: [
          {
            proposal_id: "treasury-active-1",
            proposer_address: "VLQ_TREASURER",
            title: "Fund security review",
            description: "A public request to fund a security review for the Vorliq network.",
            category: "security",
            requested_amount: 25,
            recipient_address: "VLQ_RECIPIENT",
            status: "active",
            created_at: 1715791000,
            voting_deadline: 2715791000,
            votes: {},
            yes_vote_weight: 50,
            no_vote_weight: 0,
            quorum: 200,
            approval_threshold: 0.6,
            status_history: [{ status: "active", timestamp: 1715791000, note: "Treasury proposal opened." }],
          },
        ],
        total: 1,
      },
    });
  }

  if (path === "/treasury/all") {
    return Promise.resolve({
      data: {
        success: true,
        proposals: [
          {
            proposal_id: "treasury-active-1",
            proposer_address: "VLQ_TREASURER",
            title: "Fund security review",
            description: "A public request to fund a security review for the Vorliq network.",
            category: "security",
            requested_amount: 25,
            recipient_address: "VLQ_RECIPIENT",
            status: "active",
            created_at: 1715791000,
            voting_deadline: 2715791000,
            votes: {},
            yes_vote_weight: 50,
            no_vote_weight: 0,
            quorum: 200,
            approval_threshold: 0.6,
            status_history: [{ status: "active", timestamp: 1715791000, note: "Treasury proposal opened." }],
          },
          {
            proposal_id: "treasury-paid-1",
            proposer_address: "VLQ_TREASURER",
            title: "Paid docs work",
            description: "A completed treasury payout for documentation.",
            category: "education",
            requested_amount: 50,
            recipient_address: "VLQ_RECIPIENT",
            status: "paid",
            payout_tx_id: "treasury-tx-1",
            payout_block_index: 3,
            created_at: 1715790000,
            voting_deadline: 2715791000,
            votes: { VLQ_VOTER: { vote: "yes", weight: 250 } },
            yes_vote_weight: 250,
            no_vote_weight: 0,
            quorum: 200,
            approval_threshold: 0.6,
            status_history: [{ status: "paid", timestamp: 1715791000, note: "Payout confirmed." }],
          },
        ],
        total: 2,
      },
    });
  }

  if (path === "/treasury/my") {
    return Promise.resolve({ data: { success: true, created: [], voted: [], received: [], proposals: [] } });
  }

  if (path === "/treasury/ledger") {
    return Promise.resolve({
      data: {
        success: true,
        entries: [
          {
            ledger_id: "ledger-1",
            type: "reward_in",
            amount: 2.5,
            from_address: "SYSTEM",
            to_address: "VORLIQ_TREASURY",
            tx_id: "reward-tx-1",
            block_index: 2,
            block_hash: "block-hash",
            timestamp: 1715791000,
            description: "Treasury mining reward",
          },
          {
            ledger_id: "ledger-2",
            type: "payout_paid",
            amount: 50,
            from_address: "VORLIQ_TREASURY",
            to_address: "VLQ_RECIPIENT",
            tx_id: "treasury-tx-1",
            block_index: 3,
            block_hash: "block-hash-3",
            timestamp: 1715792000,
            proposal_id: "treasury-paid-1",
            description: "Treasury payout for Paid docs work",
          },
        ],
        total: 2,
      },
    });
  }

  if (path === "/faucet/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          enabled: true,
          starter_amount: 1,
          treasury_balance: 250,
          claims_24h: 1,
          pending_claims: 1,
          confirmed_claims: 2,
        },
      },
    });
  }

  if (path === "/faucet/claims") {
    return Promise.resolve({
      data: {
        success: true,
        claims: [
          {
            claim_id: "claim-1",
            wallet_address: "VLQ_TEST_ADDRESS_123456",
            amount: 1,
            status: "pending",
            tx_id: "faucet-tx-1",
            requested_at: 1715791000,
          },
        ],
      },
    });
  }

  if (path === "/faucet/recent") {
    return Promise.resolve({
      data: {
        success: true,
        claims: [
          {
            claim_id: "claim-1",
            wallet_address: "VLQ_TEST_ADDRESS_123456",
            amount: 1,
            status: "pending",
            tx_id: "faucet-tx-1",
            requested_at: 1715791000,
          },
        ],
      },
    });
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

  if (path === "/registry/nodes") {
    return Promise.resolve({
      data: {
        success: true,
        nodes: [
          {
            node_url: "https://node.example.org",
            display_name: "Example Node",
            description: "A public Vorliq node",
            region: "Europe",
            country: "United Kingdom",
            operator_wallet_address: "VLQ_OPERATOR",
            software_version: "vorliq-node",
            last_seen: Math.floor(Date.now() / 1000),
            last_heartbeat_at: Math.floor(Date.now() / 1000),
            last_chain_height: 12,
            last_block_hash: "0000nodehash",
            last_diagnostics_status: "valid",
            uptime_score: 100,
            reliability_score: 98,
            sync_status: "synced",
            active: true,
            status_history: [
              {
                timestamp: Math.floor(Date.now() / 1000),
                status: "synced",
                chain_height: 12,
                last_block_hash: "0000nodehash",
                response_time_ms: 42,
                message: "Node heartbeat is valid and close to the public chain height.",
              },
            ],
          },
        ],
      },
    });
  }

  if (path === "/registry/all") {
    return Promise.resolve({
      data: {
        success: true,
        nodes: [
          {
            node_url: "https://node.example.org",
            display_name: "Example Node",
            region: "Europe",
            country: "United Kingdom",
            last_chain_height: 12,
            uptime_score: 100,
            reliability_score: 98,
            sync_status: "synced",
            active: true,
            status_history: [],
          },
        ],
      },
    });
  }

  if (path === "/registry/summary") {
    return Promise.resolve({
      data: {
        success: true,
        summary: {
          active_node_count: 1,
          total_registered_node_count: 1,
          synced_node_count: 1,
          behind_node_count: 0,
          invalid_node_count: 0,
          unknown_node_count: 0,
          average_reliability_score: 98,
          highest_chain_height: 12,
          latest_block_hash: "0000nodehash",
        },
      },
    });
  }

  if (path === "/registry/node") {
    return Promise.resolve({
      data: {
        success: true,
        node: {
          node_url: "https://node.example.org",
          display_name: "Example Node",
          region: "Europe",
          country: "United Kingdom",
          operator_wallet_address: "VLQ_OPERATOR",
          last_chain_height: 12,
          last_block_hash: "0000nodehash",
          last_diagnostics_status: "valid",
          uptime_score: 100,
          reliability_score: 98,
          sync_status: "synced",
          active: true,
          status_history: [
            {
              timestamp: Math.floor(Date.now() / 1000),
              status: "synced",
              chain_height: 12,
              response_time_ms: 42,
              message: "Node heartbeat is valid.",
            },
          ],
        },
      },
    });
  }

  if (path === "/mining/status") {
    return Promise.resolve({
      data: {
        success: true,
        status: {
          enabled: true,
          current_block_height: 12,
          chain_valid: true,
          current_difficulty: 3,
          current_mining_reward: 50,
          treasury_percentage: 0.05,
          miner_reward_after_treasury: 47.5,
          treasury_reward_per_block: 2.5,
          block_time_target: 60,
          block_time_minimum: 30,
          seconds_since_last_block: 45,
          seconds_until_next_allowed_block: 0,
          last_block_timestamp: 1715791000,
          last_block_hash: "0000latestblock",
          last_miner_address: "VLQ_MINER",
          can_mine_now: true,
          reason_if_not: null,
          pending_transaction_count: 2,
          pending_user_transaction_count: 1,
        },
      },
    });
  }

  if (path === "/storage/health") {
    return Promise.resolve({
      data: {
        success: true,
        overall_status: "ok",
        critical_files_ok: 15,
        warnings_count: 0,
        errors_count: 0,
        backup_available: true,
        files: [{ file_name: "chain.json", status: "ok", valid_json: true, has_backup: true }],
      },
    });
  }

  if (path === "/mining/history") {
    return Promise.resolve({
      data: {
        success: true,
        history: [
          {
            block_index: 12,
            block_hash: "0000latestblock",
            miner_address: "VLQ_MINER",
            transaction_count: 2,
            difficulty: 3,
            miner_reward_amount: 47.5,
            treasury_reward_amount: 2.5,
            seconds_since_previous_block: 61,
          },
        ],
        total: 1,
      },
    });
  }

  if (path === "/audit/manifest") {
    return Promise.resolve({
      data: {
        success: true,
        audit_schema_version: 1,
        deployment_commit: "abc123def456",
        chain_height: 12,
        latest_block_hash: "0000latest",
        storage_health_status: "ok",
        active_node_count: 1,
        active_incident_count: 0,
        export_timestamp: "2026-05-20T10:00:00.000Z",
        exports: [
          { name: "chain", endpoint: "/api/audit/chain", sha256: "hash1" },
          { name: "treasury", endpoint: "/api/audit/treasury", sha256: "hash2" },
        ],
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

test("Theme toggle switches between readable dark and light theme states", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /vorliq/i });
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");

  await userEvent.click(screen.getAllByRole("button", { name: /switch to light theme/i })[0]);

  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(window.localStorage.getItem("vorliq_theme")).toBe("light");

  await userEvent.click(screen.getAllByRole("button", { name: /switch to dark theme/i })[0]);

  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
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
  expect(within(getStarted).getByRole("link", { name: /get starter vlq/i })).toHaveAttribute("href", "/faucet");
  expect(within(getStarted).getByRole("link", { name: /mine vlq/i })).toHaveAttribute("href", "/mine");
  expect(within(getStarted).getByRole("link", { name: /governance/i })).toHaveAttribute("href", "/governance");
  expect(await screen.findByText(/block production/i)).toBeInTheDocument();
  expect(screen.getByText(/treasury per block/i)).toBeInTheDocument();
});

test("Dashboard shows branded official social icon links", async () => {
  const { container } = renderWithProviders(<Dashboard />);

  expect(await screen.findByRole("heading", { name: /join the conversation/i })).toBeInTheDocument();
  const socialLinks = container.querySelector(".dashboard-social-links");

  expect(socialLinks.querySelectorAll(".social-brand-link")).toHaveLength(5);
  expect(socialLinks.querySelector(".discord")).toHaveAttribute("href", "https://discord.gg/qpX5sHD4pC");
  expect(socialLinks.querySelector(".telegram")).toHaveAttribute("href", "https://t.me/Vorliq");
  expect(socialLinks.querySelector(".reddit")).toHaveAttribute("href", "https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS");
  expect(socialLinks.querySelector(".github")).toHaveAttribute("href", "https://github.com/vorliq/Vorliq");
  expect(socialLinks.querySelector(".x")).toHaveAttribute("href", "https://x.com/vorliq");
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

test("mobile drawer traps focus and closes from outside click", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /vorliq/i });
  const hamburger = screen.getByRole("button", { name: /open navigation menu/i });
  await userEvent.click(hamburger);

  const drawer = screen.getByRole("dialog", { name: /navigation menu/i });
  expect(drawer).toHaveAttribute("aria-modal", "true");
  expect(drawer.closest("nav")).toBeNull();
  await waitFor(() => {
    expect(within(drawer).getByRole("link", { name: /dashboard/i })).toHaveFocus();
  });

  const focusTargets = drawer.querySelectorAll("a, button");
  focusTargets[focusTargets.length - 1].focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(focusTargets[0]).toHaveFocus();

  focusTargets[0].focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(focusTargets[focusTargets.length - 1]).toHaveFocus();

  fireEvent.click(document.querySelector(".mobile-drawer-backdrop"));
  expect(hamburger).toHaveAttribute("aria-expanded", "false");
  expect(document.body).not.toHaveClass("mobile-nav-open");
});

test("More menu opens, exposes grouped links, and closes accessibly", async () => {
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

  await userEvent.click(moreButton);
  expect(moreButton).toHaveAttribute("aria-expanded", "true");
  fireEvent.pointerDown(document.body);
  expect(moreButton).toHaveAttribute("aria-expanded", "false");

  await userEvent.click(moreButton);
  await userEvent.click(within(moreMenu).getByRole("menuitem", { name: /chat/i }));
  expect(moreButton).toHaveAttribute("aria-expanded", "false");
});

test("notification bell opens the notifications page", async () => {
  window.localStorage.setItem(ONBOARDING_KEY, "true");

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /vorliq/i });
  await userEvent.click(screen.getAllByRole("button", { name: /open notifications page/i })[0]);

  expect(await screen.findByRole("heading", { level: 1, name: /^notifications$/i })).toBeInTheDocument();
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

test("Lending page renders lifecycle tabs and active vote cards", async () => {
  renderWithProviders(<Lending />, "/lending");

  expect(await screen.findByRole("button", { name: /active votes/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /active loans/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my loans/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /active votes/i }));

  expect(await screen.findByText(/build a community tool/i)).toBeInTheDocument();
  expect(screen.getAllByText(/pending vote/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /vote yes/i })).toBeInTheDocument();
});

test("Lending My Loans can use an entered wallet address", async () => {
  renderWithProviders(<Lending />, "/lending");

  await userEvent.click(await screen.findByRole("button", { name: /my loans/i }));
  fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { value: "VLQ_ME" } });
  await userEvent.click(screen.getByRole("button", { name: /^load$/i }));

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith("/lending/my", { params: { address: "VLQ_ME" } });
  });
  expect(await screen.findByText(/no borrowed or voted loans/i)).toBeInTheDocument();
});

test("Account loan section handles active lifecycle statuses", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/lending/my") {
      return Promise.resolve({
        data: {
          success: true,
          borrowed: [
            {
              loan_id: "loan-active-1",
              requester_address: "VLQ_ME",
              amount: 25,
              repayment_amount: 27.5,
              status: "active",
              due_block: 1005,
              blocks_until_due: 995,
              issuance_tx_id: "issue-tx",
              votes: {},
            },
          ],
          voted: [],
          loans: [
            {
              loan_id: "loan-active-1",
              requester_address: "VLQ_ME",
              amount: 25,
              repayment_amount: 27.5,
              status: "active",
              due_block: 1005,
              blocks_until_due: 995,
              issuance_tx_id: "issue-tx",
              votes: {},
            },
          ],
        },
      });
    }
    if (path === "/profiles/profile") {
      return Promise.reject({ response: { status: 404 } });
    }
    return defaultApiGet(path);
  });

  render(
    <ThemeProvider>
      <NotificationProvider>
        <AuthContext.Provider value={{ wallet: { address: "VLQ_ME" }, isLoggedIn: true }}>
          <MemoryRouter initialEntries={["/account"]}>
            <Account />
          </MemoryRouter>
        </AuthContext.Provider>
      </NotificationProvider>
    </ThemeProvider>
  );

  expect(await screen.findByRole("heading", { name: /my active loans/i })).toBeInTheDocument();
  expect(await screen.findByText(/loan-active-/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /issuance tx/i })).toHaveAttribute("href", "/tx/issue-tx");
  expect(screen.getByRole("button", { name: /^repay$/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /faucet claims/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open faucet/i })).toHaveAttribute("href", "/faucet?address=VLQ_ME");
});

test("Exchange lifecycle tabs render open offer cards and risk notice", async () => {
  renderWithProviders(<Exchange />, "/exchange");

  expect(await screen.findByRole("button", { name: /browse offers/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /post offer/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my trades/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /active trades/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/risk notice/i)).toHaveTextContent(/exchange offers/i);
  expect(await screen.findByText(/community market trade/i)).toBeInTheDocument();
  expect(screen.getAllByText(/open/i).length).toBeGreaterThan(0);
});

test("Exchange My Trades state renders record tx form for active trade", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/exchange/summary") return defaultApiGet(path);
    if (path === "/exchange/offers") return defaultApiGet(path);
    if (path === "/exchange/my") {
      return Promise.resolve({
        data: {
          success: true,
          created: [
            {
              offer_id: "offer-active-1",
              creator_address: "VLQ_CREATOR",
              acceptor_address: "VLQ_ACCEPTOR",
              offer_type: "sell",
              amount: 7,
              price: "services",
              description: "Active exchange trade",
              status: "accepted",
              created_at: 1715791000,
              accepted_at: 1715792000,
              offchain_confirmation_creator: false,
              offchain_confirmation_acceptor: false,
            },
          ],
          accepted: [],
          offers: [
            {
              offer_id: "offer-active-1",
              creator_address: "VLQ_CREATOR",
              acceptor_address: "VLQ_ACCEPTOR",
              offer_type: "sell",
              amount: 7,
              price: "services",
              description: "Active exchange trade",
              status: "accepted",
              created_at: 1715791000,
              accepted_at: 1715792000,
              offchain_confirmation_creator: false,
              offchain_confirmation_acceptor: false,
            },
          ],
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Exchange />, "/exchange");

  await userEvent.click(await screen.findByRole("button", { name: /my trades/i }));
  fireEvent.change(screen.getByLabelText(/wallet address for my trades search/i), { target: { value: "VLQ_CREATOR" } });
  await userEvent.click(screen.getByRole("button", { name: /^load$/i }));

  expect(await screen.findByText(/active exchange trade/i)).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /record vlq transaction/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/vlq transaction id/i)).toBeInTheDocument();
});

test("Governance lifecycle tabs render active proposal cards", async () => {
  renderWithProviders(<Governance />, "/governance");

  expect(await screen.findByRole("button", { name: /active proposals/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /propose change/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my governance/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /rule changes/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /all history/i })).toBeInTheDocument();
  expect(await screen.findByText(/adjust mining reward/i)).toBeInTheDocument();
  expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0);
});

test("Governance rule changes timeline renders", async () => {
  renderWithProviders(<Governance />, "/governance");

  await userEvent.click(await screen.findByRole("button", { name: /rule changes/i }));

  expect(await screen.findByRole("heading", { name: /executed settings timeline/i })).toBeInTheDocument();
  expect(await screen.findByText(/50 to 25/i)).toBeInTheDocument();
  expect(screen.getByText(/proposal-rule-1/i)).toBeInTheDocument();
});

test("Governance propose form shows validation guidance", async () => {
  renderWithProviders(<Governance />, "/governance");

  await userEvent.click(await screen.findByRole("button", { name: /propose change/i }));

  expect(await screen.findByText(/mining reward must be greater than 0/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "general" } });
  expect(await screen.findByText(/general proposals are advisory/i)).toBeInTheDocument();
});

test("Governance My Governance state renders", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/governance/my") {
      return Promise.resolve({
        data: {
          success: true,
          created: [],
          voted: [
            {
              proposal_id: "proposal-my-1",
              proposer_address: "VLQ_OTHER",
              title: "My voted proposal",
              description: "A proposal this wallet voted on.",
              category: "general",
              parameter: "Advisory",
              current_value: "advisory",
              status: "executed",
              created_at: 1715791000,
              voting_deadline: 2715791000,
              votes: { VLQ_ME: { vote: "yes", weight: 20 } },
              yes_vote_weight: 20,
              no_vote_weight: 0,
              quorum: 500,
              status_history: [{ status: "executed", timestamp: 1715791000, note: "Recorded." }],
            },
          ],
          proposals: [
            {
              proposal_id: "proposal-my-1",
              proposer_address: "VLQ_OTHER",
              title: "My voted proposal",
              description: "A proposal this wallet voted on.",
              category: "general",
              parameter: "Advisory",
              current_value: "advisory",
              status: "executed",
              created_at: 1715791000,
              voting_deadline: 2715791000,
              votes: { VLQ_ME: { vote: "yes", weight: 20 } },
              yes_vote_weight: 20,
              no_vote_weight: 0,
              quorum: 500,
              status_history: [{ status: "executed", timestamp: 1715791000, note: "Recorded." }],
            },
          ],
        },
      });
    }
    return defaultApiGet(path);
  });

  render(
    <ThemeProvider>
      <NotificationProvider>
        <AuthContext.Provider value={{ wallet: { address: "VLQ_ME" }, isLoggedIn: true }}>
          <MemoryRouter initialEntries={["/governance"]}>
            <Governance />
          </MemoryRouter>
        </AuthContext.Provider>
      </NotificationProvider>
    </ThemeProvider>
  );

  await userEvent.click(await screen.findByRole("button", { name: /my governance/i }));

  expect(await screen.findByText(/my voted proposal/i)).toBeInTheDocument();
  expect(screen.getAllByText(/executed/i).length).toBeGreaterThan(0);
});

test("Treasury tabs render overview and active proposal card", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  expect(await screen.findByRole("button", { name: /overview/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /active proposals/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /submit proposal/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my treasury/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /treasury ledger/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /history/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /active proposals/i }));

  expect(await screen.findByText(/fund security review/i)).toBeInTheDocument();
  expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0);
});

test("Treasury overview summary renders", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  expect(await screen.findByText(/treasury balance/i)).toBeInTheDocument();
  expect(await screen.findByText(/250 VLQ/i)).toBeInTheDocument();
  expect(screen.getByText(/total received/i)).toBeInTheDocument();
});

test("Treasury ledger tab renders public entries", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  await userEvent.click(await screen.findByRole("button", { name: /treasury ledger/i }));

  expect(await screen.findByRole("heading", { name: /treasury inflows and payouts/i })).toBeInTheDocument();
  expect(await screen.findByText(/treasury mining reward/i)).toBeInTheDocument();
  expect(screen.getByText(/payout paid/i)).toBeInTheDocument();
});

test("Treasury proposal form shows treasury balance max and risk notice", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  expect(await screen.findByLabelText(/risk notice/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /submit proposal/i }));

  expect(await screen.findByText(/maximum request right now/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/maximum 250 vlq/i)).toBeInTheDocument();
});

test("Faucet page renders and success state shows tx link", async () => {
  api.post.mockResolvedValueOnce({
    data: {
      success: true,
      claim: {
        claim_id: "claim-success",
        wallet_address: "VLQ_TEST_ADDRESS_123456",
        amount: 1,
        status: "pending",
        tx_id: "faucet-tx-success",
        reason: "Starter VLQ transaction submitted from the community treasury.",
      },
    },
  });

  renderWithProviders(<Faucet />, "/faucet");

  expect(await screen.findByRole("heading", { name: /starter vlq faucet/i })).toBeInTheDocument();
  expect(await screen.findByText(/250 VLQ/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { value: "VLQ_TEST_ADDRESS_123456" } });
  await userEvent.click(screen.getByRole("button", { name: /claim starter vlq/i }));

  expect(await screen.findByText(/faucet-tx-success/i)).toBeInTheDocument();
  expect(screen.getByText(/faucet-tx-success/i).closest("a")).toHaveAttribute("href", "/tx/faucet-tx-success");
});

test("Faucet claim form validates wallet address", async () => {
  renderWithProviders(<Faucet />, "/faucet");

  await screen.findByRole("heading", { name: /starter vlq faucet/i });
  fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: /claim starter vlq/i }));

  expect(api.post).not.toHaveBeenCalledWith("/faucet/claim", expect.anything());
});

test("Wallet page contains faucet callout after wallet creation", async () => {
  api.post.mockResolvedValueOnce({ data: walletResponse });

  renderWithProviders(<Wallet />, "/wallet");

  await userEvent.click(screen.getByLabelText(/private key cannot be recovered/i));
  await userEvent.click(screen.getByRole("button", { name: /create new wallet/i }));

  expect(await screen.findByText(/need starter vlq/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open faucet/i })).toHaveAttribute(
    "href",
    `/faucet?address=${walletResponse.address}`
  );
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

  expect(screen.getByText(/pasted private keys are never saved/i)).toBeInTheDocument();
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
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    </NotificationProvider>
  );

  fireEvent.change(screen.getByLabelText(/miner address/i), {
    target: { value: "VLQ_MINER_ADDRESS_123456" },
  });
  await userEvent.click(screen.getByRole("button", { name: /mine block/i }));

  expect(await screen.findByText(/cooling down\. ready to mine in 12 seconds/i)).toBeInTheDocument();
});

test("Mine page renders Mining Status and reward split", async () => {
  renderWithProviders(<Mine />, "/mine");

  expect(await screen.findByRole("heading", { name: /mining status/i })).toBeInTheDocument();
  expect(await screen.findByText(/miner receives/i)).toBeInTheDocument();
  expect(screen.getAllByText(/47\.5 VLQ/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/treasury receives/i)).toBeInTheDocument();
  expect(screen.getAllByText(/2\.5 VLQ/i).length).toBeGreaterThan(0);
});

test("Mine page renders cooldown reason from mining status", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/mining/status") {
      return Promise.resolve({
        data: {
          success: true,
          status: {
            chain_valid: true,
            can_mine_now: false,
            reason_if_not: "Next block is allowed in 20 seconds.",
            seconds_until_next_allowed_block: 20,
            current_block_height: 12,
            current_difficulty: 3,
            miner_reward_after_treasury: 47.5,
            treasury_reward_per_block: 2.5,
            pending_transaction_count: 0,
          },
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Mine />, "/mine");

  expect(await screen.findByText(/next block is allowed in 20 seconds/i)).toBeInTheDocument();
});

test("Transaction detail page renders status and block link", async () => {
  renderWithProviders(<TransactionDetail />, "/tx/tx-test-123");

  expect(await screen.findByRole("heading", { name: /transaction detail/i })).toBeInTheDocument();
  expect(await screen.findByText(/confirmed/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view block/i })).toHaveAttribute("href", "/block/0000abc");
  expect(screen.queryByText(/private key/i)).not.toBeInTheDocument();
});

test("Block detail page renders transactions with tx links", async () => {
  api.get.mockImplementation((path) => {
    if (path.startsWith("/chain/block/")) {
      return Promise.resolve({
        data: {
          success: true,
          block: {
            index: 2,
            hash: "0000block",
            previous_hash: "0000prev",
            timestamp: 1715791000,
            nonce: 42,
            difficulty: 4,
            transaction_count: 1,
            confirmations: 1,
            transactions: [{ tx_id: "tx-one", status: "confirmed", amount: 3, type: "transfer" }],
          },
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<BlockDetail />, "/block/0000block");

  expect(await screen.findByRole("heading", { name: /block detail/i })).toBeInTheDocument();
  expect(screen.getByText(/block #2/i)).toBeInTheDocument();
  expect(await screen.findByText(/tx-one/i)).toBeInTheDocument();
  expect(screen.getByText(/tx-one/i).closest("a")).toHaveAttribute("href", "/tx/tx-one");
});

test("Blockchain explorer loads pending transactions and links to tx details", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/transactions/pending") {
      return Promise.resolve({
        data: {
          success: true,
          transactions: [{ tx_id: "pending-tx", status: "pending", sender_address: "VLQ_A", amount: 2 }],
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Blockchain />, "/blockchain");

  expect(await screen.findByRole("heading", { name: /pending transactions/i })).toBeInTheDocument();
  expect(await screen.findByText(/pending-tx/i)).toBeInTheDocument();
  expect(screen.getByText(/pending-tx/i).closest("a")).toHaveAttribute("href", "/tx/pending-tx");
});

test("Registry tabs render active node card with sync status", async () => {
  renderWithProviders(<Registry />, "/registry");

  expect(await screen.findByRole("heading", { name: /registry/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /active nodes/i })).toBeInTheDocument();
  expect(await screen.findByText(/example node/i)).toBeInTheDocument();
  expect(screen.getAllByText(/synced/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/98%/i).length).toBeGreaterThan(0);
});

test("Registry register node form validates through API errors", async () => {
  api.post.mockRejectedValueOnce({ response: { data: { message: "display name is required." } } });

  renderWithProviders(<Registry />, "/registry");

  await userEvent.click(await screen.findByRole("button", { name: /register node/i }));
  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "" } });
  const registerForm = screen.getByRole("heading", { name: /^register node$/i }).closest("section");
  await userEvent.click(within(registerForm).getByRole("button", { name: /^register node$/i }));

  expect(await screen.findByText(/display name is required/i)).toBeInTheDocument();
});

test("Registry node details search renders health history", async () => {
  renderWithProviders(<Registry />, "/registry");

  await userEvent.click(await screen.findByRole("button", { name: /node details/i }));
  fireEvent.change(screen.getByLabelText(/node url/i), { target: { value: "https://node.example.org" } });
  await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

  expect(await screen.findByRole("heading", { name: /health history/i })).toBeInTheDocument();
  expect(screen.getByText(/node heartbeat is valid/i)).toBeInTheDocument();
});

test("Health page renders registry summary section", async () => {
  renderWithProviders(<Health />, "/health");

  expect(await screen.findByRole("heading", { name: /network registry health/i })).toBeInTheDocument();
  expect(screen.getByText(/average reliability/i)).toBeInTheDocument();
  expect(screen.getByText(/98%/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /mining operations/i })).toBeInTheDocument();
  expect(screen.getByText(/block production status/i)).toBeInTheDocument();
});

test("Health page renders Storage Health", async () => {
  renderWithProviders(<Health />, "/health");

  expect(await screen.findByRole("heading", { name: /storage health/i })).toBeInTheDocument();
  expect(screen.getByText(/critical files ok/i)).toBeInTheDocument();
  expect(screen.getByText(/backup available/i)).toBeInTheDocument();
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

test("Admin page shows login form first", () => {
  renderWithProviders(<Admin />, "/admin");

  expect(screen.getByRole("heading", { name: /admin access/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/admin token/i)).toHaveAttribute("type", "password");
});

test("Admin page handles unauthorized token", async () => {
  api.get.mockRejectedValueOnce({ response: { status: 401 } });
  renderWithProviders(<Admin />, "/admin");

  fireEvent.change(screen.getByLabelText(/admin token/i), { target: { value: "bad-token" } });
  await userEvent.click(screen.getByRole("button", { name: /open operator dashboard/i }));

  expect(await screen.findByText(/unauthorized/i)).toBeInTheDocument();
  expect(screen.queryByText("bad-token")).not.toBeInTheDocument();
});

test("Admin page renders overview after successful response", async () => {
  api.get.mockResolvedValueOnce({
    data: {
      success: true,
      deployment: { commit_hash: "abcdef1234567890", commit_timestamp: "2026-05-17T12:00:00Z" },
      blockchain: {
        height: 218,
        chain_valid: true,
        pending_transaction_count: 2,
        current_difficulty: 4,
        current_mining_reward: 50,
      },
      treasury: { balance: 25 },
      backups: { latest_backup: { file_name: "vorliq-backup-2026-05-17-120000.tar.gz" } },
      incidents: { active_count: 0, total_count: 1 },
      services: { backend: "active", blockchain: "active", heartbeat: "active", nginx: "active" },
      server_uptime_seconds: 10,
    },
  });

  renderWithProviders(<Admin />, "/admin");
  fireEvent.change(screen.getByLabelText(/admin token/i), { target: { value: "good-token" } });
  await userEvent.click(screen.getByRole("button", { name: /open operator dashboard/i }));

  expect(await screen.findByRole("heading", { name: /vorliq operator dashboard/i })).toBeInTheDocument();
  expect(screen.getByText(/block height/i)).toBeInTheDocument();
  expect(screen.getByText("218")).toBeInTheDocument();
  expect(screen.queryByText("good-token")).not.toBeInTheDocument();
});

test("Admin page renders storage section after token", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/admin/overview") {
      return Promise.resolve({
        data: {
          success: true,
          deployment: { commit_hash: "abcdef1234567890" },
          blockchain: { height: 218, chain_valid: true, pending_transaction_count: 2 },
          treasury: { balance: 25 },
          backups: { latest_backup: null },
          incidents: { active_count: 0 },
          services: {},
          server_uptime_seconds: 10,
        },
      });
    }
    if (path === "/admin/storage") {
      return Promise.resolve({
        data: {
          success: true,
          overall_status: "warning",
          critical_files_ok: 14,
          warnings_count: 1,
          errors_count: 0,
          backup_available: true,
          files: [
            {
              file_name: "chain.json",
              status: "ok",
              valid_json: true,
              has_backup: true,
              size_bytes: 120,
              last_modified: "2026-05-20T00:00:00.000Z",
            },
          ],
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Admin />, "/admin");
  fireEvent.change(screen.getByLabelText(/admin token/i), { target: { value: "good-token" } });
  await userEvent.click(screen.getByRole("button", { name: /open operator dashboard/i }));
  await userEvent.click(await screen.findByRole("button", { name: /storage/i }));

  expect(await screen.findByText(/overall status/i)).toBeInTheDocument();
  expect(screen.getByText("chain.json")).toBeInTheDocument();
});
