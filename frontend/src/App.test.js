import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import IncidentBanner from "./components/IncidentBanner";
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
import VLQ from "./pages/VLQ";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Forum from "./pages/Forum";
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
import NodeSync from "./pages/NodeSync";
import Readiness from "./pages/Readiness";
import MigrationReadiness from "./pages/MigrationReadiness";
import Footer from "./components/Footer";

jest.setTimeout(15000);

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
  private_key: "REDACTED_TEST_SIGNING_MATERIAL",
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

  if (path === "/snapshot/verify") {
    return Promise.resolve({
      data: {
        success: true,
        verified: true,
        snapshot: { chain_height: 12, latest_block_hash: "0000snapshot" },
        checks: [{ id: "secret_scan_passed", passed: true }],
        warnings: [],
      },
    });
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
    return Promise.resolve({
      data: { success: true, holders: [{ address: "VLQ_A", value: 10 }], miners: [], lenders: [], totals: { holders: 1 } },
    });
  }

  if (path === "/wallet/balance") {
    return Promise.resolve({
      data: {
        success: true,
        address: "VLQ_TEST_ADDRESS_123456",
        balance: 42,
        coin: "VLQ",
      },
    });
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
            description: "Community coordination request",
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
            description: "Active coordination record",
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
          exchange_limit: { default: 5, current: 5, changed: false },
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
        halving_interval: 210000,
        maximum_supply: 21000000,
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

  if (path === "/nodes/compare") {
    return Promise.resolve({
      data: {
        success: true,
        checked_at: "2026-05-26T12:00:00.000Z",
        trusted_node_url: "https://vorliq.org",
        trusted_chain_height: 12,
        trusted_latest_hash: "0000nodehash",
        trusted_snapshot_hash: "snapshot-hash",
        trusted_signature_verified: true,
        active_node_count: 1,
        summary: {
          total_node_count: 1,
          active_node_count: 1,
          synced_count: 1,
          behind_count: 0,
          ahead_count: 0,
          forked_count: 0,
          stale_count: 0,
          unreachable_count: 0,
          unknown_count: 0,
          overall_status: "synced",
        },
        nodes: [
          {
            node_url: "https://node.example.org",
            display_name: "Example Node",
            region: "Europe",
            country: "United Kingdom",
            last_seen: Math.floor(Date.now() / 1000),
            active: true,
            chain_height: 12,
            latest_block_hash: "0000nodehash",
            chain_valid: true,
            response_time_ms: 42,
            sync_status: "synced",
            sync_label: "Synced",
            sync_message: "Node matches the trusted public chain.",
            height_difference: 0,
            same_latest_hash: true,
            risk_level: "low",
          },
        ],
      },
    });
  }

  if (path === "/nodes/monitor") {
    return Promise.resolve({
      data: {
        success: true,
        overall_status: "warning",
        checked_at: "2026-05-26T12:00:00.000Z",
        trusted_node_url: "https://vorliq.org",
        trusted_public_node_status: "synced",
        active_node_count: 1,
        synced_count: 1,
        behind_count: 0,
        ahead_count: 0,
        forked_count: 0,
        stale_count: 1,
        unreachable_count: 0,
        warning_count: 1,
        critical_count: 0,
        recommended_actions: ["Restart heartbeat and run node doctor locally."],
        alerts: [
          {
            severity: "warning",
            code: "stale_node",
            title: "Registered node heartbeat is stale",
            message: "A non-critical registered node has not sent a heartbeat inside the active window.",
            node_url: "https://old-node.example.org",
            operator_action: "Restart heartbeat and run node doctor locally.",
            public_safe: true,
          },
        ],
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

  if (path === "/indexes/health") {
    return Promise.resolve({
      data: {
        success: true,
        exists: true,
        valid: true,
        status: "ok",
        schema_version: 1,
        chain_height: 12,
        latest_block_hash: "0000latestblock",
        built_at: "2026-05-21T00:00:00Z",
        rebuild_needed: false,
        index_chain_match: true,
      },
    });
  }

  if (path === "/migration/readiness") {
    return Promise.resolve({
      data: {
        success: true,
        storage_backend: "json",
        storage_adapter_interface_available: true,
        active_storage_adapter: "json",
        database_enabled: false,
        future_database_target: "postgresql",
        postgres_adapter_available: true,
        postgres_adapter_enabled: false,
        postgres_write_mode: "disabled",
        postgres_runtime_blocked_in_production: true,
        postgres_schema_present: true,
        postgres_active: false,
        postgres_shadow_rehearsal_available: true,
        postgres_shadow_ci_enabled: true,
        postgres_shadow_fixture_available: true,
        migration_phase: "preparation",
        rollback_plan_required: true,
        migration_tools_available: true,
        migration_supported: "shadow_rehearsal_available",
        chain_source_of_truth: "chain.json",
        pending_source_of_truth: "pending.json",
        indexes_derived: true,
        latest_chain_height: 12,
        latest_block_hash: "0000latestblock",
        last_storage_health: { overall_status: "ok", warnings_count: 0, errors_count: 0 },
        last_index_health: { status: "ok", rebuild_needed: false, index_chain_match: true },
        docs_url: "https://vorliq.github.io/Vorliq/storage-adapters.html",
        storage_adapter_interface_url: "https://vorliq.github.io/Vorliq/storage-adapter-interface.html",
        postgres_adapter_url: "https://vorliq.github.io/Vorliq/postgres-adapter.html",
        schema_map_url: "https://vorliq.github.io/Vorliq/schema-map.html",
        postgres_readiness_url: "https://vorliq.github.io/Vorliq/postgres-readiness.html",
        database_migration_plan_url: "https://vorliq.github.io/Vorliq/database-migration-plan.html",
        database_rollback_plan_url: "https://vorliq.github.io/Vorliq/database-rollback-plan.html",
        postgres_shadow_migration_url: "https://vorliq.github.io/Vorliq/postgres-shadow-migration.html",
        message: "Production storage is intentionally still hardened JSON. PostgreSQL support is shadow rehearsal preparation only.",
      },
    });
  }

  if (path === "/readiness") {
    return Promise.resolve({
      data: {
        success: true,
        overall_status: "pass",
        score: 98,
        checked_at: "2026-05-21T00:00:00Z",
        index_health: "ok",
        index_rebuild_needed: false,
        index_chain_match: true,
        migration_readiness_available: true,
        storage_backend: "json",
        storage_adapter_interface_available: true,
        active_storage_adapter: "json",
        database_enabled: false,
        future_database_target: "postgresql",
        postgres_adapter_available: true,
        postgres_adapter_enabled: false,
        postgres_write_mode: "disabled",
        postgres_runtime_blocked_in_production: true,
        postgres_schema_present: true,
        postgres_active: false,
        postgres_shadow_rehearsal_available: true,
        postgres_shadow_ci_enabled: true,
        migration_phase: "preparation",
        rollback_plan_required: true,
        migration_tools_available: true,
        node_monitor_status: "warning",
        node_monitor_warning_count: 1,
        node_monitor_critical_count: 0,
        checks: [
          {
            id: "index_health_ok",
            name: "Index health ok",
            category: "Storage",
            status: "pass",
            severity: "medium",
            message: "Index health is ok.",
          },
          {
            id: "migration_readiness_available",
            name: "Migration readiness available",
            category: "Storage",
            status: "pass",
            severity: "medium",
            message: "Migration readiness metadata is available.",
          },
          {
            id: "postgres_schema_present",
            name: "PostgreSQL schema present",
            category: "Storage",
            status: "pass",
            severity: "medium",
            message: "Preparation-only PostgreSQL schema files are present.",
          },
          {
            id: "postgres_not_active_expected",
            name: "PostgreSQL not active expected",
            category: "Storage",
            status: "pass",
            severity: "critical",
            message: "PostgreSQL is not active in production, as expected for this preparation release.",
          },
          {
            id: "postgres_shadow_rehearsal_available",
            name: "PostgreSQL shadow rehearsal available",
            category: "Storage",
            status: "pass",
            severity: "medium",
            message: "PostgreSQL shadow migration rehearsal tooling is available for local and CI-only validation.",
          },
        ],
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

function renderWithAuth(ui, auth, route = "/") {
  const defaultAuth = {
    wallet: null,
    isLoggedIn: false,
    login: jest.fn(),
    logout: jest.fn(),
    clearLocalWallet: jest.fn(),
    createAndSaveWallet: jest.fn(),
  };

  return render(
    <ThemeProvider>
      <NotificationProvider>
        <AuthContext.Provider value={{ ...defaultAuth, ...auth }}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AuthContext.Provider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.clearAllMocks();
  api.get.mockImplementation(defaultApiGet);
  api.post.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

test("App renders without crashing inside its providers", async () => {
  render(<App />);

  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: /your community's platform\. your rules\./i,
    })
  ).toBeInTheDocument();
  expect(screen.getByRole("navigation")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^create your account$/i })).toHaveAttribute("href", "/register");
  expect(screen.getByText(/Vorliq is a community savings and lending platform built on its own lightweight blockchain/i)).toBeInTheDocument();
});

test("Production shell is dark only and no longer exposes the old theme toggle", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(screen.queryByRole("button", { name: /switch to light theme/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /switch to dark theme/i })).not.toBeInTheDocument();
});

test("Production homepage replaces the legacy onboarding modal", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { level: 1, name: /your community's platform/i })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: /welcome to vorliq/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^skip$/i })).not.toBeInTheDocument();
});

test("App exposes a keyboard skip link to the main content", async () => {
  render(<App />);

  expect(await screen.findByRole("link", { name: /skip to main content/i })).toHaveAttribute(
    "href",
    "#main-content"
  );
  expect(document.querySelector("main#main-content")).toBeInTheDocument();
});

test("Homepage navigation exposes current product routes", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  const nav = screen.getByRole("navigation");

  expect(within(nav).getByRole("link", { name: /how it works/i })).toHaveAttribute("href", "/#how-it-works");
  expect(within(nav).getByRole("link", { name: /^features$/i })).toHaveAttribute("href", "/features");
  expect(within(nav).getByRole("link", { name: /^lending$/i })).toHaveAttribute("href", "/lending");
  expect(within(nav).getByRole("link", { name: /^community$/i })).toHaveAttribute("href", "/#community");
  expect(within(nav).getByRole("link", { name: /^learn$/i })).toHaveAttribute("href", "/#learn");
  expect(within(nav).getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  expect(within(nav).getByRole("link", { name: /^create account$/i })).toHaveAttribute("href", "/register");
});

test("Homepage has responsible product wording and no external wallet integration copy", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });

  expect(screen.getByText(/Vorliq is a community savings and lending platform built on its own lightweight blockchain/i)).toBeInTheDocument();
  expect(screen.getByText(/Native VLQ\. Built for Vorliq\./i)).toBeInTheDocument();
  expect(screen.queryByText(/MetaMask/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/WalletConnect/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/wallet-connect|connect wallet/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Ethereum|Bitcoin|Solana/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/regulated bank/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/investment product/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/custody provider/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/legal lender/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/guaranteed return/i)).not.toBeInTheDocument();
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
  expect(screen.getByRole("link", { name: /^blockchain inspect blocks and transactions$/i })).toHaveAttribute("href", "/blockchain");
  expect(screen.getByRole("link", { name: /^network view public node and decentralization status$/i })).toHaveAttribute("href", "/network");
  expect(screen.getByRole("link", { name: /^community requests coordinate peer requests$/i })).toHaveAttribute("href", "/exchange");
  expect(screen.getByText(/treasury per block/i)).toBeInTheDocument();
});

test("Dashboard shows account-aware wallet data and actions when a wallet is unlocked", async () => {
  api.get.mockImplementation((path, options) => {
    if (path === "/wallet/balance") {
      expect(options.params.address).toBe("VLQ_TEST_ADDRESS_123456");
      return Promise.resolve({ data: { success: true, address: "VLQ_TEST_ADDRESS_123456", balance: 42, coin: "VLQ" } });
    }

    if (path === "/chain/address") {
      return Promise.resolve({
        data: {
          success: true,
          transactions: [
            {
              tx_id: "wallet-activity-tx",
              status: "confirmed",
              sender_address: "VLQ_TEST_ADDRESS_123456",
              receiver_address: "VLQ_RECEIVER_ADDRESS",
              amount: 3,
              block_index: 4,
            },
          ],
        },
      });
    }

    return defaultApiGet(path);
  });

  const auth = {
    wallet: { address: "VLQ_TEST_ADDRESS_123456", public_key: "TEST_PUBLIC_KEY" },
    isLoggedIn: true,
    logout: jest.fn(),
    clearLocalWallet: jest.fn(),
  };

  renderWithAuth(<Dashboard />, auth, "/dashboard");

  expect(await screen.findByRole("heading", { name: /your wallet dashboard/i })).toBeInTheDocument();
  const walletDashboard = screen.getByRole("heading", { name: /your wallet dashboard/i }).closest("section");
  expect(await screen.findByText(/42 VLQ/i)).toBeInTheDocument();
  expect(screen.getByText(/loaded from the existing public balance endpoint/i)).toBeInTheDocument();
  expect(within(walletDashboard).getByRole("link", { name: /get starter vlq/i })).toHaveAttribute("href", "/faucet?address=VLQ_TEST_ADDRESS_123456");
  expect(within(walletDashboard).getByRole("link", { name: /send vlq/i })).toHaveAttribute("href", "/send");
  expect(within(walletDashboard).getByRole("link", { name: /explorer/i })).toHaveAttribute("href", "/blockchain");
  expect(within(walletDashboard).getByRole("link", { name: /vlq overview/i })).toHaveAttribute("href", "/vlq");
  expect(walletDashboard.querySelector('a[href="/tx/wallet-activity-tx"]')).toBeInTheDocument();
});

test("Dashboard can clear the encrypted local wallet only after explicit confirmation", async () => {
  const clearLocalWallet = jest.fn();
  const auth = {
    wallet: { address: "VLQ_TEST_ADDRESS_123456", public_key: "TEST_PUBLIC_KEY" },
    isLoggedIn: true,
    logout: jest.fn(),
    clearLocalWallet,
  };

  renderWithAuth(<Dashboard />, auth, "/dashboard");

  await screen.findByRole("heading", { name: /your wallet dashboard/i });
  const clearButton = screen.getByRole("button", { name: /clear local wallet/i });
  expect(clearButton).toBeDisabled();

  await userEvent.click(screen.getByLabelText(/removes the encrypted wallet backup from this browser/i));
  expect(clearButton).toBeEnabled();

  await userEvent.click(clearButton);
  expect(clearLocalWallet).toHaveBeenCalledTimes(1);
});

test("Dashboard shows branded official social icon links", async () => {
  const { container } = renderWithProviders(<Dashboard />);

  expect(await screen.findByRole("heading", { name: /join the conversation/i })).toBeInTheDocument();
  const socialLinks = container.querySelector(".dashboard-social-links");

  expect(socialLinks.querySelectorAll(".social-brand-link")).toHaveLength(4);
  expect(socialLinks.querySelector(".discord")).toHaveAttribute("href", "https://discord.gg/qpX5sHD4pC");
  expect(socialLinks.querySelector(".telegram")).toHaveAttribute("href", "https://t.me/Vorliq");
  expect(socialLinks.querySelector(".github")).toHaveAttribute("href", "https://github.com/vorliq/Vorliq");
  expect(socialLinks.querySelector(".x")).toHaveAttribute("href", "https://x.com/vorliq");
});

test("mobile hamburger announces expanded state when opened", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  const hamburger = screen.getByRole("button", { name: /open navigation menu/i });

  expect(hamburger).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(hamburger);
  expect(hamburger).toHaveAttribute("aria-expanded", "true");
  expect(hamburger).toHaveAttribute("aria-controls", "mobile-product-navigation");
});

test("mobile drawer traps focus and closes from outside click", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  const hamburger = screen.getByRole("button", { name: /open navigation menu/i });
  await userEvent.click(hamburger);

  const drawer = screen.getByRole("dialog", { name: /navigation menu/i });
  expect(drawer).toHaveAttribute("aria-modal", "true");
  expect(drawer.closest("nav")).toBeNull();
  expect(drawer.closest("header")).toBeNull();
  expect(within(drawer).getByRole("link", { name: /^features$/i })).toHaveAttribute("href", "/features");
  expect(within(drawer).getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");

  const focusTargets = drawer.querySelectorAll("a, button");
  focusTargets[focusTargets.length - 1].focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(focusTargets[0]).toHaveFocus();

  focusTargets[0].focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(focusTargets[focusTargets.length - 1]).toHaveFocus();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(hamburger).toHaveAttribute("aria-expanded", "false");
  expect(document.body).not.toHaveClass("mobile-nav-open");
});

test("mobile drawer content is hidden when closed and drawer links close cleanly", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  expect(screen.queryByRole("dialog", { name: /navigation menu/i })).not.toBeInTheDocument();

  const hamburger = screen.getByRole("button", { name: /open navigation menu/i });
  await userEvent.click(hamburger);

  let drawer = screen.getByRole("dialog", { name: /navigation menu/i });
  expect(drawer.querySelectorAll(".brand")).toHaveLength(1);
  expect(within(drawer).getByRole("button", { name: /close navigation menu/i }).closest("#mobile-product-navigation")).toBe(drawer);

  await userEvent.click(within(drawer).getByRole("link", { name: /^features$/i }));
  await waitFor(() => expect(window.location.pathname).toBe("/features"));
  expect(screen.queryByRole("dialog", { name: /navigation menu/i })).not.toBeInTheDocument();
  expect(document.body).not.toHaveClass("mobile-nav-open");

  await userEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));
  drawer = screen.getByRole("dialog", { name: /navigation menu/i });
  await userEvent.click(within(drawer).getByRole("link", { name: /create account/i }));
  await waitFor(() => expect(window.location.pathname).toBe("/register"));
  expect(screen.queryByRole("dialog", { name: /navigation menu/i })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));
  drawer = screen.getByRole("dialog", { name: /navigation menu/i });
  await userEvent.click(within(drawer).getByRole("link", { name: /create account/i }));
  expect(screen.queryByRole("dialog", { name: /navigation menu/i })).not.toBeInTheDocument();
});

