import { formatNumber } from "../../helpers/publicApi";

// Original Vorliq hero scene. Built from CSS 3D transforms, SVG and brand
// gradients only. No external 3D libraries, no logo image, no stock art.
// It renders a small product world: glass blockchain blocks linked by live
// transaction lines, a rotating VLQ coin, community nodes, and a floating
// wallet and savings pool card. Animation is paused under reduced motion.

function GlassBlock({ className, index, label }) {
  return (
    <div className={`vq-block ${className}`} aria-hidden="true">
      <span className="vq-block__face vq-block__face--front">
        <span className="vq-block__index">{label}</span>
        <span className="vq-block__bars">
          <i style={{ width: "70%" }} />
          <i style={{ width: "48%" }} />
          <i style={{ width: "60%" }} />
        </span>
      </span>
      <span className="vq-block__face vq-block__face--back" />
      <span className="vq-block__face vq-block__face--right" />
      <span className="vq-block__face vq-block__face--left" />
      <span className="vq-block__face vq-block__face--top" />
      <span className="vq-block__face vq-block__face--bottom" />
    </div>
  );
}

function VlqCoin() {
  return (
    <div className="vq-coin" aria-hidden="true">
      <span className="vq-coin__face vq-coin__face--front">
        <svg viewBox="0 0 100 100" className="vq-coin__glyph">
          <polygon
            points="50,16 80,33 80,67 50,84 20,67 20,33"
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="3"
          />
          <text x="50" y="58" textAnchor="middle" className="vq-coin__text">
            VLQ
          </text>
        </svg>
      </span>
      <span className="vq-coin__edge" />
      <span className="vq-coin__face vq-coin__face--back" />
    </div>
  );
}

function TransactionNetwork() {
  // Nodes and links for the community network. Lines carry a flowing dash so
  // they read as live transaction paths between blocks and members.
  const links = [
    "M70 188 L196 150",
    "M196 150 L320 196",
    "M196 150 L150 70",
    "M196 150 L268 78",
    "M196 150 L96 96",
    "M320 196 L356 120",
  ];
  const nodes = [
    { cx: 70, cy: 188 },
    { cx: 320, cy: 196 },
    { cx: 150, cy: 70 },
    { cx: 268, cy: 78 },
    { cx: 96, cy: 96 },
    { cx: 356, cy: 120 },
  ];

  return (
    <svg className="vq-network" viewBox="0 0 400 260" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="vqLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#86e33b" />
          <stop offset="0.5" stopColor="#00c6a7" />
          <stop offset="1" stopColor="#1479ff" />
        </linearGradient>
        <radialGradient id="vqNode" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#b6f17a" />
          <stop offset="1" stopColor="#00c6a7" />
        </radialGradient>
      </defs>
      {links.map((d, i) => (
        <path key={d} className="vq-network__link" style={{ animationDelay: `${i * -0.9}s` }} d={d} />
      ))}
      {nodes.map((node) => (
        <circle key={`${node.cx}-${node.cy}`} className="vq-network__node" cx={node.cx} cy={node.cy} r="6" />
      ))}
    </svg>
  );
}

function FloatingWalletCard({ snapshot, loading }) {
  const summary = snapshot?.summary || {};
  const height =
    summary.block_height != null
      ? `#${formatNumber(summary.block_height)}`
      : snapshot?.blocks?.[0]?.index != null
        ? `#${formatNumber(snapshot.blocks[0].index)}`
        : "—";
  const txTotal = summary.total_transactions != null ? formatNumber(summary.total_transactions) : "—";

  return (
    <div className="vq-glass-card vq-glass-card--wallet" aria-hidden="true">
      <div className="vq-glass-card__head">
        <span className="vq-glass-card__tag">Vorliq Wallet</span>
        <span className={`vq-dot ${loading ? "is-load" : "is-live"}`} />
      </div>
      <span className="vq-glass-card__label">Available balance</span>
      <span className="vq-glass-card__balance">
        1,250<span className="vq-glass-card__unit">VLQ</span>
      </span>
      <div className="vq-glass-card__grid">
        <div>
          <span className="vq-glass-card__k">Chain height</span>
          <span className="vq-glass-card__v">{loading ? "…" : height}</span>
        </div>
        <div>
          <span className="vq-glass-card__k">Transactions</span>
          <span className="vq-glass-card__v">{loading ? "…" : txTotal}</span>
        </div>
      </div>
    </div>
  );
}

function FloatingPoolCard() {
  return (
    <div className="vq-glass-card vq-glass-card--pool" aria-hidden="true">
      <div className="vq-glass-card__head">
        <span className="vq-glass-card__tag">Savings pool</span>
        <span className="vq-pill-mini">12 members</span>
      </div>
      <div className="vq-pool-track">
        <span className="vq-pool-fill" style={{ width: "68%" }} />
      </div>
      <span className="vq-glass-card__k">Pool goal progress</span>
      <div className="vq-pool-avatars">
        <i className="g" />
        <i className="c" />
        <i className="b" />
        <i className="g" />
        <span className="vq-pool-more">+8</span>
      </div>
    </div>
  );
}

function HeroScene({ snapshot, loading }) {
  return (
    <div className="vq-scene" role="img" aria-label="Illustration of the Vorliq product: blockchain blocks linked by live transactions, a VLQ coin, and community wallet and savings cards.">
      <div className="vq-scene__glow" aria-hidden="true" />
      <div className="vq-stage" aria-hidden="true">
        <div className="vq-grid-plane" />
        <TransactionNetwork />
        <div className="vq-blocks">
          <GlassBlock className="vq-block--a" label="#1" />
          <GlassBlock className="vq-block--b" label="#2" />
          <GlassBlock className="vq-block--c" label="#3" />
        </div>
        <VlqCoin />
      </div>
      <FloatingWalletCard snapshot={snapshot} loading={loading} />
      <FloatingPoolCard />
    </div>
  );
}

export default HeroScene;
