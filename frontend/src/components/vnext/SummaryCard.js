// Reusable summary/metric card: label, large value, optional small trend
// indicator. Shared by Dashboard and later by Wallet / Mining / Lending /
// Governance. Shows a skeleton while loading and an "Unavailable" value when
// the underlying figure is missing (honest, never estimated).
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Card, Skeleton } from "./primitives";

function Trend({ trend }) {
  if (!trend || !trend.direction) return null;
  const { direction, label } = trend;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className={`vn-sum__trend vn-sum__trend--${direction}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}

export default function SummaryCard({ label, value, trend, icon: Icon, loading = false }) {
  return (
    <Card className="vn-sum">
      <div className="vn-sum__head">
        <span className="vn-sum__label">{label}</span>
        {Icon && <Icon size={18} aria-hidden="true" className="vn-sum__icon" />}
      </div>
      {loading ? (
        <Skeleton height={30} width="65%" style={{ marginTop: 8 }} />
      ) : (
        <div className="vn-sum__value">{value == null || value === "" ? "Unavailable" : value}</div>
      )}
      {!loading && <Trend trend={trend} />}
    </Card>
  );
}
