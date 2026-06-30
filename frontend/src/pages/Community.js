import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { formatNumber, formatVlq } from "../helpers/publicApi";

// Public, no-auth community statistics. Polls the aggregated stats endpoint every
// 30 seconds (the same pattern the rest of the public surfaces use) so anyone can
// watch the network's health without an account.
const REFRESH_MS = 30000;

function StatCard({ label, value }) {
  return (
    <div className="card card-pad stat-card compact-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value mono-wrap">{value}</span>
    </div>
  );
}

function Leaderboard({ eyebrow, title, rows, emptyText, columns }) {
  return (
    <section className="card card-pad stack" aria-label={title}>
      <div className="section-title">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {rows && rows.length ? (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Address</th>
                {columns.map((col) => (
                  <th scope="col" key={col.key}>{col.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.address}>
                  <td>{index + 1}</td>
                  <td>
                    {/* AddressIdentity renders the avatar + name and links to the
                        public wallet profile at /profile/:address. */}
                    <AddressIdentity address={row.address} compact />
                  </td>
                  {columns.map((col) => (
                    <td className="mono-wrap" key={col.key}>{col.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">{emptyText}</div>
      )}
    </section>
  );
}

function Community() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const response = await api.get("/community/stats");
      setData(response.data);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) setErrorMessage(apiErrorMessage(error, "Unable to load community statistics."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = data?.summary || {};
  const stats = [
    { label: "Blocks mined", value: formatNumber(summary.total_blocks) },
    { label: "Transactions confirmed", value: formatNumber(summary.total_transactions) },
    { label: "VLQ in circulation", value: formatVlq(summary.total_vlq_in_circulation) },
    { label: "Active wallets (30 days)", value: formatNumber(summary.active_wallets_30d) },
    { label: "Registered nodes", value: formatNumber(summary.registered_nodes) },
    { label: "Value locked in active loans", value: formatVlq(summary.total_value_locked) },
    { label: "Governance proposals concluded", value: formatNumber(summary.governance_proposals_concluded) },
  ];

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Statistics</span>
        <h1>The Vorliq network at a glance</h1>
        <p className="subtitle">
          Live, public network activity, no account required. These figures refresh every 30 seconds
          and come straight from the blockchain, so anyone can verify the network is real and active.
        </p>
        <p className="help-text">
          <Link to="/blockchain">Open the block explorer</Link> to inspect any block or transaction, or see the{" "}
          <Link to="/economics">full VLQ supply &amp; reward schedule</Link> and the{" "}
          <Link to="/leaderboard">community leaderboard</Link>.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading && !data ? (
        <Spinner label="Loading community statistics..." />
      ) : (
        <>
          <section className="card card-pad stack" aria-label="Network summary">
            <div className="section-title">
              <div>
                <span className="eyebrow">Network</span>
                <h2>Live summary</h2>
              </div>
            </div>
            <div className="grid stats-grid">
              {stats.map((stat) => (
                <StatCard key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
          </section>

          <div className="two-column">
            <Leaderboard
              eyebrow="Most blocks mined"
              title="Top miners"
              rows={data?.top_miners}
              emptyText="No blocks have been mined yet."
              columns={[
                { key: "blocks", header: "Blocks", render: (row) => formatNumber(row.blocks) },
                { key: "rewards", header: "Rewards", render: (row) => formatVlq(row.rewards) },
              ]}
            />
            <Leaderboard
              eyebrow="Most loans funded"
              title="Top lenders"
              rows={data?.top_lenders}
              emptyText="No community loans have been funded yet."
              columns={[
                { key: "loans", header: "Loans funded", render: (row) => formatNumber(row.loans_funded) },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default Community;
