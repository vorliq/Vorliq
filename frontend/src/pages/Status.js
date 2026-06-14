import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  formatHash,
  formatNumber,
  formatStatus,
  formatTime,
  loadNetworkStatus,
  loadPublicChainSnapshot,
} from "../helpers/publicApi";

function readinessLabel(status, loading) {
  if (loading) return "Checking";
  const readiness = status?.readiness;
  if (!readiness || status?.unavailable?.readiness) return "Unavailable";
  return formatStatus(readiness.overall_status);
}

function MetricCard({ label, value, mono, title }) {
  return (
    <div className="card card-pad stat-card compact-stat vq-metric">
      <span className="stat-label">{label}</span>
      <span className={`stat-value vq-metric__value ${mono ? "vq-metric__value--mono" : ""}`} title={title || undefined}>
        {value}
      </span>
    </div>
  );
}

function StatusSection({ title, eyebrow, live, loading, children, action }) {
  return (
    <section className="card card-pad stack" aria-label={title}>
      <div className="section-title">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <div className="vq-live-head-actions">
          <span className={`status-badge ${loading ? "active" : live ? "executed" : "expired"}`} role="status">
            {loading ? "Checking" : live ? "Live data" : "Unavailable"}
          </span>
          {action}
        </div>
      </div>
      <div className="grid vq-live-grid">{children}</div>
    </section>
  );
}

function Status() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadPublicChainSnapshot()
      .then((data) => mounted && setSnapshot(data))
      .catch(() => mounted && setSnapshot(null))
      .finally(() => mounted && setLoading(false));
    loadNetworkStatus()
      .then((data) => mounted && setStatus(data))
      .catch(() => mounted && setStatus(null))
      .finally(() => mounted && setStatusLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const summary = snapshot?.summary || {};
  const latestBlock = snapshot?.blocks?.[0];
  const propagation = status?.propagation;
  const deployment = status?.deployment;
  const readiness = status?.readiness;

  const chainLive = !loading && snapshot && !snapshot.unavailable?.summary;
  const deployLive = !statusLoading && deployment && !status?.unavailable?.deployment;
  const readinessLive = !statusLoading && readiness && !status?.unavailable?.readiness;
  const peersLive = !statusLoading && propagation && !status?.unavailable?.propagation;

  function chainValue(available, content) {
    if (loading) return "…";
    return available ? content : "Unavailable";
  }
  function statusValue(available, content) {
    if (statusLoading) return "…";
    return available ? content : "Unavailable";
  }

  return (
    <div className="page stack">
      <section className="hero">
        <span className="eyebrow">Transparency</span>
        <h1>Network status</h1>
        <p className="subtitle">
          A live, read-only view of the Vorliq network from the public APIs: chain height, latest block, readiness,
          the deployed version, and peer propagation. When a value is not available it is shown as unavailable, never
          estimated.
        </p>
      </section>

      <StatusSection
        title="Chain"
        eyebrow="Vorliq chain"
        live={chainLive}
        loading={loading}
        action={
          <Link className="button secondary small-button" to="/blockchain">
            Open Explorer
          </Link>
        }
      >
        <MetricCard
          label="Chain height"
          value={chainValue(!snapshot?.unavailable?.summary && summary.block_height != null, `#${formatNumber(summary.block_height)}`)}
        />
        <MetricCard
          label="Latest block"
          value={chainValue(latestBlock?.hash != null, latestBlock ? formatHash(latestBlock.hash) : null)}
          title={latestBlock?.hash}
          mono
        />
        <MetricCard
          label="Transactions"
          value={chainValue(!snapshot?.unavailable?.summary && summary.total_transactions != null, formatNumber(summary.total_transactions))}
        />
        <MetricCard
          label="Chain status"
          value={chainValue(!snapshot?.unavailable?.summary, summary.chain_valid ? formatStatus("valid") : "Under review")}
        />
      </StatusSection>

      <StatusSection
        title="Readiness"
        eyebrow="Technical readiness"
        live={readinessLive}
        loading={statusLoading}
        action={
          <Link className="button secondary small-button" to="/readiness">
            Open Readiness
          </Link>
        }
      >
        <MetricCard label="Overall" value={readinessLabel(status, statusLoading)} />
        <MetricCard label="Score" value={statusValue(readiness?.score != null, formatNumber(readiness?.score))} />
        <MetricCard label="Index health" value={statusValue(Boolean(readiness?.index_health), formatStatus(readiness?.index_health))} />
        <MetricCard
          label="Checks"
          value={statusValue(Array.isArray(readiness?.checks), `${(readiness?.checks || []).length} checks`)}
        />
      </StatusSection>

      <StatusSection title="Deployment" eyebrow="Deployed version" live={deployLive} loading={statusLoading}>
        <MetricCard
          label="Commit"
          value={statusValue(Boolean(deployment?.commit_hash), deployment?.commit_hash ? deployment.commit_hash.slice(0, 10) : null)}
          title={deployment?.commit_hash}
          mono
        />
        <MetricCard
          label="Deployed at"
          value={statusValue(Boolean(deployment?.commit_timestamp), deployment ? formatTime(Date.parse(deployment.commit_timestamp) / 1000) : null)}
        />
      </StatusSection>

      <StatusSection
        title="Peer propagation"
        eyebrow="Decentralization"
        live={peersLive}
        loading={statusLoading}
        action={
          <Link className="button secondary small-button" to="/peers/propagation">
            Open Propagation
          </Link>
        }
      >
        <MetricCard label="Active peers" value={statusValue(propagation?.active_peer_count != null, formatNumber(propagation?.active_peer_count))} />
        <MetricCard
          label="Broadcast peers"
          value={statusValue(propagation?.eligible_broadcast_peer_count != null, formatNumber(propagation?.eligible_broadcast_peer_count))}
        />
        <MetricCard label="Propagation" value={peersLive ? "Operational" : statusLoading ? "…" : "Unavailable"} />
      </StatusSection>

      <p className="muted-text">
        This page reads only public Vorliq APIs. It is a transparency view and not a guarantee of uptime, value, or
        legal status.
      </p>
    </div>
  );
}

export default Status;
