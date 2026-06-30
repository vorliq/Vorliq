// Public VLQ economics page — the single source of truth for supply and reward
// figures. No sign-in. Every live figure (total issued, current reward, height)
// is the same one the block explorer reports; the schedule and curve are derived
// deterministically from the protocol constants. Other pages link here rather
// than showing their own version.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import api from "../helpers/api";
import LineChart from "../components/vnext/LineChart";
import { formatVlq } from "../helpers/publicApi";

function fmt(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtDate(seconds) {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function Stat({ label, value, sub }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value mono-wrap">{value}</span>
      {sub ? <span className="help-text">{sub}</span> : null}
    </div>
  );
}

export default function Economics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.get("/economics/overview");
      setData(response.data?.economics || null);
      setError("");
    } catch (requestError) {
      setError("The economics data is temporarily unavailable. Please try again shortly.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = useMemo(() => {
    const curve = data?.supply_curve || [];
    return curve.map((point) => ({ x: Number(point.block), y: Number(point.supply) }));
  }, [data]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Honest &amp; verifiable</span>
        <h1>VLQ economics</h1>
        <p className="subtitle">
          VLQ is the community currency of Vorliq. It isn&apos;t pre-mined or sold. Every coin is created by
          mining a block, on a fixed and public schedule that can never be changed by anyone. Here is exactly
          how much exists, how it&apos;s made, and where it&apos;s headed. Check any figure in the{" "}
          <Link to="/blockchain">block explorer</Link>.
        </p>
      </section>

      {error && <div className="empty-state" role="status">{error}</div>}

      {data ? (
        <>
          <section className="card card-pad stack">
            <div className="grid meta-grid">
              <Stat label="Maximum supply (ever)" value={`${fmt(data.maximum_supply, 0)} VLQ`} sub="A hard cap. No more will ever exist." />
              <Stat label="Issued so far" value={`${fmt(data.total_issued)} VLQ`} sub={`${fmt(data.percent_issued, 4)}% of the cap`} />
              <Stat label="Still to be issued" value={`${fmt(data.remaining_to_issue, 0)} VLQ`} sub="Released gradually through mining." />
              <Stat label="Current block reward" value={`${fmt(data.current_mining_reward)} VLQ`} sub={`${fmt(data.miner_reward_per_block)} to the miner, ${fmt(data.treasury_reward_per_block)} to the treasury`} />
              <Stat label="Treasury cut" value={`${fmt(data.treasury_percentage * 100)}%`} sub={<>of every reward. See the <Link to="/community-treasury">community treasury</Link>.</>} />
              <Stat label="Next halving" value={`block #${fmt(data.next_halving_block, 0)}`} sub={`~${fmt(data.blocks_until_halving, 0)} blocks away · est. ${fmtDate(data.estimated_next_halving_at)}`} />
            </div>
            <p className="help-text">
              Current chain height is block #{fmt(data.current_block_height, 0)}, mining roughly one block every{" "}
              {fmt(data.seconds_per_block_estimate, 0)} seconds.
            </p>
          </section>

          <section className="card card-pad stack">
            <h2>Supply over time, projected to the cap</h2>
            <p className="help-text">
              Each &quot;halving&quot; cuts the block reward in half every {fmt(data.halving_interval, 0)} blocks, so new VLQ
              slows down over time and the total approaches, but never exceeds, {fmt(data.maximum_supply, 0)} VLQ.
              Today we are at the very start of the curve.
            </p>
            {chartData.length > 1 ? (
              <LineChart
                data={chartData}
                height={280}
                formatY={(v) => formatVlq(v)}
                formatX={(v) => `#${Number(v).toLocaleString()}`}
              />
            ) : (
              <div className="empty-state">Supply curve unavailable.</div>
            )}
          </section>

          <section className="card card-pad stack">
            <h2>The halving schedule</h2>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr><th>Era</th><th>Starts at block</th><th>Block reward</th><th>Total supply by end of era</th></tr>
                </thead>
                <tbody>
                  {(data.supply_schedule || []).slice(0, 8).map((row) => (
                    <tr key={row.epoch}>
                      <td>{row.epoch + 1}{row.epoch === data.current_epoch ? " (now)" : ""}</td>
                      <td>#{fmt(row.start_block, 0)}</td>
                      <td>{fmt(row.reward, 8)} VLQ</td>
                      <td>{fmt(row.cumulative_supply_at_end, 0)} VLQ</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="help-text">
              These numbers come straight from the protocol. Verify the issued total and reward yourself on the{" "}
              <Link to="/blockchain">block explorer</Link>.
            </p>
          </section>
        </>
      ) : (
        !error && <div className="empty-state">Loading economics…</div>
      )}
    </div>
  );
}