test("mobile drawer backdrop closes without leaving hidden overlay content", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  await userEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

  expect(screen.getByRole("dialog", { name: /navigation menu/i })).toBeInTheDocument();
  const backdrop = document.querySelector(".mobile-drawer-backdrop");
  expect(backdrop).toBeInTheDocument();
  fireEvent.click(backdrop);

  expect(screen.queryByRole("dialog", { name: /navigation menu/i })).not.toBeInTheDocument();
  expect(document.body).not.toHaveClass("mobile-nav-open");
});

test("mobile drawer hash link closes and scrolls to the target section", async () => {
  const scrollIntoView = jest.fn();
  Element.prototype.scrollIntoView = scrollIntoView;

  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  await userEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

  const drawer = screen.getByRole("dialog", { name: /navigation menu/i });
  await userEvent.click(within(drawer).getByRole("link", { name: /how it works/i }));

  await waitFor(() => expect(window.location.hash).toBe("#how-it-works"));
  expect(screen.queryByRole("dialog", { name: /navigation menu/i })).not.toBeInTheDocument();
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
});

test("primary CTAs navigate with one click to their route targets", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  await userEvent.click(screen.getByRole("link", { name: /create your account/i }));
  await waitFor(() => expect(window.location.pathname).toBe("/register"));

  cleanup();
  window.history.pushState({}, "", "/features");
  render(<App />);
  await userEvent.click(await screen.findByRole("link", { name: /open blockchain/i }));
  await waitFor(() => expect(window.location.pathname).toBe("/blockchain"));

  cleanup();
  window.history.pushState({}, "", "/dashboard");
  render(<App />);
  await screen.findByRole("heading", { name: /vorliq dashboard/i });
  await userEvent.click(screen.getAllByRole("link", { name: /get starter vlq/i })[0]);
  await waitFor(() => expect(window.location.pathname).toBe("/faucet"));
});

