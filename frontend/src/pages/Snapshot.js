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
  const signature = snapshot?.signature || {};
  const signatureEnabled = signature.enabled === true;
  const signatureVerified = verification?.signature_verified === true;
  const signatureStatus = verification?.signature_status || signature.status || "unknown";

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
              <Metric label="Signature" value={signatureStatus} />
              <Metric label="Signed" value={signatureEnabled ? "Yes" : "No"} />
            </div>
            <div className="info-list">
              <CopyRow label="Latest block hash" value={snapshot.latest_block_hash} copied={copied} onCopy={copy} />
              <CopyRow label="Snapshot hash" value={signature.snapshot_hash} copied={copied} onCopy={copy} />
              <CopyRow label="Deployment commit" value={snapshot.deployment_commit || "Unavailable"} copied={copied} onCopy={copy} />
              <div>
                <span>Last generated</span>
                <strong>{snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString() : "Unavailable"}</strong>
              </div>
            </div>
          </section>

          <section className="card card-pad stats-section">
            <div className="section-title">
              <h2>Signature</h2>
              <span className={`status-badge ${signatureEnabled && signatureVerified ? "pass" : "warning"}`}>
                {signatureEnabled ? signatureStatus : "unsigned"}
              </span>
            </div>
            <p className="help-text">
              Signed snapshots help verify that the public snapshot was produced by the Vorliq production signing key. They do not prove legal, financial, banking, or investment status.
            </p>
            {!signatureEnabled && (
              <div className="risk-notice">
                <strong>Unsigned snapshot</strong>
                <span>Deterministic verification can still pass, but production snapshot signing is not configured.</span>
              </div>
            )}
            <div className="stats-grid compact-stats">
              <Metric label="Algorithm" value={signature.algorithm || "Ed25519"} />
              <Metric label="Public key id" value={signature.public_key_id || "Unavailable"} />
              <Metric label="Signature verified" value={signatureVerified ? "True" : "False"} />
              <Metric label="Required" value={verification?.signature_required ? "Yes" : "No"} />
            </div>
            <div className="stack">
              <CopyRow label="Snapshot hash" value={signature.snapshot_hash} copied={copied} onCopy={copy} />
              {signature.signature && <CopyRow label="Signature" value={signature.signature} copied={copied} onCopy={copy} />}
              {signature.public_key && <CopyRow label="Public key" value={signature.public_key} copied={copied} onCopy={copy} />}
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
