import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import SocialLinks from "../components/SocialLinks";
import { formatVlq, loadPublicChainSnapshot, shortHash } from "../helpers/publicApi";

const trustFacts = [
  "100% Vorliq Chain",
  "No External Blockchains",
  "VLQ Community Coin",
  "Open Source",
];

const steps = [
  {
    number: "01",
    title: "Create a Community.",
    body: "Set up a savings group and invite trusted members.",
  },
  {
    number: "02",
    title: "Save and Lend Together.",
    body: "Pool VLQ savings and vote on lending decisions.",
  },
  {
    number: "03",
    title: "Track It On Chain.",
    body: "Every accepted transaction is recorded on Vorliq's own blockchain.",
  },
];

const features = [
  {
    title: "Everyone Saves. Everyone Benefits.",
    copy:
      "Pool VLQ together as a community. Track deposits, withdrawals, and movement in real time on the Vorliq blockchain. No hidden platform claims. No middlemen.",
    cta: "Start Saving",
    to: "/register",
  },
  {
    title: "Lend to People You Trust.",
    copy:
      "Community members can propose and vote on loans. Lending activity is recorded on chain so decisions stay transparent and traceable.",
    cta: "Learn About Lending",
    to: "/features",
  },
  {
    title: "Native VLQ. Built for Vorliq.",
    copy:
      "VLQ runs on Vorliq's own lightweight blockchain. Wallets, blocks, and transactions are internal to this platform, with no external validators or gas fees.",
    cta: "Explore the Chain",
    to: "/blockchain",
  },
];

const communityCards = [
  { title: "Transparent", body: "Shared records are visible on Vorliq's own chain so members can inspect activity." },
  { title: "Trustless", body: "Rules are enforced by signed transactions and blockchain validation, not private spreadsheets." },
  { title: "Together", body: "Savings and lending decisions stay close to the people who understand the community." },
];

const guides = [
  {
    title: "What is VLQ?",
    body: "A plain-English guide to Vorliq's internal community coin.",
    to: "/features",
  },
  {
    title: "How Does the Vorliq Blockchain Work?",
    body: "Blocks, transactions, mining, and public records without third party chains.",
    to: "/blockchain",
  },
  {
    title: "How to Start a Community Savings Group",
    body: "A responsible first step for groups saving and lending together.",
    to: "/features",
  },
];

function chainStatusBadge(loading, snapshot) {
  if (loading) return { className: "status-badge active", label: "Connecting..." };
  if (!snapshot || snapshot.unavailable.summary) {
    return { className: "status-badge expired", label: "Chain data unavailable" };
  }
  return snapshot.summary?.chain_valid
    ? { className: "status-badge executed", label: "Chain online" }
    : { className: "status-badge rejected", label: "Chain under review" };
}

