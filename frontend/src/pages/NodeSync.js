import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const filters = [
  { label: "All", value: "" },
  { label: "Synced", value: "synced" },
  { label: "Behind", value: "behind" },
  { label: "Ahead", value: "ahead" },
  { label: "Forked", value: "forked" },
  { label: "Stale", value: "stale" },
  { label: "Unreachable", value: "unreachable" },
];

const statusMeanings = [
  ["Synced", "Active, valid, same height, and same latest hash as the trusted public chain."],
  ["Behind", "Valid, but lower than the trusted public chain height."],
  ["Ahead", "Higher than the trusted public chain. This is a signal, not automatic trust."],
  ["Forked", "Latest hash does not match the trusted chain at the comparable height."],
  ["Stale", "Last heartbeat is outside the active window."],
  ["Unreachable", "The node diagnostics could not be checked."],
  ["Unknown", "Missing enough safe data to compare confidently."],
];

function badgeClass(status) {
  if (status === "synced" || status === "low" || status === "ok") return "pass";
  if (status === "forked" || status === "high" || status === "critical") return "fail";
  return "warning";
}

function shortHash(hash) {
  if (!hash) return "unknown";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function timeAgo(timestamp) {
  if (!timestamp) return "unknown";
  const seconds = Math.max(Math.floor(Date.now() / 1000 - Number(timestamp)), 0);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "unknown";
  return String(value);
}

function NodeSync() {
  const [comparison, setComparison] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [activeFilter, setActiveFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadNodeSync() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [compareResponse, monitorResponse, readinessResponse] = await Promise.all([
          api.get("/nodes/compare"),
          api.get("/nodes/monitor").catch(() => ({ data: null })),
          api.get("/readiness").catch(() => ({ data: null })),
        ]);
        if (mounted) {
          setComparison(compareResponse.data);
          setMonitor(monitorResponse.data);
          setReadiness(readinessResponse.data);
        }
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Node sync comparison is unavailable."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadNodeSync();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleNodes = useMemo(
    () => (comparison?.nodes || []).filter((node) => !activeFilter || node.sync_status === activeFilter),
    [comparison, activeFilter]
  );
  const summary = comparison?.summary || {};

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Node Sync</span>
        <h1>Node Sync</h1>
        <p className="subtitle">
          Compare registered public nodes with the trusted public chain using heartbeat data,
          signed snapshot state, and safe fork-awareness signals.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading node sync comparison..." />
        </section>
      ) : comparison ? (
        <>
          <section className="card card-pad health-section">
            <div className="section-title">
              <h2>Network Sync Overview</h2>
              <span className={`status-badge ${badgeClass(summary.overall_status === "synced" ? "synced" : summary.high_risk_count ? "forked" : "warning")}`}>
                {summary.overall_status || "unknown"}
              </span>
            </div>
            <div className="stats-grid compact-stats">
              <div className="stat-card">
                <span>Active nodes</span>
                <strong>{comparison.active_node_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span>Synced</span>
                <strong>{summary.synced_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span>Behind</span>
                <strong>{summary.behind_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span>Ahead</span>
                <strong>{summary.ahead_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span>Forked</span>
                <strong>{summary.forked_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span>Readiness</span>
                <strong>{readiness?.overall_status || "unknown"}</strong>
              </div>
            </div>
          </section>

          <section className="card card-pad health-section">
            <div className="section-title">
              <h2>Network Monitor</h2>
              <span className={`status-badge ${badgeClass(monitor?.overall_status)}`}>
                {monitor?.overall_status || "unknown"}
              </span>
            </div>
            {monitor?.success ? (
              <>
                <div className="stats-grid compact-stats">
                  <div className="stat-card">
                    <span>Trusted public node</span>
                    <strong>{monitor.trusted_public_node_status || "unknown"}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Warnings</span>
                    <strong>{monitor.warning_count ?? 0}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Critical</span>
                    <strong>{monitor.critical_count ?? 0}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Unreachable</span>
                    <strong>{monitor.unreachable_count ?? 0}</strong>
                  </div>
                </div>
                {(monitor.alerts || []).length > 0 && (
                  <div className="release-list">
                    {monitor.alerts.map((item) => (
                      <article className="release-item" key={`${item.code}-${item.node_url || "network"}`}>
                        <span className={`status-badge ${badgeClass(item.severity)}`}>{item.severity}</span>
                        <h3>{item.title}</h3>
                        <p>{item.message}</p>
                        <span className="help-text">{item.operator_action}</span>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">Network monitor is unavailable right now.</div>
            )}
          </section>

          <section className="card card-pad health-section">
            <div className="section-title">
              <h2>Trusted Public Chain</h2>
              <span className={`status-badge ${comparison.trusted_signature_verified ? "pass" : "warning"}`}>
                {comparison.trusted_signature_verified ? "signed" : "review"}
              </span>
            </div>
            <div className="meta-grid">
              <div>
                <span className="meta-label">Trusted node</span>
                <span className="meta-value">{comparison.trusted_node_url}</span>
              </div>
              <div>
                <span className="meta-label">Height</span>
                <span className="meta-value">{displayValue(comparison.trusted_chain_height)}</span>
              </div>
              <div>
                <span className="meta-label">Latest hash</span>
                <span className="meta-value hash-text">{shortHash(comparison.trusted_latest_hash)}</span>
              </div>
              <div>
                <span className="meta-label">Snapshot hash</span>
                <span className="meta-value hash-text">{shortHash(comparison.trusted_snapshot_hash)}</span>
              </div>
            </div>
          </section>

          <section className="card card-pad registry-section stack">
            <div className="section-title">
              <h2>Node Comparison</h2>
              <span className="eyebrow">{visibleNodes.length} shown</span>
            </div>
            <div className="tabs" role="tablist" aria-label="Node sync filters">
              {filters.map((filter) => (
                <button
                  className={`tab-button ${activeFilter === filter.value ? "active" : ""}`}
                  key={filter.value || "all"}
                  type="button"
                  onClick={() => setActiveFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {visibleNodes.length === 0 ? (
              <div className="empty-state">No nodes match this filter.</div>
            ) : (
              <div className="table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>URL</th>
                      <th>Region</th>
                      <th>Active</th>
                      <th>Lifecycle</th>
                      <th>Height</th>
                      <th>Diff</th>
                      <th>Latest hash</th>
                      <th>Sync</th>
                      <th>Risk</th>
                      <th>Last seen</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleNodes.map((node) => (
                      <tr key={node.node_url}>
                        <td>{node.display_name || "Vorliq Node"}</td>
                        <td className="hash-text">{node.node_url}</td>
                        <td>{[node.region, node.country].filter(Boolean).join(", ") || "unknown"}</td>
                        <td>{node.active ? "active" : "inactive"}</td>
                        <td>
                          <span className={`status-badge ${badgeClass(node.lifecycle_status === "active" ? "synced" : "warning")}`}>
                            {node.lifecycle_status || (node.active ? "active" : "inactive")}
                          </span>
                        </td>
                        <td>{displayValue(node.chain_height)}</td>
                        <td>{displayValue(node.height_difference)}</td>
                        <td className="hash-text">{shortHash(node.latest_block_hash)}</td>
                        <td>
                          <span className={`status-badge ${badgeClass(node.sync_status)}`}>
                            {node.sync_label || node.sync_status}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge ${badgeClass(node.risk_level)}`}>
                            {node.risk_level || "unknown"}
                          </span>
                        </td>
                        <td>{timeAgo(node.last_seen)}</td>
                        <td>{node.sync_message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card card-pad health-section">
            <h2>Status Meaning</h2>
            <div className="release-list">
              {statusMeanings.map(([label, text]) => (
                <article className="release-item" key={label}>
                  <h3>{label}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="card card-pad health-section">
            <h2>Operator Fix Commands</h2>
            <div className="table-wrap">
              <table className="stats-table">
                <tbody>
                  <tr>
                    <th>Restart heartbeat</th>
                    <td><code>sudo systemctl restart vorliq-heartbeat.service</code></td>
                  </tr>
                  <tr>
                    <th>Verified bootstrap dry-run</th>
                    <td><code>python3.12 tools/bootstrap_chain_from_public_node.py --trusted-node https://vorliq.org --data-dir ./blockchain/data</code></td>
                  </tr>
                  <tr>
                    <th>Check DNS and HTTPS</th>
                    <td><code>curl -I https://node.example.org/api/health</code></td>
                  </tr>
                  <tr>
                    <th>Update server</th>
                    <td><code>sudo bash deployment/update_server.sh</code></td>
                  </tr>
                  <tr>
                    <th>Run doctor locally</th>
                    <td><code>node tools/node_doctor.js --base-url http://127.0.0.1:5000 --trusted-node https://vorliq.org</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="card card-pad">
          <div className="empty-state">Node sync comparison is unavailable right now.</div>
        </section>
      )}
    </div>
  );
}

export default NodeSync;
