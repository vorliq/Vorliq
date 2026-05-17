import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Stats() {
  const [summary, setSummary] = useState(null);
  const [lendingSummary, setLendingSummary] = useState(null);
  const [exchangeSummary, setExchangeSummary] = useState(null);
  const [governanceSummary, setGovernanceSummary] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ holders: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadStats() {
      try {
        const [summaryResponse, loansResponse, exchangeResponse, governanceResponse, leaderboardResponse] = await Promise.all([
          api.get("/chain/summary"),
          api.get("/lending/summary"),
          api.get("/exchange/summary"),
          api.get("/governance/summary"),
          api.get("/leaderboard", { params: { limit: 10 } }),
        ]);

        if (mounted) {
          setSummary(summaryResponse.data.summary || {});
          setLendingSummary(loansResponse.data.summary || {});
          setExchangeSummary(exchangeResponse.data.summary || {});
          setGovernanceSummary(governanceResponse.data.summary || {});
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

    return {
      totalBlocks: summary?.total_blocks ?? 0,
      totalTransactions: summary?.total_transactions ?? 0,
      totalIssued: summary?.total_issued ?? 0,
      currentReward: summary?.current_mining_reward ?? 50,
      nextHalvingBlock,
      blocksUntilHalving,
      totalLoans: lendingSummary?.total_loans ?? 0,
      pendingVotes: lendingSummary?.pending_vote_count ?? 0,
      approvedPendingIssue: lendingSummary?.approved_pending_issue_count ?? 0,
      activeLoans: lendingSummary?.active_count ?? 0,
      overdueLoans: lendingSummary?.overdue_count ?? 0,
      rejectedLoans: lendingSummary?.rejected_count ?? 0,
      repaidLoans: lendingSummary?.repaid_count ?? 0,
      totalLent: lendingSummary?.total_vlq_active ?? 0,
      totalRepaid: lendingSummary?.total_vlq_repaid ?? 0,
      openOffers: exchangeSummary?.open_count ?? 0,
      activeTrades: exchangeSummary?.active_trades_count ?? 0,
      completedTrades: exchangeSummary?.completed_count ?? 0,
      disputedTrades: exchangeSummary?.disputed_count ?? 0,
      activeProposals: governanceSummary?.active_count ?? 0,
      pendingExecution: governanceSummary?.passed_pending_execution_count ?? 0,
      executedRuleChanges: governanceSummary?.executed_count ?? 0,
      latestRuleChange: governanceSummary?.latest_executed_rule_change?.category || "None",
      topAddresses: leaderboard.holders || [],
    };
  }, [exchangeSummary, governanceSummary, leaderboard, lendingSummary, summary]);

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Loading community statistics..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <ErrorMessage message={error} />
      </div>
    );
  }

  return (
    <div className="page">
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
          ["Pending Votes", stats.pendingVotes],
          ["Approved Pending Issue", stats.approvedPendingIssue],
          ["Active Loans", stats.activeLoans],
          ["Overdue Loans", stats.overdueLoans],
          ["Rejected Loans", stats.rejectedLoans],
          ["Repaid Loans", stats.repaidLoans],
          ["Active VLQ", `${formatNumber(stats.totalLent)} VLQ`],
          ["Repaid VLQ", `${formatNumber(stats.totalRepaid)} VLQ`],
        ]}
      />

      <StatsSection
        title="Exchange Statistics"
        items={[
          ["Open Offers", stats.openOffers],
          ["Active Trades", stats.activeTrades],
          ["Completed Trades", stats.completedTrades],
          ["Disputed Trades", stats.disputedTrades],
        ]}
      />

      <StatsSection
        title="Governance Statistics"
        items={[
          ["Active Proposals", stats.activeProposals],
          ["Pending Execution", stats.pendingExecution],
          ["Executed Rule Changes", stats.executedRuleChanges],
          ["Latest Rule Change", stats.latestRuleChange],
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
    </div>
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
