// Reusable presentational primitives for the vnext design layer. Plain CSS
// classes (see styles/vnext.css) keep this layer self-contained and theme-aware
// via the shared html[data-theme] switch.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";

export function Button({ variant = "primary", size, to, href, className = "", children, ...rest }) {
  const cls = `vn-btn vn-btn--${variant}${size === "lg" ? " vn-btn--lg" : ""} ${className}`.trim();
  if (to) {
    return (
      <Link className={cls} to={to} {...rest}>
        {children}
      </Link>
    );
  }
  if (href) {
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Pill({ children, live = false }) {
  return (
    <span className="vn-pill">
      {live && <span className="vn-pill__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Card({ pad = true, nested = false, className = "", children, ...rest }) {
  const cls = `vn-card${pad ? " vn-card--pad" : ""}${nested ? " vn-card--nested" : ""} ${className}`.trim();
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}

export function SectionHead({ overline, title, subtitle, underline = true }) {
  return (
    <div className="vn-section-head">
      {overline && <span className="vn-overline">{overline}</span>}
      <h2>{title}</h2>
      {underline && <span className="vn-underline" aria-hidden="true" />}
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

// Inline error block with retry, per the spec's universal error handling.
export function InlineError({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="vn-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// Skeleton block sized by the caller; shown while data is in flight.
export function Skeleton({ width = "100%", height = 16, radius = 6, style }) {
  return <span className="vn-skel" style={{ display: "block", width, height, borderRadius: radius, ...style }} />;
}

// Placeholder that matches the shape of a loan/proposal card (title + badge,
// description lines, a meta grid, and a vote bar) so the card grid does not jump
// when the real cards arrive. Render a few of these in a vn-card-grid while the
// list is loading.
export function CardSkeleton() {
  return (
    <Card className="vn-prop" aria-hidden="true">
      <div className="vn-prop__head">
        <Skeleton width="42%" height={18} />
        <Skeleton width={74} height={22} radius={9999} />
      </div>
      <Skeleton width="92%" height={12} style={{ marginTop: 12 }} />
      <Skeleton width="70%" height={12} style={{ marginTop: 6 }} />
      <div className="vn-prop__meta" style={{ marginTop: 16 }}>
        <Skeleton width="80%" height={12} />
        <Skeleton width="55%" height={12} />
        <Skeleton width="70%" height={12} />
        <Skeleton width="48%" height={12} />
      </div>
      <Skeleton width="100%" height={10} radius={9999} style={{ marginTop: 16 }} />
    </Card>
  );
}

// Copy-to-clipboard button with transient confirmation, no toast dependency.
export function CopyButton({ value, label = "Copy", variant = "secondary", className = "" }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard can be blocked; leave the button label unchanged
    }
  }
  return (
    <button type="button" className={`vn-btn vn-btn--${variant} ${className}`.trim()} onClick={handleCopy}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {copied ? "Copied" : label}
    </button>
  );
}
