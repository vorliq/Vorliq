import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import RevealSection from "../components/RevealSection";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const STATUS_LABELS = {
  pass: "Pass",
  warning: "Warning",
  fail: "Fail",
};

function groupByCategory(checks = []) {
  return checks.reduce((groups, check) => {
    const category = check.category || "Other";
    if (!groups[category]) groups[category] = [];
    groups[category].push(check);
    return groups;
  }, {});
}

function Readiness() {
  const [readiness, setReadiness] = useState(null);
  const [nodeMonitor, setNodeMonitor] = useState(null);
  const [deployment, setDeployment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadReadiness() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [response, monitorResponse, deploymentResponse] = await Promise.all([
          api.get("/readiness"),
          api.get("/nodes/monitor").catch(() => ({ data: null })),
          api.get("/deployment").catch(() => ({ data: null })),
        ]);
        if (mounted) {
          setReadiness(response.data);
          setNodeMonitor(monitorResponse.data);
          setDeployment(deploymentResponse.data);
        }
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Production readiness is unavailable."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadReadiness();
    return () => {
      mounted = false;
    };
  }, []);

  const groupedChecks = useMemo(() => groupByCategory(readiness?.checks || []), [readiness]);
  const failingChecks = (readiness?.checks || []).filter((check) => check.status === "fail");
  const warningChecks = (readiness?.checks || []).filter((check) => check.status === "warning");

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Production Gate</span>
        <h1>Readiness</h1>
        <p className="subtitle">
          A technical quality gate for release health, security, storage, backups, audit, API, deployment, and node status.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading readiness score..." />
        </section>
      ) : readiness ? (
        <>
          <RevealSection className="card card-pad">
            <div className="section-title">
              <h2>Production Readiness</h2>
              <span className={`status-badge ${readiness.overall_status}`}>
                {STATUS_LABELS[readiness.overall_status] || readiness.overall_status}
              </span>
            </div>
            <div className="readiness-score-row">
              <div className={`readiness-score ${readiness.overall_status}`}>
                <strong>{readiness.score}</strong>
                <span>/100</span>
              </div>
              <div>
                <p>
                  Checked at{" "}
                  {readiness.checked_at ? new Date(readiness.checked_at).toLocaleString() : "unknown time"}.
                </p>
                <p className="help-text">
                  This is a technical readiness signal only. It is not proof of legal status,
                  financial value, operating safety, or future outcomes.
                </p>
              </div>
            </div>
            <div className="stats-grid compact-stats">
              <div className="stat-card">
                <span>Index health</span>
                <strong>{readiness.index_health || "unknown"}</strong>
              </div>
              <div className="stat-card">
                <span>Deployed commit</span>
                <strong className="hash-text">{deployment?.commit_hash || readiness.deployment_commit || "unknown"}</strong>
              </div>
              <div className="stat-card">
                <span>Index rebuild needed</span>
                <strong>{readiness.index_rebuild_needed ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Index chain match</span>
                <strong>{readiness.index_chain_match ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Migration readiness</span>
                <strong>{readiness.migration_readiness_available ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Storage backend</span>
                <strong>{readiness.storage_backend || "unknown"}</strong>
              </div>
              <div className="stat-card">
                <span>Database enabled</span>
                <strong>{readiness.database_enabled ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Future database</span>
                <strong>{readiness.future_database_target || "unknown"}</strong>
              </div>
              <div className="stat-card">
                <span>PostgreSQL active</span>
                <strong>{readiness.postgres_active ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>PostgreSQL schema</span>
                <strong>{readiness.postgres_schema_present ? "Present" : "Missing"}</strong>
              </div>
              <div className="stat-card">
                <span>Migration tools</span>
                <strong>{readiness.migration_tools_available ? "Available" : "Unavailable"}</strong>
              </div>
              <div className="stat-card">
                <span>Snapshot endpoint</span>
                <strong>{readiness.snapshot_endpoint_available ? "Available" : "Unavailable"}</strong>
              </div>
              <div className="stat-card">
                <span>Snapshot verified</span>
                <strong>{readiness.snapshot_verify_passed ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Snapshot secret scan</span>
                <strong>{readiness.snapshot_secret_scan_passed ? "Passed" : "Review"}</strong>
              </div>
              <div className="stat-card">
                <span>Snapshot signature</span>
                <strong>{readiness.snapshot_signature_status || "unknown"}</strong>
              </div>
              <div className="stat-card">
                <span>Signature verified</span>
                <strong>{readiness.snapshot_signature_verified ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Signature required</span>
                <strong>{readiness.snapshot_signature_required ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Snapshot archive</span>
                <strong>{readiness.snapshot_archive_available ? "Available" : "Empty"}</strong>
              </div>
              <div className="stat-card">
                <span>Archive verified</span>
                <strong>{readiness.snapshot_archive_latest_verified ? "Yes" : "No"}</strong>
              </div>
              <div className="stat-card">
                <span>Archive signature</span>
                <strong>{readiness.snapshot_archive_signature_valid ? "Valid" : "Review"}</strong>
              </div>
              <div className="stat-card">
                <span>Bootstrap package</span>
                <strong>{readiness.bootstrap_package_available ? "Available" : "Review"}</strong>
              </div>
              <div className="stat-card">
                <span>Bootstrap signature</span>
                <strong>{readiness.bootstrap_package_snapshot_signature_verified ? "Verified" : "Review"}</strong>
              </div>
            </div>
          </RevealSection>

          <section className="card card-pad">
            <div className="section-title">
              <h2>Network Monitor</h2>
              <span className={`status-badge ${nodeMonitor?.overall_status === "ok" ? "pass" : nodeMonitor?.overall_status === "critical" ? "fail" : "warning"}`}>
                {nodeMonitor?.overall_status || readiness.node_monitor_status || "unknown"}
              </span>
            </div>
            <div className="stats-grid compact-stats">
              <div className="stat-card">
                <span>Trusted node</span>
                <strong>
                  {nodeMonitor?.trusted_public_node_status === "synced"
                    ? "Synced"
                    : nodeMonitor
                      ? "No external peer"
                      : "unknown"}
                </strong>
              </div>
              <div className="stat-card">
                <span>Warnings</span>
                <strong>{nodeMonitor?.warning_count ?? readiness.node_monitor_warning_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span>Critical</span>
                <strong>{nodeMonitor?.critical_count ?? readiness.node_monitor_critical_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span>Active nodes</span>
                <strong>{nodeMonitor?.active_node_count ?? "unknown"}</strong>
              </div>
            </div>
            {nodeMonitor && (nodeMonitor.active_node_count ?? 0) <= 1 && (
              <p className="help-text">
                Vorliq is running as a single public node right now, with no external peers
                connected, which is a normal operating state for this phase, not a fault. "No external peer"
                means no second public node is currently syncing.
              </p>
            )}
          </section>

          <section className="card card-pad">
            <div className="section-title">
              <h2>How To Read This</h2>
              <span className="eyebrow">Public-safe status</span>
            </div>
            <div className="release-list">
              <article className="release-item">
                <span className="status-badge pass">pass</span>
                <h3>Passing</h3>
                <p>The check is currently satisfied by the public readiness API.</p>
              </article>
              <article className="release-item">
                <span className="status-badge warning">warning</span>
                <h3>Warning</h3>
                <p>Review the check before relying on it. Known inactive historical nodes can be non-critical warnings.</p>
              </article>
              <article className="release-item">
                <span className="status-badge fail">fail</span>
                <h3>Failing</h3>
                <p>Stop and investigate before treating production as ready.</p>
              </article>
              <article className="release-item">
                <span className="status-badge warning">unknown</span>
                <h3>Unavailable</h3>
                <p>Missing data is not treated as healthy. Use operator docs and protected checks before acting.</p>
              </article>
            </div>
            <p className="help-text">
              Storage, signature, audit, chain-validity, security, and critical node-monitor warnings are serious
              until reviewed. This public report does not expose private keys, wallet passwords, raw logs,
              environment values, server paths, IP addresses, user-agent strings, or operator credentials.
            </p>
            <div className="button-row">
              <a className="button secondary small-button" href="/health">Health</a>
              <a className="button secondary small-button" href="/network">Network</a>
              <a className="button secondary small-button" href="/peers/propagation">Peer Propagation</a>
              <a className="button secondary small-button" href="/audit">Audit</a>
              <a className="button secondary small-button" href="/docs/readiness.html">Readiness Docs</a>
              <a className="button secondary small-button" href="/docs/deploy.html">Deploy Docs</a>
              <a className="button secondary small-button" href="/docs/recovery.html">Recovery Docs</a>
            </div>
          </section>

          {(failingChecks.length > 0 || warningChecks.length > 0) && (
            <section className="card card-pad">
              <h2>Attention Needed</h2>
              <div className="release-list">
                {[...failingChecks, ...warningChecks].map((check) => (
                  <article className="release-item" key={check.id}>
                    <span className={`status-badge ${check.status}`}>{check.status}</span>
                    <h3>{check.name}</h3>
                    <p>{check.message}</p>
                    <span className="help-text">
                      {check.category} - {check.severity}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          )}

          {Object.entries(groupedChecks).map(([category, checks]) => (
            <section className="card card-pad" key={category}>
              <div className="section-title">
                <h2>{category}</h2>
                <span className="eyebrow">{checks.length} checks</span>
              </div>
              <div className="table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Status</th>
                      <th>Severity</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((check) => (
                      <tr key={check.id}>
                        <td>{check.name}</td>
                        <td>
                          <span className={`status-badge ${check.status}`}>{check.status}</span>
                        </td>
                        <td>{check.severity}</td>
                        <td>{check.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      ) : (
        <section className="card card-pad">
          <div className="empty-state">Production readiness is unavailable right now.</div>
        </section>
      )}
    </div>
  );
}

export default Readiness;
