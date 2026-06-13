import { formatHash, formatNumber } from "../../helpers/publicApi";

// Original Vorliq hero world. Built entirely from React, SVG and lightweight
// CSS 3D using the brand gradient (green -> teal -> blue). No logo, no stock
// art, no copied images. Each piece below is a small, reusable, editable asset.

// A 3D VLQ coin: two gradient faces and a rim, slowly rotating on its own axis.
export function VLQCoin3D({ className = "" }) {
  return (
    <div className={`vq-coin3d ${className}`} aria-hidden="true">
      <span className="vq-coin3d__face vq-coin3d__front">
        <svg viewBox="0 0 100 100">
          <polygon
            points="50,15 81,33 81,67 50,85 19,67 19,33"
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="3"
          />
          <text x="50" y="58" textAnchor="middle" className="vq-coin3d__text">
            VLQ
          </text>
        </svg>
      </span>
      <span className="vq-coin3d__rim" />
      <span className="vq-coin3d__face vq-coin3d__back" />
    </div>
  );
}

// A stack of glass blockchain blocks linked in a short chain. Each block is a
// real CSS 3D cube (six faces) so it reads with depth, not as a flat card.
function GlassCube({ className, label }) {
  return (
    <div className={`vq-cube ${className}`}>
      <span className="vq-cube__face vq-cube__front">
        <span className="vq-cube__label">{label}</span>
        <span className="vq-cube__bars">
          <i style={{ width: "72%" }} />
          <i style={{ width: "52%" }} />
          <i style={{ width: "63%" }} />
        </span>
      </span>
      <span className="vq-cube__face vq-cube__back" />
      <span className="vq-cube__face vq-cube__right" />
      <span className="vq-cube__face vq-cube__left" />
      <span className="vq-cube__face vq-cube__top" />
      <span className="vq-cube__face vq-cube__bottom" />
    </div>
  );
}

export function BlockchainCubeStack({ className = "" }) {
  return (
    <div className={`vq-cubes ${className}`} aria-hidden="true">
      <GlassCube className="vq-cube--a" label="#1" />
      <GlassCube className="vq-cube--b" label="#2" />
      <GlassCube className="vq-cube--c" label="#3" />
    </div>
  );
}

// Connected community nodes with animated transaction flow lines between them.
export function CommunityNodeNetwork() {
  const links = [
    "M40 150 C 110 120, 150 90, 210 120",
    "M210 120 C 270 145, 320 120, 360 150",
    "M210 120 C 180 70, 250 55, 300 70",
    "M210 120 C 150 175, 90 185, 60 220",
    "M360 150 C 380 110, 350 80, 320 70",
  ];
  const nodes = [
    { cx: 40, cy: 150 },
    { cx: 210, cy: 120 },
    { cx: 360, cy: 150 },
    { cx: 300, cy: 70 },
    { cx: 60, cy: 220 },
    { cx: 320, cy: 70 },
  ];
  return (
    <svg
      className="vq-net"
      viewBox="0 0 400 260"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="vqNetLine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#86e33b" />
          <stop offset="0.5" stopColor="#00c6a7" />
          <stop offset="1" stopColor="#1479ff" />
        </linearGradient>
        <radialGradient id="vqNetNode" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c6f592" />
          <stop offset="1" stopColor="#00c6a7" />
        </radialGradient>
      </defs>
      <TransactionFlowLines links={links} />
      {nodes.map((n) => (
        <circle key={`${n.cx}-${n.cy}`} className="vq-net__node" cx={n.cx} cy={n.cy} r="5.5" />
      ))}
    </svg>
  );
}

// Animated transaction paths: a flowing dash plus a travelling pulse per link.
export function TransactionFlowLines({ links }) {
  return (
    <g className="vq-flow">
      {links.map((d, i) => (
        <g key={d}>
          <path className="vq-flow__line" d={d} style={{ animationDelay: `${i * -0.7}s` }} />
          <circle className="vq-flow__pulse" r="3" style={{ animationDelay: `${i * 0.9}s` }}>
            <animateMotion dur="3.2s" repeatCount="indefinite" path={d} begin={`${i * 0.5}s`} />
          </circle>
        </g>
      ))}
    </g>
  );
}

// A small block record chip (the explorer element), driven by live chain data.
function ExplorerChip({ snapshot, loading }) {
  const block = snapshot?.blocks?.[0];
  const known = block && !snapshot?.unavailable?.blocks;
  return (
    <div className="vq-world-chip" aria-hidden="true">
      <span className="vq-world-chip__icon">
        <svg viewBox="0 0 24 24">
          <path
            d="M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="vq-world-chip__text">
        <span className="vq-world-chip__title">
          {loading ? "Latest block" : known ? `Block #${formatNumber(block.index)}` : "Latest block"}
        </span>
        <span className="vq-world-chip__hash">
          {loading ? "syncing…" : known ? formatHash(block.hash, 6, 4) : "—"}
        </span>
      </span>
    </div>
  );
}

function WalletHeroCard({ snapshot, loading }) {
  const summary = snapshot?.summary || {};
  const height =
    !loading && summary.block_height != null ? `#${formatNumber(summary.block_height)}` : loading ? "…" : "—";
  const tx = !loading && summary.total_transactions != null ? formatNumber(summary.total_transactions) : loading ? "…" : "—";
  return (
    <div className="vq-world-card vq-world-card--wallet" aria-hidden="true">
      <div className="vq-world-card__head">
        <span className="vq-world-card__tag">Vorliq wallet</span>
        <span className={`vq-world-dot ${loading ? "load" : "live"}`} />
      </div>
      <span className="vq-world-card__label">Available balance</span>
      <span className="vq-world-card__balance">
        1,250<small>VLQ</small>
      </span>
      <div className="vq-world-card__stats">
        <div>
          <span>Chain height</span>
          <strong>{height}</strong>
        </div>
        <div>
          <span>Transactions</span>
          <strong>{tx}</strong>
        </div>
      </div>
    </div>
  );
}

function PoolHeroCard() {
  return (
    <div className="vq-world-card vq-world-card--pool" aria-hidden="true">
      <div className="vq-world-card__head">
        <span className="vq-world-card__tag">Savings pool</span>
        <span className="vq-world-mini">12 members</span>
      </div>
      <div className="vq-world-track">
        <span style={{ width: "68%" }} />
      </div>
      <span className="vq-world-card__label">Shared goal, 68 percent</span>
      <div className="vq-world-avatars">
        <i className="g" />
        <i className="c" />
        <i className="b" />
        <i className="g" />
        <span className="vq-world-mini">+8</span>
      </div>
    </div>
  );
}

export default function Hero3DWorld({ snapshot, loading }) {
  return (
    <div
      className="vq-world"
      role="img"
      aria-label="Illustration of the Vorliq product: glass blockchain blocks linked by live transactions, a VLQ coin, community nodes, and wallet, savings pool and block record cards."
    >
      <span className="vq-world__glow" aria-hidden="true" />
      <span className="vq-world__grid" aria-hidden="true" />
      <CommunityNodeNetwork />
      <div className="vq-world__stage" aria-hidden="true">
        <BlockchainCubeStack />
        <VLQCoin3D />
      </div>
      <WalletHeroCard snapshot={snapshot} loading={loading} />
      <PoolHeroCard />
      <ExplorerChip snapshot={snapshot} loading={loading} />
    </div>
  );
}
