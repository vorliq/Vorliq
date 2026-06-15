// Dashboard inside the new app shell (/preview/app/dashboard). Composes the
// reusable SummaryCard / DataTable / LineChart primitives and wires them to the
// real APIs. Every data-dependent section has its own skeleton loader and its
// own inline error + retry; nothing is ever estimated.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Coins, Landmark, Wallet } from "lucide-react";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import DataTable from "../../components/vnext/DataTable";
import LineChart from "../../components/vnext/LineChart";
import SummaryCard from "../../components/vnext/SummaryCard";
import { Card, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import api from "../../helpers/api";
import { formatNumber, formatRelativeTime, formatVlq } from "../../helpers/publicApi";

const TX_PAGE = 200;
const TX_PAGE_CAP = 5; // up to 1000 transactions

function shortAddress(value) {
  if (!value) return "—";
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

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
function useWalletData(address) {
  const [state, setState] = useState({ loading: true, error: "", balance: null, history: null, lending: null });

  const load = useCallback(
    async (signal) => {
      if (!address) {
        setState({ loading: false, error: "", balance: null, history: null, lending: null });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: "" }));
      const [balanceRes, historyRes, lendingRes] = await Promise.allSettled([
        api.get("/wallet/balance", { params: { address }, signal }),
        api.get("/wallet/history", { params: { address }, signal }),
        api.get("/lending/my", { params: { address }, signal }),
      ]);
      if (signal?.aborted) return;

      const everythingFailed =
        balanceRes.status === "rejected" && historyRes.status === "rejected" && lendingRes.status === "rejected";

      setState({
        loading: false,
        error: everythingFailed ? "We couldn't load your wallet overview." : "",
        balance: balanceRes.status === "fulfilled" ? balanceRes.value.data : null,
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

/* --------------------------------------------------- Transaction table --- */
function useTransactions(address) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal) => {
      if (!address) {
        setRows([]);
        setError("");
        return;
      }
      setRows(null);
      setError("");
      try {
        const all = [];
        let offset = 0;
        for (let i = 0; i < TX_PAGE_CAP; i += 1) {
          const res = await api.get("/chain/address", {
            params: { address, limit: TX_PAGE, offset },
            signal,
          });
          const batch = res.data?.transactions || [];
          all.push(...batch);
          if (!res.data?.has_more || batch.length === 0) break;
          offset += TX_PAGE;
        }
        setRows(all);
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError("We couldn't load your transaction history.");
        setRows([]);
      }
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { rows, error, reload: () => load() };
}

/* ------------------------------------------------- Network status panel -- */
function NetworkStatusPanel() {
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
      setData({
        height: summary.block_height ?? diag.block_height,
        difficulty: latest?.difficulty,
        uptime: diag.uptime_seconds,
      });
    } catch (err) {
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
      setError("Network status is unavailable.");
    }
  }, []);

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
    { label: "Hash rate", value: "Unavailable" },
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

/* ---------------------------------------------------- Transaction row ---- */
function txColumns(address) {
  return [
    {
      key: "type",
      header: "Type",
      render: (tx) => {
        const received = tx.receiver_address === address;
        return (
          <span className={`vn-tx-type ${received ? "vn-tx-type--in" : "vn-tx-type--out"}`}>
            {received ? <ArrowDownLeft size={16} aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}
            {received ? "Received" : "Sent"}
          </span>
        );
      },
    },
    { key: "amount", header: "Amount", render: (tx) => formatVlq(tx.amount) },
    {
      key: "party",
      header: "Counterparty",
      className: "vn-mono",
      render: (tx) => {
        const other = tx.receiver_address === address ? tx.sender_address : tx.receiver_address;
        return <span title={other}>{shortAddress(other)}</span>;
      },
    },
    {
      key: "block",
      header: "Block",
      render: (tx) =>
        tx.block_index != null ? (
          <Link className="vn-block-link" to={`/block/${tx.block_index}`}>
            #{formatNumber(tx.block_index)}
          </Link>
        ) : (
          "—"
        ),
    },
    { key: "time", header: "Time", render: (tx) => formatRelativeTime(tx.timestamp) || "—" },
  ];
}

function TxDetail({ tx, address }) {
  return (
    <dl className="vn-dt__detail">
      <div>
        <dt>Transaction ID</dt>
        <dd className="vn-mono">{tx.tx_id || tx.hash || "—"}</dd>
      </div>
      <div>
        <dt>Block hash</dt>
        <dd className="vn-mono">{tx.block_hash || "—"}</dd>
      </div>
      <div>
        <dt>From</dt>
        <dd className="vn-mono">{tx.sender_address || "—"}</dd>
      </div>
      <div>
        <dt>To</dt>
        <dd className="vn-mono">{tx.receiver_address || "—"}</dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>{formatVlq(tx.amount)}</dd>
      </div>
      <div>
        <dt>Direction</dt>
        <dd>{tx.receiver_address === address ? "Received" : "Sent"}</dd>
      </div>
      {tx.block_index != null && (
        <div>
          <dt>Block</dt>
          <dd>
            <Link className="vn-block-link" to={`/block/${tx.block_index}`}>
              View block #{formatNumber(tx.block_index)}
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}

/* --------------------------------------------------------------- Page ---- */
export default function Dashboard() {
  const { wallet, isLoggedIn } = useAuth();
  const address = wallet?.address;

  const walletData = useWalletData(address);
  const { rows: txRows, error: txError, reload: reloadTx } = useTransactions(address);
  const [now, setNow] = useState(() => new Date());
  const [latestHeight, setLatestHeight] = useState(null);

  // Tick the header clock once a minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Latest block height for the header meta.
  useEffect(() => {
    const controller = new AbortController();
    api
      .get("/chain/summary", { signal: controller.signal })
      .then((res) => setLatestHeight(res.data?.summary?.block_height))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const history = walletData.history;
  const balanceNum = Number(walletData.balance?.balance);
  const hasBalance = Number.isFinite(balanceNum);

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
  const cards = [
    {
      label: "Current VLQ Balance",
      value: hasBalance ? formatVlq(balanceNum) : null,
      trend: balanceTrend,
      icon: Wallet,
    },
    {
      label: "Total Sent",
      value: history ? formatVlq(history.total_sent) : null,
      trend: { direction: "flat", label: "lifetime" },
      icon: ArrowUpRight,
    },
    {
      label: "Total Received",
      value: history ? formatVlq(history.total_received) : null,
      trend: { direction: "flat", label: "lifetime" },
      icon: Coins,
    },
    {
      label: "Active Lending Position",
      value: activeLending ? formatVlq(activeLending.total) : null,
      trend: activeLending ? { direction: "flat", label: `${activeLending.count} active` } : null,
      icon: Landmark,
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

      {walletData.error ? (
        <InlineError message={walletData.error} onRetry={walletData.reload} />
      ) : (
        <div className="vn-summary-grid">
          {cards.map((c) => (
            <SummaryCard
              key={c.label}
              label={c.label}
              value={c.value}
              trend={c.trend}
              icon={c.icon}
              loading={summaryLoading && isLoggedIn}
            />
          ))}
        </div>
      )}

      <div className="vn-dash-split">
        {/* Left: full transaction history */}
        <Card>
          <h2 className="vn-panel-title">Transaction history</h2>
          <DataTable
            columns={txColumns(address)}
            rows={txRows}
            loading={txRows == null && isLoggedIn}
            error={txError}
            onRetry={reloadTx}
            rowKey={(tx, i) => tx.tx_id || tx.hash || `${tx.block_index}-${i}`}
            pageSize={20}
            emptyMessage={isLoggedIn ? "No transactions for this wallet yet." : "Sign in to see your transactions."}
            renderExpanded={(tx) => <TxDetail tx={tx} address={address} />}
            caption="Wallet transaction history"
          />
        </Card>

        {/* Right: balance chart + network status */}
        <div className="vn-dash-right">
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
          <NetworkStatusPanel />
        </div>
      </div>
    </AppShell>
  );
}
