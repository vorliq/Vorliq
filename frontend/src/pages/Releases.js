import { useEffect, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function shortCommit(hash) {
  if (!hash) return "Unavailable";
  return `${hash.slice(0, 12)}...`;
}

function Releases() {
  const [metadata, setMetadata] = useState(null);
  const [changelog, setChangelog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadReleases() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [metadataResponse, changelogResponse] = await Promise.all([
          api.get("/version/metadata"),
          api.get("/changelog"),
        ]);
        if (mounted) {
          setMetadata(metadataResponse.data);
          setChangelog(changelogResponse.data);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(apiErrorMessage(error, "Unable to load release metadata."));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadReleases();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Release Management</span>
        <h1>Releases</h1>
        <p className="subtitle">
          Track the current production version, release channel, compatibility status, changelog, and upgrade guidance.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading releases..." />
        </section>
      ) : (
        <>
          <section className="card card-pad">
            <div className="section-title">
              <h2>Production Version</h2>
              <span className="status-badge ok">{metadata?.release_channel || "stable"}</span>
            </div>
            <div className="stats-grid compact-stats">
              <div className="stat-card">
                <span>Version</span>
                <strong>{metadata?.current_version || "Unavailable"}</strong>
              </div>
              <div className="stat-card">
                <span>Commit</span>
                <strong title={metadata?.deployment_commit || ""}>{shortCommit(metadata?.deployment_commit)}</strong>
              </div>
              <div className="stat-card">
                <span>API</span>
                <strong>v{metadata?.api_version || 1}</strong>
              </div>
              <div className="stat-card">
                <span>SDK</span>
                <strong>{metadata?.sdk_version || "Unavailable"}</strong>
              </div>
              <div className="stat-card">
                <span>Mobile</span>
                <strong>{metadata?.mobile_version || "Unavailable"}</strong>
              </div>
              <div className="stat-card">
                <span>Web</span>
                <strong>{metadata?.web_version || "Unavailable"}</strong>
              </div>
            </div>
          </section>

          <section className="card card-pad">
            <h2>Upgrade Notes</h2>
            <div className="release-note-list">
              {(metadata?.compatibility_notes || []).map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </section>

          <section className="card card-pad">
            <h2>Changelog</h2>
            <div className="release-list">
              {(changelog?.entries || []).map((entry) => (
                <article className="release-item" key={`${entry.version}-${entry.title}`}>
                  <div className="section-title">
                    <h3>{entry.title}</h3>
                    <span className="status-badge ok">{entry.version}</span>
                  </div>
                  <p>{entry.summary}</p>
                  {entry.date && <p className="help-text">Released: {entry.date}</p>}
                  <h4>Major changes</h4>
                  <ul>
                    {entry.major_changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                  <h4>Compatibility</h4>
                  <ul>
                    {entry.compatibility_notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  <a href={entry.docs_url} target="_blank" rel="noreferrer">
                    Read related docs
                  </a>
                </article>
              ))}
            </div>
          </section>

          <section className="card card-pad">
            <h2>Release Resources</h2>
            <div className="button-row">
              <a className="button secondary" href="https://github.com/vorliq/Vorliq/releases" target="_blank" rel="noreferrer">
                GitHub Releases
              </a>
              <a className="button secondary" href="https://vorliq.github.io/Vorliq/api-versioning.html" target="_blank" rel="noreferrer">
                API Versioning
              </a>
              <a className="button secondary" href="https://vorliq.github.io/Vorliq/testing.html" target="_blank" rel="noreferrer">
                Testing
              </a>
              <a className="button secondary" href="https://vorliq.github.io/Vorliq/audit.html" target="_blank" rel="noreferrer">
                Audit
              </a>
              <a className="button secondary" href="https://vorliq.github.io/Vorliq/storage.html" target="_blank" rel="noreferrer">
                Storage
              </a>
              <a className="button secondary" href="https://vorliq.github.io/Vorliq/recovery.html" target="_blank" rel="noreferrer">
                Recovery
              </a>
              <a className="button secondary" href="https://vorliq.github.io/Vorliq/upgrades.html" target="_blank" rel="noreferrer">
                Upgrade Guide
              </a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default Releases;
