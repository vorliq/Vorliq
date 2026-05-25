import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Snapshot() {
  const [latest, setLatest] = useState(null);
  const [verification, setVerification] = useState(null);
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadSnapshot() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [latestResponse, verifyResponse] = await Promise.all([
          api.get("/snapshot/latest"),
          api.get("/snapshot/verify"),
        ]);
        if (mounted) {
          setLatest(latestResponse.data?.snapshot || latestResponse.data || null);
          setVerification(verifyResponse.data || null);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(apiErrorMessage(error, "Unable to load snapshot verification."));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadSnapshot();
    return () => {
      mounted = false;
    };
  }, []);

  const snapshot = verification?.snapshot || latest;
  const hashes = useMemo(() => Object.entries(snapshot?.hashes || {}), [snapshot]);
  const checks = verification?.checks || [];

  async function copy(value, label) {
    if (!value) return;
    await navigator.clipboard?.writeText(String(value));
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  return (
    <div className="page snapshot-page">
      <section className="hero">
        <span className="eyebrow">Public Integrity</span>
        <h1>Snapshot</h1>
        <p className="subtitle">
          A deterministic public manifest for comparing current Vorliq chain state, public ledger summaries, and audit hashes.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading snapshot verification..." />
        </section>
      ) : snapshot ? (
        <>
          <section className="risk-notice">
            <strong>Integrity aid only</strong>
            <span>
              This snapshot is a public integrity aid. It helps users compare hashes and exported public state. It is not a legal, financial, or investment guarantee.
            </span>
          </section>

          <section className="card card-pad stats-section">
            <div className="section-title">
              <h2>Snapshot Status</h2>
              <span className={`status-badge ${verification?.verified ? "pass" : "warning"}`}>
                {verification?.verified ? "verified" : "review"}
              </span>
            </div>
            <div className="stats-grid compact-stats">
              <Metric label="Chain height" value={snapshot.chain_height} />
              <Metric label="Confirmed transactions" value={snapshot.confirmed_transaction_count} />
              <Metric label="Treasury balance" value={`${snapshot.treasury_balance} VLQ`} />
              <Metric label="Active nodes" value={snapshot.active_node_count} />
              <Metric label="Storage" value={snapshot.storage_status?.overall_status || "unknown"} />
              <Metric label="Readiness" value={snapshot.readiness_status?.overall_status || "unknown"} />
            </div>
            <div className="info-list">
              <CopyRow label="Latest block hash" value={snapshot.latest_block_hash} copied={copied} onCopy={copy} />
              <CopyRow label="Deployment commit" value={snapshot.deployment_commit || "Unavailable"} copied={copied} onCopy={copy} />
              <div>
                <span>Last generated</span>
                <strong>{snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString() : "Unavailable"}</strong>
              </div>
            </div>
          </section>

          <section className="card card-pad stats-section">
            <h2>Hash List</h2>
            <div className="stack">
              {hashes.map(([name, value]) => (
                <CopyRow key={name} label={name.replaceAll("_", " ")} value={value} copied={copied} onCopy={copy} />
              ))}
            </div>
          </section>

          <section className="card card-pad stats-section">
            <h2>Verification Checks</h2>
            {checks.length ? (
              <div className="stack">
                {checks.map((check) => (
                  <div className="health-row" key={check.id}>
                    <span className={`health-icon ${check.passed ? "online" : "offline"}`}>
                      {check.passed ? "\u2713" : "\u00d7"}
                    </span>
                    <div>
                      <strong>{check.id.replaceAll("_", " ")}</strong>
                      <span>{check.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Verification checks are unavailable right now.</div>
            )}
          </section>
        </>
      ) : (
        <section className="card card-pad">
          <div className="empty-state">Snapshot verification is unavailable right now.</div>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong className="compact-stat">{value ?? "Unavailable"}</strong>
    </div>
  );
}

function CopyRow({ label, value, copied, onCopy }) {
  const copyLabel = `${label} hash`;
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <strong className="mono-wrap wrap-anywhere">{value || "Unavailable"}</strong>
      <button className="button secondary small-button" type="button" onClick={() => onCopy(value, copyLabel)}>
        {copied === copyLabel ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default Snapshot;
