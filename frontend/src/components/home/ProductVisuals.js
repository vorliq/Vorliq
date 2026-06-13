import { Link } from "react-router-dom";

import { formatHash, formatNumber, formatRelativeTime, formatStatus, formatVlq } from "../../helpers/publicApi";

// Original 2D Vorliq interface cards. Each is built from React, CSS and inline
// SVG. Nothing is a screenshot or copied asset. Cards that can show real public
// data do; the rest are honestly labelled as product previews. Every card is a
// real link to the relevant route, clickable across its full area.

function LineIcon({ paths, viewBox = "0 0 24 24" }) {
  return (
    <svg viewBox={viewBox} className="vq-ui-icon" aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="vq-ui-cta__arrow" aria-hidden="true" focusable="false">
      <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chrome({ title, badge, live }) {
  return (
    <div className="vq-ui__chrome">
      <span className="vq-ui__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="vq-ui__title">{title}</span>
      <span className={`vq-ui__chip ${live ? "live" : "preview"}`}>{badge}</span>
    </div>
  );
}

// A card is a single Link so the whole area is clickable, with a clear CTA row.
function InterfaceCard({ to, label, variant, title, badge, live, cta, children }) {
  return (
    <Link className={`vq-ui vq-ui--${variant}`} to={to} aria-label={label} data-vq-track={`card:${variant}`}>
      <Chrome title={title} badge={badge} live={live} />
      <div className="vq-ui__body">{children}</div>
      <span className="vq-ui-cta">
        {cta}
        <Arrow />
      </span>
    </Link>
  );
}

export function WalletInterfaceCard({ to = "/wallet" }) {
  const rows = [
    { label: "Community deposit", amount: "+120 VLQ", dir: "in" },
    { label: "Pool contribution", amount: "-40 VLQ", dir: "out" },
    { label: "Mining reward", amount: "+50 VLQ", dir: "in" },
  ];
  return (
    <InterfaceCard to={to} variant="wallet" title="Wallet" badge="Product preview" cta="Open your wallet" label="Open the Vorliq wallet">
      <div className="vq-wallet-balance">
        <span className="vq-ui__muted">Total balance</span>
        <strong>
          1,250.00 <span>VLQ</span>
        </strong>
        <span className="vq-ui__trend up">Self custody, on the Vorliq chain</span>
      </div>
      <div className="vq-wallet-actions">
        <span className="vq-ui-btn primary">
          <LineIcon paths={["M12 5v14", "M5 12h14"]} /> Send
        </span>
        <span className="vq-ui-btn">
          <LineIcon paths={["M5 12h14", "M12 5l-7 7 7 7"]} /> Receive
        </span>
      </div>
      <ul className="vq-wallet-rows">
        {rows.map((row) => (
          <li key={row.label}>
            <span className={`vq-row-icon ${row.dir}`} aria-hidden="true">
              <LineIcon paths={row.dir === "in" ? ["M12 19V5", "M5 12l7-7 7 7"] : ["M12 5v14", "M5 12l7 7 7-7"]} />
            </span>
            <span className="vq-row-label">{row.label}</span>
            <span className={`vq-row-amount ${row.dir}`}>{row.amount}</span>
          </li>
        ))}
      </ul>
    </InterfaceCard>
  );
}

export function SavingsPoolInterfaceCard({ to = "/register" }) {
  return (
    <InterfaceCard to={to} variant="pool" title="Community savings pool" badge="Product preview" cta="Start saving together" label="Create an account to save together">
      <div className="vq-pool-head">
        <div>
          <span className="vq-ui__muted">Pooled together</span>
          <strong className="vq-pool-amount">8,400 VLQ</strong>
        </div>
        <span className="vq-ui-chip-soft">On chain</span>
      </div>
      <div className="vq-pool-bar">
        <span style={{ width: "68%" }} />
      </div>
      <div className="vq-pool-meta">
        <span>68 percent of shared goal</span>
        <span>Open contributions</span>
      </div>
      <div className="vq-pool-members">
        <div className="vq-avatars" aria-hidden="true">
          {["g", "c", "b", "g", "c"].map((tone, i) => (
            <i key={i} className={tone} />
          ))}
          <span className="vq-pool-more">+7</span>
        </div>
        <span className="vq-ui__muted">12 members saving together</span>
      </div>
    </InterfaceCard>
  );
}

export function GovernanceInterfaceCard({ to = "/governance" }) {
  return (
    <InterfaceCard to={to} variant="gov" title="Governance proposal" badge="Product preview" cta="See how voting works" label="Open Vorliq governance">
      <div className="vq-gov-head">
        <span className="vq-ui-chip-soft live">Voting open</span>
        <span className="vq-ui__muted">Proposal 14</span>
      </div>
      <h4 className="vq-gov-title">Adjust the community mining reward</h4>
      <p className="vq-gov-copy">
        A request to move the per block reward within the range agreed by members. Every vote is signed and recorded.
      </p>
      <div className="vq-vote">
        <div className="vq-vote-row">
          <span>For</span>
          <span className="vq-vote-track">
            <i className="for" style={{ width: "72%" }} />
          </span>
          <span className="vq-vote-num">72%</span>
        </div>
        <div className="vq-vote-row">
          <span>Against</span>
          <span className="vq-vote-track">
            <i className="against" style={{ width: "28%" }} />
          </span>
          <span className="vq-vote-num">28%</span>
        </div>
      </div>
    </InterfaceCard>
  );
}

export function ExplorerInterfaceCard({ snapshot, loading, to = "/blockchain" }) {
  const blocks = snapshot?.blocks?.slice(0, 4) || [];
  const unavailable = snapshot?.unavailable?.blocks;
  return (
    <InterfaceCard to={to} variant="explorer" title="Blockchain explorer" badge="Live data" live cta="Open the explorer" label="Open the Vorliq blockchain explorer">
      {loading ? (
        <div className="vq-ui-empty">Loading recent blocks…</div>
      ) : unavailable || !blocks.length ? (
        <div className="vq-ui-empty">Recent block data is unavailable right now.</div>
      ) : (
        <ul className="vq-explorer-rows">
          {blocks.map((block, i) => (
            <li className="vq-explorer-row" key={block.hash || block.index} style={{ animationDelay: `${i * 90}ms` }}>
              <span className="vq-block-badge" aria-hidden="true">
                <LineIcon paths={["M4 7l8-4 8 4v10l-8 4-8-4z", "M4 7l8 4 8-4", "M12 11v10"]} />
              </span>
              <span className="vq-explorer-main">
                <span className="vq-explorer-index">Block #{formatNumber(block.index)}</span>
                <span className="vq-explorer-hash" title={block.hash || undefined}>
                  {formatHash(block.hash)}
                </span>
              </span>
              <span className="vq-explorer-meta">{block.transaction_count ?? (block.transactions || []).length} tx</span>
            </li>
          ))}
        </ul>
      )}
    </InterfaceCard>
  );
}

export function ReadinessInterfaceCard({ snapshot, status, statusLoading, to = "/readiness" }) {
  const readiness = status?.readiness;
  const propagation = status?.propagation;
  const score = readiness?.score;
  const overall = readiness?.overall_status;
  const chainValid = snapshot?.summary?.chain_valid;
  const chainKnown = snapshot != null && !snapshot.unavailable?.summary;
  const activePeers = propagation?.active_peer_count;
  const statusLabel = statusLoading ? "Checking" : overall ? formatStatus(overall) : "Unavailable";

  return (
    <InterfaceCard to={to} variant="health" title="Network readiness" badge="Live data" live cta="View transparency" label="Open Vorliq network readiness">
      <div className="vq-health-top">
        <div className={`vq-health-ring ${overall || "unknown"}`}>
          <strong>{statusLoading ? "…" : score != null ? score : "—"}</strong>
          <span>score</span>
        </div>
        <div className="vq-health-status">
          <span className={`vq-ui-chip-soft ${overall === "pass" ? "live" : ""}`}>{statusLabel}</span>
          <span className="vq-ui__muted">Readiness is a technical signal, not a legal status.</span>
        </div>
      </div>
      <ul className="vq-health-list">
        <li>
          <span>Chain validation</span>
          <span className={chainValid ? "ok" : "muted"}>
            {!chainKnown ? "Unavailable" : chainValid ? "Valid" : "Under review"}
          </span>
        </li>
        <li>
          <span>Active peers</span>
          <span className="muted">{statusLoading ? "…" : activePeers != null ? formatNumber(activePeers) : "Unavailable"}</span>
        </li>
        <li>
          <span>Index health</span>
          <span className="muted">{statusLoading ? "…" : formatStatus(readiness?.index_health)}</span>
        </li>
      </ul>
    </InterfaceCard>
  );
}

export function TransactionListCard({ snapshot, loading, to = "/blockchain" }) {
  const transactions = snapshot
    ? [...(snapshot.confirmedTransactions || []), ...(snapshot.pendingTransactions || [])].slice(0, 4)
    : [];
  return (
    <InterfaceCard to={to} variant="tx" title="Recent transactions" badge="Live data" live cta="Open the explorer" label="Open recent Vorliq transactions">
      {loading ? (
        <div className="vq-ui-empty">Loading transactions…</div>
      ) : transactions.length ? (
        <ul className="vq-tx-rows">
          {transactions.map((tx, i) => {
            const pending = tx.status === "pending";
            return (
              <li className="vq-tx-row" key={tx.tx_id || i} style={{ animationDelay: `${i * 90}ms` }}>
                <span className={`vq-tx-status ${pending ? "pending" : "ok"}`} aria-hidden="true" />
                <span className="vq-tx-main">
                  <span className="vq-tx-hash" title={tx.tx_id || undefined}>
                    {formatHash(tx.tx_id)}
                  </span>
                  <span className="vq-tx-time">{formatRelativeTime(tx.timestamp) || (pending ? "pending" : "confirmed")}</span>
                </span>
                <span className="vq-tx-amount">{formatVlq(tx.amount)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="vq-ui-empty">No recent transactions to show right now.</div>
      )}
    </InterfaceCard>
  );
}
