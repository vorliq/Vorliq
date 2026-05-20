import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Growth() {
  const [analytics, setAnalytics] = useState(null);
  const [registry, setRegistry] = useState(null);
  const [chain, setChain] = useState(null);
  const [mining, setMining] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadGrowth() {
      try {
        const [analyticsResponse, registryResponse, chainResponse, miningResponse] = await Promise.all([
          api.get("/analytics/summary"),
          api.get("/registry/summary"),
          api.get("/chain/summary"),
          api.get("/mining/status"),
        ]);

        if (mounted) {
          setAnalytics(analyticsResponse.data || {});
          setRegistry(registryResponse.data.summary || {});
          setChain(chainResponse.data.summary || {});
          setMining(miningResponse.data.status || miningResponse.data || {});
        }
      } catch (requestError) {
        if (mounted) {
          setError(apiErrorMessage(requestError, "Unable to load community growth metrics."));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadGrowth();

    return () => {
      mounted = false;
    };
  }, []);

  const communityInterest = useMemo(
    () => [
      ["Onboarding completions", analytics?.onboarding_completed_7d ?? 0],
      ["Faucet interest", analytics?.faucet_interest_7d ?? 0],
      ["Forum views", analytics?.forum_page_views_7d ?? 0],
      ["Mine views", analytics?.mine_page_views_7d ?? 0],
    ],
    [analytics]
  );

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Loading growth dashboard..." />
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
    <div className="page growth-page">
      <section className="hero">
        <span className="eyebrow">Community Growth</span>
        <h1>Growth</h1>
        <p className="subtitle">
          Privacy-preserving aggregate activity for the public Vorliq community. No private keys,
          passwords, raw IP addresses, raw user agents, message bodies, or personal identity are shown here.
        </p>
      </section>

      <section className="card card-pad stats-section">
        <h2>Product Activity</h2>
        <div className="grid stats-grid">
          <Metric label="Visits today" value={analytics?.page_views_today ?? 0} />
          <Metric label="Visits this week" value={analytics?.page_views_7d ?? 0} />
          <Metric label="Anonymous sessions today" value={analytics?.unique_anonymous_sessions_today ?? 0} />
          <Metric label="Anonymous sessions this week" value={analytics?.unique_anonymous_sessions_7d ?? 0} />
        </div>
      </section>

      <section className="card card-pad stats-section">
        <h2>Most Viewed Areas</h2>
        <RankedList rows={analytics?.top_routes_7d || []} empty="No route activity recorded yet." />
      </section>

      <section className="card card-pad stats-section">
        <h2>Community Activity Interest</h2>
        <div className="grid stats-grid">
          {communityInterest.map(([label, value]) => (
            <Metric label={label} value={value} key={label} />
          ))}
        </div>
      </section>

      <section className="card card-pad stats-section">
        <h2>Feature Usage</h2>
        <RankedList rows={analytics?.top_features_7d || []} empty="No feature activity recorded yet." />
      </section>

      <section className="card card-pad stats-section">
        <h2>Network Growth Signals</h2>
        <div className="grid stats-grid">
          <Metric label="Active registry nodes" value={registry?.active_node_count ?? 0} />
          <Metric label="Synced nodes" value={registry?.synced_node_count ?? 0} />
          <Metric label="Chain height" value={chain?.block_height ?? chain?.height ?? 0} />
          <Metric label="Pending transactions" value={chain?.pending_transaction_count ?? chain?.pending_transactions ?? 0} />
          <Metric label="Mining reward" value={`${mining?.current_mining_reward ?? mining?.mining_reward ?? 50} VLQ`} />
          <Metric label="Can mine now" value={mining?.can_mine_now ? "Yes" : "No"} />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="card card-pad stat-card compact-stat">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RankedList({ rows, empty }) {
  if (!rows.length) {
    return <div className="empty-state">{empty}</div>;
  }

  return (
    <div className="admin-list">
      {rows.map((row) => (
        <div className="admin-row" key={row.name}>
          <strong>{row.name}</strong>
          <span>{row.count}</span>
        </div>
      ))}
    </div>
  );
}

export default Growth;
