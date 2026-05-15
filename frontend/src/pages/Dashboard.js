import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import logo from "../assets/logo.png";

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

function shortAddress(address) {
  if (!address) return "Unknown";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function Dashboard() {
  const [chainData, setChainData] = useState(null);
  const [economics, setEconomics] = useState(null);
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      try {
        const [chainResponse, economicsResponse, featuredResponse] = await Promise.all([
          api.get("/chain"),
          api.get("/economics"),
          api.get("/forum/featured"),
        ]);
        if (mounted) {
          setErrorMessage("");
          setChainData(chainResponse.data);
          setEconomics(economicsResponse.data);
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
    const chain = chainData?.chain || [];
    const transactions = chain.reduce((total, block) => total + (block.transactions?.length || 0), 0);

    return {
      blocks: chain.length,
      transactions,
      reward: economics?.current_mining_reward ?? chainData?.mining_reward ?? 50,
      blockHeight: economics?.current_block_height ?? Math.max(chain.length - 1, 0),
      totalIssued: economics?.total_issued ?? 0,
      valid: Boolean(chainData?.is_valid),
    };
  }, [chainData, economics]);

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">VLQ Community Chain</span>
        <h1>Welcome to Vorliq</h1>
        <p className="subtitle">
          Vorliq is a community savings bank running on its own blockchain, built for people
          who want to save, lend, and keep shared records together.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <Spinner label="Loading dashboard data..." />
      ) : (
        <section className="grid stats-grid">
          <div className="card card-pad stat-card">
            <span className="stat-label">Total Blocks</span>
            <span className="stat-value">{stats.blocks}</span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Total Transactions</span>
            <span className="stat-value">{stats.transactions}</span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Mining Reward</span>
            <span className="stat-value">{stats.reward} VLQ</span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Chain Status</span>
            <span className={`stat-value ${stats.valid ? "green" : "red"}`}>
              {stats.valid ? "Chain Valid" : "Chain Invalid"}
            </span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Current Block Height</span>
            <span className="stat-value">{stats.blockHeight}</span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Total VLQ Issued</span>
            <span className="stat-value">{stats.totalIssued} VLQ</span>
          </div>
        </section>
      )}

      {lastUpdated && (
        <p className="last-updated">Last updated {lastUpdated.toLocaleString()}</p>
      )}

      <section className="card card-pad quick-links-card">
        <div className="section-title">
          <div>
            <span className="eyebrow">Quick Access</span>
            <h2>Important Links</h2>
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

      <section className="card card-pad about-card">
        <img className="section-logo" src={logo} alt="Vorliq logo" />
        <span className="eyebrow">About Vorliq</span>
        <h2>About Vorliq</h2>
        <p>
          Vorliq is a self contained community savings bank that runs on its own blockchain,
          giving communities a shared place to save, lend, and track value together. VLQ is
          the native coin used inside the Vorliq network. Every VLQ transaction is signed with
          cryptographic keys and recorded by the chain after it is mined into a block.
        </p>
        <p>Deployed automatically via GitHub Actions.</p>
      </section>

      <section className="card card-pad featured-community-card">
        <div className="section-title">
          <div>
            <span className="eyebrow">Community Signal</span>
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
                <span>By {shortAddress(post.author_address)}</span>
                <span>{post.feature_vote_count || 0} feature votes</span>
                <Link className="text-button" to="/forum">Read More</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">No featured posts yet. Be the first to feature a great post.</div>
        )}
      </section>
    </main>
  );
}

export default Dashboard;