test("New product shell removes old More menu and notification bell controls", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });

  expect(screen.queryByRole("button", { name: /^more/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /open notifications page/i })).not.toBeInTheDocument();
});

test("Footer renders official community links without Reddit", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
  const footer = document.querySelector("footer");

  expect(footer.querySelectorAll(".social-links")).toHaveLength(1);
  expect(within(footer).getByRole("link", { name: /open vorliq on github/i })).toHaveAttribute("href", "https://github.com/vorliq/Vorliq");
  expect(within(footer).getByRole("link", { name: /open vorliq on x/i })).toHaveAttribute("href", "https://x.com/vorliq");
  expect(within(footer).getByRole("link", { name: /open vorliq on telegram/i })).toHaveAttribute("href", "https://t.me/Vorliq");
  expect(within(footer).getByRole("link", { name: /open vorliq on discord/i })).toHaveAttribute("href", "https://discord.gg/qpX5sHD4pC");
  expect(within(footer).getByRole("link", { name: /vlq overview/i })).toHaveAttribute("href", "/vlq");
  expect(within(footer).getByRole("link", { name: /^lending$/i })).toHaveAttribute("href", "/lending");
  expect(within(footer).queryByRole("link", { name: /reddit/i })).not.toBeInTheDocument();
});

test("Features route states responsible limits without wallet-connect integrations", async () => {
  window.history.pushState({}, "", "/features");

  render(<App />);

  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: /savings, lending, and shared records for real communities/i,
    })
  ).toBeInTheDocument();
  expect(screen.getByText(/Vorliq describes itself as a community savings bank product experience/i)).toBeInTheDocument();
  expect(screen.getByText(/not as regulated banking, legal lending, custody, exchange services, or a promise of value/i)).toBeInTheDocument();
  expect(screen.getByText(/Native Vorliq wallet flow\./i)).toBeInTheDocument();
  expect(screen.getByText(/No third party blockchain dependency\./i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /understand vlq/i })).toHaveAttribute("href", "/vlq");
  expect(screen.queryByText(/MetaMask|WalletConnect|wallet-connect|connect wallet/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Ethereum|Bitcoin|Solana/i)).not.toBeInTheDocument();
});

