import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import api from "../helpers/api";

function Dashboard() {
  const [chainData, setChainData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      try {
        const response = await api.get("/chain");
        if (mounted) {
          setChainData(response.data);
        }
      } catch (error) {
        toast.error(error.response?.data?.error || "Unable to load blockchain dashboard.");
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
      reward: chainData?.mining_reward ?? 50,
      valid: Boolean(chainData?.is_valid),
    };
  }, [chainData]);

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
      </section>

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
