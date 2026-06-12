import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import useReveal from "../helpers/useReveal";

const quickLinks = [
  { to: "/blockchain", label: "Blockchain", detail: "Inspect blocks and transactions" },
  { to: "/network", label: "Network", detail: "View public node and decentralization status" },
  { to: "/wallet", label: "Wallet", detail: "Create and check your VLQ wallet" },
  { to: "/faucet", label: "Faucet", detail: "Request starter VLQ from the treasury" },
  { to: "/send", label: "Send", detail: "Move VLQ to another member" },
  { to: "/mine", label: "Mine", detail: "Mine blocks and support the chain" },
  { to: "/treasury", label: "Treasury", detail: "Track public funding and payouts" },
  { to: "/lending", label: "Lending", detail: "Request or vote on community loans" },
  { to: "/exchange", label: "Community Requests", detail: "Coordinate peer requests" },
  { to: "/governance", label: "Governance", detail: "Review proposals and rule-change history" },
  { to: "/forum", label: "Forum", detail: "Post messages and reply to members" },
  { to: "/profiles", label: "Profiles", detail: "View public wallet-linked profiles" },
  { to: "/registry", label: "Registry", detail: "Find and connect to public nodes" },
  { to: "/health", label: "Health", detail: "Check readiness, node status, and deployment" },
  { to: "/readiness", label: "Readiness", detail: "Review production gate checks and warnings" },
];

const getStartedSteps = [
  {
    step: "Step 1",
    title: "Read the safety notice",
    body:
      "Vorliq is a community savings bank built on its own blockchain with the VLQ coin. Start by reading the transparency page and wallet safety guide so you understand private keys, backups, and live-network risk.",
    links: [
      { to: "/transparency", label: "Read Transparency" },
      { href: "https://vorliq.github.io/Vorliq/wallet-safety.html", label: "Wallet Safety" },
    ],
  },
  {
    step: "Step 2",
    title: "Create or import a wallet",
    body:
      "A wallet gives you a VLQ address. New users can create an encrypted browser wallet from Login, while advanced users can inspect raw keys on the Wallet page.",
    links: [
      { to: "/login", label: "Start Wallet Login" },
      { to: "/wallet", label: "Open Wallet Tools" },
    ],
  },
  {
    step: "Step 3",
    title: "Get your first VLQ",
    body:
      "Use the starter faucet if the community treasury is funded, or mine a block to support the chain and earn VLQ. Faucet payouts are real pending treasury transactions.",
    links: [
      { to: "/faucet", label: "Get Starter VLQ" },
      { to: "/mine", label: "Mine VLQ" },
    ],
  },
  {
    step: "Step 4",
    title: "Join the community",
    body:
      "Once you understand the basics, introduce yourself, chat with members, coordinate community requests, and vote on governance.",
    links: [
      { to: "/forum", label: "Forum" },
      { to: "/profiles", label: "Profiles" },
      { to: "/chat", label: "Chat" },
      { to: "/exchange", label: "Community Requests" },
      { to: "/governance", label: "Governance" },
    ],
  },
];

const dashboardRequests = [
  { key: "summary", label: "chain summary", request: () => api.get("/chain/summary") },
  { key: "featured", label: "featured posts", request: () => api.get("/forum/featured", { params: { limit: 3 } }) },
  { key: "lending", label: "lending summary", request: () => api.get("/lending/summary") },
  { key: "exchange", label: "community request summary", request: () => api.get("/exchange/summary") },
  { key: "governance", label: "governance summary", request: () => api.get("/governance/summary") },
  { key: "treasury", label: "treasury summary", request: () => api.get("/treasury/summary") },
  { key: "mining", label: "mining status", request: () => api.get("/mining/status") },
];

