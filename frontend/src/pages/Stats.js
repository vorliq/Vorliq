import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Stats() {
  const [chainData, setChainData] = useState(null);
  const [economics, setEconomics] = useState(null);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadStats() {
      try {
        const [chainResponse, economicsResponse, loansResponse] = await Promise.all([
          api.get("/chain"),
          api.get("/economics"),
          api.get("/lending/loans"),
        ]);

        if (mounted) {
          setChainData(chainResponse.data);
          setEconomics(economicsResponse.data);
          setLoans(loansResponse.data.loans || []);
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
    const chain = chainData?.chain || [];
    const totalTransactions = chain.reduce(
      (total, block) => total + (block.transactions?.length || 0),
      0
    );
    const currentHeight = economics?.current_block_height ?? Math.max(chain.length - 1, 0);
    const halvingInterval = economics?.halving_interval ?? 210000;
    const nextHalvingBlock =
      Math.floor(currentHeight / halvingInterval) * halvingInterval + halvingInterval;
    const blocksUntilHalving = Math.max(nextHalvingBlock - currentHeight, 0);

    const approvedLoans = loans.filter((loan) => loan.status === "approved");
    const rejectedLoans = loans.filter((loan) => loan.status === "rejected");
    const repaidLoans = loans.filter((loan) => loan.status === "repaid");
    const everApprovedLoans = loans.filter((loan) => ["approved", "repaid"].includes(loan.status));

    const balances = new Map();
    chain.forEach((block) => {
      (block.transactions || []).forEach((transaction) => {
        const sender = transaction.sender_address;
        const receiver = transaction.receiver_address;
        const amount = Number(transaction.amount) || 0;
        balances.set(sender, (balances.get(sender) || 0) - amount);
        balances.set(receiver, (balances.get(receiver) || 0) + amount);
      });
    });

    const topAddresses = Array.from(balances.entries())
      .filter(([, balance]) => balance > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      totalBlocks: chain.length,
      totalTransactions,
      totalIssued: economics?.total_issued ?? 0,
      currentReward: economics?.current_mining_reward ?? chainData?.mining_reward ?? 50,
      nextHalvingBlock,
      blocksUntilHalving,
      totalLoans: loans.length,
      approvedLoans: approvedLoans.length,
      rejectedLoans: rejectedLoans.length,
      repaidLoans: repaidLoans.length,
      totalLent: everApprovedLoans.reduce((sum, loan) => sum + Number(loan.amount || 0), 0),
      totalRepaid: repaidLoans.reduce((sum, loan) => sum + Number(loan.repayment_amount || 0), 0),
      topAddresses,
    };
  }, [chainData, economics, loans]);

  if (loading) {
    return (
      <main className="page">
        <div className="empty-state">Loading community statistics...</div>
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
                {stats.topAddresses.map(([address, balance], index) => (
                  <tr key={address}>
                    <td>{index + 1}</td>
                    <td>{shorten(address)}</td>
                    <td>{balance} VLQ</td>
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

export default Stats;
