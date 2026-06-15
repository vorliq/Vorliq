// VLQ-weighted vote split bar shared by the Lending and Governance pages.
// Carries forward the real on-chain model: votes are weighted by VLQ balance
// (yes_vote_weight / no_vote_weight), not a simple count. Green is the success
// colour for "yes"; a muted red (never an accent) is used for "no".
import { formatNumber } from "../../helpers/publicApi";

export default function VoteBar({ yesWeight = 0, noWeight = 0 }) {
  const yes = Math.max(0, Number(yesWeight) || 0);
  const no = Math.max(0, Number(noWeight) || 0);
  const total = yes + no;
  const yesPct = total > 0 ? (yes / total) * 100 : 0;
  const noPct = total > 0 ? 100 - yesPct : 0;

  return (
    <div className="vn-vote">
      <div
        className="vn-vote-bar"
        role="img"
        aria-label={`Yes ${formatNumber(yes)} VLQ, No ${formatNumber(no)} VLQ`}
      >
        <span className="vn-vote-bar__yes" style={{ width: `${yesPct}%` }} />
        <span className="vn-vote-bar__no" style={{ width: `${noPct}%` }} />
      </div>
      <div className="vn-vote-split">
        <span className="vn-vote-split__yes">
          Yes <b>{total > 0 ? `${yesPct.toFixed(0)}%` : "—"}</b> · {formatNumber(yes)} VLQ
        </span>
        <span className="vn-vote-split__no">
          No <b>{total > 0 ? `${noPct.toFixed(0)}%` : "—"}</b> · {formatNumber(no)} VLQ
        </span>
      </div>
    </div>
  );
}
