import { useCallback, useEffect, useState } from "react";

import api from "../helpers/api";

const ADMIN_TOKEN_KEY = "vorliq_admin_token";

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function formatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : "0";
}

// A simple horizontal bar list. No chart library: lightweight inline markup.
function BarList({ items, valueKey = "count", labelKey = "name", empty }) {
  const rows = Array.isArray(items) ? items.filter((item) => item && item[valueKey] > 0) : [];
  if (!rows.length) {
    return <div className="vq-ui-empty">{empty || "No data collected yet."}</div>;
  }
  const max = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 1);
  return (
    <div className="vq-bars">
      {rows.map((row) => (
        <div className="vq-bar-row" key={row[labelKey]}>
          <span className="vq-bar-label" title={row[labelKey]}>
            {row[labelKey]}
          </span>
          <span className="vq-bar-track">
            <span className="vq-bar-fill" style={{ width: `${Math.max(4, (Number(row[valueKey]) / max) * 100)}%` }} />
          </span>
          <span className="vq-bar-value">{formatNumber(row[valueKey])}</span>
        </div>
      ))}
    </div>
  );
}

// A compact column chart for daily page views over time.
function ColumnChart({ data }) {
  const rows = Array.isArray(data) ? data : [];
  const total = rows.reduce((sum, row) => sum + (Number(row.page_views) || 0), 0);
  if (!rows.length || total === 0) {
    return <div className="vq-ui-empty">No page views collected yet.</div>;
  }
  const max = Math.max(...rows.map((row) => Number(row.page_views) || 0), 1);
  return (
    <div className="vq-columns" role="img" aria-label="Daily page views over the last 30 days">
      {rows.map((row) => (
        <span
          className="vq-column"
          key={row.date}
          title={`${row.date}: ${formatNumber(row.page_views)} page views`}
          style={{ height: `${Math.max(3, (Number(row.page_views) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="card card-pad stat-card compact-stat vq-metric">
      <span className="stat-label">{label}</span>
      <span className="stat-value vq-metric__value">{value}</span>
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <article className="card card-pad stack">
      <div className="section-title">
        <div>
          <span className="eyebrow">{title}</span>
          {subtitle ? <p className="muted-text">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </article>
  );
}

function AdminAnalytics() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [tokenInput, setTokenInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (activeToken) => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/analytics", { headers: authHeader(activeToken) });
      setData(response.data);
      return true;
    } catch (requestError) {
      const status = requestError?.response?.status;
      setError(status === 401 ? "That admin token was not accepted." : "Unable to load analytics right now.");
      setData(null);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  async function submitToken(event) {
    event.preventDefault();
    const ok = await load(tokenInput);
    if (ok) {
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, tokenInput);
      setToken(tokenInput);
      setTokenInput("");
    }
  }

  function signOut() {
    window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken("");
    setData(null);
  }

  if (!token || (!data && !loading)) {
    return (
      <div className="page">
        <section className="hero">
          <span className="eyebrow">Admin</span>
          <h1>Product analytics</h1>
          <p className="subtitle">
            Aggregate, privacy-conscious product analytics. Enter the server operator token to view it. The token is
            kept only in this browser session.
          </p>
        </section>
        <section className="card card-pad stack" aria-label="Admin token">
          <form className="form" onSubmit={submitToken}>
            <div className="field">
              <label htmlFor="admin-analytics-token">Admin token</label>
              <input
                id="admin-analytics-token"
                className="input"
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                autoComplete="off"
              />
            </div>
            {error ? <p className="error-message">{error}</p> : null}
            <div className="button-row">
              <button className="button" type="submit" disabled={!tokenInput || loading}>
                {loading ? "Checking..." : "View analytics"}
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="page">
        <section className="hero">
          <span className="eyebrow">Admin</span>
          <h1>Product analytics</h1>
        </section>
        <div className="empty-state">Loading analytics...</div>
      </div>
    );
  }

  const summary = data || {};
  const noData = (summary.total_events_30d ?? 0) === 0;

  return (
    <div className="page stack">
      <section className="hero two-column">
        <div className="stack">
          <span className="eyebrow">Admin</span>
          <h1>Product analytics</h1>
          <p className="subtitle">
            Aggregate usage over the last {summary.retention_days || 90} day retention window. No IP addresses, wallet
            identity, keys, or secrets are stored.
          </p>
        </div>
        <div className="button-row">
          <button className="button secondary small-button" type="button" onClick={() => load(token)}>
            Refresh
          </button>
          <button className="button secondary small-button" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>

      {error ? <p className="error-message">{error}</p> : null}

      {noData ? (
        <div className="empty-state">
          No analytics events have been collected yet. Charts will fill in as the product is used.
        </div>
      ) : null}

      <div className="grid stats-grid">
        <StatTile label="Events (30d)" value={formatNumber(summary.total_events_30d)} />
        <StatTile label="Page views (30d)" value={formatNumber(summary.page_views_30d)} />
        <StatTile label="API failures (30d)" value={formatNumber(summary.api_failure_total_30d)} />
        <StatTile label="Frontend errors (30d)" value={formatNumber(summary.frontend_error_count_30d)} />
        <StatTile label="Explorer usage (30d)" value={formatNumber(summary.explorer_usage_30d)} />
        <StatTile label="API error rate" value={`${((summary.api_error_rate_30d || 0) * 100).toFixed(1)}%`} />
      </div>

      <ChartCard title="Page views over time" subtitle="Daily page views across the last 30 days.">
        <ColumnChart data={summary.daily_counts} />
      </ChartCard>

      <div className="grid two-column">
        <ChartCard title="Top buttons" subtitle="Most clicked calls to action and navigation.">
          <BarList items={summary.top_buttons} />
        </ChartCard>
        <ChartCard title="Top product cards" subtitle="Most clicked interface cards.">
          <BarList items={summary.top_cards} />
        </ChartCard>
      </div>

      <div className="grid two-column">
        <ChartCard title="Most used dashboard features" subtitle="Dashboard action clicks.">
          <BarList items={summary.dashboard_features} />
        </ChartCard>
        <ChartCard title="User journey funnel" subtitle="Landing to first key actions.">
          <BarList items={summary.journey_funnel} labelKey="stage" />
        </ChartCard>
      </div>

      <div className="grid two-column">
        <ChartCard title="Top routes" subtitle="Most visited pages.">
          <BarList items={summary.top_routes} />
        </ChartCard>
        <ChartCard title="Device breakdown" subtitle="Viewport size buckets.">
          <BarList items={summary.device_breakdown} />
        </ChartCard>
      </div>

      <ChartCard title="API failures by endpoint" subtitle="Failed or timed-out public data requests by route.">
        <BarList items={(summary.api_failures || []).map((entry) => ({ name: entry.endpoint, count: entry.total }))} empty="No API failures recorded." />
      </ChartCard>
    </div>
  );
}

export default AdminAnalytics;
