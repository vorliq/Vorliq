// Compact exchange activity for the member's own wallet page: their recent
// coordination records (created and accepted) with a plain-language status and a
// link into the full Exchange page. Refreshes live off the realtime socket so a
// completed or accepted trade shows up without a manual refresh.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import api from "../../helpers/api";
import { useRealtime } from "../../context/RealtimeContext";
import { formatVlq } from "../../helpers/publicApi";
import { Card, InlineError, Skeleton } from "./primitives";

const STATUS_LABEL = {
  open: "Open",
  accepted: "Accepted",
  vlq_pending: "VLQ confirming",
  vlq_confirmed: "VLQ confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

function statusClass(status) {
  if (status === "completed") return "is-done";
  if (status === "cancelled") return "is-muted";
  if (status === "disputed") return "is-alert";
  return "is-active";
}

export default function WalletExchangeHistory({ address }) {
  const { exchangeVersion } = useRealtime();
  const [state, setState] = useState({ loading: true, error: "", records: [] });

  const load = useCallback(
    async (signal) => {
      if (!address) return;
      try {
        const res = await api.get("/exchange/my", { params: { address }, signal });
        if (signal?.aborted) return;
        const created = res.data?.created || [];
        const accepted = res.data?.accepted || [];
        // Merge both sides, de-duplicate by offer id, newest first.
        const byId = new Map();
        [...created, ...accepted].forEach((r) => byId.set(r.offer_id, r));
        const records = [...byId.values()].sort(
          (a, b) => Number(b.created_at || b.timestamp || 0) - Number(a.created_at || a.timestamp || 0)
        );
        setState({ loading: false, error: "", records });
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setState((s) => ({ ...s, loading: false, error: "Couldn't load your exchange activity." }));
      }
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, exchangeVersion]);

  const { loading, error, records } = state;

  return (
    <Card>
      <div className="vn-feed__head">
        <h2 className="vn-panel-title" style={{ margin: 0 }}>Exchange activity</h2>
        <Link className="vn-block-link" to="/exchange">Open exchange</Link>
      </div>

      {error ? (
        <InlineError message={error} onRetry={() => load()} />
      ) : loading ? (
        <Skeleton height={56} radius={10} />
      ) : records.length ? (
        <div className="vn-xchg-list">
          {records.slice(0, 6).map((r) => (
            <Link className="vn-xchg-row" to="/exchange" key={r.offer_id}>
              <span className="vn-xchg-row__main">
                <span className="vn-xchg-row__amount">{formatVlq(r.amount)}</span>
                <span className="vn-xchg-row__terms">{r.offer_type === "sell" ? "Offering" : "Requesting"} · {r.price}</span>
              </span>
              <span className={`vn-xchg-row__status ${statusClass(r.status)}`}>
                {STATUS_LABEL[r.status] || r.status}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="vn-empty-note" style={{ margin: 0 }}>
          You have no exchange activity yet. <Link className="vn-block-link" to="/exchange">Browse community requests</Link> to
          trade VLQ for goods, services, or support.
        </p>
      )}
    </Card>
  );
}