test("VLQ overview explains confirmed and pending movement from public APIs", async () => {
  renderWithProviders(<VLQ />, "/vlq");

  expect(await screen.findByRole("heading", { level: 1, name: /understand vlq inside vorliq/i })).toBeInTheDocument();
  expect(screen.getByText(/VLQ is the native coin used by Vorliq wallets/i)).toBeInTheDocument();
  expect(screen.getByText(/Confirmed supply issued/i)).toBeInTheDocument();
  expect(screen.getByText(/Maximum supply rule/i)).toBeInTheDocument();
  expect(screen.getByText(/Pending to confirmed/i)).toBeInTheDocument();
  expect(screen.getByText(/Faucet status/i)).toBeInTheDocument();
  expect(screen.getByText(/Reward status/i)).toBeInTheDocument();
  expect(screen.getByText(/Public treasury movement/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open explorer/i })).toHaveAttribute("href", "/blockchain");
  expect(screen.getByRole("link", { name: /check a balance/i })).toHaveAttribute("href", "/wallet");
  expect(screen.queryByText(/MetaMask|WalletConnect|wallet-connect|connect wallet/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Ethereum|Bitcoin|Solana|Reddit/i)).not.toBeInTheDocument();
});

test("Register route renders safe account creation without private key collection", async () => {
  window.history.pushState({}, "", "/register");

  render(<App />);

  expect(await screen.findByRole("heading", { level: 1, name: /create your vorliq account safely/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");
  expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute("type", "password");
  expect(screen.getByLabelText(/private key cannot be recovered by vorliq/i)).toHaveAttribute("type", "checkbox");
  expect(screen.queryByRole("textbox", { name: /private key/i })).not.toBeInTheDocument();
  expect(screen.getByText(/never asks you to paste a private key/i)).toBeInTheDocument();
  expect(screen.queryByText(/MetaMask|WalletConnect|wallet-connect|connect wallet/i)).not.toBeInTheDocument();
});

test("Dashboard route still renders the existing real dashboard", async () => {
  window.history.pushState({}, "", "/dashboard");

  render(<App />);

  expect(await screen.findByRole("heading", { level: 1, name: /^vorliq dashboard$/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /get started with vorliq/i })).toBeInTheDocument();
  expect(await screen.findByText(/block production/i)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /^profiles$/i }).some((link) => link.getAttribute("href") === "/profiles")).toBe(true);
  expect(screen.getByRole("link", { name: /health check readiness/i })).toHaveAttribute("href", "/health");
  expect(screen.getByRole("link", { name: /network view public node/i })).toHaveAttribute("href", "/network");
  expect(screen.getByRole("link", { name: /readiness review production gate/i })).toHaveAttribute("href", "/readiness");
});

test("Profiles route aliases the public profile page", async () => {
  window.history.pushState({}, "", "/profiles");

  render(<App />);

  expect(await screen.findByRole("heading", { level: 1, name: /^profiles$/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /how profiles work/i })).toBeInTheDocument();
});

test("Dashboard keeps core live data visible when an optional summary is unavailable", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/exchange/summary") {
      return Promise.reject({ response: { data: { message: "Exchange summary unavailable" } } });
    }

    return defaultApiGet(path);
  });

  renderWithProviders(<Dashboard />, "/dashboard");

  expect(await screen.findByText(/block production/i)).toBeInTheDocument();
  expect(screen.getByText(/some dashboard data is unavailable right now/i)).toBeInTheDocument();
  expect(screen.getByText(/community request summary/i)).toBeInTheDocument();
  expect(screen.getByText(/open community requests/i).parentElement).toHaveTextContent(/Unavailable/i);
});

test("Login page shows wallet creation when no wallet is stored", () => {
  renderWithProviders(<Login />, "/login");

  expect(screen.getByRole("heading", { level: 1, name: /create or restore your vorliq wallet/i })).toBeInTheDocument();
  expect(screen.getAllByText(/create your vorliq wallet/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /create wallet and set password/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /import encrypted wallet backup/i })).toBeInTheDocument();
  expect(screen.getByText(/restore it on this browser or another device/i)).toBeInTheDocument();
  expect(screen.getByText(/vorliq does not send them to the server/i)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /private key/i })).not.toBeInTheDocument();
});

test("Login page makes saved wallet unlock the primary path and gates clear saved wallet", async () => {
  window.localStorage.setItem("vorliq_wallet", JSON.stringify({ address: "VLQ_SAVED_ADDRESS" }));
  const login = jest.fn().mockResolvedValue({ address: "VLQ_SAVED_ADDRESS", public_key: "PUBLIC_ONLY" });
  const clearLocalWallet = jest.fn(() => window.localStorage.removeItem("vorliq_wallet"));

  renderWithAuth(<Login />, { login, clearLocalWallet }, "/login");

  expect(screen.getByRole("heading", { level: 1, name: /unlock saved wallet/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /unlock saved wallet/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /import encrypted wallet backup/i })).toBeInTheDocument();
  expect(screen.getByText(/restoring your wallet on this browser or another device/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /create new wallet or clear saved wallet/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear saved wallet/i })).toBeDisabled();
  expect(screen.queryByRole("textbox", { name: /private key/i })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/wallet password/i), { target: { value: "REDACTED_TEST_WALLET_SECRET" } });
  await userEvent.click(screen.getByRole("button", { name: /unlock saved wallet/i }));
  await waitFor(() => expect(login).toHaveBeenCalledWith("REDACTED_TEST_WALLET_SECRET"));

  await userEvent.click(screen.getByLabelText(/removes the encrypted wallet backup from this browser/i));
  await userEvent.click(screen.getByRole("button", { name: /clear saved wallet/i }));
  expect(clearLocalWallet).toHaveBeenCalled();
  expect(screen.getByRole("heading", { level: 1, name: /create or restore your vorliq wallet/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /create wallet and set password/i })).toBeInTheDocument();
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

  expect(await screen.findByText(/private key hidden/i)).toBeInTheDocument();
  const revealButton = screen.getByRole("button", { name: /reveal private key/i });
  expect(revealButton).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/anyone with this key can spend this wallet's VLQ/i));
  expect(revealButton).toBeEnabled();
});

