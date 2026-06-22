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

  const load = useCallback(async (signal) => {
    try {
      const [summaryRes, blockRes, diagRes] = await Promise.allSettled([
        api.get("/chain/summary", { signal }),
        api.get("/chain/blocks", { params: { limit: 1, offset: 0 }, signal }),
        api.get("/diagnostics", { signal }),
      ]);
      if (signal?.aborted) return;
      if (summaryRes.status === "rejected" && blockRes.status === "rejected" && diagRes.status === "rejected") {
        setError("Network status is unavailable.");
        return;
      }
      const summary = summaryRes.status === "fulfilled" ? summaryRes.value.data?.summary || {} : {};
      const latest = blockRes.status === "fulfilled" ? blockRes.value.data?.blocks?.[0] : null;
      const diag = diagRes.status === "fulfilled" ? diagRes.value.data || {} : {};
      setError("");
      const height = summary.block_height ?? diag.block_height;
      setData({
        height,
        difficulty: latest?.difficulty ?? summary.current_difficulty,
        totalTransactions: summary.total_transactions,
        uptime: diag.uptime_seconds,
      });
      // Share the height with the page header so it does not fetch the same
      // chain summary a second time.
      if (height != null && onHeight) onHeight(height);
    } catch (err) {
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
      setError("Network status is unavailable.");
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

  const loading = !data && !error;
  const rows = [
    { label: "Block height", value: data?.height != null ? `#${formatNumber(data.height)}` : "Unavailable" },
    { label: "Difficulty", value: data?.difficulty != null ? formatNumber(data.difficulty) : "Unavailable" },
    {
      label: "Total transactions",
      value: data?.totalTransactions != null ? formatNumber(data.totalTransactions) : "Unavailable",
    },
    { label: "Node uptime", value: formatUptime(data?.uptime) || "Unavailable" },
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
              <span className="vn-netstat__value">{loading ? "…" : r.value}</span>
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

      {/* Lower dashboard. A grid with named areas so the public activity feed
          sits in the right-hand sidebar next to the charts on desktop, but drops
          to directly below the summary cards on mobile (above the personal
          transaction history), per the responsive spec. */}
      <div className="vn-dash-grid">
        {/* Public network activity — everyone sees the same chain events. */}
        <div className="vn-dash-grid__feed">
          <ActivityFeed />
        </div>

        {/* Personal transaction history (shared with the Wallet page). */}
        <div className="vn-dash-grid__main">
          <TransactionHistory
            address={address}
            isLoggedIn={isLoggedIn}
            rows={txRows}
            error={txError}
            onRetry={reloadTx}
          />
        </div>

        {/* Balance chart + network status. */}
        <div className="vn-dash-grid__aside">
          <Card>
            <h2 className="vn-panel-title">Balance over time</h2>
            <LineChart
              data={chartData}
              loading={walletData.loading && isLoggedIn}
              formatY={(v) => formatVlq(v)}
              formatX={(v) => (v > 1e9 ? new Date(v * 1000).toLocaleDateString() : `#${v}`)}
              ariaLabel="Wallet balance over time"
            />
          </Card>
          <NetworkStatusPanel onHeight={setLatestHeight} />
        </div>
      </div>

      {/* First-run guided tour — only renders for a brand-new wallet, and only
          while it is active (it remembers if it was dismissed or finished). */}
      {isLoggedIn && <OnboardingTour />}
    </AppShell>
  );
}
