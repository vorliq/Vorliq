import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import BrandLoader from "../components/BrandLoader";
import HeroScene from "../components/home/HeroScene";
import {
  ExplorerPreviewVisual,
  GovernanceProposalVisual,
  NetworkHealthVisual,
  RecentTransactionsVisual,
  SavingsPoolVisual,
  WalletDashboardVisual,
} from "../components/home/ProductVisuals";
import { formatNumber, loadNetworkStatus, loadPublicChainSnapshot, shortHash } from "../helpers/publicApi";
import useReveal from "../helpers/useReveal";

function Icon({ paths, viewBox = "0 0 24 24" }) {
  return (
    <svg viewBox={viewBox} className="vq-step-icon" aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

const steps = [
  {
    number: "01",
    title: "Create your wallet",
    body: "Set up a Vorliq wallet in your browser. Your keys stay with you, encrypted on your own device.",
    icon: ["M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M16 12h3", "M3 9h13"],
  },
  {
    number: "02",
    title: "Join or start community saving activity",
    body: "Pool VLQ with people you trust, set shared goals, and keep every contribution visible to the group.",
    icon: ["M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M21 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  },
  {
    number: "03",
    title: "Move and track VLQ on chain",
    body: "Send and receive VLQ with signed transactions. Each accepted transfer is written to the Vorliq blockchain.",
    icon: ["M4 12h16", "M14 6l6 6-6 6", "M10 18l-6-6 6-6"],
  },
  {
    number: "04",
    title: "Verify records through the explorer",
    body: "Open the public explorer to confirm blocks, balances, and history for yourself at any time.",
    icon: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  },
];

const safetyItems = [
  {
    title: "You hold your keys",
    body: "Vorliq wallets are created and encrypted on your device. Your private key is your responsibility and is never sent to a server.",
    icon: ["M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z", "M9 12l2 2 4-4"],
  },
  {
    title: "Public verification",
    body: "Every block and transaction is openly readable. Anyone can check the chain through the explorer instead of trusting a private record.",
    icon: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  },
  {
    title: "Readiness checks",
    body: "A technical readiness gate reports on storage, indexes, backups, and node status. It is a health signal, not a legal status.",
    icon: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  },
  {
    title: "Open source",
    body: "The Vorliq code is open for review on GitHub. You can read how wallets, blocks, and validation actually work.",
    icon: ["M16 18l6-6-6-6", "M8 6l-6 6 6 6", "M14 4l-4 16"],
  },
  {
    title: "Honest about VLQ risk",
    body: "VLQ is a community coin with no guaranteed market value. Vorliq is community software, not a licensed banking service or a promise of profit.",
    icon: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  },
];

const learnCards = [
  {
    title: "What is VLQ",
    body: "A plain explanation of the native Vorliq coin and how it moves between wallets.",
    to: "/vlq",
  },
  {
    title: "How Vorliq's blockchain works",
    body: "Blocks, transactions, validation, and the public record that holds it all together.",
    to: "/blockchain",
  },
  {
    title: "Wallet safety",
    body: "How keys, passwords, and encrypted backups keep your wallet under your control.",
    to: "/transparency",
  },
  {
    title: "Community savings",
    body: "How groups organise shared saving activity with VLQ and a common chain record.",
    to: "/features",
  },
  {
    title: "Running a node",
    body: "What it takes to run a Vorliq node and help verify the network.",
    to: "/registry",
  },
  {
    title: "Transparency",
    body: "Where to read the chain, the readiness signal, and the public project records.",
    to: "/transparency",
  },
];

function Home() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadPublicChainSnapshot()
      .then((data) => {
        if (mounted) setSnapshot(data);
      })
      .catch(() => {
        if (mounted) setSnapshot(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    // Readiness and deployment are slower, so they load on their own and update
    // their cards when ready without holding back the core chain data.
    loadNetworkStatus()
      .then((data) => {
        if (mounted) setStatus(data);
      })
      .catch(() => {
        if (mounted) setStatus(null);
      })
      .finally(() => {
        if (mounted) setStatusLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="page vq-home">
      <Hero snapshot={snapshot} loading={loading} />
      <LiveNetwork snapshot={snapshot} loading={loading} status={status} statusLoading={statusLoading} />
      <ProductShowcase snapshot={snapshot} loading={loading} status={status} statusLoading={statusLoading} />
      <HowItWorks />
      <ExplorerSection snapshot={snapshot} loading={loading} />
      <CommunitySavings />
      <Safety />
      <Learn />
      <FinalCta />
    </div>
  );
}

function Hero({ snapshot, loading }) {
  return (
    <section className="vq-hero" aria-label="Vorliq introduction">
      <div className="vq-hero__copy">
        <span className="eyebrow">Community savings bank</span>
        <h1>Your Community's Bank. Your Rules.</h1>
        <p className="subtitle">
          Create a wallet, save together, move VLQ, vote on community activity, and verify your community's blockchain
          activity in real time.
        </p>
        <div className="button-row">
          <Link className="button" to="/register">
            Create Your Account
          </Link>
          <Link className="button secondary" to="/blockchain">
            Explore the Blockchain
          </Link>
        </div>
        <p className="help-text">
          Vorliq is a community savings bank built on its own blockchain with the VLQ coin.
        </p>
      </div>
      <div className="vq-hero__scene">
        <HeroScene snapshot={snapshot} loading={loading} />
      </div>
    </section>
  );
}

function deploymentLabel(status, statusLoading) {
  if (statusLoading) return "Checking";
  const deployment = status?.deployment;
  if (!deployment || status?.unavailable?.deployment) return "Unavailable";
  return deployment.commit_hash ? deployment.commit_hash.slice(0, 7) : "Live";
}

function readinessLabel(status, statusLoading) {
  if (statusLoading) return "Checking";
  const readiness = status?.readiness;
  if (!readiness || status?.unavailable?.readiness) return "Unavailable";
  if (readiness.overall_status === "pass") return "Operational";
  if (readiness.overall_status === "warning") return "Monitoring";
  return "Attention";
}

function LiveNetwork({ snapshot, loading, status, statusLoading }) {
  const revealRef = useReveal();
  const summary = snapshot?.summary || {};
  const latestBlock = snapshot?.blocks?.[0];

  function value(available, content) {
    if (loading) return "…";
    if (!available) return "Unavailable";
    return content;
  }

  const cards = [
    {
      label: "Chain height",
      value: value(
        !snapshot?.unavailable?.summary && summary.block_height != null,
        `#${formatNumber(summary.block_height)}`
      ),
    },
    {
      label: "Latest block",
      value: value(latestBlock?.hash != null, latestBlock ? shortHash(latestBlock.hash) : null),
      mono: true,
    },
    {
      label: "Transactions",
      value: value(!snapshot?.unavailable?.summary && summary.total_transactions != null, formatNumber(summary.total_transactions)),
    },
    {
      label: "Pending",
      value: value(!snapshot?.unavailable?.pendingTransactions && snapshot?.pendingTotal != null, formatNumber(snapshot?.pendingTotal)),
    },
    {
      label: "Wallet holders",
      value: value(!snapshot?.unavailable?.holders, formatNumber(snapshot?.holderTotal)),
    },
    {
      label: "Readiness",
      value: readinessLabel(status, statusLoading),
    },
    {
      label: "Deployment",
      value: deploymentLabel(status, statusLoading),
      mono: true,
    },
    {
      label: "Chain status",
      value: value(!snapshot?.unavailable?.summary, summary.chain_valid ? "Valid" : "Under review"),
    },
  ];

  const live = !loading && snapshot && !snapshot.unavailable?.summary;

  return (
    <section className="card card-pad stack reveal-up vq-live" id="network" aria-label="Live Vorliq network" ref={revealRef}>
      <div className="section-title">
        <div>
          <span className="eyebrow">Live network</span>
          <h2>The Vorliq network, right now</h2>
        </div>
        <span className={`status-badge ${loading ? "active" : live ? "executed" : "expired"}`} role="status">
          {loading ? "Connecting" : live ? "Live data" : "Data unavailable"}
        </span>
      </div>
      <p className="muted-text">
        These values come from the public Vorliq APIs. When a value is not available it stays marked unavailable and is
        never estimated.
      </p>
      <div className="grid vq-live-grid">
        {cards.map((card) => (
          <div className="card card-pad stat-card compact-stat" key={card.label}>
            <span className="stat-label">{card.label}</span>
            <span className={`stat-value ${card.mono ? "mono-wrap" : ""}`}>{card.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductShowcase({ snapshot, loading, status, statusLoading }) {
  const revealRef = useReveal();
  return (
    <section className="stack reveal-up vq-showcase" id="product" aria-label="Vorliq product interfaces" ref={revealRef}>
      <div className="section-title">
        <div>
          <span className="eyebrow">Product</span>
          <h2>One place to save, move, and verify</h2>
        </div>
      </div>
      <p className="subtitle">
        A wallet for your VLQ, shared savings pools for your group, community proposals you can vote on, and an open
        explorer to check every record.
      </p>
      <div className="vq-showcase-grid">
        <WalletDashboardVisual />
        <SavingsPoolVisual />
        <GovernanceProposalVisual />
        <ExplorerPreviewVisual snapshot={snapshot} loading={loading} />
        <NetworkHealthVisual snapshot={snapshot} status={status} statusLoading={statusLoading} />
      </div>
    </section>
  );
}

function HowItWorks() {
  const revealRef = useReveal();
  return (
    <section className="card card-pad stack reveal-up" id="how-it-works" aria-label="How Vorliq works" ref={revealRef}>
      <div className="section-title">
        <div>
          <span className="eyebrow">How it works</span>
          <h2>Four steps from new wallet to verified record</h2>
        </div>
      </div>
      <div className="vq-steps">
        {steps.map((step) => (
          <article className="vq-step" key={step.title}>
            <span className="vq-step__badge">
              <Icon paths={step.icon} />
            </span>
            <span className="vq-step__num">{step.number}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ExplorerSection({ snapshot, loading }) {
  const revealRef = useReveal();
  return (
    <section className="stack reveal-up vq-explorer-section" id="explorer" aria-label="Blockchain explorer preview" ref={revealRef}>
      <div className="section-title">
        <div>
          <span className="eyebrow">On chain</span>
          <h2>Recent blocks and transactions</h2>
        </div>
        <Link className="button secondary small-button" to="/blockchain">
          Open Explorer
        </Link>
      </div>
      {loading ? (
        <BrandLoader compact label="Loading live chain data" />
      ) : (
        <div className="vq-explorer-pair">
          <ExplorerPreviewVisual snapshot={snapshot} loading={loading} />
          <RecentTransactionsVisual snapshot={snapshot} loading={loading} />
        </div>
      )}
      <p className="muted-text">
        {loading
          ? "Loading the latest public chain data…"
          : snapshot && !snapshot.unavailable?.blocks
            ? "Rows update from the public Vorliq explorer APIs."
            : "Live explorer data is unavailable right now. The page stays readable until it returns."}
      </p>
    </section>
  );
}

function CommunitySavings() {
  const revealRef = useReveal();
  const points = [
    "Members contribute VLQ toward a shared goal and can see the running total.",
    "Contributions and withdrawals are signed and recorded on the Vorliq chain.",
    "Decisions stay close to the people who understand the community.",
  ];
  return (
    <section className="card card-pad stack reveal-up vq-community" id="community" aria-label="Community savings" ref={revealRef}>
      <div className="vq-community__copy">
        <span className="eyebrow">Community savings</span>
        <h2>Save together, with a record everyone can check</h2>
        <p className="subtitle">
          Vorliq helps a community organise its saving activity using VLQ and a shared blockchain record. The goal is
          clarity. Everyone sees the same numbers, and nothing depends on a private spreadsheet.
        </p>
        <ul className="vq-checklist">
          {points.map((point) => (
            <li key={point}>
              <span className="vq-check" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M5 13l4 4 10-10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <p className="help-text">
          Vorliq does not promise profit and does not hold your funds for you. It is software for organising community
          saving activity transparently.
        </p>
      </div>
      <div className="vq-community__visual">
        <SavingsPoolVisual />
      </div>
    </section>
  );
}

function Safety() {
  const revealRef = useReveal();
  return (
    <section className="card card-pad stack reveal-up vq-safety" id="transparency-overview" aria-label="Safety and transparency" ref={revealRef}>
      <div className="section-title">
        <div>
          <span className="eyebrow">Safety and transparency</span>
          <h2>Built to be checked, not just trusted</h2>
        </div>
      </div>
      <div className="vq-safety-grid">
        {safetyItems.map((item) => (
          <article className="vq-safety-card" key={item.title}>
            <span className="vq-safety-card__icon">
              <Icon paths={item.icon} />
            </span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Learn() {
  const revealRef = useReveal();
  return (
    <section className="card card-pad stack reveal-up" id="learn" aria-label="Learn about Vorliq" ref={revealRef}>
      <div className="section-title">
        <div>
          <span className="eyebrow">Learn</span>
          <h2>New to community savings on a blockchain?</h2>
        </div>
      </div>
      <div className="vq-learn-grid">
        {learnCards.map((card) => (
          <Link className="vq-learn-card" to={card.to} key={card.title}>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <span className="vq-learn-card__more">
              Read more
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  const revealRef = useReveal();
  return (
    <section className="card card-pad reveal-up vq-final" aria-label="Get started with Vorliq" ref={revealRef}>
      <div className="vq-final__copy">
        <span className="eyebrow">Get started</span>
        <h2>Ready to save with your community?</h2>
        <p className="subtitle">
          Create a wallet, join a savings pool, and verify every record on the Vorliq chain. It is open software, built
          for the people who use it.
        </p>
        <div className="button-row">
          <Link className="button" to="/register">
            Create Account
          </Link>
          <Link className="button secondary" to="/blockchain">
            View Blockchain
          </Link>
        </div>
      </div>
      <div className="vq-final__orb" aria-hidden="true">
        <span className="vq-orb-core">VLQ</span>
        <span className="vq-orb-ring vq-orb-ring--1" />
        <span className="vq-orb-ring vq-orb-ring--2" />
        <span className="vq-orb-node n1" />
        <span className="vq-orb-node n2" />
        <span className="vq-orb-node n3" />
        <span className="vq-orb-node n4" />
      </div>
    </section>
  );
}

export default Home;