test("Footer exposes a public Risk Notice link", async () => {
  render(<App />);

  await screen.findByRole("heading", { level: 1, name: /your community's platform/i });
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
            activity_summary: { forum_posts: 1, completed_exchange_trades: 2 },
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
  expect(screen.getByRole("heading", { name: /how profiles work/i })).toBeInTheDocument();
  expect(screen.getByText(/public community identity for one wallet address/i)).toBeInTheDocument();
  expect(screen.getByText(/completed coordinations/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /wallet tools/i })).toHaveAttribute("href", "/wallet");
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

test("Forum explains public coordination and reports do not request secrets", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/forum/featured" || path === "/forum/posts") {
      return Promise.resolve({
        data: {
          success: true,
          posts: [
            {
              post_id: "post-1",
              title: "Node coordination update",
              category: "general",
              author_address: "VLQ_MEMBER_ADDRESS",
              vote_count: 2,
              feature_vote_count: 1,
              replies: [{ reply_id: "reply-1", author_address: "VLQ_REPLY_ADDRESS", body: "List reply", vote_count: 0, timestamp: 1715791100, tips: [] }],
              tips: [{ amount: 1 }],
              timestamp: 1715791000,
            },
          ],
        },
      });
    }
    if (path === "/forum/post") {
      return Promise.resolve({
        data: {
          success: true,
          post: {
            post_id: "post-1",
            title: "Node coordination update",
            body: "Detail body from API.",
            category: "general",
            author_address: "VLQ_MEMBER_ADDRESS",
            vote_count: 2,
            feature_vote_count: 1,
            replies: [
              {
                reply_id: "reply-1",
                author_address: "VLQ_REPLY_ADDRESS",
                body: "Detail reply from API.",
                vote_count: 0,
                timestamp: 1715791100,
                tips: [{ amount: 1 }],
              },
            ],
            timestamp: 1715791000,
          },
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Forum />, "/forum");

  expect(await screen.findByRole("heading", { name: /how the forum works/i })).toBeInTheDocument();
  expect(screen.getByText(/public coordination space for vorliq members/i)).toBeInTheDocument();
  expect(screen.getByText(/moderator and admin actions are protected/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /tip/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/\btips\b/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/private key|wallet password|backup password|seed phrase|admin token/i)).not.toBeInTheDocument();

  const forumPostButton = await screen.findByRole("button", { name: /node coordination update/i });
  await act(async () => {
    await userEvent.click(forumPostButton);
  });

  expect(api.get).toHaveBeenCalledWith("/forum/post", { params: { post_id: "post-1" } });
  expect(await screen.findByText(/detail body from api/i)).toBeInTheDocument();
  expect(screen.getByText(/detail reply from api/i)).toBeInTheDocument();
  expect(screen.queryByText(/\btips\b/i)).not.toBeInTheDocument();

  await userEvent.click((await screen.findAllByRole("button", { name: /^report$/i }))[0]);

  expect(screen.getByRole("form", { name: /report content/i })).toBeInTheDocument();
  expect(screen.getByText(/describe the public issue only/i)).toBeInTheDocument();
  expect(screen.getByText(/public reporters do not receive admin controls/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/private key|wallet password|backup password|seed phrase|admin token/i)).not.toBeInTheDocument();
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

  expect(await screen.findByLabelText(/authority write status/i)).toHaveTextContent(/signed wallet authorization/i);
  expect(screen.getByRole("button", { name: /submit loan request/i })).toBeDisabled();
  expect(await screen.findByRole("button", { name: /active votes/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /active loans/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my loans/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /lending lifecycle/i })).toBeInTheDocument();
  expect(screen.getByText(/no lending pool vlq has moved yet/i)).toBeInTheDocument();
  expect(screen.getByText(/pending vs confirmed lending movement/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open explorer/i })).toHaveAttribute("href", "/blockchain");

  await userEvent.click(screen.getByRole("button", { name: /active votes/i }));

  expect(await screen.findByText(/build a community tool/i)).toBeInTheDocument();
  expect(screen.getAllByText(/pending vote/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /vote yes/i })).toBeDisabled();
});

test("Lending page routes active repayments through the Send review flow", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/lending/summary") {
      return Promise.resolve({
        data: {
          success: true,
          summary: {
            total_loans: 1,
            pending_vote_count: 0,
            approved_pending_issue_count: 0,
            active_count: 1,
            repayment_pending_count: 0,
            repaid_count: 0,
            overdue_count: 0,
            rejected_count: 0,
            total_vlq_active: 25,
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
              loan_id: "loan-active-send-review-1",
              requester_address: "VLQ_ME",
              amount: 25,
              repayment_amount: 27.5,
              reason: "Repair shared tools",
              status: "active",
              created_at: 1715791000,
              due_block: 1005,
              blocks_until_due: 99,
              issuance_tx_id: "issue-tx-1",
              yes_vote_weight: 50,
              no_vote_weight: 0,
              votes: {},
            },
          ],
          total: 1,
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithAuth(<Lending />, { wallet: { address: "VLQ_ME", public_key: "PUBLIC_ONLY" }, isLoggedIn: true }, "/lending");

  await userEvent.click(await screen.findByRole("button", { name: /active loans/i }));

  expect(await screen.findByText(/repair shared tools/i)).toBeInTheDocument();
  expect(screen.getByText(/issuance confirmed; repayment is outstanding/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /issuance tx/i })).toHaveAttribute("href", "/tx/issue-tx-1");
  expect(screen.getByRole("link", { name: /review repayment in send/i })).toHaveAttribute("href", "/send");
  expect(screen.queryByRole("button", { name: /^repay$/i })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalledWith("/lending/repay", expect.anything());
});

test("Lending page marks missing summary fields unavailable instead of fake zeroes", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/lending/summary") {
      return Promise.resolve({ data: { success: true, summary: { pending_vote_count: 1 } } });
    }
    if (path === "/lending/loans") {
      return Promise.resolve({ data: { success: true, loans: [], total: 0 } });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Lending />, "/lending");

  expect(await screen.findByText(/pending votes/i)).toBeInTheDocument();
  expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/lending records come from the existing public lending apis/i)).toBeInTheDocument();
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
  expect(screen.getByRole("link", { name: /review repayment in send/i })).toHaveAttribute("href", "/send");
  expect(screen.queryByRole("button", { name: /^repay$/i })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /faucet claims/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open faucet/i })).toHaveAttribute("href", "/faucet?address=VLQ_ME");
});

test("Account requires confirmation before clearing the saved local wallet", async () => {
  const clearLocalWallet = jest.fn();

  renderWithAuth(
    <Routes>
      <Route path="/account" element={<Account />} />
      <Route path="/login" element={<Login />} />
    </Routes>,
    {
      wallet: { address: "VLQ_ME", public_key: "TEST_PUBLIC_KEY" },
      isLoggedIn: true,
      logout: jest.fn(),
      clearLocalWallet,
    },
    "/account"
  );

  expect(await screen.findByRole("heading", { name: /my wallet/i })).toBeInTheDocument();
  const clearButton = screen.getByRole("button", { name: /clear saved wallet/i });
  expect(clearButton).toBeDisabled();

  await userEvent.click(screen.getByLabelText(/removes the encrypted wallet backup from this browser/i));
  expect(clearButton).toBeEnabled();

  await userEvent.click(clearButton);
  expect(clearLocalWallet).toHaveBeenCalledTimes(1);
});

