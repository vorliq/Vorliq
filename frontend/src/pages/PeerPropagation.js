import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function shortValue(value, size = 12) {
  if (!value) return "";
  const text = String(value);
  return text.length > size ? `${text.slice(0, size)}...` : text;
}

function displayTime(value) {
  if (!value) return "No events yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function statusClass(status) {
  if (status === "accepted") return "confirmed";
  if (status === "duplicate" || status === "quarantined") return "pending";
  if (status === "rejected" || status === "failed") return "cancelled";
  return "unknown";
}

function safePeerLabel(index, prefix = "Peer") {
  return `${prefix} ${index + 1} endpoint hidden`;
}

function PeerPropagation() {
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadPropagation({ quiet = false } = {}) {
    try {
      const [statusResponse, eventsResponse] = await Promise.all([
        api.get("/peers/propagation/status"),
        api.get("/peers/propagation/events", { params: { limit: 25 } }),
      ]);
      setStatus(statusResponse.data || null);
      setEvents(eventsResponse.data.events || []);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load peer propagation status.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPropagation();
    const timer = window.setInterval(() => loadPropagation({ quiet: true }), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const metrics = useMemo(() => {
    const source = status || {};
    return [
      ["Broadcast", source.broadcast_enabled ? "Enabled" : "Disabled"],
      ["Receive", source.receive_enabled ? "Enabled" : "Disabled"],
      ["Active peers", source.active_peer_count ?? 0],
      ["Eligible peers", source.eligible_broadcast_peer_count ?? 0],
      ["Accepted tx", source.accepted_transactions ?? 0],
      ["Accepted blocks", source.accepted_blocks ?? 0],
      ["Duplicates", source.duplicates ?? 0],
      ["Rejected", source.rejected ?? 0],
      ["Quarantined", source.quarantined ?? 0],
      ["Failed", source.failed ?? 0],
      ["Last event", displayTime(source.last_event_at)],
    ];
  }, [status]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Peer Network</span>
        <h1>Peer Propagation</h1>
        <p className="subtitle">Inspect safe transaction and block relay between registered Vorliq nodes.</p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading && <Spinner label="Loading peer propagation..." />}

      {!loading && (
        <>
          <section className="card card-pad stack">
            <div className="section-title">
              <h2>Propagation Status</h2>
              <span className="eyebrow">Auto refreshes every 30 seconds</span>
            </div>
            <div className="stats-grid compact-stats">
              {metrics.map(([label, value]) => (
                <div className="stat-card" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="card card-pad stack">
            <div className="section-title">
              <h2>Eligible Peers</h2>
              <span className="eyebrow">{status?.eligible_broadcast_peer_count ?? 0} available for broadcast</span>
            </div>
            {status?.eligible_peers?.length ? (
              <div className="peer-list">
                {status.eligible_peers.map((peer, index) => (
                  <div className="peer-item" key={peer}>
                    <span className="peer-url">{safePeerLabel(index)}</span>
                    <span className="status-badge confirmed">synced</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No eligible broadcast peers are available right now.</div>
            )}
          </section>

          <section className="card card-pad stack">
            <div className="section-title">
              <h2>Recent Peer Events</h2>
              <span className="eyebrow">{events.length} shown</span>
            </div>
            {events.length === 0 ? (
              <div className="empty-state">No peer propagation events have been recorded yet.</div>
            ) : (
              <div className="history-list">
                {events.map((event, index) => (
                  <div className="history-item" key={event.event_id}>
                    <span>{displayTime(event.timestamp)}</span>
                    <span>{event.direction}</span>
                    <span>{event.type}</span>
                    <span className="meta-value">{safePeerLabel(index, "Event peer")}</span>
                    <span className={`status-badge ${statusClass(event.status)}`}>{event.status}</span>
                    <span>{event.reason || "none"}</span>
                    <span>{shortValue(event.tx_id)}</span>
                    <span>{shortValue(event.block_hash)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid two-column">
            <div className="card card-pad stack">
              <h2>What Gets Accepted</h2>
              <p>Signed user transactions with valid sender addresses, matching public keys, spendable confirmed balance, safe field sizes, and no duplicate transaction identity.</p>
              <p>Direct next blocks that extend the local latest hash, meet proof of work, recompute to the submitted hash, and pass the existing local block validation path.</p>
            </div>
            <div className="card card-pad stack">
              <h2>What Gets Quarantined</h2>
              <p>Validly shaped peer blocks that do not directly extend the local latest block, including ahead candidates, possible gaps, and possible forks.</p>
              <p>Quarantined blocks are recorded for operators but are not applied to the local chain.</p>
            </div>
          </section>

          <section className="card card-pad stack">
            <h2>Operator Notes</h2>
            <p>
              Broadcast can be disabled while receive validation remains active. Peer data never replaces
              the local chain automatically, and public views hide peer endpoints while preserving status counts.
            </p>
            <p>
              Peer APIs should never receive private keys, wallet passwords, raw logs, environment values, or operator credentials.
            </p>
            <div className="button-row">
              <a className="button secondary small-button" href="/network">Network</a>
              <a className="button secondary small-button" href="/health">Health</a>
              <a className="button secondary small-button" href="/docs/peer-propagation.html">Propagation Docs</a>
              <a className="button secondary small-button" href="/docs/node-monitoring.html">Node Monitoring Docs</a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default PeerPropagation;
