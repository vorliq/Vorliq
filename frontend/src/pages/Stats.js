import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Stats() {
  const [summary, setSummary] = useState(null);
  const [loans, setLoans] = useState([]);
  const [leaderboard, setLeaderboard] = useState({ holders: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadStats() {
      try {
        const [summaryResponse, loansResponse, leaderboardResponse] = await Promise.all([
          api.get("/chain/summary"),
          api.get("/lending/loans", { params: { limit: 200 } }),
          api.get("/leaderboard", { params: { limit: 10 } }),
        ]);

        if (mounted) {
          setSummary(summaryResponse.data.summary || {});
          setLoans(loansResponse.data.loans || []);
          setLeaderboard(leaderboardResponse.data || { holders: [] });
        }
      } catch (requestError) {
        if (mounted) {
          setError(apiErrorMessage(requestError, "Unable to load community statistics."));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadStats();

    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const currentHeight = summary?.block_height ?? 0;
    const halvingInterval = 210000;
    const nextHalvingBlock =
      Math.floor(currentHeight / halvingInterval) * halvingInterval + halvingInterval;
    const blocksUntilHalving = Math.max(nextHalvingBlock - currentHeight, 0);

    const approvedLoans = loans.filter((loan) => loan.status === "approved");
    const rejectedLoans = loans.filter((loan) => loan.status === "rejected");
    const repaidLoans = loans.filter((loan) => loan.status === "repaid");
    const everApprovedLoans = loans.filter((loan) => ["approved", "repaid"].includes(loan.status));

    return {
      totalBlocks: summary?.total_blocks ?? 0,
      totalTransactions: summary?.total_transactions ?? 0,
      totalIssued: summary?.total_issued ?? 0,
      currentReward: summary?.current_mining_reward ?? 50,
      nextHalvingBlock,
      blocksUntilHalving,
      totalLoans: loans.length,
      approvedLoans: approvedLoans.length,
      rejectedLoans: rejectedLoans.length,
      repaidLoans: repaidLoans.length,
      totalLent: everApprovedLoans.reduce((sum, loan) => sum + Number(loan.amount || 0), 0),
      totalRepaid: repaidLoans.reduce((sum, loan) => sum + Number(loan.repayment_amount || 0), 0),
      topAddresses: leaderboard.holders || [],
    };
  }, [leaderboard, loans, summary]);

  if (loading) {
    return (
      <main className="page">
        <Spinner label="Loading community statistics..." />
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <ErrorMessage message={error} />
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Community Metrics</span>
        <h1>Stats</h1>
        <p className="subtitle">
          A live overview of Vorliq network activity, lending activity, and top VLQ balances.
        </p>
      </section>

      <StatsSection
        title="Network Statistics"
        items={[
          ["Total Blocks Mined", stats.totalBlocks],
          ["Total Transactions", stats.totalTransactions],
          ["VLQ in Circulation", `${stats.totalIssued} VLQ`],
          ["Current Mining Reward", `${stats.currentReward} VLQ`],
          ["Next Halving Block", stats.nextHalvingBlock],
          ["Blocks Until Halving", stats.blocksUntilHalving],
        ]}
      />

      <StatsSection
        title="Lending Statistics"
        items={[
          ["Total Loan Requests", stats.totalLoans],
          ["Approved Loans", stats.approvedLoans],
          ["Rejected Loans", stats.rejectedLoans],
          ["Repaid Loans", stats.repaidLoans],
          ["Total VLQ Lent Out", `${stats.totalLent} VLQ`],
          ["Total VLQ Repaid", `${stats.totalRepaid} VLQ`],
        ]}
      />

      <section className="card card-pad stats-section">
        <h2>Top Addresses</h2>
        {stats.topAddresses.length === 0 ? (
          <div className="empty-state">No positive address balances found yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Address</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {stats.topAddresses.map((row, index) => (
                  <tr key={row.address}>
                    <td>{index + 1}</td>
                    <td>{shorten(row.address)}</td>
                    <td>{formatNumber(row.value)} VLQ</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function StatsSection({ items, title }) {
  return (
    <section className="card card-pad stats-section">
      <h2>{title}</h2>
      <div className="grid stats-grid">
        {items.map(([label, value]) => (
          <div className="card card-pad stat-card compact-stat" key={label}>
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function shorten(address) {
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : Number(value).toFixed(4).replace(/\.?0+$/, "");
}

export default Stats;