test("Exchange lifecycle tabs render open request cards and risk notice", async () => {
  renderWithProviders(<Exchange />, "/exchange");

  expect(await screen.findByRole("button", { name: /browse requests/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /post request/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my requests/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /active coordination/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/risk notice/i)).toHaveTextContent(/peer community requests/i);
  expect(await screen.findByText(/community coordination request/i)).toBeInTheDocument();
  expect(screen.getAllByText(/open/i).length).toBeGreaterThan(0);
});

test("Exchange My Requests state renders record tx form for active coordination", async () => {
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
              description: "Active coordination record",
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
              description: "Active coordination record",
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

  await userEvent.click(await screen.findByRole("button", { name: /my requests/i }));
  fireEvent.change(screen.getByLabelText(/wallet address for my requests search/i), { target: { value: "VLQ_CREATOR" } });
  await userEvent.click(screen.getByRole("button", { name: /^load$/i }));

  expect(await screen.findByText(/active coordination record/i)).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /record vlq transaction/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/vlq transaction id/i)).toBeInTheDocument();
});

test("Governance lifecycle tabs render active proposal cards", async () => {
  renderWithProviders(<Governance />, "/governance");

  expect(await screen.findByLabelText(/authority write status/i)).toHaveTextContent(/signed wallet authorization/i);
  expect(await screen.findByRole("button", { name: /active proposals/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /propose change/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my governance/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /rule changes/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /all history/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /how governance works/i })).toBeInTheDocument();
  expect(screen.getByText(/passed pending execution/i)).toBeInTheDocument();
  expect(screen.getByText(/community request limit/i)).toBeInTheDocument();
  expect(await screen.findByText(/adjust mining reward/i)).toBeInTheDocument();
  expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /vote yes/i })).toBeDisabled();
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

  expect(screen.getByRole("button", { name: /submit proposal/i })).toBeDisabled();
  expect(await screen.findByText(/mining reward must be greater than 0/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "exchange_limit" } });
  expect(await screen.findByText(/community request limit must be between 1 and 1000/i)).toBeInTheDocument();
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

  expect(await screen.findByLabelText(/authority write status/i)).toHaveTextContent(/signed wallet authorization/i);
  expect(await screen.findByRole("button", { name: /overview/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /active proposals/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /submit proposal/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /my treasury/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /treasury ledger/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /history/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /active proposals/i }));

  expect(await screen.findByText(/fund security review/i)).toBeInTheDocument();
  expect(screen.getAllByText(/pending vote/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /vote yes/i })).toBeDisabled();
});

test("Treasury overview summary renders", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  expect(await screen.findByText(/treasury balance/i)).toBeInTheDocument();
  expect(await screen.findByText(/250 VLQ/i)).toBeInTheDocument();
  expect(screen.getByText(/total received/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /treasury lifecycle/i })).toBeInTheDocument();
  expect(screen.getByText(/missing summary fields are marked unavailable/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /what treasury supports/i })).toBeInTheDocument();
  expect(screen.getByText(/pending vs confirmed treasury movement/i)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /^faucet$/i })[0]).toHaveAttribute("href", "/faucet");
  expect(screen.getAllByRole("link", { name: /^lending$/i })[0]).toHaveAttribute("href", "/lending");
  expect(screen.getAllByRole("link", { name: /^explorer$/i })[0]).toHaveAttribute("href", "/blockchain");
});

test("Treasury overview marks missing summary fields unavailable", async () => {
  api.get.mockImplementation((path, options) => {
    if (path === "/treasury/summary") {
      return Promise.resolve({ data: { success: true, summary: { current_balance: 250 } } });
    }
    return defaultApiGet(path, options);
  });

  renderWithProviders(<Treasury />, "/treasury");

  expect(await screen.findByText(/treasury balance/i)).toBeInTheDocument();
  expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThanOrEqual(4);
  expect(screen.queryByText(/total received/i)?.parentElement).not.toHaveTextContent("0 VLQ");
});

test("Treasury ledger tab renders public entries", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  await userEvent.click(await screen.findByRole("button", { name: /treasury ledger/i }));

  expect(await screen.findByRole("heading", { name: /treasury inflows and payouts/i })).toBeInTheDocument();
  expect(await screen.findByText(/treasury mining reward/i)).toBeInTheDocument();
  expect(screen.getByText(/payout paid/i)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /^tx$/i })[0]).toHaveAttribute("href", "/tx/reward-tx-1");
});

test("Treasury proposal form shows treasury balance max and risk notice", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  expect(await screen.findByLabelText(/risk notice/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /submit proposal/i }));

  expect(screen.getByRole("button", { name: /submit treasury proposal/i })).toBeDisabled();
  expect(await screen.findByText(/maximum request right now/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/maximum 250 vlq/i)).toBeInTheDocument();
  expect(screen.getByText(/public payout execution controls are not exposed/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /execute payout/i })).not.toBeInTheDocument();
});

