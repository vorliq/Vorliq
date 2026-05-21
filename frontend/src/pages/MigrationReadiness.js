import { useEffect, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function display(value, fallback = "Unavailable") {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function MigrationReadiness() {
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadReadiness() {
      setLoading(true);
      setErrorMessage("");
      try {
        const response = await api.get("/migration/readiness");
        if (mounted) setReadiness(response.data);
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Migration readiness is unavailable."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadReadiness();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Storage Roadmap</span>
        <h1>Migration Readiness</h1>
        <p className="subtitle">
          Database migration preparation for Vorliq operators and developers. Production remains on hardened JSON storage.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading migration readiness..." />
        </section>
      ) : readiness?.success ? (
        <>
          <section className="card card-pad">
            <div className="section-title">
              <h2>Current Storage</h2>
              <span className="status-badge pass">Preparation Only</span>
            </div>
            <div className="stats-grid compact-stats">
              <div className="stat-card">
                <span>Future database target</span>
                <strong>{display(readiness.future_database_target)}</strong>
              </div>
              <div className="stat-card">
                <span>Current production storage</span>
                <strong>{display(readiness.storage_backend)}</strong>
              </div>
              <div className="stat-card">
                <span>Database enabled</span>
                <strong>{display(readiness.database_enabled)}</strong>
              </div>
              <div className="stat-card">
                <span>PostgreSQL active</span>
                <strong>{display(readiness.postgres_active)}</strong>
              </div>
              <div className="stat-card">
                <span>Migration phase</span>
                <strong>{display(readiness.migration_phase)}</strong>
              </div>
              <div className="stat-card">
                <span>Migration support</span>
                <strong>{display(readiness.migration_supported).replaceAll("_", " ")}</strong>
              </div>
              <div className="stat-card">
                <span>Schema files present</span>
                <strong>{display(readiness.postgres_schema_present)}</strong>
              </div>
              <div className="stat-card">
                <span>Migration tools</span>
                <strong>{display(readiness.migration_tools_available)}</strong>
              </div>
              <div className="stat-card">
                <span>Chain source</span>
                <strong>{display(readiness.chain_source_of_truth)}</strong>
              </div>
              <div className="stat-card">
                <span>Indexes derived</span>
                <strong>{display(readiness.indexes_derived)}</strong>
              </div>
              <div className="stat-card">
                <span>Rollback required</span>
                <strong>{display(readiness.rollback_plan_required)}</strong>
              </div>
              <div className="stat-card">
                <span>Chain height</span>
                <strong>{display(readiness.latest_chain_height)}</strong>
              </div>
            </div>
            <p className="help-text">
              {readiness.message}
            </p>
          </section>

          <section className="card card-pad">
            <h2>Chain Snapshot</h2>
            <div className="table-wrap">
              <table className="stats-table">
                <tbody>
                  <tr>
                    <th>Latest block hash</th>
                    <td>{display(readiness.latest_block_hash)}</td>
                  </tr>
                  <tr>
                    <th>Pending source</th>
                    <td>{display(readiness.pending_source_of_truth)}</td>
                  </tr>
                  <tr>
                    <th>Storage health</th>
                    <td>{display(readiness.last_storage_health?.overall_status)}</td>
                  </tr>
                  <tr>
                    <th>Index health</th>
                    <td>{display(readiness.last_index_health?.status)}</td>
                  </tr>
                  <tr>
                    <th>Index rebuild needed</th>
                    <td>{display(readiness.last_index_health?.rebuild_needed)}</td>
                  </tr>
                  <tr>
                    <th>Migration dry-run tool</th>
                    <td>{readiness.migration_tools_available ? "Available" : "Unavailable"}</td>
                  </tr>
                  <tr>
                    <th>Import simulation tool</th>
                    <td>{readiness.migration_tools_available ? "Available" : "Unavailable"}</td>
                  </tr>
                  <tr>
                    <th>Last schema check</th>
                    <td>{display(readiness.last_schema_check?.status)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card card-pad">
            <h2>Migration Docs</h2>
            <div className="resource-grid">
              <a href="https://vorliq.github.io/Vorliq/storage-adapters.html" target="_blank" rel="noreferrer">
                Storage Adapters
              </a>
              <a href="https://vorliq.github.io/Vorliq/schema-map.html" target="_blank" rel="noreferrer">
                Schema Map
              </a>
              <a href="https://vorliq.github.io/Vorliq/postgres-readiness.html" target="_blank" rel="noreferrer">
                PostgreSQL Readiness
              </a>
              <a href="https://vorliq.github.io/Vorliq/database-migration-plan.html" target="_blank" rel="noreferrer">
                Migration Plan
              </a>
              <a href="https://vorliq.github.io/Vorliq/database-rollback-plan.html" target="_blank" rel="noreferrer">
                Rollback Plan
              </a>
              <a href="https://vorliq.github.io/Vorliq/recovery.html" target="_blank" rel="noreferrer">
                Recovery
              </a>
              <a href="https://vorliq.github.io/Vorliq/indexes.html" target="_blank" rel="noreferrer">
                Derived Indexes
              </a>
            </div>
          </section>
        </>
      ) : (
        <section className="card card-pad">
          <div className="empty-state">Migration readiness is unavailable right now.</div>
        </section>
      )}
    </div>
  );
}

export default MigrationReadiness;
