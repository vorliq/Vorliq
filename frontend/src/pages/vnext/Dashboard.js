// Dashboard inside the new app shell (/preview/app/dashboard). Composes the
// reusable SummaryCard / DataTable / LineChart primitives and wires them to the
// real APIs. Every data-dependent section has its own skeleton loader and its
// own inline error + retry; nothing is ever estimated.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Coins, Droplets, Landmark, Wallet } from "lucide-react";

import "../../styles/vnext.css";
import ActivityFeed from "../../components/vnext/ActivityFeed";
import AppShell from "../../components/vnext/AppShell";
import OnboardingTour from "../../components/vnext/OnboardingTour";
import LineChart from "../../components/vnext/LineChart";
import SummaryCard from "../../components/vnext/SummaryCard";
import TransactionHistory, { useTransactions } from "../../components/vnext/TransactionHistory";
import { Button, Card, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import api from "../../helpers/api";
import { useSharedWalletBalance } from "../../context/WalletBalanceContext";
import { formatNumber, formatVlq } from "../../helpers/publicApi";

function formatUptime(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/* ----------------------------------------------- Wallet summary + chart -- */
// History + lending overview for the dashboard. The spendable balance itself
// comes from the shared useWalletBalance hook (same source as the sidebar,
// Wallet, Send and Faucet) so every surface shows one consistent figure rather
// than a separate, divergent fetch.
function useWalletData(address) {
  const [state, setState] = useState({ loading: true, error: "", history: null, lending: null });

  const load = useCallback(
    async (signal) => {
      if (!address) {
        setState({ loading: false, error: "", history: null, lending: null });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: "" }));
      const [historyRes, lendingRes] = await Promise.allSettled([
        api.get("/wallet/history", { params: { address }, signal }),
        api.get("/lending/my", { params: { address }, signal }),
      ]);
      if (signal?.aborted) return;

      const everythingFailed = historyRes.status === "rejected" && lendingRes.status === "rejected";

      setState({
        loading: false,
        error: everythingFailed ? "We couldn't load your wallet overview." : "",
        history: historyRes.status === "fulfilled" ? historyRes.value.data : null,
        lending: lendingRes.status === "fulfilled" ? lendingRes.value.data : null,
      });
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { ...state, reload: () => load() };
}

/* ------------------------------------------------- Network status panel -- */
function NetworkStatusPanel({ onHeight }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  const load = useCallback(async (signal) => {
    // Update each value the moment its source responds, rather than waiting for
    // the slowest of the three fetches. A slow /diagnostics (Flask cold start)
    // therefore only delays "Node uptime" — block height, difficulty, and total
    // transactions still appear immediately from /chain/summary.
    const merge = (patch) => {
      if (signal?.aborted) return;
      setData((prev) => ({ ...(prev || {}), ...patch }));
      setError("");
    };

    const summaryTask = api
      .get("/chain/summary", { signal })
      .then((res) => {
        const summary = res.data?.summary || {};
        merge({
          height: summary.block_height,
          totalTransactions: summary.total_transactions,
        });
        setData((prev) => ({ ...(prev || {}), difficulty: prev?.difficulty ?? summary.current_difficulty }));
        if (summary.block_height != null && onHeight) onHeight(summary.block_height);
      });

    const blockTask = api
      .get("/chain/blocks", { params: { limit: 1, offset: 0 }, signal })
      .then((res) => {
        const latest = res.data?.blocks?.[0];
        if (latest?.difficulty != null) merge({ difficulty: latest.difficulty });
      });

    const diagTask = api
      .get("/diagnostics", { signal })
      .then((res) => {
        const diag = res.data || {};
        merge({ uptime: diag.uptime_seconds });
        setData((prev) => ({ ...(prev || {}), height: prev?.height ?? diag.block_height }));
        if (diag.block_height != null && onHeight) onHeight(diag.block_height);
      });

    const settled = await Promise.allSettled([summaryTask, blockTask, diagTask]);
    if (signal?.aborted) return;
    setReady(true);
    // Only show the panel-level error if every source failed; a partial response
    // still shows the values that did arrive.
    if (settled.every((r) => r.status === "rejected")) {
      const realFailure = settled.some(
        (r) => r.reason?.name !== "CanceledError" && r.reason?.code !== "ERR_CANCELED"
      );
      if (realFailure) setError("Network status is unavailable.");
    }
  }, [onHeight]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    // Refresh every 30 seconds; cleared on unmount.
    const timer = setInterval(() => load(controller.signal), 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  // A field that has not arrived yet shows "…"; once every fetch has settled, a
  // field that is still missing is genuinely "Unavailable".
  const cell = (value, format) => {
    if (value != null) return format(value);
    return ready ? "Unavailable" : "…";
  };
  const rows = [
    { label: "Block height", value: cell(data?.height, (v) => `#${formatNumber(v)}`) },
    { label: "Difficulty", value: cell(data?.difficulty, (v) => formatNumber(v)) },
    { label: "Total transactions", value: cell(data?.totalTransactions, (v) => formatNumber(v)) },
    { label: "Node uptime", value: cell(data?.uptime, (v) => formatUptime(v) || "Unavailable") },
  ];

  return (
    <Card>
      <h2 className="vn-panel-title">Network status</h2>
      {error ? (
        <InlineError message={error} onRetry={() => load()} />
      ) : (
        <div className="vn-netstat">
          {rows.map((r) => (
            <div className="vn-netstat__row" key={r.label}>
              <span className="vn-netstat__label">{r.label}</span>
              <span className="vn-netstat__value">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- Page ---- */
export default function Dashboard() {
  const { wallet, isLoggedIn } = useAuth();
  const address = wallet?.address;

  const walletData = useWalletData(address);
  const balance = useSharedWalletBalance();
  const { rows: txRows, error: txError, reload: reloadTx } = useTransactions(address);
  const [now, setNow] = useState(() => new Date());
  const [latestHeight, setLatestHeight] = useState(null);
  // Mobile-only section toggles (ignored by CSS on tablet/desktop, where both
  // panels in each section are shown side by side as before).
  const [chartTab, setChartTab] = useState("chart");
  const [listTab, setListTab] = useState("activity");

  // Tick the header clock once a minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // The header's "Block #N" comes from the network panel's chain-summary fetch
  // (via onHeight) rather than a second identical request.

  const history = walletData.history;
  const hasBalance = Number.isFinite(Number(balance.available));

  const chartData = useMemo(() => {
    const points = history?.balance_history || [];
    return points
      .map((p, i) => ({ x: Number(p.timestamp) || i, y: Number(p.balance) }))
      .filter((p) => Number.isFinite(p.y));
  }, [history]);

  const balanceTrend = useMemo(() => {
    if (!chartData.length) return null;
    const last = chartData[chartData.length - 1].y;
    const prev = chartData.length > 1 ? chartData[chartData.length - 2].y : 0;
    if (last === prev) return { direction: "flat", label: "no change" };
    const up = last > prev;
    return { direction: up ? "up" : "down", label: `${up ? "+" : "−"}${formatNumber(Math.abs(last - prev))} VLQ` };
  }, [chartData]);

  // Directional colour for the balance line: teal when the latest balance is up
  // on the previous point, red when down, neutral grey when unchanged.
  const chartColor =
    balanceTrend?.direction === "down"
      ? "#ef4444"
      : balanceTrend?.direction === "flat"
        ? "#8a9bb0"
        : "#00a896";

  const activeLending = useMemo(() => {
    if (!walletData.lending) return null;
    const list = walletData.lending.borrowed || walletData.lending.loans || [];
    const active = list.filter((l) => ["active", "approved_pending_issue", "overdue"].includes(l.status));
    const total = active.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    return { count: active.length, total };
  }, [walletData.lending]);

  const summaryLoading = walletData.loading;
  // Headline balance is the spendable (available) figure — the same number the
  // sidebar, Wallet, Send and Faucet show — so no two surfaces disagree. Any
  // unconfirmed incoming credit (e.g. a fresh mining reward) is surfaced as the
  // trend so the figure is never silently understated.
  const balanceTrendOrPending =
    balance.pendingIncoming > 0
      ? { direction: "up", label: `+${formatVlq(balance.pendingIncoming)} pending` }
      : balanceTrend;
  const cards = [
    {
      label: "Available Balance",
      value: hasBalance ? formatVlq(balance.available) : null,
      trend: balanceTrendOrPending,
      icon: Wallet,
      loading: balance.loading,
    },
    {
      label: "Total Sent",
      value: history ? formatVlq(history.total_sent) : null,
      trend: { direction: "flat", label: "lifetime" },
      icon: ArrowUpRight,
      loading: summaryLoading,
    },
    {
      label: "Total Received",
      value: history ? formatVlq(history.total_received) : null,
      trend: { direction: "flat", label: "lifetime" },
      icon: Coins,
      loading: summaryLoading,
    },
    {
      label: "Active Lending Position",
      value: activeLending ? formatVlq(activeLending.total) : null,
      trend: activeLending ? { direction: "flat", label: `${activeLending.count} active` } : null,
      icon: Landmark,
      loading: summaryLoading,
    },
  ];

  return (
    <AppShell active="dashboard">
      <div className="vn-page-head">
        <h1>{greetingFor(now)}</h1>
        <div className="vn-page-head__meta">
          {now.toLocaleString()}
          {latestHeight != null && (
            <>
              {" · Block "}
              <b>#{formatNumber(latestHeight)}</b>
            </>
          )}
        </div>
      </div>

      {!isLoggedIn && (
        <Card style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: "var(--vn-text-2)" }}>
            <Link className="vn-block-link" to="/login">
              Sign in
            </Link>{" "}
            to load your VLQ balance, transaction history, and lending position.
          </p>
        </Card>
      )}

      {/* New-member nudge: a logged-in wallet with no VLQ at all (none confirmed,
          none pending) is almost always someone who just created their wallet,
          so point them at the Faucet — the fastest way to a first balance. */}
      {isLoggedIn && balance.total === 0 && (
        <Card style={{ marginBottom: 18 }}>
          <h2 className="vn-panel-title" style={{ marginTop: 0 }}>Welcome to Vorliq</h2>
          <p style={{ color: "var(--vn-text-2)", margin: "0 0 16px" }}>
            Your wallet is ready but empty. Claim your first VLQ from the community Faucet to start
            saving, sending, and voting — no mining required.
          </p>
          <Button variant="primary" to="/faucet">
            <Droplets size={18} aria-hidden="true" /> Get your first VLQ
          </Button>
        </Card>
      )}

      {walletData.error && (
        <InlineError message={walletData.error} onRetry={walletData.reload} />
      )}
      <div className="vn-summary-grid">
        {cards.map((c) => (
          <SummaryCard
            key={c.label}
            label={c.label}
            value={c.value}
            trend={c.trend}
            icon={c.icon}
            loading={c.loading && isLoggedIn}
          />
        ))}
      </div>

      {/* Lower dashboard. One set of components, arranged by CSS grid on
          tablet/desktop exactly as before. Below 768px the same components are
          reorganised into two tabbed sections (charts ↔ network status, and
          activity ↔ transaction history) via the data-* attributes — no data is
          removed, only the way it is reached on a small screen. Each component is
          mounted once, so switching tabs never refetches. */}
      <div className="vn-dash-zones" data-chart-tab={chartTab} data-list-tab={listTab}>
        {/* Section A toggle (mobile only): Balance chart ↔ Network status. */}
        <div className="vn-dash-zones__tabs" role="tablist" aria-label="Charts and network">
          <button
            type="button"
            role="tab"
            aria-selected={chartTab === "chart"}
            className={`vn-dash-zones__tab ${chartTab === "chart" ? "is-active" : ""}`}
            onClick={() => setChartTab("chart")}
          >
            Balance
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={chartTab === "network"}
            className={`vn-dash-zones__tab ${chartTab === "network" ? "is-active" : ""}`}
            onClick={() => setChartTab("network")}
          >
            Network status
          </button>
        </div>

        <div className="vn-dash-zones__chart">
          <Card>
            <h2 className="vn-panel-title">Balance over time</h2>
            <LineChart
              data={chartData}
              loading={walletData.loading && isLoggedIn}
              color={chartColor}
              formatY={(v) => formatVlq(v)}
              formatX={(v) => (v > 1e9 ? new Date(v * 1000).toLocaleDateString() : `#${v}`)}
              ariaLabel="Wallet balance over time"
            />
          </Card>
        </div>

        <div className="vn-dash-zones__network">
          <NetworkStatusPanel onHeight={setLatestHeight} />
        </div>

        {/* Section B toggle (mobile only): Network activity ↔ Transactions. */}
        <div className="vn-dash-zones__tabs vn-dash-zones__tabs--b" role="tablist" aria-label="Activity and transactions">
          <button
            type="button"
            role="tab"
            aria-selected={listTab === "activity"}
            className={`vn-dash-zones__tab ${listTab === "activity" ? "is-active" : ""}`}
            onClick={() => setListTab("activity")}
          >
            Activity
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={listTab === "transactions"}
            className={`vn-dash-zones__tab ${listTab === "transactions" ? "is-active" : ""}`}
            onClick={() => setListTab("transactions")}
          >
            Transactions
          </button>
        </div>

        {/* Public network activity — everyone sees the same chain events. */}
        <div className="vn-dash-zones__feed">
          <ActivityFeed />
        </div>

        {/* Personal transaction history (shared with the Wallet page). */}
        <div className="vn-dash-zones__history">
          <TransactionHistory
            address={address}
            isLoggedIn={isLoggedIn}
            rows={txRows}
            error={txError}
            onRetry={reloadTx}
          />
        </div>
      </div>

      {/* First-run guided tour — only renders for a brand-new wallet, and only
          while it is active (it remembers if it was dismissed or finished). */}
      {isLoggedIn && <OnboardingTour />}
    </AppShell>
  );
}
