import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const STATUS_ORDER = ["completed", "in_progress", "planned", "research"];
const STATUS_LABELS = {
  completed: "Completed",
  in_progress: "In Progress",
  planned: "Planned",
  research: "Research",
};

function groupRoadmap(items = []) {
  return STATUS_ORDER.reduce((groups, status) => {
    groups[status] = items.filter((item) => item.status === status);
    return groups;
  }, {});
}

function Roadmap() {
  const [metadata, setMetadata] = useState(null);
  const [roadmap, setRoadmap] = useState(null);
  const [changelog, setChangelog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadRoadmap() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [metadataResponse, roadmapResponse, changelogResponse] = await Promise.all([
          api.get("/version/metadata"),
          api.get("/roadmap"),
          api.get("/changelog"),
        ]);
        if (mounted) {
          setMetadata(metadataResponse.data);
          setRoadmap(roadmapResponse.data);
          setChangelog(changelogResponse.data);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(apiErrorMessage(error, "Unable to load the public roadmap."));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadRoadmap();
    return () => {
      mounted = false;
    };
  }, []);

  const grouped = useMemo(() => groupRoadmap(roadmap?.items || []), [roadmap]);
  const latestRelease = changelog?.entries?.[0];

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Public Planning</span>
        <h1>Roadmap</h1>
        <p className="subtitle">
          See what is live, what is being worked on, and what is being researched for the Vorliq community platform.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <section className="card card-pad">
          <Spinner label="Loading roadmap..." />
        </section>
      ) : (
        <>
          <section className="card card-pad">
            <div className="section-title">
              <h2>Current Version</h2>
              <span className="status-badge ok">{metadata?.release_channel || "stable"}</span>
            </div>
            <div className="stats-grid compact-stats">
              <div className="stat-card">
                <span>Version</span>
                <strong>{metadata?.current_version || "Unavailable"}</strong>
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
                <span>Recommended node</span>
                <strong>{metadata?.recommended_node_version || "Unavailable"}</strong>
              </div>
            </div>
            {latestRelease && (
              <p className="help-text">
                Latest release note: <strong>{latestRelease.title}</strong>
              </p>
            )}
          </section>

          <section className="card card-pad">
            <h2>Compatibility Status</h2>
            <div className="release-note-list">
              {(metadata?.compatibility_notes || []).map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </section>

          {STATUS_ORDER.map((status) => (
            <section className="card card-pad" key={status}>
              <div className="section-title">
                <h2>{STATUS_LABELS[status]}</h2>
                <span className="eyebrow">{grouped[status]?.length || 0} items</span>
              </div>
              <div className="release-grid">
                {(grouped[status] || []).map((item) => (
                  <article className="release-item" key={item.id}>
                    <span className={`status-badge ${status}`}>{STATUS_LABELS[status]}</span>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                    <span className="help-text">{item.category}</span>
                  </article>
                ))}
                {(!grouped[status] || grouped[status].length === 0) && (
                  <div className="empty-state">No public items are listed for this status right now.</div>
                )}
              </div>
            </section>
          ))}

          <section className="card card-pad">
            <h2>Propose what comes next</h2>
            <p>
              This roadmap is what the maintainers are building. The network&apos;s own rules — the
              mining reward, block difficulty, lending limits — are not fixed by us: any member
              holding VLQ can propose a change, and the community decides by a VLQ-weighted vote.
              If you want something on this list, that is where it starts.
            </p>
            <div className="button-row">
              <Link className="button" to="/governance">Open governance</Link>
            </div>
          </section>

          <section className="card card-pad">
            <h2>Roadmap Disclaimer</h2>
            <p>{roadmap?.disclaimer}</p>
          </section>
        </>
      )}
    </div>
  );
}

export default Roadmap;
