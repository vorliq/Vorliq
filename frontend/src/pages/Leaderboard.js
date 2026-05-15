import { useEffect, useMemo, useState } from "react";

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
  const [chainData, setChainData] = useState(null);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadLeaderboard() {
      try {
        const [chainResponse, loansResponse] = await Promise.all([
          api.get("/chain"),
          api.get("/lending/loans"),
        ]);

        if (mounted) {
          setChainData(chainResponse.data);
          setLoans(loansResponse.data.loans || []);
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

  const leaderboard = useMemo(() => {
    const chain = chainData?.chain || [];
    const balances = new Map();
    const miners = new Map();
    const repaidLoans = new Map();

    chain.forEach((block) => {
      if (block.miner_address) {
        miners.set(block.miner_address, (miners.get(block.miner_address) || 0) + 1);
      }

      (block.transactions || []).forEach((transaction) => {
        const sender = transaction.sender_address;
        const receiver = transaction.receiver_address;
        const amount = Number(transaction.amount) || 0;
        balances.set(sender, (balances.get(sender) || 0) - amount);
        balances.set(receiver, (balances.get(receiver) || 0) + amount);
      });
    });

    loans
      .filter((loan) => loan.status === "repaid")
      .forEach((loan) => {
        const requester = loan.requester_address;
        if (requester) {
          repaidLoans.set(requester, (repaidLoans.get(requester) || 0) + 1);
        }
      });

    return {
      holders: rankMap(balances, { positiveOnly: true }),
      miners: rankMap(miners),
      lenders: rankMap(repaidLoans),
    };
  }, [chainData, loans]);

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
              {rows.map(([address, value], index) => (
                <tr key={address}>
                  <td>{index + 1}</td>
                  <td>{shorten(address)}</td>
                  <td>
                    {formatNumber(value)} {valueSuffix}
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

function rankMap(map, { positiveOnly = false } = {}) {
  return Array.from(map.entries())
    .filter(
      ([address, value]) =>
        address &&
        !["SYSTEM", "LENDING_POOL"].includes(address) &&
        (!positiveOnly || value > 0)
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
}

function shorten(address) {
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : Number(value).toFixed(4).replace(/\.?0+$/, "");
}

export default Leaderboard;
