import { motion } from "framer-motion";
import {
  ArrowRight,
  Blocks,
  Coins,
  Compass,
  GitBranch,
  HandCoins,
  Network,
  ShieldCheck,
  Users,
  Vote,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ButtonLink, Card, PageShell, Reveal, Section, StatCount, StatusPill } from "../components/MarketingPrimitives";
import SocialLinks from "../components/SocialLinks";
import { formatVlq, loadPublicChainSnapshot, shortHash } from "../helpers/publicApi";

const stats = [
  { value: 100, suffix: "%", label: "Vorliq Chain" },
  { label: "No External Blockchains" },
  { label: "VLQ Community Coin" },
  { label: "Open Source" },
];

const steps = [
  {
    number: "01",
    icon: Users,
    title: "Create a Community.",
    body: "Set up a savings group and invite trusted members.",
  },
  {
    number: "02",
    icon: HandCoins,
    title: "Save and Lend Together.",
    body: "Pool VLQ savings and vote on lending decisions.",
  },
  {
    number: "03",
    icon: Blocks,
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
    icon: Coins,
  },
  {
    title: "Lend to People You Trust.",
    copy:
      "Community members can propose and vote on loans. Lending activity is recorded on chain so decisions stay transparent and traceable.",
    cta: "Learn About Lending",
    to: "/features",
    icon: Vote,
  },
  {
    title: "Native VLQ. Built for Vorliq.",
    copy:
      "VLQ runs on Vorliq's own lightweight blockchain. Wallets, blocks, and transactions are internal to this platform, with no external validators or gas fees.",
    cta: "Explore the Chain",
    to: "/blockchain",
    icon: Network,
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
    icon: Coins,
  },
  {
    title: "How Does the Vorliq Blockchain Work?",
    body: "Blocks, transactions, mining, and public records without third party chains.",
    to: "/blockchain",
    icon: GitBranch,
  },
  {
    title: "How to Start a Community Savings Group",
    body: "A responsible first step for groups saving and lending together.",
    to: "/features",
    icon: Compass,
  },
];

function Home() {
  return (
    <PageShell>
      <Hero />
      <TrustStats />
      <HowItWorks />
      <Features />
      <LiveSnapshot />
      <Community />
      <Learn />
      <FinalCta />
    </PageShell>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full bg-vorliq-accent/10 blur-3xl" aria-hidden="true" />
      <div className="mx-auto grid min-h-[calc(100svh-72px)] w-[min(1180px,calc(100%_-_32px))] items-center gap-10 py-14 lg:grid-cols-[1fr_0.9fr] lg:py-16">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: "easeOut" }}
          className="grid gap-7"
        >
          <h1 className="max-w-3xl text-[clamp(2.65rem,8vw,5.6rem)] font-black leading-[0.95] tracking-normal text-white">
            Your Community's Platform. Your Rules.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-vorliq-muted md:text-xl">
            Vorliq is a community savings and lending platform built on its own lightweight blockchain.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/register">Create Your Account</ButtonLink>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-vorliq-border bg-white/[0.04] px-5 py-3 text-sm font-black text-white transition hover:border-vorliq-accent hover:bg-white/[0.07]"
              href="#how-it-works"
            >
              See How It Works
            </a>
          </div>
          <p className="text-sm font-bold text-vorliq-muted">Community-run software - VLQ powered - No third party chains</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, delay: 0.08, ease: "easeOut" }}
        >
          <DashboardMockup />
        </motion.div>
      </div>
    </section>
  );
}

