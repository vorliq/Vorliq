// Reusable presentational primitives for the vnext design layer. Plain CSS
// classes (see styles/vnext.css) keep this layer self-contained and theme-aware
// via the shared html[data-theme] switch.
import { Link } from "react-router-dom";

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