function displayValue(source, value, suffix = "") {
  if (!source || value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  return `${value}${suffix}`;
}

function statusValue(source, ok, readyLabel, reviewLabel = "Needs review") {
  if (!source || ok === null || ok === undefined) {
    return "Unavailable";
  }

  return ok ? readyLabel : reviewLabel;
}

function walletBalanceValue(balancePayload) {
  if (!balancePayload || balancePayload.balance === null || balancePayload.balance === undefined || balancePayload.balance === "") {
    return "Unavailable";
  }

  return `${balancePayload.balance} ${balancePayload.coin || "VLQ"}`;
}

function Dashboard() {
  const { clearLocalWallet, isLoggedIn, logout, wallet } = useAuth();
  const [summary, setSummary] = useState(null);
  const [lendingSummary, setLendingSummary] = useState(null);
  const [exchangeSummary, setExchangeSummary] = useState(null);
  const [governanceSummary, setGovernanceSummary] = useState(null);
  const [treasurySummary, setTreasurySummary] = useState(null);
  const [miningStatus, setMiningStatus] = useState(null);
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [resourceErrors, setResourceErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [walletSummary, setWalletSummary] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletErrors, setWalletErrors] = useState([]);
  const [clearWalletConfirmed, setClearWalletConfirmed] = useState(false);
  const getStartedRevealRef = useReveal();

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      const results = await Promise.all(
        dashboardRequests.map((resource) =>
          resource
            .request()
            .then((response) => ({ ...resource, ok: true, data: response.data }))
            .catch((error) => ({ ...resource, ok: false, error }))
        )
      );

      if (mounted) {
        const data = Object.fromEntries(results.filter((result) => result.ok).map((result) => [result.key, result.data]));
        const failures = results.filter((result) => !result.ok);
        const allFailed = failures.length === results.length;

        setSummary(data.summary?.summary || null);
        setLendingSummary(data.lending?.summary || null);
        setExchangeSummary(data.exchange?.summary || null);
        setGovernanceSummary(data.governance?.summary || null);
        setTreasurySummary(data.treasury?.summary || null);
        setMiningStatus(data.mining?.status || null);
        setFeaturedPosts((data.featured?.posts || []).slice(0, 3));
        setResourceErrors(
          failures.map((failure) => ({
            key: failure.key,
            label: failure.label,
            message: apiErrorMessage(failure.error, `${failure.label} is unavailable.`),
          }))
        );

        if (allFailed) {
          const message = "Dashboard data is unavailable right now.";
          setErrorMessage(message);
          toast.error(message);
        } else {
          setErrorMessage("");
          setLastUpdated(new Date());
        }
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadWalletDashboard() {
      if (!wallet?.address) {
        setWalletSummary(null);
        setWalletErrors([]);
        setWalletLoading(false);
        return;
      }

      setWalletLoading(true);
      const resources = [
        {
          key: "balance",
          label: "wallet balance",
          request: () => api.get("/wallet/balance", { params: { address: wallet.address } }),
        },
        {
          key: "activity",
          label: "wallet activity",
          request: () => api.get("/chain/address", { params: { address: wallet.address, limit: 8 } }),
        },
        {
          key: "faucet",
          label: "faucet claims",
          request: () => api.get("/faucet/claims", { params: { address: wallet.address } }),
        },
      ];

      const results = await Promise.all(
        resources.map((resource) =>
          resource
            .request()
            .then((response) => ({ ...resource, ok: true, data: response.data }))
            .catch((error) => ({ ...resource, ok: false, error }))
        )
      );

      if (!mounted) return;

      const data = Object.fromEntries(results.filter((result) => result.ok).map((result) => [result.key, result.data]));
      const failures = results.filter((result) => !result.ok);
      setWalletSummary({
        balance: data.balance || null,
        activity: data.activity || null,
        faucetClaims: data.faucet?.claims || [],
      });
      setWalletErrors(
        failures.map((failure) => ({
          key: failure.key,
          label: failure.label,
          message: apiErrorMessage(failure.error, `${failure.label} is unavailable.`),
        }))
      );
      setWalletLoading(false);
    }

    loadWalletDashboard();

    return () => {
      mounted = false;
    };
  }, [wallet?.address]);

  const stats = useMemo(() => {
    return {
      blocks: displayValue(summary, summary?.total_blocks),
      transactions: displayValue(summary, summary?.total_transactions),
      reward: displayValue(summary, summary?.current_mining_reward, " VLQ"),
      blockHeight: displayValue(summary, summary?.block_height),
      totalIssued: displayValue(summary, summary?.total_issued, " VLQ"),
      chainStatus: statusValue(summary, summary?.chain_valid, "Chain Valid"),
      chainStatusTone: summary?.chain_valid ? "green" : "gold",
      pendingVotes: displayValue(lendingSummary, lendingSummary?.pending_vote_count),
      activeLoans: displayValue(
        lendingSummary,
        (lendingSummary?.active_count ?? 0) + (lendingSummary?.overdue_count ?? 0) + (lendingSummary?.repayment_pending_count ?? 0)
      ),
      openOffers: displayValue(exchangeSummary, exchangeSummary?.open_count),
      activeTrades: displayValue(exchangeSummary, exchangeSummary?.active_trades_count),
      activeProposals: displayValue(governanceSummary, governanceSummary?.active_count),
      executedRuleChanges: displayValue(governanceSummary, governanceSummary?.executed_count),
      latestRuleChange: governanceSummary?.latest_executed_rule_change?.category,
      treasuryBalance: displayValue(treasurySummary, treasurySummary?.current_balance, " VLQ"),
      activeTreasury: displayValue(treasurySummary, treasurySummary?.active_proposal_count),
      pendingTreasuryPayouts: displayValue(treasurySummary, treasurySummary?.pending_payout_count),
      blockProduction: miningStatus
        ? statusValue(miningStatus, miningStatus.can_mine_now, "Ready", `${miningStatus.seconds_until_next_allowed_block ?? 0}s`)
        : "Unavailable",
      blockProductionTone: miningStatus?.can_mine_now ? "green" : "gold",
      treasuryPerBlock: displayValue(miningStatus, miningStatus?.treasury_reward_per_block, " VLQ"),
    };
  }, [exchangeSummary, governanceSummary, lendingSummary, miningStatus, summary, treasurySummary]);

  function lockSession() {
    logout();
    toast.info("Wallet session locked. The encrypted backup remains in this browser.");
  }

  function removeLocalWallet() {
    if (!clearWalletConfirmed) {
      toast.error("Confirm that you want to remove the encrypted wallet backup from this browser.");
      return;
    }
    clearLocalWallet();
    setClearWalletConfirmed(false);
    toast.success("Encrypted wallet backup removed from this browser.");
  }

  return (
    <div className="page">
      <section className="hero dashboard-brand-hero glass-section">
        <span className="section-eyebrow brand-pill">Live Network Console</span>
        <h1>Vorliq Dashboard</h1>
        <p className="subtitle">
          Vorliq is a community savings bank built on its own blockchain with the VLQ coin,
          bringing wallets, mining, lending, community coordination, governance, and transparent public records
          into one network.
        </p>
        <div className="hero-actions">
          <Link className="button brand-button" to="/login">Create Wallet</Link>
          <Link className="button secondary brand-button-secondary" to="/faucet">Get Starter VLQ</Link>
          <Link className="button secondary brand-button-secondary" to="/vlq">Understand VLQ</Link>
          <Link className="button secondary brand-button-secondary" to="/mine">Mine VLQ</Link>
          <Link className="button secondary brand-button-secondary" to="/forum">Explore Forum</Link>
          <Link className="button secondary brand-button-secondary" to="/transparency">View Transparency</Link>
        </div>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="glass-section account-dashboard-card elev-2" aria-labelledby="wallet-dashboard-title">
        <div className="section-title">
          <div>
            <span className="section-eyebrow">Wallet Setup</span>
            <h2 id="wallet-dashboard-title">{isLoggedIn ? "Your Wallet Dashboard" : "Start With A Vorliq Wallet"}</h2>
          </div>
          {isLoggedIn ? (
            <div className="button-row">
              <button className="button secondary small-button" type="button" onClick={lockSession}>
                Lock Session
              </button>
              <Link className="button secondary small-button" to="/account">
                Wallet Safety
              </Link>
            </div>
          ) : (
            <Link className="button small-button" to="/register">
              Create Wallet
            </Link>
          )}
        </div>

        {isLoggedIn && wallet?.address ? (
          <div className="grid account-aware-grid">
            <div className="card card-pad glass-card wallet-overview-card">
              <span className="stat-label">Wallet Address</span>
              <span className="value-box mono-wrap">{wallet.address}</span>
              <div className="button-row">
                <Link className="button secondary small-button" to={`/faucet?address=${encodeURIComponent(wallet.address)}`}>
                  Get Starter VLQ
                </Link>
                <Link className="button secondary small-button" to="/send">
                  Send VLQ
                </Link>
                <Link className="button secondary small-button" to="/blockchain">
                  Explorer
                </Link>
                <Link className="button secondary small-button" to="/vlq">
                  VLQ Overview
                </Link>
              </div>
            </div>

            <div className="card card-pad glass-card wallet-overview-card">
              <span className="stat-label">Confirmed Balance</span>
              <span className="stat-value">
                {walletLoading
                  ? "Loading..."
                  : walletBalanceValue(walletSummary?.balance)}
              </span>
              <p className="help-text">Loaded from the existing public balance endpoint. No private key is sent.</p>
            </div>

            <div className="card card-pad glass-card wallet-overview-card">
              <span className="stat-label">Recent Wallet Activity</span>
              {walletLoading ? (
                <Spinner label="Loading wallet activity..." />
              ) : walletSummary?.activity?.transactions?.length ? (
                <div className="history-list compact-history-list">
                  {walletSummary.activity.transactions.slice(0, 4).map((transaction, index) => (
                    <WalletActivityRow transaction={transaction} walletAddress={wallet.address} key={`${transaction.tx_id || transaction.block_index}-${index}`} />
                  ))}
                </div>
              ) : walletErrors.some((error) => error.key === "activity") ? (
                <div className="empty-state">Wallet activity is unavailable from the public address endpoint right now.</div>
              ) : (
                <div className="empty-state">No public wallet activity found yet.</div>
              )}
            </div>

            <div className="card card-pad glass-card wallet-overview-card">
              <span className="stat-label">Faucet Claims</span>
              {walletLoading ? (
                <Spinner label="Loading faucet claims..." />
              ) : walletSummary?.faucetClaims?.length ? (
                <div className="history-list compact-history-list">
                  {walletSummary.faucetClaims.slice(0, 3).map((claim) => (
                    <div className="history-row" key={claim.claim_id}>
                      <span className={`status-badge ${claim.status}`}>{claim.status}</span>
                      <span>{claim.amount} VLQ</span>
                      {claim.tx_id ? <Link to={`/tx/${claim.tx_id}`}>View Tx</Link> : <span>{claim.reason || "No transaction yet"}</span>}
                    </div>
                  ))}
                </div>
              ) : walletErrors.some((error) => error.key === "faucet") ? (
                <div className="empty-state">Faucet claim history is unavailable right now.</div>
              ) : (
                <div className="empty-state">No faucet claims found for this wallet.</div>
              )}
            </div>

            <div className="card card-pad glass-card wallet-overview-card">
              <span className="stat-label">Local Wallet Controls</span>
              <p className="help-text">
                Locking clears only the current session. Removing local wallet data deletes the encrypted wallet backup from this browser.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={clearWalletConfirmed}
                  onChange={(event) => setClearWalletConfirmed(event.target.checked)}
                />
                <span>I understand this removes the encrypted wallet backup from this browser.</span>
              </label>
              <button className="button secondary small-button" type="button" disabled={!clearWalletConfirmed} onClick={removeLocalWallet}>
                Clear Local Wallet
              </button>
            </div>

            {walletErrors.length > 0 && (
              <div className="empty-state" role="status">
                Some wallet dashboard data is unavailable right now: {walletErrors.map((error) => error.label).join(", ")}.
              </div>
            )}
          </div>
        ) : (
          <div className="get-started-grid">
            <article className="get-started-step">
              <span className="step-pill">Wallet</span>
              <h3>Create or import safely</h3>
              <p>
                Create an encrypted browser wallet or import an existing encrypted Vorliq backup. Private keys stay local and are never sent to the backend.
              </p>
              <div className="button-row">
                <Link className="button small-button" to="/register">
                  Create Wallet
                </Link>
                <Link className="button secondary small-button" to="/login">
                  Import Existing Wallet
                </Link>
              </div>
            </article>
            <article className="get-started-step">
              <span className="step-pill">Safety</span>
              <h3>Back up before funding</h3>
              <p>
                Save your encrypted backup and password before requesting starter VLQ or sending funds. Vorliq cannot recover a lost private key.
              </p>
              <div className="button-row">
                <Link className="button secondary small-button" to="/transparency">
                  Learn Safety
                </Link>
              </div>
            </article>
          </div>
        )}
      </section>

      <section className="card card-pad glass-section get-started-card reveal-up" aria-labelledby="get-started-title" ref={getStartedRevealRef}>
        <div className="section-title">
          <div>
            <span className="section-eyebrow">First time here?</span>
            <h2 id="get-started-title">Get Started With Vorliq</h2>
          </div>
        </div>
        <div className="get-started-grid">
          {getStartedSteps.map((item) => (
            <article className="get-started-step" key={item.step}>
              <span className="step-pill">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <div className="button-row">
                {item.links.map((link) =>
                  link.to ? (
                    <Link className="button small-button" to={link.to} key={link.label}>
                      {link.label}
                    </Link>
                  ) : (
                    <a className="button secondary small-button" href={link.href} target="_blank" rel="noreferrer" key={link.label}>
                      {link.label}
                    </a>
                  )
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {loading ? (
        <Spinner label="Loading dashboard data..." />
      ) : (
        <section className="dashboard-section" aria-labelledby="network-summary-title">
          <div className="section-heading">
            <span className="section-eyebrow">Network Summary</span>
            <h2 id="network-summary-title">Live Chain Snapshot</h2>
          </div>
          <div className="grid stats-grid">
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Total Blocks</span>
              <span className="stat-value">{stats.blocks}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Total Transactions</span>
              <span className="stat-value">{stats.transactions}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Mining Reward</span>
              <span className="stat-value">{stats.reward}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Chain Status</span>
              <span className={`stat-value ${stats.chainStatusTone}`}>{stats.chainStatus}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Current Block Height</span>
              <span className="stat-value">{stats.blockHeight}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Total VLQ Issued</span>
              <span className="stat-value">{stats.totalIssued}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Pending Loan Votes</span>
              <span className="stat-value">{stats.pendingVotes}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Active Loans</span>
              <span className="stat-value">{stats.activeLoans}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Open Community Requests</span>
              <span className="stat-value">{stats.openOffers}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Active Coordinations</span>
              <span className="stat-value">{stats.activeTrades}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Active Governance</span>
              <span className="stat-value">{stats.activeProposals}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Rule Changes</span>
              <span className="stat-value">{stats.executedRuleChanges}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Latest Rule</span>
              <span className="stat-value">{stats.latestRuleChange || "None"}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Treasury Balance</span>
              <span className="stat-value">{stats.treasuryBalance}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Treasury Proposals</span>
              <span className="stat-value">{stats.activeTreasury}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Pending Payouts</span>
              <span className="stat-value">{stats.pendingTreasuryPayouts}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Block Production</span>
              <span className={`stat-value ${stats.blockProductionTone}`}>{stats.blockProduction}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Treasury Per Block</span>
              <span className="stat-value">{stats.treasuryPerBlock}</span>
            </div>
          </div>
          {resourceErrors.length > 0 && (
            <div className="empty-state" role="status">
              Some dashboard data is unavailable right now: {resourceErrors.map((error) => error.label).join(", ")}.
            </div>
          )}
        </section>
      )}

      {lastUpdated && (
        <p className="last-updated">Last updated {lastUpdated.toLocaleString()}</p>
      )}

      <section className="card card-pad glass-section quick-links-card">
        <div className="section-title">
          <div>
            <span className="section-eyebrow">Quick Access</span>
            <h2>Network Tools</h2>
          </div>
        </div>
        <div className="quick-link-grid">
          {quickLinks.map((link) => (
            <Link className="quick-link" to={link.to} key={link.to}>
              <strong>{link.label}</strong>
              <span>{link.detail}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card card-pad glass-section featured-community-card">
        <div className="section-title">
          <div>
            <span className="section-eyebrow">Community Signal</span>
            <h2>Featured Community Posts</h2>
          </div>
        </div>
        {featuredPosts.length ? (
          <div className="featured-post-grid">
            {featuredPosts.map((post) => (
              <article className="featured-post-card" key={post.post_id}>
                <strong>
                  <span className="featured-star" aria-label="Featured post">&#9733;</span>
                  {post.title}
                </strong>
                <span>By <AddressIdentity address={post.author_address} compact /></span>
                <span>{post.feature_vote_count || 0} feature votes</span>
                <Link className="text-button" to="/forum">Read More</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">No featured posts yet. Be the first to feature a great post.</div>
        )}
      </section>

    </div>
  );
}

function WalletActivityRow({ transaction, walletAddress }) {
  const sent = transaction.sender_address === walletAddress;
  const txId = transaction.tx_id;
  const otherParty = sent ? transaction.receiver_address : transaction.sender_address;
  const status = transaction.status || "confirmed";

  return (
    <div className="history-row">
      <span className={`status-badge ${status}`}>{status}</span>
      <span className={`direction ${sent ? "sent" : "received"}`}>{sent ? "Sent" : "Received"}</span>
      <span className="mono-wrap">{otherParty || "Unknown address"}</span>
      <span>{transaction.amount} VLQ</span>
      {txId ? <Link to={`/tx/${txId}`}>View Tx</Link> : <span>No transaction ID</span>}
    </div>
  );
}

export default Dashboard;
