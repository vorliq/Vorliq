// Public community-treasury transparency page. No sign-in required: any visitor
// can see that real VLQ is moving — the treasury is funded by 5% of every block's
// mining reward and spends only on faucet starter grants and approved community
// payouts. Every figure comes straight from the chain and is verifiable in the
// block explorer.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import api from "../helpers/api";
import LineChart from "../components/vnext/LineChart";
import { formatVlq } from "../helpers/publicApi";

function fmt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function Stat({ label, value, primary }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value mono-wrap" style={primary ? { fontSize: "1.7rem", fontWeight: 700 } : undefined}>
        {value}
      </span>
    </div>
  );
}

function FlowList({ flows, sign, fallbackKind }) {
  if (!flows || flows.length === 0) {
    return <div className="empty-state">None recorded yet.</div>;
  }
  return (
    <div className="admin-list">
      {flows.map((flow, index) => (
        <div className="admin-row" key={`${flow.block_index}-${index}`}>
          <strong>
            {sign}
            {fmt(flow.amount)} VLQ
            <span className="muted"> · {flow.kind || fallbackKind}</span>
          </strong>
          <Link className="text-button" to={`/block/${flow.block_index}`}>
            block #{flow.block_index}
          </Link>
        </div>
      ))}
    </div>
  );
}

export default function CommunityTreasury() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.get("/treasury/transparency");
      setData(response.data?.treasury || null);
      setError("");
    } catch (requestError) {
      setError("The treasury data is temporarily unavailable. Please try again shortly.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = useMemo(() => {
    const series = data?.balance_series || [];
    return series.map((point, index) => ({ x: Number(point.timestamp) || index, y: Number(point.balance) }));
  }, [data]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Public &amp; verifiable</span>
        <h1>The community treasury</h1>
        <p className="subtitle">
          The Vorliq treasury is funded automatically — 5% of every block&apos;s mining reward flows in — and
          it spends only on faucet starter VLQ for new members and community-approved grants. Every number on
          this page comes straight from the chain, with nothing to sign in for. Check any of it yourself in the{" "}
          <Link to="/blockchain">block explorer</Link>, or see the full{" "}
          <Link to="/economics">VLQ supply &amp; reward schedule</Link>.
        </p>
      </section>

      {error && <div className="empty-state" role="status">{error}</div>}

      {!data && !error ? (
        <div className="empty-state">Loading treasury data…</div>
      ) : data ? (
        <>
          <section className="card card-pad stack">
            <div className="grid meta-grid">
              <Stat label="Current balance" value={`${fmt(data.balance)} VLQ`} primary />
              <Stat label="Total received (mining)" value={`${fmt(data.total_inflow)} VLQ`} />
              <Stat label="Total spent" value={`${fmt(data.total_outflow)} VLQ`} />
              <Stat label="Faucet grants paid" value={`${fmt(data.faucet_outflow_total)} VLQ`} />
              <Stat label="Inflows" value={fmt(data.inflow_count)} />
              <Stat label="Outflows" value={fmt(data.outflow_count)} />
            </div>
          </section>

          <section className="card card-pad stack">
            <h2>Treasury balance over time</h2>
            {chartData.length > 1 ? (
              <LineChart
                data={chartData}
                height={260}
                formatY={(value) => formatVlq(value)}
                formatX={(value) => (value > 1e9 ? new Date(value * 1000).toLocaleDateString() : `#${value}`)}
              />
            ) : (
              <div className="empty-state">Not enough history yet to chart — check back after a few more blocks.</div>
            )}
          </section>

          <div className="grid lending-guide-grid">
            <section className="card card-pad stack">
              <h2>Recent inflows (mining rewards)</h2>
              <p className="help-text">5% of each mined block&apos;s reward is routed to the treasury automatically.</p>
              <FlowList flows={data.recent_inflows} sign="+" fallbackKind="mining" />
            </section>
            <section className="card card-pad stack">
              <h2>Recent outflows (grants &amp; faucet)</h2>
              <p className="help-text">VLQ the community has spent — faucet starter grants and approved payouts.</p>
              <FlowList flows={data.recent_outflows} sign="−" fallbackKind="payout" />
            </section>
          </div>

          <p className="help-text">
            Treasury address <code className="mono-wrap">{data.treasury_address}</code> —{" "}
            <Link to={`/chain/address?address=${data.treasury_address}`}>view every transaction</Link>.
          </p>
        </>
      ) : null}
    </div>
  );
}