test("Treasury history links paid proposals to explorer records", async () => {
  renderWithProviders(<Treasury />, "/treasury");

  await userEvent.click(await screen.findByRole("button", { name: /history/i }));

  expect(await screen.findByText(/paid docs work/i)).toBeInTheDocument();
  expect(screen.getByText(/confirmed treasury movement/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /payout tx/i })).toHaveAttribute("href", "/tx/treasury-tx-1");
  expect(screen.getByRole("link", { name: /block #3/i })).toHaveAttribute("href", "/block/3");
  expect(screen.getAllByRole("link", { name: /^explorer$/i })[0]).toHaveAttribute("href", "/blockchain");
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

test("Faucet claim cards keep long badges and transaction states readable", async () => {
  const longAddress = "VLQ_LONG_WALLET_ADDRESS_1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  api.get.mockImplementation((path, options) => {
    if (path === "/faucet/summary") {
      return Promise.resolve({ data: { success: true, summary: { starter_amount: 1, treasury_balance: 250, pending_claims: 2, confirmed_claims: 1 } } });
    }
    if (path === "/faucet/recent" || path === "/faucet/claims") {
      return Promise.resolve({
        data: {
          success: true,
          claims: [
            { claim_id: `${path}-rate`, wallet_address: longAddress, amount: 1, status: "rate_limited", tx_id: null },
            { claim_id: `${path}-pending`, wallet_address: `${longAddress}_PENDING`, amount: 1, status: "pending", tx_id: "pending-faucet-transaction-id-with-long-value" },
            { claim_id: `${path}-confirmed`, wallet_address: `${longAddress}_CONFIRMED`, amount: 1, status: "confirmed", tx_id: "confirmed-faucet-transaction-id-with-long-value" },
          ],
        },
      });
    }
    if (path === "/profiles/profile") {
      return Promise.resolve({
        data: {
          success: true,
          profile: {
            wallet_address: options?.params?.address,
            display_name: "Very Long Faucet Claimant Display Name",
            trust_labels: ["Wallet Verified", "Active Contributor", "New Member"],
          },
        },
      });
    }
    return defaultApiGet(path, options);
  });

  renderWithProviders(<Faucet />, `/faucet?address=${longAddress}`);

  expect(await screen.findByRole("heading", { name: /my faucet claims/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /recent public claims/i })).toBeInTheDocument();
  expect(await screen.findAllByText(/wallet verified/i)).toHaveLength(6);
  expect(screen.getAllByText(/active contributor/i)).toHaveLength(6);
  expect(screen.getAllByText(/new member/i)).toHaveLength(6);
  expect(screen.getAllByText(/rate limited/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/no tx/i).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("link", { name: /view tx/i })[0]).toHaveAttribute("href", "/tx/pending-faucet-transaction-id-with-long-value");
  expect(screen.getAllByText(/amount/i).length).toBeGreaterThan(0);
  expect(document.querySelectorAll(".faucet-claim-row").length).toBe(6);
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

  fireEvent.change(screen.getByLabelText(/encrypted wallet backup json/i), {
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
    target: { value: "REDACTED_TEST_BACKUP_SECRET" },
  });
  await userEvent.click(screen.getByRole("button", { name: /^import encrypted backup$/i }));

  expect(await screen.findByText(/wallet backup is invalid or the password is incorrect/i)).toBeInTheDocument();
});

test("wallet backup import rejects invalid wallet backup structure", async () => {
  renderWithProviders(<Login />, "/login");

  fireEvent.change(screen.getByLabelText(/encrypted wallet backup json/i), {
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
    target: { value: "REDACTED_TEST_BACKUP_SECRET" },
  });
  await userEvent.click(screen.getByRole("button", { name: /^import encrypted backup$/i }));

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

  expect(await screen.findByRole("heading", { name: /import encrypted wallet backup/i })).toBeInTheDocument();
  expect(screen.getAllByText(/create your vorliq wallet/i).length).toBeGreaterThan(0);
});

test("Send page logged-out manual mode is behind advanced disclosure", async () => {
  renderWithProviders(<Send />, "/send");

  expect(screen.getByText(/use saved-wallet signing/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/sender private key/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /advanced manual signing/i }));

  expect(screen.getByText(/saved-wallet signing is safer/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/sender private key/i)).toBeInTheDocument();
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
  expect(screen.getByRole("link", { name: /back to blockchain explorer/i })).toHaveAttribute("href", "/blockchain");
  expect(screen.queryByText(/private key/i)).not.toBeInTheDocument();
});

test("Transaction detail public fields omit raw signature material", async () => {
  api.get.mockImplementation((path) => {
    if (path.startsWith("/transactions/")) {
      return Promise.resolve({
        data: {
          success: true,
          transaction: {
            tx_id: "tx-public-fields",
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
            signature: "RAW_SIGNATURE_SHOULD_NOT_RENDER",
            public_key: "RAW_PUBLIC_KEY_SHOULD_NOT_RENDER",
          },
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<TransactionDetail />, "/tx/tx-public-fields");

  expect(await screen.findByRole("heading", { name: /transaction detail/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /show public fields/i }));

  expect(screen.getByText(/signature_present/i)).toBeInTheDocument();
  expect(screen.queryByText(/RAW_SIGNATURE_SHOULD_NOT_RENDER/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/RAW_PUBLIC_KEY_SHOULD_NOT_RENDER/i)).not.toBeInTheDocument();
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
  expect(screen.getByRole("link", { name: /back to blockchain explorer/i })).toHaveAttribute("href", "/blockchain");
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

test("Blockchain explorer address search scrolls directly to wallet results", async () => {
  const scrollIntoView = jest.fn();
  Element.prototype.scrollIntoView = scrollIntoView;

  api.get.mockImplementation((path) => {
    if (path.startsWith("/transactions/")) {
      return Promise.reject(new Error("not a transaction"));
    }
    if (path.startsWith("/chain/block/")) {
      return Promise.reject(new Error("not a block"));
    }
    if (path === "/chain/address") {
      return Promise.resolve({
        data: {
          success: true,
          transactions: [{ tx_id: "address-tx", status: "confirmed", sender_address: "VLQ_ADDRESS_SEARCH", receiver_address: "VLQ_B", amount: 7 }],
          total: 1,
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Blockchain />, "/blockchain");

  await screen.findByRole("heading", { level: 1, name: /vorliq blockchain/i });
  fireEvent.change(screen.getByLabelText(/search block, transaction, or wallet address/i), {
    target: { value: "VLQ_ADDRESS_SEARCH" },
  });
  await userEvent.click(screen.getByRole("button", { name: /search explorer/i }));

  expect(await screen.findByText(/1 public transaction match/i)).toBeInTheDocument();
  expect(screen.getByText(/address-tx/i).closest("a")).toHaveAttribute("href", "/tx/address-tx");
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
});

test("Blockchain page renders a loading state before public chain data resolves", () => {
  api.get.mockImplementation((path) => {
    if (["/chain/summary", "/chain/blocks", "/transactions", "/transactions/pending", "/health", "/leaderboard"].includes(path)) {
      return new Promise(() => {});
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Blockchain />, "/blockchain");

  expect(screen.getByRole("heading", { level: 1, name: /vorliq blockchain/i })).toBeInTheDocument();
  expect(screen.getByText(/loading blockchain explorer/i)).toBeInTheDocument();
});

test("Blockchain page handles unavailable public chain endpoints safely", async () => {
  api.get.mockImplementation((path) => {
    if (["/chain/summary", "/chain/blocks", "/transactions", "/transactions/pending", "/health", "/leaderboard"].includes(path)) {
      return Promise.reject(new Error("public endpoint unavailable"));
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Blockchain />, "/blockchain");

  expect(await screen.findByRole("heading", { level: 1, name: /vorliq blockchain/i })).toBeInTheDocument();
  expect(await screen.findByText(/Public holder count comes from the leaderboard endpoint/i)).toBeInTheDocument();
  expect(screen.getAllByText(/^Unavailable$/i).length).toBeGreaterThanOrEqual(3);
  expect(screen.getByText(/Block history is unavailable from the public API right now/i)).toBeInTheDocument();
  expect(screen.getByText(/Pending transaction data is unavailable from the public API right now/i)).toBeInTheDocument();
  expect(screen.getByText(/Confirmed transaction history is unavailable from the public API right now/i)).toBeInTheDocument();
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

test("Node sync page renders comparison filters and trusted chain", async () => {
  renderWithProviders(<NodeSync />, "/nodes/compare");

  expect(await screen.findByRole("heading", { name: /^node sync$/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /network sync overview/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /network monitor/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /trusted public chain/i })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /forked/i })).toBeInTheDocument();
  expect(await screen.findByText(/example node/i)).toBeInTheDocument();
  expect(await screen.findByText(/registered node heartbeat is stale/i)).toBeInTheDocument();
  expect(screen.getByText(/operator fix commands/i)).toBeInTheDocument();
});

test("Health page renders registry summary section", async () => {
  renderWithProviders(<Health />, "/health");

  expect(await screen.findByRole("heading", { name: /network registry health/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /^node sync$/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /network monitor/i })).toBeInTheDocument();
  expect(await screen.findByText(/average reliability/i)).toBeInTheDocument();
  expect(await screen.findByText(/98%/i)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /mining operations/i })).toBeInTheDocument();
  expect(await screen.findByText(/block production status/i)).toBeInTheDocument();
});

test("Health page renders Storage Health", async () => {
  renderWithProviders(<Health />, "/health");

  expect(await screen.findByRole("heading", { name: /storage health/i })).toBeInTheDocument();
  expect(await screen.findByText(/critical files ok/i)).toBeInTheDocument();
  expect(await screen.findByText(/backup available/i)).toBeInTheDocument();
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

test("Transparency page renders live software and self custody notices from the manifest flow", async () => {
  renderWithProviders(<Transparency />, "/transparency");

  expect(await screen.findByRole("heading", { name: /live community software/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /user-controlled keys/i })).toBeInTheDocument();
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

test("Health page renders Index Health section", async () => {
  api.get.mockImplementation(defaultApiGet);

  renderWithProviders(<Health />, "/health");

  expect(await screen.findByRole("heading", { name: /index health/i })).toBeInTheDocument();
  expect(await screen.findByText(/rebuild needed/i)).toBeInTheDocument();
  expect(screen.getByText(/chain match/i)).toBeInTheDocument();
});

test("Migration Readiness page renders current JSON storage preparation state", async () => {
  api.get.mockImplementation(defaultApiGet);

  renderWithProviders(<MigrationReadiness />, "/migration-readiness");

  expect(await screen.findByRole("heading", { name: /migration readiness/i })).toBeInTheDocument();
  expect(await screen.findByText(/future database target/i)).toBeInTheDocument();
  expect((await screen.findAllByText(/postgresql/i)).length).toBeGreaterThan(0);
  expect(await screen.findByText(/current production storage/i)).toBeInTheDocument();
  expect(await screen.findByText(/storage adapter interface/i)).toBeInTheDocument();
  expect(await screen.findByText(/active adapter/i)).toBeInTheDocument();
  expect(await screen.findByText(/available, disabled/i)).toBeInTheDocument();
  expect((await screen.findAllByText(/production postgresql writes/i)).length).toBeGreaterThan(0);
  expect(await screen.findByText(/shadow-only status/i)).toBeInTheDocument();
  expect((await screen.findAllByText(/postgresql active/i)).length).toBeGreaterThan(0);
  expect(await screen.findByText(/schema files present/i)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /shadow migration rehearsal/i })).toBeInTheDocument();
  expect((await screen.findAllByText(/ci enabled/i)).length).toBeGreaterThan(0);
  expect(await screen.findByText(/production postgresql active/i)).toBeInTheDocument();
  expect(await screen.findByText(/rollback required/i)).toBeInTheDocument();
  expect(await screen.findByText(/chain\.json/i)).toBeInTheDocument();
  expect(screen.getByText(/production storage is intentionally still hardened json/i)).toBeInTheDocument();
});

test("Health page renders Migration Readiness summary", async () => {
  api.get.mockImplementation(defaultApiGet);

  renderWithProviders(<Health />, "/health");

  expect(await screen.findByRole("heading", { name: /migration readiness/i })).toBeInTheDocument();
  expect(await screen.findByText(/future target/i)).toBeInTheDocument();
  expect(await screen.findByText(/schema files/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open migration readiness/i })).toHaveAttribute("href", "/migration-readiness");
});

test("Footer includes Storage Roadmap link", () => {
  render(<Footer />);

  expect(screen.getByRole("link", { name: /storage roadmap/i })).toHaveAttribute("href", "/migration-readiness");
});

test("Readiness page includes index checks", async () => {
  api.get.mockImplementation(defaultApiGet);

  renderWithProviders(<Readiness />, "/readiness");

  expect(await screen.findByRole("heading", { name: /readiness/i })).toBeInTheDocument();
  expect((await screen.findAllByText(/index health/i)).length).toBeGreaterThan(0);
  expect(await screen.findByText(/index rebuild needed/i)).toBeInTheDocument();
  expect(await screen.findByText(/index health is ok/i)).toBeInTheDocument();
  expect(await screen.findByText(/migration readiness metadata is available/i)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /network monitor/i })).toBeInTheDocument();
  expect(await screen.findByText(/preparation-only postgresql schema files are present/i)).toBeInTheDocument();
  expect(await screen.findByText(/postgresql is not active in production/i)).toBeInTheDocument();
});

test("Admin Indexes section stays protected and renders safe rebuild controls after token", async () => {
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
    if (path === "/admin/indexes") {
      return Promise.resolve({
        data: {
          success: true,
          index_health: {
            success: true,
            exists: true,
            valid: true,
            status: "ok",
            schema_version: 1,
            chain_height: 218,
            latest_block_hash: "0000hash",
            built_at: "2026-05-21T00:00:00Z",
            rebuild_needed: false,
            index_chain_match: true,
          },
          note: "Indexes are derived from chain.json.",
        },
      });
    }
    return defaultApiGet(path);
  });
  api.post.mockResolvedValueOnce({
    data: { success: true, status: "ok", rebuild_needed: false },
  });

  renderWithProviders(<Admin />, "/admin");

  expect(screen.getByRole("heading", { name: /admin access/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /indexes/i })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/admin token/i), { target: { value: "good-token" } });
  await userEvent.click(screen.getByRole("button", { name: /open operator dashboard/i }));
  await userEvent.click(await screen.findByRole("button", { name: /indexes/i }));

  expect(await screen.findByText(/indexes are derived from chain\.json/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /rebuild indexes/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /rebuild indexes/i }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith("/admin/indexes/rebuild", {}, expect.objectContaining({ headers: expect.any(Object) }));
  });
  expect(screen.queryByText("good-token")).not.toBeInTheDocument();
});

test("Admin Migration section stays protected and renders shadow rehearsal metadata after token", async () => {
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
    if (path === "/admin/migration/readiness") {
      return Promise.resolve({
        data: {
          success: true,
          storage_backend: "json",
          database_enabled: false,
          future_database_target: "postgresql",
          postgres_schema_present: true,
          postgres_active: false,
          postgres_shadow_rehearsal_available: true,
          postgres_shadow_ci_enabled: true,
          migration_phase: "preparation",
          migration_tools_available: true,
          migration_supported: "shadow_rehearsal_available",
          chain_source_of_truth: "chain.json",
          indexes_derived: true,
          latest_chain_height: 218,
          latest_block_hash: "0000hash",
          last_storage_health: { overall_status: "ok" },
          last_index_health: { status: "ok" },
          operator_metadata: {
            dry_run_tool: "tools/migration_dry_run.py",
            postgres_schema_check_tool: "tools/postgres_schema_check.py",
            import_simulation_tool: "tools/simulate_postgres_import.py",
            shadow_rehearsal_tool: "tools/run_shadow_migration_rehearsal.py",
            rollback_required: true,
          },
        },
      });
    }
    return defaultApiGet(path);
  });

  renderWithProviders(<Admin />, "/admin");

  expect(screen.getByRole("heading", { name: /admin access/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^migration$/i })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/admin token/i), { target: { value: "good-token" } });
  await userEvent.click(screen.getByRole("button", { name: /open operator dashboard/i }));
  await userEvent.click(await screen.findByRole("button", { name: /^migration$/i }));

  expect(await screen.findByText(/migration readiness is shadow rehearsal preparation only/i)).toBeInTheDocument();
  expect(await screen.findByText(/tools\/migration_dry_run.py/i)).toBeInTheDocument();
  expect(await screen.findByText(/tools\/run_shadow_migration_rehearsal.py/i)).toBeInTheDocument();
  expect(screen.queryByText("good-token")).not.toBeInTheDocument();
});
