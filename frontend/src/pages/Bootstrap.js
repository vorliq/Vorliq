import { useEffect, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function statusText(value) {
  if (value === true) return "Available";
  if (value === false) return "Unavailable";
  return "Unknown";
}

function Bootstrap() {
  const [bootstrapPackage, setBootstrapPackage] = useState(null);
  const [bootstrapStatus, setBootstrapStatus] = useState(null);
  const [snapshotVerify, setSnapshotVerify] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadBootstrap() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [packageResponse, statusResponse, snapshotResponse, readinessResponse] = await Promise.all([
          api.get("/bootstrap/package"),
          api.get("/bootstrap/status").catch(() => ({ data: null })),
          api.get("/snapshot/verify").catch(() => ({ data: null })),
          api.get("/readiness").catch(() => ({ data: null })),
        ]);
        if (mounted) {
          setBootstrapPackage(packageResponse.data);
          setBootstrapStatus(statusResponse.data);
          setSnapshotVerify(snapshotResponse.data);
          setReadiness(readinessResponse.data);
        }
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Verified bootstrap metadata is unavailable."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadBootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Verified Chain Bootstrap</span>
        <h1>Bootstrap Node</h1>
        <p className="subtitle">
          Verify signed snapshots, audit exports, chain hashes, and block links before importing public chain data into a new node.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading verified bootstrap status..." />
        </section>
      ) : (
        <>
          <section className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Trusted public node</span>
              <strong>{bootstrapPackage?.source_node_url || "https://vorliq.org"}</strong>
            </div>
            <div className="stat-card">
              <span>Signed snapshot</span>
              <strong>{snapshotVerify?.signature_verified || bootstrapPackage?.snapshot_signature_verified ? "Verified" : "Review"}</strong>
            </div>
            <div className="stat-card">
              <span>Chain height</span>
              <strong>{bootstrapPackage?.chain_height ?? "Unknown"}</strong>
            </div>
            <div className="stat-card">
              <span>Bootstrap package</span>
              <strong>{bootstrapPackage?.success ? "Available" : "Unavailable"}</strong>
            </div>
          </section>

          <section className="card card-pad stack">
            <div className="section-title">
              <h2>Verification Status</h2>
              <span className={`status-badge ${readiness?.overall_status || "warning"}`}>
                {readiness?.overall_status || "unknown"}
              </span>
            </div>
            <div className="table-wrap">
              <table className="stats-table">
                <tbody>
                  <tr>
                    <th>Latest block hash</th>
                    <td>{bootstrapPackage?.latest_block_hash || "Unavailable"}</td>
                  </tr>
                  <tr>
                    <th>Snapshot hash</th>
                    <td>{bootstrapPackage?.snapshot_hash || "Unavailable"}</td>
                  </tr>
                  <tr>
                    <th>Audit chain export</th>
                    <td>{bootstrapPackage?.audit_chain_hash ? "Available and hashed" : "Unavailable"}</td>
                  </tr>
                  <tr>
                    <th>Local bootstrap marker</th>
                    <td>{bootstrapStatus?.last_bootstrap_marker?.has_run ? "Recorded" : "Not recorded"}</td>
                  </tr>
                  <tr>
                    <th>Local chain valid</th>
                    <td>{bootstrapStatus?.chain_valid === true ? "Valid" : statusText(bootstrapStatus?.chain_valid)}</td>
                  </tr>
                  <tr>
                    <th>Bootstrap status endpoint</th>
                    <td>{statusText(bootstrapStatus?.success)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card card-pad stack">
            <h2>Operator Commands</h2>
            <p className="help-text">
              Dry-run mode writes nothing. Write mode should only be used on a new node or after a deliberate backup.
            </p>
            <pre className="code-block"><code>python3.12 tools/bootstrap_chain_from_public_node.py --trusted-node https://vorliq.org --data-dir ./blockchain/data</code></pre>
            <pre className="code-block"><code>python3.12 tools/bootstrap_chain_from_public_node.py --trusted-node https://vorliq.org --data-dir ./blockchain/data --write</code></pre>
            <pre className="code-block"><code>node tools/node_doctor.js --base-url http://127.0.0.1:5000 --trusted-node https://vorliq.org</code></pre>
          </section>

          <section className="card card-pad stack">
            <h2>Write Mode Warning</h2>
            <p className="help-text">
              Do not overwrite an existing chain unless you intentionally created a backup and understand that local node data will be replaced.
              Bootstrap verification is a technical integrity check; it is not legal or financial proof.
            </p>
            <div className="button-row">
              <a className="button secondary small-button" href="/docs/bootstrap-chain.html">
                Bootstrap Chain Guide
              </a>
              <a className="button secondary small-button" href="/docs/recovery.html">
                Recovery Guide
              </a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default Bootstrap;
