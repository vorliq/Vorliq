// Reusable area line chart: filled gradient from teal to transparent, faint
// horizontal grid lines, and a hover tooltip. Pure SVG, theme-aware, no chart
// library. Width is measured from the container so hover hit-testing is exact;
// height is fixed by the caller. Reused later by Wallet (and adaptable beyond).
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { InlineError, Skeleton } from "./primitives";

const PAD = { top: 14, right: 12, bottom: 18, left: 12 };
const GRID_LINES = 4;

export default function LineChart({
  data,
  height = 240,
  loading = false,
  error = "",
  onRetry,
  formatY = (v) => v,
  formatX = (v) => v,
  ariaLabel = "Line chart",
  // Line/fill colour. Callers that track directional movement pass teal for a
  // rising series, red for a falling one, and grey for no change.
  color = "#00a896",
}) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth);
    update();
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(node);
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", update);
    };
  }, []);

  // Reset any stale hover when the data changes.
  useEffect(() => {
    setHover(null);
  }, [data]);

  if (error) return <InlineError message={error} onRetry={onRetry} />;
  if (loading) return <Skeleton height={height} radius={12} />;
  if (!data || data.length < 2) {
    return (
      <div className="vn-chart__empty" style={{ height }}>
        Not enough data yet to chart.
      </div>
    );
  }

  const w = width || 600;
  const innerW = Math.max(1, w - PAD.left - PAD.right);
  const innerH = Math.max(1, height - PAD.top - PAD.bottom);

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = maxX - minX || 1;

  // Vertical scale. Auto-fit to the data so small balance changes are visible
  // rather than a flat line lost against a 0-based axis. A genuinely unchanging
  // series is centred (not glued to the bottom edge); a varying one gets a small
  // headroom pad so the line never touches the top/bottom of the frame.
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);
  let minY;
  let maxY;
  if (rawMaxY === rawMinY) {
    const magnitude = Math.abs(rawMinY) || 1;
    minY = rawMinY - magnitude * 0.5;
    maxY = rawMaxY + magnitude * 0.5;
  } else {
    const padY = (rawMaxY - rawMinY) * 0.12;
    minY = rawMinY - padY;
    maxY = rawMaxY + padY;
  }
  const spanY = maxY - minY || 1;
  const gradId = `vn-chart-fill-${String(color).replace(/[^a-z0-9]/gi, "")}`;

  const px = (x) => PAD.left + ((x - minX) / spanX) * innerW;
  const py = (y) => PAD.top + (1 - (y - minY) / spanY) * innerH;

  const points = data.map((d) => [px(d.x), py(d.y)]);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${px(maxX).toFixed(1)},${height - PAD.bottom} L${px(minX).toFixed(1)},${height - PAD.bottom} Z`;

  const gridYs = Array.from({ length: GRID_LINES + 1 }, (_, i) => PAD.top + (innerH / GRID_LINES) * i);

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // nearest point by x pixel
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const dist = Math.abs(points[i][0] - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHover(best);
  }

  const hoverPoint = hover != null ? points[hover] : null;
  const hoverDatum = hover != null ? data[hover] : null;

  return (
    <div className="vn-chart" ref={wrapRef} style={{ height, maxWidth: "100%" }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridYs.map((gy, i) => (
          <line
            key={i}
            x1={PAD.left}
            x2={w - PAD.right}
            y1={gy}
            y2={gy}
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeWidth="1"
            className="vn-chart__grid"
          />
        ))}
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" />
        {hoverPoint && (
          <>
            <line
              x1={hoverPoint[0]}
              x2={hoverPoint[0]}
              y1={PAD.top}
              y2={height - PAD.bottom}
              stroke="#1e6fd9"
              strokeOpacity="0.5"
              strokeWidth="1"
            />
            <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
          </>
        )}
      </svg>
      {hoverPoint && hoverDatum && (
        <div
          className="vn-chart__tip"
          style={{
            left: Math.min(Math.max(hoverPoint[0], 60), w - 60),
            top: Math.max(hoverPoint[1] - 8, 8),
          }}
        >
          <strong>{formatY(hoverDatum.y)}</strong>
          <span>{formatX(hoverDatum.x)}</span>
        </div>
      )}
    </div>
  );
}
