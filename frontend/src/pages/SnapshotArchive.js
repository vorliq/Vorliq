import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function SnapshotArchive() {
  const [latest, setLatest] = useState(null);
  const [archives, setArchives] = useState([]);
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadArchive() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [latestResponse, listResponse] = await Promise.all([
          api.get("/snapshot/archive/latest").catch(() => ({ data: null })),
          api.get("/snapshot/archive?limit=30&offset=0"),
        ]);
        if (mounted) {
          setLatest(latestResponse.data?.archive || null);
          setArchives(listResponse.data?.archives || []);
        }
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Unable to load snapshot archive."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadArchive();
    return () => {
      mounted = false;
    };
  }, []);

  const latestRows = useMemo(() => {
    if (!latest) return [];
    return [
      ["Snapshot hash", latest.snapshot_hash],
      ["Latest block hash", latest.latest_block_hash],
      ["Public key id", latest.public_key_id],
      ["Signature status", latest.signature_status],
      ["Deployment commit", latest.deployment_commit],
    ];
  }, [latest]);

  async function copy(value, label) {
    if (!value) return;
    await navigator.clipboard?.writeText(String(value));
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  return (
    <div className="page snapshot-page">
      <section className="hero">
        <span className="eyebrow">Public Archive</span>
        <h1>Snapshot Archive</h1>
        <p className="subtitle">
          Signed public snapshot history for comparing current and historical Vorliq network state.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="risk-notice">
        <strong>Verification aid only</strong>
        <span>
          Archived snapshots help public verification and recovery checks. They are not legal, financial, banking, or investment proof.
        </span>
      </section>

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading snapshot archive..." />
        </section>
      ) : (
        <>
          <section className="card card-pad stats-section">
            <div className="section-title">
              <h2>Latest Archived Snapshot</h2>
              <a className="button secondary small-button" href="/snapshot">Current Snapshot</a>
            </div>
            {latest ? (
              <>
                <div className="stats-grid compact-stats">
                  <Metric label="Chain height" value={latest.chain_height} />
                  <Metric label="Confirmed transactions" value={latest.confirmed_transaction_count} />
                  <Metric label="Treasury balance" value={`${latest.treasury_balance} VLQ`} />
                  <Metric label="Active nodes" value={latest.active_node_count} />
                  <Metric label="Signature" value={latest.signature_status} />
                  <Metric label="Created" value={latest.created_at ? new Date(latest.created_at).toLocaleString() : "Unavailable"} />
                </div>
                <div className="stack">
                  {latestRows.map(([label, value]) => (
                    <CopyRow key={label} label={label} value={value} copied={copied} onCopy={copy} />
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">No archived snapshots are available yet.</div>
            )}
          </section>

          <section className="card card-pad stats-section">
            <h2>Archive List</h2>
            {archives.length ? (
              <div className="table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Height</th>
                      <th>Snapshot hash</th>
                      <th>Latest block</th>
                      <th>Signature</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archives.map((item) => (
                      <tr key={item.snapshot_hash}>
                        <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "Unavailable"}</td>
                        <td>{item.chain_height}</td>
                        <td className="mono-wrap wrap-anywhere">{item.snapshot_hash}</td>
                        <td className="mono-wrap wrap-anywhere">{item.latest_block_hash}</td>
                        <td>{item.signature_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">Archive metadata is unavailable right now.</div>
            )}
          </section>
        </>
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
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <strong className="mono-wrap wrap-anywhere">{value || "Unavailable"}</strong>
      <button className="button secondary small-button" type="button" onClick={() => onCopy(value, label)}>
        {copied === label ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default SnapshotArchive;
