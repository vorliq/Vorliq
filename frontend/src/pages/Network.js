import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const initialNetworkData = {
  peers: null,
  registryNodes: null,
  registrySummary: null,
  registryLifecycle: null,
  nodeComparison: null,
  nodeMonitor: null,
  peerPropagation: null,
  bootstrapStatus: null,
  bootstrapPackage: null,
  snapshotVerification: null,
  auditManifest: null,
  readiness: null,
  networkManifest: null,
};

const statusMeanings = [
  ["Synced", "Active, valid, same trusted height, and same latest hash."],
  ["Behind", "Valid, but lower than the trusted public chain."],
  ["Ahead", "A warning signal until signed snapshots and audit exports verify the newer state."],
  ["Forked", "A comparable latest hash mismatch. Treat this as serious before syncing from it."],
  ["Stale", "Heartbeat is outside the active window. Usually an operator repair item."],
  ["Unreachable", "Diagnostics could not be checked. Verify service, DNS, HTTPS, and firewall setup."],
];

function badgeClass(status) {
  if (status === true || ["pass", "ok", "synced", "verified", "signed", "low"].includes(status)) return "pass";
  if (["fail", "critical", "forked", "invalid", "high"].includes(status)) return "fail";
  return "warning";
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "unavailable";
  return String(value);
}

function displayCount(value, available) {
  if (!available || value === null || value === undefined) return "unavailable";
  return String(value);
}

function shortHash(hash) {
  if (!hash) return "unavailable";
  if (String(hash).length <= 18) return String(hash);
  return `${String(hash).slice(0, 10)}...${String(hash).slice(-8)}`;
}

function safeEndpointLabel(value, index) {
  if (!value) return `Node ${index + 1}`;
  return `Node ${index + 1} endpoint hidden`;
}

function lifecycleCount(nodes, status) {
  return nodes.filter((node) => (node.lifecycle_status || (node.active ? "active" : "inactive")) === status).length;
}

async function getPublicData(path, config) {
  try {
    const response = await api.get(path, config);
    return response.data || null;
  } catch {
    return null;
  }
}

