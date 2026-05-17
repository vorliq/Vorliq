import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const quickLinks = [
  { to: "/wallet", label: "Wallet", detail: "Create and check your VLQ wallet" },
  { to: "/send", label: "Send", detail: "Move VLQ to another member" },
  { to: "/mine", label: "Mine", detail: "Mine blocks and support the chain" },
  { to: "/lending", label: "Lending", detail: "Request or vote on community loans" },
  { to: "/exchange", label: "Exchange", detail: "Post buy and sell offers" },
  { to: "/governance", label: "Governance", detail: "Vote on network changes" },
  { to: "/forum", label: "Forum", detail: "Post messages and reply to members" },
  { to: "/registry", label: "Registry", detail: "Find and connect to public nodes" },
  { to: "/health", label: "Health", detail: "Check node status and deployment" },
];

const getStartedSteps = [
  {
    step: "Step 1",
    title: "Read the safety notice",
    body:
      "Vorliq is experimental self-custody software. Start by reading the transparency page and wallet safety guide so you understand private keys, backups, and live-network risk.",
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
      "Mine a block to support the chain and earn VLQ. Vorliq has a cooldown, so you may need to wait before mining again.",
    links: [{ to: "/mine", label: "Mine VLQ" }],
  },
  {
    step: "Step 4",
    title: "Join the community",
    body:
      "Once you understand the basics, introduce yourself, chat with members, trade offers, and vote on community governance.",
    links: [
      { to: "/forum", label: "Forum" },
      { to: "/chat", label: "Chat" },
      { to: "/exchange", label: "Exchange" },
      { to: "/governance", label: "Governance" },
    ],
  },
];

function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [lendingSummary, setLendingSummary] = useState(null);
  const [exchangeSummary, setExchangeSummary] = useState(null);
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      try {
        const [summaryResponse, featuredResponse, lendingResponse, exchangeResponse] = await Promise.all([
          api.get("/chain/summary"),
          api.get("/forum/featured", { params: { limit: 3 } }),
          api.get("/lending/summary"),
          api.get("/exchange/summary"),
        ]);
        if (mounted) {
          setErrorMessage("");
          setSummary(summaryResponse.data.summary || {});
          setLendingSummary(lendingResponse.data.summary || {});
          setExchangeSummary(exchangeResponse.data.summary || {});
          setFeaturedPosts((featuredResponse.data.posts || []).slice(0, 3));
          setLastUpdated(new Date());
        }
      } catch (error) {
        const message = apiErrorMessage(error, "Unable to load blockchain dashboard.");
        setErrorMessage(message);
        toast.error(message);
      } finally {
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

  const stats = useMemo(() => {
    return {
      blocks: summary?.total_blocks ?? 0,
      transactions: summary?.total_transactions ?? 0,
      reward: summary?.current_mining_reward ?? 50,
      blockHeight: summary?.block_height ?? 0,
      totalIssued: summary?.total_issued ?? 0,
      valid: Boolean(summary?.chain_valid),
      pendingVotes: lendingSummary?.pending_vote_count ?? 0,
      activeLoans: (lendingSummary?.active_count ?? 0) + (lendingSummary?.overdue_count ?? 0) + (lendingSummary?.repayment_pending_count ?? 0),
      openOffers: exchangeSummary?.open_count ?? 0,
      activeTrades: exchangeSummary?.active_trades_count ?? 0,
    };
  }, [exchangeSummary, lendingSummary, summary]);

  return (
    <div className="page">
      <section className="hero dashboard-brand-hero glass-section">
        <span className="section-eyebrow brand-pill">Live Network Console</span>
        <h1>Vorliq Dashboard</h1>
        <p className="subtitle">
          Vorliq is experimental open-source community blockchain software for wallets, mining,
          lending, exchange, governance, and transparent public records.
        </p>
        <div className="hero-actions">
          <Link className="button brand-button" to="/login">Create Wallet</Link>
          <Link className="button secondary brand-button-secondary" to="/mine">Mine VLQ</Link>
          <Link className="button secondary brand-button-secondary" to="/forum">Explore Forum</Link>
          <Link className="button secondary brand-button-secondary" to="/transparency">View Transparency</Link>
        </div>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad glass-section get-started-card" aria-labelledby="get-started-title">
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
              <span className="stat-value">{stats.reward} VLQ</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Chain Status</span>
              <span className={`stat-value ${stats.valid ? "green" : "red"}`}>
                {stats.valid ? "Chain Valid" : "Chain Invalid"}
              </span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Current Block Height</span>
              <span className="stat-value">{stats.blockHeight}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Total VLQ Issued</span>
              <span className="stat-value">{stats.totalIssued} VLQ</span>
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
              <span className="stat-label">Open Exchange Offers</span>
              <span className="stat-value">{stats.openOffers}</span>
            </div>
            <div className="card card-pad glass-card stat-card">
              <span className="stat-label">Active Trades</span>
              <span className="stat-value">{stats.activeTrades}</span>
            </div>
          </div>
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

      <section className="card card-pad glass-section community-links-card">
        <div className="section-title">
          <div>
            <span className="section-eyebrow">Community</span>
            <h2>Join the Conversation</h2>
          </div>
        </div>
        <p>
          Follow official Vorliq channels for project updates, support discussions, network
          announcements, and community feedback.
        </p>
        <div className="button-row">
          <Link className="button secondary brand-button-secondary" to="/forum">Open Forum</Link>
          <Link className="button secondary brand-button-secondary" to="/chat">Open Chat</Link>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
