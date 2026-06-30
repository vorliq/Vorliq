import { useEffect, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const POLL_MS = 30 * 1000; // refresh every 30 seconds

function relTime(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function healthLabel(status) {
  if (status === "healthy") return { text: "Healthy", cls: "executed" };
  if (status === "degraded") return { text: "Degraded", cls: "active" };
  return { text: "Unreachable", cls: "rejected" };
}

function NetworkHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await api.get("/network-health");
        if (mounted) {
          setHealth(res.data);
          setErrorMessage("");
        }
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Unable to load network health."));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Loading network health..." />
      </div>
    );
  }

  const h = health || {};
  const status = healthLabel(h.chain_health);

  const stats = [
    { label: "Chain height", value: h.chain_height != null ? `#${Number(h.chain_height).toLocaleString()}` : "—" },
    { label: "Time since last block", value: relTime(h.seconds_since_last_block) },
    { label: "Pending transactions", value: h.pending_transaction_count != null ? Number(h.pending_transaction_count).toLocaleString() : "—" },
    { label: "Registered nodes", value: h.registered_nodes != null ? Number(h.registered_nodes).toLocaleString() : "—" },
    { label: "30-day uptime", value: h.uptime_30d_percent != null ? `${h.uptime_30d_percent}%` : "—" },
  ];

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Network Status</span>
        <h1>Network Health</h1>
        <p className="subtitle">
          A live, public view of the Vorliq network, no account needed. This page refreshes every 30 seconds.
          Uptime is measured from the operator monitoring log over the last 30 days.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Chain status</h2>
        <span className={`status-badge ${status.cls}`}>{status.text}</span>
      </section>

      <section className="card card-pad">
        <div className="table-wrap">
          <table className="stats-table">
            <tbody>
              {stats.map((s) => (
                <tr key={s.label}>
                  <th scope="row">{s.label}</th>
                  <td>{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default NetworkHealth;
