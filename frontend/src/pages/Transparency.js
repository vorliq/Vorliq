import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function Transparency() {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadManifest() {
      setLoading(true);
      setErrorMessage("");

      try {
        const response = await api.get("/network/manifest", { timeout: 8000 });
        if (mounted) {
          setManifest(response.data);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(apiErrorMessage(error, "Network manifest is unavailable right now."));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadManifest();

    return () => {
      mounted = false;
    };
  }, []);

  const proofRows = useMemo(() => {
    const summary = manifest?.chain_summary || {};
    const diagnostics = manifest?.diagnostics || {};

    return [
      ["Current Commit", manifest?.deployment?.commit_hash],
      ["Block Height", summary.block_height],
      ["Total Blocks", summary.total_blocks],
      ["Total Transactions", summary.total_transactions],
      ["Chain Valid", summary.chain_valid],
      ["Public Node", diagnostics.node_url],
      ["Known Peers", diagnostics.known_peers],
      ["Active Incidents", manifest?.incidents?.active ? manifest.incidents.active_count : 0],
      ["Generated At", manifest?.generated_at ? new Date(manifest.generated_at).toLocaleString() : null],
    ];
  }, [manifest]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Public Trust</span>
        <h1>Transparency</h1>
        <p className="subtitle">
          Vorliq is public blockchain software. This page explains what is live, what is still
          experimental, how user-controlled keys work, and where anyone can verify the network.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="transparency-grid">
        <article className="card card-pad transparency-notice experimental">
          <h2>Experimental Software</h2>
          <p>
            Vorliq is live and usable, but it is still early software. VLQ is not listed on
            exchanges, has no guaranteed market value, and should not be treated as a promise
            of financial return. The network is young and users should test carefully.
          </p>
        </article>

        <article className="card card-pad transparency-notice custody">
          <h2>User-Controlled Keys</h2>
          <p>
            Vorliq does not store private keys or wallet passwords on the server. Lost keys cannot
            be recovered by Vorliq. Keep encrypted backups and never share a private key with
            anyone who should not control the wallet.
          </p>
        </article>
      </section>

      <section className="card card-pad health-section">
        <h2>What Is Live Today</h2>
        <p>
          Vorliq has a live web app, public node, blockchain API, status page, documentation,
          wallet creation, VLQ transactions, mining, forum, lending, exchange, governance,
          treasury, developer SDK, and mobile app source code.
        </p>
      </section>

      <section className="card card-pad health-section">
        <h2>Risk and Limitations</h2>
        <p>
          Vorliq is experimental community software, not regulated financial advice or a
          provider of financial services. The public node at vorliq.org is a convenience gateway
          for visitors, not a guarantee that the network is fully decentralized. Decentralization
          improves only as more independent operators run nodes, keep their own backups, and
          verify the chain for themselves.
        </p>
      </section>

      <section className="card card-pad health-section">
        <h2>Open Source Proof</h2>
        <div className="whitepaper-links">
          <a href="https://github.com/vorliq/Vorliq" target="_blank" rel="noreferrer">
            GitHub Repository
          </a>
          <a href="https://github.com/vorliq/Vorliq/actions" target="_blank" rel="noreferrer">
            GitHub Actions
          </a>
          <a href="https://github.com/vorliq/Vorliq/releases" target="_blank" rel="noreferrer">
            Releases
          </a>
          <a href="https://vorliq.github.io/Vorliq/api.html" target="_blank" rel="noreferrer">
            API Docs
          </a>
          <a href="https://github.com/vorliq/Vorliq/tree/main/sdk#readme" target="_blank" rel="noreferrer">
            SDK Docs
          </a>
        </div>
      </section>

      <section className="card card-pad health-section">
        <h2>Operations Status</h2>
        <p>
          Vorliq uses continuous integration, automatic production deployment, monitoring, daily
          backups, restore tooling, public incident reporting, rate limiting, backend validation,
          and security headers.
        </p>
      </section>

      <section className="card card-pad health-section">
        <h2>Network Proof</h2>
        {loading ? (
          <Spinner label="Loading network manifest..." />
        ) : manifest?.success ? (
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                {proofRows.map(([label, value]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{formatValue(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Network manifest data is unavailable right now.</div>
        )}
        <div className="whitepaper-links">
          <a href="https://vorliq.org/api/health" target="_blank" rel="noreferrer">
            Health API
          </a>
          <a href="https://vorliq.org/api/chain/summary" target="_blank" rel="noreferrer">
            Chain Summary
          </a>
          <a href="https://vorliq.org/api/diagnostics" target="_blank" rel="noreferrer">
            Diagnostics
          </a>
          <a href="https://vorliq.org/api/deployment" target="_blank" rel="noreferrer">
            Deployment
          </a>
          <a href="https://status.vorliq.org" target="_blank" rel="noreferrer">
            Status Page
          </a>
        </div>
      </section>

      <section className="card card-pad health-section">
        <h2>Known Limitations</h2>
        <p>
          The network is young, and the production node is currently a main public gateway. The
          mobile app is source and export ready, but it is not yet published to app stores. Push
          notification production builds need a real Firebase google-services.json, and real
          subscriber broadcasting needs a mailing provider beyond Formspree.
        </p>
      </section>
    </div>
  );
}

export default Transparency;