function DashboardMockup() {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let mounted = true;
    loadPublicChainSnapshot()
      .then((data) => {
        if (mounted) setSnapshot(data);
      })
      .catch(() => {
        if (mounted) setSnapshot(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const summary = snapshot?.summary || {};
  const recentTransactions = [...(snapshot?.pendingTransactions || []), ...(snapshot?.confirmedTransactions || [])].slice(0, 3);
  const latestBlock = snapshot?.blocks?.[0];
  const rows = recentTransactions.length
    ? recentTransactions.map((tx) => ({
        label: tx.status === "pending" ? "Pending transaction" : "Confirmed transaction",
        value: formatVlq(tx.amount),
        tone: tx.status === "pending" ? "text-vorliq-gold" : "text-vorliq-accent",
      }))
    : [
        {
          label: "Latest accepted block",
          value: latestBlock?.index != null ? `#${latestBlock.index}` : summary.block_height != null ? `#${summary.block_height}` : "Loading",
          tone: "text-white",
        },
        {
          label: "Public transactions",
          value: summary.total_transactions ?? "Loading",
          tone: "text-vorliq-accent",
        },
        {
          label: "Chain status",
          value: snapshot ? (summary.chain_valid ? "Valid" : "Review") : "Loading",
          tone: summary.chain_valid ? "text-vorliq-accent" : "text-vorliq-gold",
        },
      ];

  return (
    <Card className="relative overflow-hidden p-5">
      <div className="absolute right-8 top-8 h-28 w-28 rounded-full bg-vorliq-accent/15 blur-3xl" aria-hidden="true" />
      <div className="relative grid gap-5">
        <div className="flex items-center justify-between gap-4 border-b border-vorliq-border pb-4">
          <div>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-vorliq-muted">Vorliq dashboard</span>
            <h2 className="mt-1 text-2xl font-black text-white">Community pool</h2>
          </div>
          <StatusPill>Chain online</StatusPill>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/70 p-4">
            <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">Total VLQ issued</span>
            <strong className="mt-3 block font-mono text-3xl text-white">{formatVlq(summary.total_issued)}</strong>
          </div>
          <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/70 p-4">
            <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">Wallet holders</span>
            <strong className="mt-3 block font-mono text-3xl text-vorliq-accent">
              {snapshot?.unavailable.holders ? "Unavailable" : snapshot?.holderTotal ?? "Loading"}
            </strong>
          </div>
        </div>
        <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">Recent transactions</span>
            <span className="font-mono text-xs text-vorliq-muted">VLQ local chain</span>
          </div>
          <div className="grid gap-3">
            {rows.map((row) => (
              <div className="flex items-center justify-between gap-4 rounded-md bg-white/[0.035] px-3 py-3" key={row.label}>
                <span className="text-sm font-bold text-vorliq-muted">{row.label}</span>
                <span className={`font-mono text-sm font-black ${row.tone}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
            {["Valid chain", "No gas fees", "Internal VLQ"].map((item) => (
            <div className="rounded-md border border-vorliq-border bg-white/[0.035] px-2 py-3 text-xs font-black text-vorliq-muted" key={item}>
              {item}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function TrustStats() {
  return (
    <div className="border-y border-vorliq-border bg-[#080C17]">
      <div className="mx-auto grid w-[min(1180px,calc(100%_-_32px))] grid-cols-2 gap-px py-2 lg:grid-cols-4">
        {stats.map((item) => (
          <div className="min-h-[98px] px-4 py-5 text-center" key={item.label}>
            <strong className="block text-xl font-black text-white">
              {typeof item.value === "number" ? <StatCount value={item.value} suffix={item.suffix} /> : item.label}
            </strong>
            {typeof item.value === "number" && <span className="mt-1 block text-sm font-bold text-vorliq-muted">{item.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <Section id="how-it-works">
      <Reveal className="mb-10 max-w-3xl">
        <h2 className="text-[clamp(2rem,5vw,3.7rem)] font-black leading-tight text-white">Savings and Lending That Work for Your Community</h2>
      </Reveal>
      <div className="relative grid gap-5 lg:grid-cols-3">
        <div className="absolute left-[16%] right-[16%] top-12 hidden h-px bg-vorliq-border lg:block" aria-hidden="true" />
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <Reveal delay={index * 0.05} key={step.title}>
              <Card className="relative grid min-h-[270px] content-start gap-5 p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-5xl font-black text-vorliq-accent">{step.number}</span>
                  <span className="grid h-12 w-12 place-items-center rounded-lg border border-vorliq-border bg-[#0A0E1A] text-vorliq-gold">
                    <Icon size={24} aria-hidden="true" />
                  </span>
                </div>
                <h3 className="text-2xl font-black text-white">{step.title}</h3>
                <p className="leading-7 text-vorliq-muted">{step.body}</p>
              </Card>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

function Features() {
  return (
    <Section id="features" className="grid gap-12">
      {features.map((feature, index) => (
        <FeatureBlock feature={feature} flip={index % 2 === 1} key={feature.title} />
      ))}
    </Section>
  );
}

function FeatureBlock({ feature, flip }) {
  const Icon = feature.icon;
  return (
    <Reveal className={`grid items-center gap-6 lg:grid-cols-2 ${flip ? "lg:[&>*:first-child]:order-2" : ""}`} x={flip ? 14 : -14}>
      <div className="grid gap-5">
        <span className="grid h-12 w-12 place-items-center rounded-lg border border-vorliq-border bg-vorliq-accent/10 text-vorliq-accent">
          <Icon size={24} aria-hidden="true" />
        </span>
        <h2 className="text-[clamp(2rem,4.5vw,3.4rem)] font-black leading-tight text-white">{feature.title}</h2>
        <p className="max-w-2xl text-lg leading-8 text-vorliq-muted">{feature.copy}</p>
        <ButtonLink className="w-fit" to={feature.to} variant="secondary">
          {feature.cta}
        </ButtonLink>
      </div>
      <Card className="min-h-[300px] overflow-hidden p-6">
        <div className="grid h-full content-between gap-8">
          <div className="flex items-center justify-between">
            <StatusPill tone={flip ? "gold" : "teal"}>{feature.title.split(".")[0]}</StatusPill>
            <span className="font-mono text-xs text-vorliq-muted">VLQ://community</span>
          </div>
          <div className="grid gap-3">
            {[0, 1, 2].map((item) => (
              <div className="h-14 rounded-md border border-vorliq-border bg-[#0A0E1A]/72" key={item}>
                <div className="flex h-full items-center gap-3 px-4">
                  <span className="h-2.5 w-2.5 rounded-full bg-vorliq-accent" />
                  <span className="h-2 w-1/2 rounded-full bg-white/18" />
                  <span className="ml-auto h-2 w-16 rounded-full bg-vorliq-gold/60" />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["Saved", "Voted", "Recorded"].map((label) => (
              <div className="rounded-md bg-white/[0.035] p-3 text-center text-xs font-black text-vorliq-muted" key={label}>
                {label}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

function LiveSnapshot() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    loadPublicChainSnapshot()
      .then((data) => {
        if (!mounted) return;
        setSnapshot(data);
        const allUnavailable =
          data.unavailable.summary &&
          data.unavailable.blocks &&
          data.unavailable.confirmedTransactions &&
          data.unavailable.pendingTransactions;
        setError(allUnavailable ? "Live chain data is unavailable right now." : "");
      })
      .catch(() => {
        if (mounted) setError("Live chain data is unavailable right now.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const transactions = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.confirmedTransactions, ...snapshot.pendingTransactions].slice(0, 8);
  }, [snapshot]);

  const summary = snapshot?.summary || {};
  const statCards = [
    {
      label: "Wallet holders",
      value: snapshot?.unavailable.holders ? "Unavailable" : snapshot?.holderTotal ?? "Unavailable",
      note: "Public holder count comes from the leaderboard endpoint.",
    },
    { label: "Total blocks", value: snapshot?.unavailable.summary ? "Unavailable" : summary.total_blocks ?? "Unavailable" },
    { label: "Total transactions", value: snapshot?.unavailable.summary ? "Unavailable" : summary.total_transactions ?? "Unavailable" },
    {
      label: "Pending transactions",
      value: snapshot?.unavailable.pendingTransactions || snapshot?.pendingTotal == null
        ? "Unavailable"
        : snapshot.pendingTotal,
    },
    { label: "Current chain status", value: snapshot?.unavailable.summary ? "Unavailable" : summary.chain_valid ? "Valid" : "Needs review" },
  ];

  return (
    <Section id="live-chain">
      <Reveal className="mb-8 grid gap-4">
        <h2 className="text-[clamp(2rem,5vw,3.7rem)] font-black leading-tight text-white">Live VLQ and Chain Snapshot</h2>
        <p className="max-w-3xl text-lg leading-8 text-vorliq-muted">
          This panel uses existing public backend APIs. When a value is not exposed by an API, it stays unavailable instead of being estimated.
        </p>
      </Reveal>
      <Card className="overflow-hidden">
        <div className="border-b border-vorliq-border p-5">
          {loading && <p className="font-bold text-vorliq-muted">Loading live chain data...</p>}
          {!loading && error && <p className="font-bold text-red-200">{error}</p>}
          {!loading && !error && <p className="font-bold text-vorliq-muted">Live public API data loaded.</p>}
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-5">
          {statCards.map((stat) => (
            <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4" key={stat.label}>
              <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">{stat.label}</span>
              <strong className="mt-3 block break-words font-mono text-2xl text-white">{stat.value}</strong>
              {stat.note && <p className="mt-2 text-xs leading-5 text-vorliq-muted">{stat.note}</p>}
            </div>
          ))}
        </div>
        <div className="border-t border-vorliq-border p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-xl font-black text-white">Recent on-chain transactions</h3>
            <Link className="inline-flex items-center gap-2 text-sm font-black text-vorliq-accent" to="/blockchain">
              Open explorer <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {loading ? (
            <div className="h-16 rounded-lg bg-white/[0.035]" />
          ) : transactions.length ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {transactions.map((tx, index) => (
                <Link
                  className="min-w-[260px] rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4 transition hover:border-vorliq-accent"
                  to={`/tx/${encodeURIComponent(tx.tx_id)}`}
                  key={tx.tx_id || index}
                >
                  <StatusPill tone={tx.status === "pending" ? "gold" : "teal"}>{tx.status || "confirmed"}</StatusPill>
                  <strong className="mt-3 block font-mono text-sm text-white">{shortHash(tx.tx_id)}</strong>
                  <span className="mt-2 block font-mono text-sm text-vorliq-muted">{formatVlq(tx.amount)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-5 text-vorliq-muted">
              Recent transaction data is unavailable or empty.
            </div>
          )}
        </div>
      </Card>
    </Section>
  );
}

function Community() {
  return (
    <Section id="community">
      <Reveal className="mb-10 max-w-3xl">
        <h2 className="text-[clamp(2rem,5vw,3.7rem)] font-black leading-tight text-white">Built for Communities. Run by Communities.</h2>
        <p className="mt-4 text-lg leading-8 text-vorliq-muted">Vorliq is open source. It belongs to the people who use it.</p>
      </Reveal>
      <div className="grid gap-5 lg:grid-cols-3">
        {communityCards.map((card, index) => (
          <Reveal delay={index * 0.05} key={card.title}>
            <Card className="grid min-h-[210px] content-start gap-4 p-6">
              <ShieldCheck className="text-vorliq-accent" size={28} aria-hidden="true" />
              <h3 className="text-2xl font-black text-white">{card.title}</h3>
              <p className="leading-7 text-vorliq-muted">{card.body}</p>
            </Card>
          </Reveal>
        ))}
      </div>
      <div className="mt-8">
        <SocialLinks />
      </div>
    </Section>
  );
}

function Learn() {
  return (
    <Section id="learn">
      <Reveal className="mb-10 max-w-3xl">
        <h2 className="text-[clamp(2rem,5vw,3.7rem)] font-black leading-tight text-white">New to Community Savings on the Blockchain?</h2>
      </Reveal>
      <div className="grid gap-5 lg:grid-cols-3">
        {guides.map((guide, index) => {
          const Icon = guide.icon;
          return (
            <Reveal delay={index * 0.05} key={guide.title}>
              <Card className="grid min-h-[260px] content-start gap-5 p-6">
                <div className="grid h-20 w-20 place-items-center rounded-lg border border-vorliq-border bg-vorliq-accent/10 text-vorliq-accent">
                  <Icon size={34} aria-hidden="true" />
                </div>
                <h3 className="text-2xl font-black text-white">{guide.title}</h3>
                <p className="leading-7 text-vorliq-muted">{guide.body}</p>
                <Link className="mt-auto inline-flex items-center gap-2 text-sm font-black text-vorliq-accent" to={guide.to}>
                  Read More <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </Card>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <Section className="pb-24">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.32 }}
      >
        <Card className="relative overflow-hidden p-8 md:p-12">
          <div className="absolute right-10 top-10 h-48 w-48 rounded-full bg-vorliq-accent/15 blur-3xl" aria-hidden="true" />
          <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="text-[clamp(2rem,5vw,3.6rem)] font-black leading-tight text-white">Ready to Build with Your Community?</h2>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-vorliq-muted">
                Join Vorliq. Save together, lend together, and own the shared record together.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <ButtonLink to="/register">Create Account</ButtonLink>
              <ButtonLink href="https://github.com/vorliq/Vorliq" variant="secondary">
                <GitBranch size={17} aria-hidden="true" /> View on GitHub
              </ButtonLink>
            </div>
          </div>
        </Card>
      </motion.div>
    </Section>
  );
}

export default Home;
