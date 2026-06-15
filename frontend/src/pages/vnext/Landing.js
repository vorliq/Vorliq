// New marketing landing page (design layer "vnext"). Mounted on /preview while
// the rest of the site is migrated page-by-page. All data sections are wired to
// the real public APIs; feature visuals are original brand illustrations.
//
// Locked brand rules honoured: headline is "Your Community's Bank. Your Rules.",
// social links come from the existing allowlist, the logo is used only as the
// brand mark, and the copy avoids regulated-banking / guaranteed-return framing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, Boxes, Coins, Gauge, Layers, Send, Droplets } from "lucide-react";

import "../../styles/vnext.css";
import TopNav from "../../components/vnext/TopNav";
import ParticleField from "../../components/vnext/ParticleField";
import StatCounter from "../../components/vnext/StatCounter";
import Ticker from "../../components/vnext/Ticker";
import { Button, Card, InlineError, Pill, SectionHead, Skeleton } from "../../components/vnext/primitives";
import { ProductFooter } from "../../components/ProductShell";
import { socialLinks } from "../../components/SocialLinks";
import api from "../../helpers/api";
import {
  formatHash,
  formatNumber,
  formatRelativeTime,
  formatVlq,
  loadPublicChainSnapshot,
} from "../../helpers/publicApi";

