import { useEffect, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const tabs = [
  { id: "holders", label: "Top Holders" },
  { id: "miners", label: "Top Miners" },
  { id: "lenders", label: "Top Lenders" },
];

function Leaderboard() {
  const [activeTab, setActiveTab] = useState("holders");
  const [leaderboard, setLeaderboard] = useState({ holders: [], miners: [], lenders: [] });
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadLeaderboard() {
      try {
        const response = await api.get("/leaderboard", { params: { limit: 20 } });

        if (mounted) {
          setLeaderboard({
            holders: response.data.holders || [],
            miners: response.data.miners || [],
            lenders: response.data.lenders || [],
          });
          setErrorMessage("");
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(apiErrorMessage(error, "Unable to load the community leaderboard."));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadLeaderboard();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <main className="page">
        <Spinner label="Loading leaderboard..." />
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Community Leaders</span>
        <h1>Leaderboard</h1>
        <p className="subtitle">
          See the leading VLQ holders, miners, and members who have repaid community loans.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            key={tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="card card-pad">
        {activeTab === "holders" && (
          <LeaderboardTable
            title="Top Holders"
            rows={leaderboard.holders}
            valueLabel="Balance"
            valueSuffix="VLQ"
          />
        )}
        {activeTab === "miners" && (
          <LeaderboardTable
            title="Top Miners"
            rows={leaderboard.miners}
            valueLabel="Blocks Mined"
          />
        )}
        {activeTab === "lenders" && (
          <LeaderboardTable
            title="Top Lenders"
            rows={leaderboard.lenders}
            valueLabel="Loans Repaid"
          />
        )}
      </section>
    </main>
  );
}

function LeaderboardTable({ rows, title, valueLabel, valueSuffix = "" }) {
  return (
    <>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <div className="empty-state">No leaderboard data is available yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Address</th>
                <th>{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.address}>
                  <td>{index + 1}</td>
                  <td>{shorten(row.address)}</td>
                  <td>
                    {formatNumber(row.value)} {valueSuffix}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function shorten(address) {
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : Number(value).toFixed(4).replace(/\.?0+$/, "");
}

export default Leaderboard;
