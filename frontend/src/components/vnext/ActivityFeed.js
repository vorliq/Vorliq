// Public network activity feed for the dashboard. Shows recent on-chain events
// that anyone can already see in the block explorer — blocks mined, large
// transfers, new governance proposals, and community loan requests — in reverse
// chronological order. It carries no private information (no balances, keys, or
// drafts) and needs no authentication. It refreshes whenever a new block arrives
// over the existing realtime socket (via the shared latestBlockHeight), so it
// stays live without opening its own connection.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Blocks, Landmark, ArrowLeftRight, Vote } from "lucide-react";

import api from "../../helpers/api";
import { useRealtime } from "../../context/RealtimeContext";
import { formatRelativeTime, formatVlq, shortHash } from "../../helpers/publicApi";
import { Card, InlineError, Skeleton } from "./primitives";

const ICONS = {
  block: Blocks,
  transaction: ArrowLeftRight,
  proposal: Vote,
  loan: Landmark,
};

function subtitleFor(event) {
  switch (event.kind) {
    case "block":
      // The reward is rendered on its own line (see ActivityRow) so it is never
      // clipped on a narrow screen; the subtitle keeps just the miner.
      return event.miner ? `Miner ${shortHash(event.miner)}` : "New block";
    case "transaction":
      return `${shortHash(event.sender)} → ${shortHash(event.receiver)}`;
    case "proposal":
      return event.proposer ? `Proposed by ${shortHash(event.proposer)}` : "Open for voting";
    case "loan":
      return event.requester ? `Requested by ${shortHash(event.requester)}` : "Awaiting community vote";
    default:
      return "";
  }
}

function ActivityRow({ event }) {
  const Icon = ICONS[event.kind] || Blocks;
  // A block's mining reward is shown as its own pill below the miner so it always
  // fits on a 375px screen rather than being clipped off the end of the subtitle.
  const reward = event.kind === "block" && event.amount ? `+${formatVlq(event.amount)} VLQ` : null;
  return (
    <Link className="vn-feed__row" to={event.link}>
      <span className={`vn-feed__icon vn-feed__icon--${event.kind}`} aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="vn-feed__body">
        <span className="vn-feed__title">{event.title}</span>
        <span className="vn-feed__sub">{subtitleFor(event)}</span>
        {reward && <span className="vn-feed__reward">{reward}</span>}
      </span>
      <span className="vn-feed__time">{formatRelativeTime(event.timestamp)}</span>
    </Link>
  );
}

export default function ActivityFeed() {
  const { latestBlockHeight } = useRealtime();
  const [state, setState] = useState({ loading: true, error: "", events: null });

  const load = useCallback(async (signal) => {
    try {
      const res = await api.get("/activity", { signal });
      if (signal?.aborted) return;
      setState({ loading: false, error: "", events: res.data?.events || [] });
    } catch (err) {
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
      setState((s) => ({ ...s, loading: false, error: "Network activity is unavailable." }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // A new block over the socket bumps latestBlockHeight — refetch so the feed
  // reflects the block (and any transfers it confirmed) without polling.
  useEffect(() => {
    if (latestBlockHeight == null) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [latestBlockHeight, load]);

  const { loading, error, events } = state;

  return (
    <Card className="vn-feed">
      <div className="vn-feed__head">
        <h2 className="vn-panel-title" style={{ margin: 0 }}>Network activity</h2>
        <span className="vn-feed__live" aria-label="Updates live">live</span>
      </div>

      {error ? (
        <InlineError message={error} onRetry={() => load()} />
      ) : loading ? (
        <div className="vn-feed__list">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={44} radius={10} style={{ marginBottom: 8 }} />
          ))}
        </div>
      ) : events && events.length ? (
        <div className="vn-feed__list">
          {events.map((event, i) => (
            <ActivityRow key={`${event.kind}-${event.link}-${i}`} event={event} />
          ))}
        </div>
      ) : (
        <div className="vn-feed__empty">
          <Blocks size={24} aria-hidden="true" />
          <p>No network activity yet.</p>
          <span>
            Blocks, transfers, proposals, and loan requests will appear here as the community starts
            using the chain.
          </span>
        </div>
      )}
    </Card>
  );
}