function shortAddress(value) {
  if (!value) return "—";
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/* ----------------------------------------------------------- Sparkline ---- */
// Renders a gradient-filled SVG trend from a real numeric series. Returns null
// when there is no real series, so we never imply data we do not have.
function Sparkline({ series, id }) {
  if (!series || series.length < 2) return null;
  const w = 120;
  const h = 36;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => [i * step, h - ((v - min) / range) * (h - 6) - 3]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const gid = `vn-spark-${id}`;
  return (
    <svg className="vn-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00a896" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#00a896" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke="#00a896" strokeWidth="1.5" />
    </svg>
  );
}

/* ----------------------------------------------------------- Feature data - */
const FEATURES = [
  {
    overline: "Verify everything",
    title: "A blockchain your community can read",
    body:
      "Every block, balance, and transfer is recorded on Vorliq's own lightweight chain. Open the explorer and confirm activity for yourself at any time — nothing is hidden behind a dashboard.",
    link: { label: "Open the explorer", to: "/blockchain" },
    visual: "uptime",
  },
  {
    overline: "Your keys, your coin",
    title: "Wallets created and encrypted on your device",
    body:
      "Create a wallet in seconds. Your private key is generated and encrypted locally and is never sent to a server. Hold, send, and receive VLQ across your community.",
    link: { label: "About VLQ", to: "/vlq" },
    visual: "wallet",
  },
  {
    overline: "Decide together",
    title: "Community lending, settled by a vote",
    body:
      "Members propose loans from the shared fund and the community votes them up or down. Terms, rates, and outcomes are recorded on-chain for everyone to see.",
    link: { label: "See lending", to: "/lending" },
    visual: "vote",
  },
  {
    overline: "Get started free",
    title: "A faucet to put VLQ in your hands",
    body:
      "New members can claim VLQ from the community faucet to learn how sends, blocks, and confirmations work before moving real balances.",
    link: { label: "Open the faucet", to: "/faucet" },
    visual: "faucet",
  },
];

function FeatureVisual({ kind, snapshot }) {
  if (kind === "uptime") {
    const blocks = snapshot?.blocks || [];
    const series = blocks.length
      ? blocks.slice(0, 16).reverse().map((b) => num(b.transaction_count ?? b.transactions?.length) ?? 0)
      : Array.from({ length: 16 }, (_, i) => 4 + Math.round(3 * Math.sin(i)));
    const max = Math.max(...series, 1);
    return (
      <Card className="vn-feature__visual">
        <span className="vn-overline">Recent block activity</span>
        <div className="vn-uptime">
          {series.map((v, i) => (
            <span key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
          ))}
        </div>
      </Card>
    );
  }
  if (kind === "wallet") {
    return (
      <Card className="vn-feature__visual">
        <Card nested style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--vn-teal)" }}>
            <Coins size={22} aria-hidden="true" />
            <span style={{ fontWeight: 700 }}>VLQ Wallet</span>
          </div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800, marginTop: 14 }}>1,240.00 VLQ</div>
          <div style={{ color: "var(--vn-text-2)", fontSize: "0.82rem", marginTop: 4 }}>
            Encrypted on your device
          </div>
        </Card>
      </Card>
    );
  }
  if (kind === "vote") {
    return (
      <Card className="vn-feature__visual">
        <span className="vn-overline">Example loan vote</span>
        <div style={{ marginTop: 10 }}>
          <div className="vn-bar" style={{ height: 14 }}>
            <div className="vn-bar__fill" style={{ width: "68%", background: "var(--vn-green)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginTop: 8 }}>
            <span style={{ color: "var(--vn-green)" }}>Yes 68%</span>
            <span style={{ color: "var(--vn-text-2)" }}>No 32%</span>
          </div>
        </div>
      </Card>
    );
  }
  // faucet — simple animated coin drop illustration
  return (
    <Card className="vn-feature__visual" style={{ alignItems: "center" }}>
      <Droplets size={40} aria-hidden="true" style={{ color: "var(--vn-teal)" }} />
      <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
        {[0, 1, 2].map((i) => (
          <Coins
            key={i}
            size={26}
            aria-hidden="true"
            style={{
              color: "var(--vn-teal)",
              animation: "vn-fade-in 1.6s ease-in-out infinite",
              animationDelay: `${i * 0.25}s`,
            }}
          />
        ))}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------- Live feed ------ */
function LiveFeed() {
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState("");
  const newestRef = useRef(null);

  const load = useCallback(async (signal) => {
    try {
      const res = await api.get("/chain/blocks", { params: { limit: 10, offset: 0 }, signal });
      const list = res?.data?.blocks || [];
      setBlocks((prev) => {
        if (prev && prev[0]) newestRef.current = prev[0].index;
        return list;
      });
      setError("");
    } catch (err) {
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
      setError("Couldn't load the latest blocks.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  return (
    <Card className="vn-feed" pad>
      {error ? (
        <InlineError message={error} onRetry={() => load()} />
      ) : (
        <table className="vn-table">
          <thead>
            <tr>
              <th>Block</th>
              <th>Age</th>
              <th>Miner</th>
              <th>Txns</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {blocks == null
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j}>
                        <Skeleton height={14} />
                      </td>
                    ))}
                  </tr>
                ))
              : blocks.map((b) => {
                  const isNew = newestRef.current != null && b.index > newestRef.current;
                  return (
                    <tr key={b.hash || b.index} className={isNew ? "vn-row-enter" : ""}>
                      <td className="vn-block-num">#{formatNumber(b.index)}</td>
                      <td>{formatRelativeTime(b.timestamp) || "—"}</td>
                      <td className="vn-mono" title={b.miner_address}>
                        {shortAddress(b.miner_address)}
                      </td>
                      <td>{formatNumber(b.transaction_count ?? b.transactions?.length ?? 0)}</td>
                      <td className="vn-mono" title={b.hash}>
                        {formatHash(b.hash)}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------- Page --------- */
export default function Landing() {
  const [snapshot, setSnapshot] = useState(null);
  const [economics, setEconomics] = useState(null);
  const [roadmap, setRoadmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [newsletter, setNewsletter] = useState({ tone: "", text: "" });
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const snap = await loadPublicChainSnapshot();
      setSnapshot(snap);
      const [econRes, roadRes] = await Promise.allSettled([api.get("/economics"), api.get("/roadmap")]);
      if (econRes.status === "fulfilled") setEconomics(econRes.value.data);
      if (roadRes.status === "fulfilled") setRoadmap(roadRes.value.data);
    } catch {
      setError("We couldn't reach the Vorliq network. Some live figures may be unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const summary = useMemo(() => snapshot?.summary || {}, [snapshot]);
  const econ = useMemo(() => economics || {}, [economics]);

  const heroStats = [
    { label: "Blocks mined", value: num(summary.total_blocks ?? summary.block_height), format: formatNumber },
    {
      label: "VLQ in circulation",
      value: num(econ.total_issued ?? summary.total_issued),
      format: (n) => formatNumber(n),
    },
    { label: "Wallet holders", value: num(snapshot?.holderTotal), format: formatNumber },
    { label: "Transactions", value: num(summary.total_transactions), format: formatNumber },
  ];

  const tickerItems = useMemo(() => {
    const latest = snapshot?.blocks?.[0];
    const items = [
      { label: "Block height", value: num(summary.block_height) != null ? `#${formatNumber(summary.block_height)}` : null },
      {
        label: "Mining reward",
        value:
          num(econ.current_mining_reward ?? summary.current_mining_reward) != null
            ? formatVlq(econ.current_mining_reward ?? summary.current_mining_reward)
            : null,
      },
      { label: "Difficulty", value: num(latest?.difficulty) != null ? formatNumber(latest.difficulty) : null },
      { label: "Total blocks", value: num(summary.total_blocks) != null ? formatNumber(summary.total_blocks) : null },
      { label: "Last block", value: latest?.timestamp ? formatRelativeTime(latest.timestamp) : null },
    ];
    return items.filter((i) => i.value);
  }, [snapshot, summary, econ]);

  const txSeries = useMemo(
    () =>
      (snapshot?.blocks || [])
        .slice(0, 12)
        .reverse()
        .map((b) => num(b.transaction_count ?? b.transactions?.length) ?? 0),
    [snapshot]
  );
  const diffSeries = useMemo(
    () =>
      (snapshot?.blocks || [])
        .slice(0, 12)
        .reverse()
        .map((b) => num(b.difficulty))
        .filter((v) => v != null),
    [snapshot]
  );

  const metrics = [
    { icon: Boxes, label: "Total blocks", value: num(summary.total_blocks ?? summary.block_height), series: null },
    { icon: Activity, label: "Total transactions", value: num(summary.total_transactions), series: txSeries },
    {
      icon: Gauge,
      label: "Mining difficulty",
      value: num(snapshot?.blocks?.[0]?.difficulty),
      series: diffSeries.length >= 2 ? diffSeries : null,
    },
    {
      icon: Coins,
      label: "VLQ mined of 21M",
      value: num(econ.total_issued ?? summary.total_issued),
      series: null,
    },
    { icon: Send, label: "Pending transactions", value: num(snapshot?.pendingTotal), series: null },
    { icon: Layers, label: "Wallet holders", value: num(snapshot?.holderTotal), series: null },
  ];

  const milestones = useMemo(() => {
    const items = roadmap?.items || [];
    const map = { completed: "done", in_progress: "active", planned: "next", research: "next" };
    return items.slice(0, 8).map((it) => ({
      title: it.title,
      summary: it.summary,
      state: map[it.status] || "next",
    }));
  }, [roadmap]);

  async function handleNewsletter(e) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setNewsletter({ tone: "error", text: "Please enter a valid email address." });
      return;
    }
    setSubmitting(true);
    setNewsletter({ tone: "", text: "" });
    try {
      const res = await api.post("/newsletter/subscribe", { email });
      const data = res?.data || {};
      if (data.already_subscribed) {
        setNewsletter({ tone: "info", text: "You're already subscribed to Vorliq updates." });
      } else {
        setNewsletter({ tone: "success", text: "Thanks — you're on the Vorliq list." });
        setEmail("");
      }
    } catch (err) {
      const apiMsg = err?.response?.data?.error?.message || err?.response?.data?.message;
      setNewsletter({
        tone: "error",
        text: apiMsg || "We couldn't record your sign-up right now. Please try again later.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="vnext">
      <TopNav />

      {/* ---------------------------------------------------------- Hero --- */}
      <section className="vn-hero">
        <span className="vn-hero__blob vn-hero__blob--teal" aria-hidden="true" />
        <span className="vn-hero__blob vn-hero__blob--blue" aria-hidden="true" />
        <ParticleField />
        <div className="vn-hero__content">
          <Pill live>Vorliq network is live</Pill>
          <h1>
            Your Community's Bank.
            <br />
            Your Rules.
          </h1>
          <p className="vn-hero__sub">
            Vorliq is a community savings bank built on its own blockchain with the VLQ coin — open,
            verifiable, and owned by its members. It is community software, not a licensed banking service.
          </p>
          <div className="vn-btn-row" style={{ justifyContent: "center" }}>
            <Button variant="primary" size="lg" to="/register">
              Create your wallet
            </Button>
            <Button variant="secondary" size="lg" to="/blockchain">
              Explore the chain
            </Button>
          </div>
        </div>
        <div className="vn-hero__stats">
          {heroStats.map((s) => (
            <StatCounter key={s.label} value={s.value} label={s.label} format={s.format} loading={loading} />
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- Ticker --- */}
      {tickerItems.length > 0 && <Ticker items={tickerItems} />}

      {error && (
        <div className="vn-container" style={{ marginTop: 24 }}>
          <InlineError message={error} onRetry={loadAll} />
        </div>
      )}

      {/* ------------------------------------------------------ Features --- */}
      <section className="vn-section">
        <div className="vn-container">
          <SectionHead
            overline="The platform"
            title="One community, one transparent system"
            subtitle="Everything members need to save, move, and govern VLQ together — all verifiable on the same open chain."
          />
          {FEATURES.map((f, i) => (
            <div className={`vn-feature ${i % 2 === 1 ? "vn-feature--reverse" : ""}`} key={f.title}>
              <div className="vn-feature__text">
                <span className="vn-overline">{f.overline}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <a className="vn-link" href={f.link.to}>
                  {f.link.label} <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
              <FeatureVisual kind={f.visual} snapshot={snapshot} />
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- Live feed --- */}
      <section className="vn-feed-section vn-section">
        <div className="vn-container">
          <SectionHead
            overline="Live network"
            title="The Vorliq chain, right now"
            subtitle="The ten most recent blocks, refreshed every ten seconds straight from the public API."
          />
        </div>
        <LiveFeed />
      </section>

      {/* ------------------------------------------------------- Metrics --- */}
      <section className="vn-section">
        <div className="vn-container">
          <SectionHead overline="Network stats" title="Measured, not estimated" />
          <div className="vn-metrics">
            {metrics.map((m) => {
              const Icon = m.icon;
              const hasValue = typeof m.value === "number" && Number.isFinite(m.value);
              return (
                <Card className="vn-metric" key={m.label}>
                  <div className="vn-metric__icon">
                    <Icon size={22} aria-hidden="true" />
                  </div>
                  <div className="vn-metric__num">
                    {loading ? <Skeleton height={26} width="60%" /> : hasValue ? formatNumber(m.value) : "Unavailable"}
                  </div>
                  <div className="vn-metric__label">{m.label}</div>
                  <Sparkline series={m.series} id={m.label.replace(/\s+/g, "-")} />
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ Roadmap ---- */}
      {milestones.length > 0 && (
        <section className="vn-section vn-feed-section">
          <div className="vn-container">
            <SectionHead overline="Where we're headed" title="The Vorliq roadmap" />
            <div className="vn-timeline">
              {milestones.map((m) => (
                <div className="vn-milestone" key={m.title}>
                  <span className={`vn-milestone__dot vn-milestone__dot--${m.state}`} aria-hidden="true" />
                  <h4>{m.title}</h4>
                  <p>{m.summary}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------- Community ---- */}
      <section className="vn-section">
        <div className="vn-container">
          <SectionHead
            overline="Community"
            title="Built in the open, with its members"
            subtitle="Join the conversation, follow development, and read every line of the code."
          />
          <div className="vn-socials">
            {socialLinks.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.href}
                  className="vn-social"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open Vorliq on ${link.label}`}
                  title={link.label}
                >
                  <Icon />
                </a>
              );
            })}
          </div>
          <form className="vn-newsletter" onSubmit={handleNewsletter}>
            <input
              className="vn-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Keep me posted"}
            </Button>
          </form>
          {newsletter.text && (
            <p className={`vn-form-msg vn-form-msg--${newsletter.tone}`} role="status">
              {newsletter.text}
            </p>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------- CTA ----- */}
      <section className="vn-cta">
        <span className="vn-cta__glow" aria-hidden="true" />
        <div className="vn-cta__inner">
          <h2>Start saving with your community today</h2>
          <p>Create a wallet in seconds and see your community's blockchain work in real time.</p>
          <div className="vn-btn-row">
            <Button variant="primary" size="lg" to="/register">
              Create your wallet
            </Button>
            <Button variant="secondary" size="lg" to="/whitepaper">
              Read the whitepaper
            </Button>
          </div>
        </div>
      </section>

      <ProductFooter />
    </div>
  );
}