function Home() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadPublicChainSnapshot()
      .then((data) => {
        if (!mounted) return;
        setSnapshot(data);
        setUnavailable(
          data.unavailable.summary &&
            data.unavailable.blocks &&
            data.unavailable.confirmedTransactions &&
            data.unavailable.pendingTransactions
        );
      })
      .catch(() => {
        if (mounted) {
          setSnapshot(null);
          setUnavailable(true);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="page">
      <Hero loading={loading} snapshot={snapshot} />
      <TrustFacts />
      <HowItWorks />
      <Features />
      <LiveSnapshot loading={loading} snapshot={snapshot} unavailable={unavailable} />
      <Community />
      <Learn />
      <FinalCta />
    </div>
  );
}

function Hero({ loading, snapshot }) {
  return (
    <section className="hero two-column" aria-label="Vorliq introduction">
      <div className="stack">
        <span className="eyebrow">Community Savings Bank</span>
        <h1>Your Community's Platform. Your Rules.</h1>
        <p className="subtitle">
          Vorliq is a community savings and lending platform built on its own lightweight blockchain.
        </p>
        <div className="button-row">
          <Link className="button" to="/register">
            Create Your Account
          </Link>
          <a className="button secondary" href="#how-it-works">
            See How It Works
          </a>
        </div>
        <p className="help-text">Community-run software. VLQ powered. No third party chains.</p>
      </div>
      <HeroChainPanel loading={loading} snapshot={snapshot} />
    </section>
  );
}

function HeroChainPanel({ loading, snapshot }) {
  const summary = snapshot?.summary || {};
  const badge = chainStatusBadge(loading, snapshot);
  const latestBlock = snapshot?.blocks?.[0];

  const rows = [
    {
      label: "Latest accepted block",
      value: loading
        ? "Loading..."
        : latestBlock?.index != null
          ? `#${latestBlock.index}`
          : summary.block_height != null
            ? `#${summary.block_height}`
            : "Unavailable",
    },
    {
      label: "Public transactions",
      value: loading ? "Loading..." : summary.total_transactions ?? "Unavailable",
    },
    {
      label: "Total VLQ issued",
      value: loading ? "Loading..." : snapshot?.unavailable.summary ? "Unavailable" : formatVlq(summary.total_issued),
    },
    {
      label: "Wallet holders",
      value: loading
        ? "Loading..."
        : snapshot?.unavailable.holders
          ? "Unavailable"
          : snapshot?.holderTotal ?? "Unavailable",
    },
  ];

  return (
    <article className="card card-pad stack" aria-label="Live chain panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">Vorliq Chain</span>
          <h2>Community Pool</h2>
        </div>
        <span className={badge.className} role="status">
          {badge.label}
        </span>
      </div>
      <div className="stack">
        {rows.map((row) => (
          <div className="meta-item" key={row.label}>
            <span className="meta-label">{row.label}</span>
            <span className="meta-value mono-wrap">{row.value}</span>
          </div>
        ))}
      </div>
      <p className="muted-text">
        Values come from public Vorliq APIs. When a value is not available it is shown as unavailable, never estimated.
      </p>
    </article>
  );
}

function TrustFacts() {
  return (
    <section className="grid stats-grid" aria-label="Vorliq product facts">
      {trustFacts.map((fact) => (
        <div className="card card-pad stat-card compact-stat" key={fact}>
          <span className="stat-value">{fact}</span>
        </div>
      ))}
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="card card-pad stack" id="how-it-works" aria-label="How Vorliq works">
      <div className="section-title">
        <div>
          <span className="eyebrow">How It Works</span>
          <h2>Savings and Lending That Work for Your Community</h2>
        </div>
      </div>
      <div className="lifecycle-grid">
        {steps.map((step) => (
          <article className="lifecycle-step" key={step.title}>
            <span className="eyebrow">{step.number}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="stack" id="features" aria-label="What you can do on Vorliq">
      {features.map((feature) => (
        <article className="card card-pad stack" key={feature.title}>
          <div className="section-title">
            <div>
              <span className="eyebrow">Vorliq Feature</span>
              <h2>{feature.title}</h2>
            </div>
          </div>
          <p className="subtitle">{feature.copy}</p>
          <div className="button-row">
            <Link className="button secondary small-button" to={feature.to}>
              {feature.cta}
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}

function LiveSnapshot({ loading, snapshot, unavailable }) {
  const transactions = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.confirmedTransactions, ...snapshot.pendingTransactions].slice(0, 6);
  }, [snapshot]);

  const summary = snapshot?.summary || {};
  const statCards = [
    {
      label: "Wallet Holders",
      value: snapshot?.unavailable.holders ? "Unavailable" : snapshot?.holderTotal ?? "Unavailable",
    },
    { label: "Total Blocks", value: snapshot?.unavailable.summary ? "Unavailable" : summary.total_blocks ?? "Unavailable" },
    {
      label: "Total Transactions",
      value: snapshot?.unavailable.summary ? "Unavailable" : summary.total_transactions ?? "Unavailable",
    },
    {
      label: "Pending Transactions",
      value:
        snapshot?.unavailable.pendingTransactions || snapshot?.pendingTotal == null
          ? "Unavailable"
          : snapshot.pendingTotal,
    },
    {
      label: "Chain Status",
      value: snapshot?.unavailable.summary ? "Unavailable" : summary.chain_valid ? "Valid" : "Needs review",
    },
  ];

  return (
    <section className="card card-pad stack" id="live-chain" aria-label="Live chain snapshot">
      <div className="section-title">
        <div>
          <span className="eyebrow">Live Data</span>
          <h2>Live VLQ and Chain Snapshot</h2>
        </div>
        <Link className="button secondary small-button" to="/blockchain">
          Open Explorer
        </Link>
      </div>
      <p className="muted-text">
        This panel uses existing public backend APIs. When a value is not exposed by an API, it stays unavailable
        instead of being estimated.
      </p>
      <p className="help-text" role="status">
        {loading && "Loading live chain data..."}
        {!loading && unavailable && "Live chain data is unavailable right now."}
        {!loading && !unavailable && "Live public API data loaded."}
      </p>
      <div className="grid stats-grid">
        {statCards.map((stat) => (
          <div className="card card-pad stat-card compact-stat" key={stat.label}>
            <span className="stat-label">{stat.label}</span>
            <span className="stat-value mono-wrap">{loading ? "Loading..." : stat.value}</span>
          </div>
        ))}
      </div>
      <div className="section-title">
        <div>
          <span className="eyebrow">Recent</span>
          <h3>Recent On-Chain Transactions</h3>
        </div>
      </div>
      {loading ? (
        <div className="empty-state">Loading recent transactions...</div>
      ) : transactions.length ? (
        <div className="governance-grid">
          {transactions.map((tx, index) => (
            <Link
              className="lifecycle-step home-transaction-link"
              to={`/tx/${encodeURIComponent(tx.tx_id)}`}
              key={tx.tx_id || index}
            >
              <span className={`status-badge ${tx.status === "pending" ? "active" : "executed"}`}>
                {tx.status || "confirmed"}
              </span>
              <span className="meta-value mono-wrap">{shortHash(tx.tx_id)}</span>
              <span className="muted-text">{formatVlq(tx.amount)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">Recent transaction data is unavailable or empty.</div>
      )}
    </section>
  );
}

function Community() {
  return (
    <section className="card card-pad stack" id="community" aria-label="Community principles">
      <div className="section-title">
        <div>
          <span className="eyebrow">Community</span>
          <h2>Built for Communities. Run by Communities.</h2>
        </div>
      </div>
      <p className="subtitle">Vorliq is open source. It belongs to the people who use it.</p>
      <div className="lifecycle-grid">
        {communityCards.map((card) => (
          <article className="lifecycle-step" key={card.title}>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </article>
        ))}
      </div>
      <SocialLinks />
    </section>
  );
}

function Learn() {
  return (
    <section className="card card-pad stack" id="learn" aria-label="Learning guides">
      <div className="section-title">
        <div>
          <span className="eyebrow">Learn</span>
          <h2>New to Community Savings on the Blockchain?</h2>
        </div>
      </div>
      <div className="lifecycle-grid">
        {guides.map((guide) => (
          <article className="lifecycle-step" key={guide.title}>
            <h3>{guide.title}</h3>
            <p>{guide.body}</p>
            <Link className="button secondary small-button" to={guide.to}>
              Read More
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="card card-pad stack" aria-label="Get started">
      <div className="section-title">
        <div>
          <span className="eyebrow">Get Started</span>
          <h2>Ready to Build with Your Community?</h2>
        </div>
      </div>
      <p className="subtitle">Join Vorliq. Save together, lend together, and own the shared record together.</p>
      <div className="button-row">
        <Link className="button" to="/register">
          Create Account
        </Link>
        <a
          className="button secondary"
          href="https://github.com/vorliq/Vorliq"
          rel="noopener noreferrer"
          target="_blank"
        >
          View on GitHub
        </a>
      </div>
    </section>
  );
}

export default Home;
