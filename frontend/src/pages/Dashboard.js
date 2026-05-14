import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Dashboard() {
  const [chainData, setChainData] = useState(null);
  const [economics, setEconomics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      try {
        const [chainResponse, economicsResponse] = await Promise.all([
          api.get("/chain"),
          api.get("/economics"),
        ]);
        if (mounted) {
          setErrorMessage("");
          setChainData(chainResponse.data);
          setEconomics(economicsResponse.data);
          setLastUpdated(new Date());
        }
      } catch (error) {
        const message = apiErrorMessage(error, "Unable to load blockchain dashboard.");
        setErrorMessage(message);
        toast.error(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const chain = chainData?.chain || [];
    const transactions = chain.reduce((total, block) => total + (block.transactions?.length || 0), 0);

    return {
      blocks: chain.length,
      transactions,
      reward: economics?.current_mining_reward ?? chainData?.mining_reward ?? 50,
      blockHeight: economics?.current_block_height ?? Math.max(chain.length - 1, 0),
      totalIssued: economics?.total_issued ?? 0,
      valid: Boolean(chainData?.is_valid),
    };
  }, [chainData, economics]);

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">VLQ Community Chain</span>
        <h1>Welcome to Vorliq</h1>
        <p className="subtitle">
          Vorliq is a community savings bank running on its own blockchain, built for people
          who want to save, lend, and keep shared records together.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="grid stats-grid">
        <div className="card card-pad stat-card">
          <span className="stat-label">Total Blocks</span>
          <span className="stat-value">{loading ? "..." : stats.blocks}</span>
        </div>
        <div className="card card-pad stat-card">
          <span className="stat-label">Total Transactions</span>
          <span className="stat-value">{loading ? "..." : stats.transactions}</span>
        </div>
        <div className="card card-pad stat-card">
          <span className="stat-label">Mining Reward</span>
          <span className="stat-value">{loading ? "..." : `${stats.reward} VLQ`}</span>
        </div>
        <div className="card card-pad stat-card">
          <span className="stat-label">Chain Status</span>
          <span className={`stat-value ${stats.valid ? "green" : "red"}`}>
            {loading ? "..." : stats.valid ? "Chain Valid" : "Chain Invalid"}
          </span>
        </div>
        <div className="card card-pad stat-card">
          <span className="stat-label">Current Block Height</span>
          <span className="stat-value">{loading ? "..." : stats.blockHeight}</span>
        </div>
        <div className="card card-pad stat-card">
          <span className="stat-label">Total VLQ Issued</span>
          <span className="stat-value">{loading ? "..." : `${stats.totalIssued} VLQ`}</span>
        </div>
      </section>

      {lastUpdated && (
        <p className="last-updated">Last updated {lastUpdated.toLocaleString()}</p>
      )}

      <section className="card card-pad about-card">
        <span className="eyebrow">About Vorliq</span>
        <h2>About Vorliq</h2>
        <p>
          Vorliq is a self contained community savings bank that runs on its own blockchain,
          giving communities a shared place to save, lend, and track value together. VLQ is
          the native coin used inside the Vorliq network. Every VLQ transaction is signed with
          cryptographic keys and recorded by the chain after it is mined into a block.
        </p>
      </section>
    </main>
  );
}

export default Dashboard;
