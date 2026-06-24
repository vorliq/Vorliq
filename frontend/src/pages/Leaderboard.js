import { useEffect, useState } from "react";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import ProfileBadge from "../components/ProfileBadge";
import TrustLabels from "../components/TrustLabels";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const tabs = [
  { id: "active", label: "Most Active" },
  { id: "miners", label: "Top Miners" },
  { id: "lenders", label: "Top Lenders" },
  { id: "holders", label: "Top Holders" },
  { id: "reputation", label: "Top Reputation" },
];

const POLL_MS = 5 * 60 * 1000; // refresh every five minutes

function Leaderboard() {
  const [activeTab, setActiveTab] = useState("active");
  const [leaderboard, setLeaderboard] = useState({ active: [], holders: [], miners: [], lenders: [], reputation: [] });
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadLeaderboard() {
      try {
        const [leaderboardResponse, reputationResponse] = await Promise.all([
          api.get("/leaderboard", { params: { limit: 10 } }),
          api.get("/profiles/top", { params: { limit: 10 } }),
        ]);

        if (mounted) {
          setLeaderboard({
            active: leaderboardResponse.data.active || [],
            holders: leaderboardResponse.data.holders || [],
            miners: leaderboardResponse.data.miners || [],
            lenders: leaderboardResponse.data.lenders || [],
            reputation: reputationResponse.data.profiles || [],
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
    // Public leaderboard refreshes itself every five minutes (existing polling
    // pattern) so a visitor watching it sees the network stay alive.
    const timer = setInterval(loadLeaderboard, POLL_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Loading leaderboard..." />
      </div>
    );
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Leaders</span>
        <h1>Leaderboard</h1>
        <p className="subtitle">
          Real addresses doing real things on Vorliq — the most active wallets by transaction count, the top
          miners by blocks mined, and the top lenders by VLQ lent to the community. No account needed; this
          page refreshes every five minutes.
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
        {activeTab === "active" && (
          <LeaderboardTable
            title="Most Active Wallets"
            rows={leaderboard.active}
            valueLabel="Transactions"
          />
        )}
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
            valueLabel="VLQ Lent"
            valueSuffix="VLQ"
          />
        )}
        {activeTab === "reputation" && (
          <ReputationTable rows={leaderboard.reputation} />
        )}
      </section>
    </div>
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
                  <td><AddressIdentity address={row.address} compact /></td>
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

function ReputationTable({ rows }) {
  return (
    <>
      <h2>Top Reputation</h2>
      {rows.length === 0 ? (
        <div className="empty-state">No public profiles have reputation yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Member</th>
                <th>Reputation</th>
                <th>Badges</th>
                <th>Trust Labels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((profile, index) => (
                <tr key={profile.wallet_address}>
                  <td>{index + 1}</td>
                  <td>
                    <div className="leaderboard-profile-cell">
                      <AddressIdentity address={profile.wallet_address} profile={profile} compact />
                    </div>
                  </td>
                  <td>{profile.reputation_score || 0}</td>
                  <td>
                    <div className="profile-badge-row">
                      {(profile.badges || []).slice(0, 3).map((badge, badgeIndex) => (
                        <ProfileBadge badge={badge} key={`${profile.wallet_address}-${badgeIndex}`} />
                      ))}
                    </div>
                  </td>
                  <td><TrustLabels profile={profile} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : Number(value).toFixed(4).replace(/\.?0+$/, "");
}

export default Leaderboard;
