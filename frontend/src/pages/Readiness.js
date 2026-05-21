import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
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
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadReadiness() {
      setLoading(true);
      setErrorMessage("");
      try {
        const response = await api.get("/readiness");
        if (mounted) setReadiness(response.data);
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
          <section className="card card-pad">
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
                  This is a technical readiness signal only. It is not a guarantee of legal status,
                  investment value, banking safety, or future financial outcomes.
                </p>
              </div>
            </div>
            <div className="stats-grid compact-stats">
              <div className="stat-card">
                <span>Index health</span>
                <strong>{readiness.index_health || "unknown"}</strong>
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
