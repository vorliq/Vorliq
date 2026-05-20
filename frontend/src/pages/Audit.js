import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const exportLabels = {
  chain: "Chain Export",
  treasury: "Treasury Export",
  governance: "Governance Export",
  lending: "Lending Export",
  exchange: "Exchange Export",
  registry: "Registry Export",
};

function Audit() {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadAuditManifest() {
      try {
        const response = await api.get("/audit/manifest");
        if (mounted) {
          setManifest(response.data || {});
        }
      } catch (requestError) {
        if (mounted) {
          setError(apiErrorMessage(requestError, "Unable to load the public audit manifest."));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadAuditManifest();

    return () => {
      mounted = false;
    };
  }, []);

  const exports = useMemo(() => manifest?.exports || [], [manifest]);

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Loading audit manifest..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <ErrorMessage message={error} />
      </div>
    );
  }

  return (
    <div className="page audit-page">
      <section className="hero">
        <span className="eyebrow">Public Verification</span>
        <h1>Audit</h1>
        <p className="subtitle">
          Public state exports for independent verification of the Vorliq network. These exports cover
          public blockchain and ledger state only; they do not include private wallet keys, passwords,
          admin tokens, raw IP addresses, server paths, or backend logs.
        </p>
      </section>

      <section className="card card-pad stats-section">
        <h2>Audit Manifest</h2>
        <div className="grid stats-grid">
          <Metric label="Deployment commit" value={shortHash(manifest?.deployment_commit)} />
          <Metric label="Chain height" value={manifest?.chain_height ?? 0} />
          <Metric label="Storage health" value={manifest?.storage_health_status || "unknown"} />
          <Metric label="Active nodes" value={manifest?.active_node_count ?? 0} />
          <Metric label="Active incidents" value={manifest?.active_incident_count ?? 0} />
          <Metric label="Schema version" value={manifest?.audit_schema_version ?? 1} />
        </div>
        <div className="info-list">
          <div>
            <span>Latest block hash</span>
            <strong className="mono-wrap wrap-anywhere">{manifest?.latest_block_hash || "Unavailable"}</strong>
          </div>
          <div>
            <span>Export timestamp</span>
            <strong>{manifest?.export_timestamp || "Unavailable"}</strong>
          </div>
        </div>
      </section>

      <section className="card card-pad stats-section">
        <h2>Export Files</h2>
        <div className="action-grid">
          <a className="button primary" href="/api/audit/manifest" target="_blank" rel="noreferrer">
            Live Audit Manifest
          </a>
          {exports.map((entry) => (
            <a className="button secondary" href={entry.endpoint} target="_blank" rel="noreferrer" key={entry.name}>
              {exportLabels[entry.name] || entry.name}
            </a>
          ))}
        </div>
      </section>

      <section className="card card-pad stats-section">
        <h2>Independent Verification</h2>
        <p className="muted">
          Developers can run <code>node tools/verify_audit.js https://vorliq.org</code> to fetch the manifest,
          recalculate SHA-256 hashes, verify chain links, check the latest block hash, and scan exports for
          forbidden secret markers.
        </p>
        <p className="muted">
          Audit exports verify public network state consistency. They do not prove legal or financial value
          and they cannot recover private wallet keys.
        </p>
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function shortHash(value) {
  if (!value) return "Unavailable";
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 12)}...` : text;
}

export default Audit;