function Metric({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Network() {
  const [peerUrl, setPeerUrl] = useState("");
  const [data, setData] = useState(initialNetworkData);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [peerStatuses, setPeerStatuses] = useState({});
  const [errorMessage, setErrorMessage] = useState("");

  async function loadNetwork({ quiet = false } = {}) {
    const requests = {
      peers: getPublicData("/peers"),
      registryNodes: getPublicData("/registry/nodes"),
      registrySummary: getPublicData("/registry/summary"),
      registryLifecycle: getPublicData("/registry/lifecycle", { params: { include_archived: true } }),
      nodeComparison: getPublicData("/nodes/compare"),
      nodeMonitor: getPublicData("/nodes/monitor"),
      peerPropagation: getPublicData("/peers/propagation/status"),
      bootstrapStatus: getPublicData("/bootstrap/status"),
      bootstrapPackage: getPublicData("/bootstrap/package"),
      snapshotVerification: getPublicData("/snapshot/verify"),
      auditManifest: getPublicData("/audit/manifest"),
      readiness: getPublicData("/readiness"),
      networkManifest: getPublicData("/network/manifest"),
    };
    const entries = await Promise.all(
      Object.entries(requests).map(async ([key, request]) => [key, await request])
    );
    const nextData = Object.fromEntries(entries);
    const anyPublicData = Object.values(nextData).some(Boolean);

    setData(nextData);
    setLoading(false);
    if (anyPublicData) {
      setErrorMessage("");
    } else if (!quiet) {
      const message = "Network status is unavailable right now.";
      setErrorMessage(message);
      toast.error(message);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadMountedNetwork(options) {
      if (!mounted) return;
      await loadNetwork(options);
    }

    loadMountedNetwork();
    const timer = window.setInterval(() => {
      loadMountedNetwork({ quiet: true });
    }, 10000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  async function addPeer(event) {
    event.preventDefault();

    if (!peerUrl.trim()) {
      toast.error("Enter a peer endpoint first.");
      return;
    }

    setAdding(true);
    try {
      const response = await api.post("/peers/add", {
        peer: peerUrl.trim(),
      });
      setData((current) => ({ ...current, peers: { ...(current.peers || {}), peers: response.data.peers || [] } }));
      setPeerUrl("");
      setErrorMessage("");
      toast.success("Peer added to your Vorliq node.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to add peer.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setAdding(false);
    }
  }

  async function addPeerUrl(url) {
    try {
      const response = await api.post("/peers/add", { peer: url });
      setData((current) => ({ ...current, peers: { ...(current.peers || {}), peers: response.data.peers || [] } }));
      setErrorMessage("");
      toast.success("Node added to your Vorliq node.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to add peer.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function syncChain() {
    setSyncing(true);
    try {
      const response = await api.post("/peers/sync");
      setPeerStatuses(response.data.peer_statuses || {});
      if (response.data.updated) {
        toast.success("Chain updated to a longer network chain.");
      } else {
        toast.info("Your chain is already the longest.");
      }
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to sync chain.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  const peers = data.peers?.peers || [];
  const recommendedNodes = data.registryNodes?.nodes || [];
  const lifecycleNodes = data.registryLifecycle?.nodes || [];
  const registrySummary = data.registrySummary?.summary || {};
  const comparisonSummary = data.nodeComparison?.summary || {};
  const propagation = data.peerPropagation;
  const nodeMonitor = data.nodeMonitor;
  const seriousWarnings = useMemo(() => {
    const warnings = [];
    if (data.nodeComparison?.success && (comparisonSummary.forked_count || 0) > 0) {
      warnings.push("Forked public nodes are reporting a comparable hash mismatch.");
    }
    if (data.nodeComparison?.success && (comparisonSummary.ahead_count || 0) > 0) {
      warnings.push("Ahead public nodes need signed snapshot and audit export verification before trust.");
    }
    if (nodeMonitor?.success && (nodeMonitor.critical_count || 0) > 0) {
      warnings.push("Critical network monitor alerts are active.");
    }
    if (data.readiness?.success && ["fail", "critical"].includes(data.readiness.overall_status)) {
      warnings.push("Readiness is failing for one or more release gate checks.");
    }
    return warnings;
  }, [comparisonSummary.ahead_count, comparisonSummary.forked_count, data.nodeComparison, data.readiness, nodeMonitor]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Decentralization Status</span>
        <h1>Network</h1>
        <p className="subtitle">
          Inspect public node counts, trusted chain sync, peer propagation, signed snapshots,
          bootstrap safety, audit exports, and readiness without exposing private operator details.
        </p>
        <div className="hero-actions">
          <a className="button" href="/nodes/compare">Node Sync</a>
          <a className="button secondary" href="/peers/propagation">Peer Propagation</a>
          <a className="button secondary" href="/readiness">Readiness</a>
        </div>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Public Network Overview</h2>
          <span className={`status-badge ${badgeClass(comparisonSummary.overall_status || data.readiness?.overall_status)}`}>
            {comparisonSummary.overall_status || data.readiness?.overall_status || "unavailable"}
          </span>
        </div>
        {loading ? (
          <Spinner label="Loading public network status..." />
        ) : (
          <div className="stats-grid compact-stats">
            <Metric
              label="Registered nodes"
              value={displayCount(
                registrySummary.total_registered_node_count ?? comparisonSummary.total_node_count ?? recommendedNodes.length,
                Boolean(data.registrySummary?.success || data.nodeComparison?.success || data.registryNodes?.success)
              )}
            />
            <Metric
              label="Active nodes"
              value={displayCount(
                registrySummary.active_node_count ?? comparisonSummary.active_node_count ?? data.nodeComparison?.active_node_count,
                Boolean(data.registrySummary?.success || data.nodeComparison?.success)
              )}
            />
            <Metric
              label="Synced nodes"
              value={displayCount(
                registrySummary.synced_node_count ?? comparisonSummary.synced_count,
                Boolean(data.registrySummary?.success || data.nodeComparison?.success)
              )}
            />
            <Metric
              label="Behind"
              value={displayCount(registrySummary.behind_node_count ?? comparisonSummary.behind_count, Boolean(data.registrySummary?.success || data.nodeComparison?.success))}
            />
            <Metric
              label="Forked"
              value={displayCount(comparisonSummary.forked_count, Boolean(data.nodeComparison?.success))}
            />
            <Metric
              label="Stale or unreachable"
              value={displayCount(
                (comparisonSummary.stale_count ?? 0) + (comparisonSummary.unreachable_count ?? 0),
                Boolean(data.nodeComparison?.success)
              )}
            />
          </div>
        )}
      </section>

      <div className="grid two-column">
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>Trusted Chain Sync</h2>
            <span className={`status-badge ${badgeClass(comparisonSummary.overall_status)}`}>
              {comparisonSummary.overall_status || "unavailable"}
            </span>
          </div>
          {data.nodeComparison?.success ? (
            <div className="meta-grid">
              <div>
                <span className="meta-label">Trusted height</span>
                <span className="meta-value">{displayValue(data.nodeComparison.trusted_chain_height)}</span>
              </div>
              <div>
                <span className="meta-label">Signed snapshot</span>
                <span className="meta-value">{data.nodeComparison.trusted_signature_verified ? "verified" : "review"}</span>
              </div>
              <div>
                <span className="meta-label">Latest hash</span>
                <span className="meta-value hash-text">{shortHash(data.nodeComparison.trusted_latest_hash)}</span>
              </div>
              <div>
                <span className="meta-label">Snapshot hash</span>
                <span className="meta-value hash-text">{shortHash(data.nodeComparison.trusted_snapshot_hash)}</span>
              </div>
            </div>
          ) : (
            <div className="empty-state">Node comparison is unavailable right now.</div>
          )}
        </section>

        <section className="card card-pad stack">
          <div className="section-title">
            <h2>Peer Propagation</h2>
            <span className={`status-badge ${badgeClass(propagation?.receive_enabled ? "ok" : "warning")}`}>
              {propagation?.success ? (propagation.receive_enabled ? "receiving" : "review") : "unavailable"}
            </span>
          </div>
          {propagation?.success ? (
            <div className="stats-grid compact-stats">
              <Metric label="Receive" value={propagation.receive_enabled ? "enabled" : "disabled"} />
              <Metric label="Broadcast" value={propagation.broadcast_enabled ? "enabled" : "disabled"} />
              <Metric label="Eligible peers" value={displayCount(propagation.eligible_broadcast_peer_count, true)} />
              <Metric label="Quarantined" value={displayCount(propagation.quarantined, true)} />
            </div>
          ) : (
            <div className="empty-state">Peer propagation status is unavailable right now.</div>
          )}
          <p className="help-text">
            Broadcast disabled can be normal during receive-only validation. Non-next blocks should
            be quarantined rather than trusted automatically.
          </p>
        </section>
      </div>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Bootstrap, Snapshot, Audit</h2>
          <span className={`status-badge ${badgeClass(data.snapshotVerification?.verified || data.snapshotVerification?.signature_verified)}`}>
            {data.snapshotVerification?.success ? "snapshot checked" : "unavailable"}
          </span>
        </div>
        <div className="stats-grid compact-stats">
          <Metric
            label="Bootstrap package"
            value={data.bootstrapPackage?.success ? "available" : "unavailable"}
          />
          <Metric
            label="Bootstrap chain"
            value={data.bootstrapStatus?.success ? (data.bootstrapStatus.chain_valid ? "valid" : "review") : "unavailable"}
          />
          <Metric
            label="Snapshot signature"
            value={data.snapshotVerification?.success ? (data.snapshotVerification.signature_verified || data.snapshotVerification.verified ? "verified" : "review") : "unavailable"}
          />
          <Metric
            label="Audit exports"
            value={data.auditManifest?.success ? displayCount((data.auditManifest.exports || []).length, true) : "unavailable"}
          />
          <Metric
            label="Readiness"
            value={data.readiness?.success ? displayValue(data.readiness.overall_status) : "unavailable"}
          />
          <Metric
            label="Manifest"
            value={data.networkManifest?.success ? "available" : "unavailable"}
          />
        </div>
      </section>

      <section className="card card-pad peer-section">
        <div className="section-title">
          <h2>Warnings</h2>
          <span className={`status-badge ${seriousWarnings.length ? "warning" : "pass"}`}>
            {seriousWarnings.length ? "review" : "normal"}
          </span>
        </div>
        {seriousWarnings.length > 0 ? (
          <div className="release-list">
            {seriousWarnings.map((warning) => (
              <article className="release-item" key={warning}>
                <span className="status-badge warning">warning</span>
                <p>{warning}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="success-box">No serious public decentralization warnings are active in the available status data.</div>
        )}
        <div className="release-list">
          {statusMeanings.map(([label, description]) => (
            <article className="release-item" key={label}>
              <h3>{label}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Registry Lifecycle</h2>
          <span className="eyebrow">
            {displayCount(lifecycleNodes.length, Boolean(data.registryLifecycle?.success))} public records
          </span>
        </div>
        <div className="stats-grid compact-stats">
          <Metric label="Active" value={displayCount(lifecycleCount(lifecycleNodes, "active"), Boolean(data.registryLifecycle?.success))} />
          <Metric label="Stale" value={displayCount(lifecycleCount(lifecycleNodes, "stale"), Boolean(data.registryLifecycle?.success))} />
          <Metric label="Inactive" value={displayCount(lifecycleCount(lifecycleNodes, "inactive"), Boolean(data.registryLifecycle?.success))} />
          <Metric label="Archived" value={displayCount(lifecycleCount(lifecycleNodes, "archived"), Boolean(data.registryLifecycle?.success))} />
          <Metric label="Retired" value={displayCount(lifecycleCount(lifecycleNodes, "retired"), Boolean(data.registryLifecycle?.success))} />
          <Metric label="History" value={data.registryLifecycle?.success ? "preserved" : "unavailable"} />
        </div>
        <p className="help-text">
          Archived and retired nodes remain visible as public lifecycle signals, but they should not
          be treated as default live peers.
        </p>
      </section>

      <section className="card card-pad peer-section">
        <div className="section-title">
          <h2>Node Operator Tools</h2>
          <span className="eyebrow">Verified onboarding</span>
        </div>
        <div className="button-row">
          <a className="button secondary small-button" href="/docs/run-your-own-node.html">Node Guide</a>
          <a className="button secondary small-button" href="/docs/setup.html">Setup Docs</a>
          <a className="button secondary small-button" href="/docs/bootstrap-chain.html">Bootstrap Docs</a>
          <a className="button secondary small-button" href="/docs/bootstrap-verification.html">Bootstrap Verification</a>
          <a className="button secondary small-button" href="/docs/node-sync.html">Node Sync Docs</a>
          <a className="button secondary small-button" href="/docs/peer-propagation.html">Propagation Docs</a>
          <a className="button secondary small-button" href="/docs/audit.html">Audit Docs</a>
          <a className="button secondary small-button" href="/nodes/compare">Node Sync</a>
          <a className="button secondary small-button" href="/peers/propagation">Peer Propagation</a>
          <a className="button secondary small-button" href="/bootstrap">Bootstrap Node</a>
          <a className="button secondary small-button" href="/readiness">Readiness Page</a>
          <a className="button secondary small-button" href="/audit">Audit Page</a>
        </div>
      </section>

      <div className="grid two-column">
        <section className="card card-pad stack">
          <h2>Add Peer</h2>
          <p className="help-text">
            This sends the endpoint only to your local Vorliq node. Public views below hide raw peer endpoints.
          </p>
          <form className="form" onSubmit={addPeer}>
            <div className="field">
              <label htmlFor="peer-url">Peer endpoint</label>
              <input
                id="peer-url"
                className="input"
                type="url"
                placeholder="https://community-node.example.org"
                value={peerUrl}
                onChange={(event) => setPeerUrl(event.target.value)}
              />
            </div>
            <button className="button" type="submit" disabled={adding}>
              {adding ? "Adding..." : "Add Peer"}
            </button>
          </form>
        </section>

        <section className="card card-pad stack">
          <h2>Sync Chain</h2>
          <p>
            Ask connected peers for their latest chain and adopt the longest valid chain only when
            validation passes.
          </p>
          <button className="button secondary" onClick={syncChain} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Chain Now"}
          </button>
        </section>
      </div>

      <section className="card card-pad peer-section">
        <div className="section-title">
          <h2>Known Peers</h2>
          <span className="eyebrow">Auto refreshes every 10 seconds</span>
        </div>

        {loading && <Spinner label="Loading peers..." />}

        {!loading && peers.length === 0 && (
          <div className="empty-state">No peers registered yet.</div>
        )}

        <div className="peer-list">
          {peers.map((peer, index) => (
            <div className="peer-item" key={peer}>
              <span className="peer-url">
                <span
                  className={`status-dot ${peerStatuses[peer] ? "online" : "unknown"}`}
                  aria-label={peerStatuses[peer] ? "peer reached" : "peer not reached"}
                />
                {safeEndpointLabel(peer, index)}
              </span>
              <button
                className="button secondary small-button"
                type="button"
                onClick={() => toast.info("Peer removal coming in the next version.")}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad peer-section">
        <div className="section-title">
          <h2>Recommended Active Nodes</h2>
          <span className="eyebrow">{displayCount(recommendedNodes.length, Boolean(data.registryNodes?.success))} from registry</span>
        </div>
        {!loading && recommendedNodes.length === 0 && (
          <div className="empty-state">No active registry nodes are available right now.</div>
        )}
        <div className="peer-list">
          {recommendedNodes.map((node, index) => (
            <div className="peer-item" key={node.node_url || `${node.display_name}-${index}`}>
              <span className="peer-url">
                <span
                  className={`status-dot ${node.sync_status === "synced" ? "online" : "unknown"}`}
                  aria-label={`${node.sync_status || "unknown"} node`}
                />
                <span>
                  <strong>{node.display_name || `Vorliq node ${index + 1}`}</strong>
                  <span className="meta-value">{safeEndpointLabel(node.node_url, index)}</span>
                </span>
              </span>
              <span className="meta-label">
                Height {displayValue(node.last_chain_height)} - Reliability {displayValue(node.reliability_score)}%
              </span>
              <button
                className="button secondary small-button"
                type="button"
                onClick={() => addPeerUrl(node.node_url)}
                disabled={!node.node_url}
              >
                Add Node
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Network;
