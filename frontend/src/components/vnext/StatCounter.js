// Animated count-up that starts only when it scrolls into view (Intersection
// Observer), using an ease-out curve. Honours reduced-motion by jumping to the
// final value. While the real value is unknown it shows a dash, never a guess.
import { useEffect, useRef, useState } from "react";

const DURATION = 1400;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export default function StatCounter({ value, label, format = (n) => n.toLocaleString(), loading }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || started) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started || typeof value !== "number" || !Number.isFinite(value)) return undefined;

    const prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplay(value);
      return undefined;
    }

    let rafId;
    const startTime = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - startTime) / DURATION);
      setDisplay(value * easeOut(t));
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [started, value]);

  const hasValue = typeof value === "number" && Number.isFinite(value);
  const shown = loading || !hasValue ? "—" : format(Math.round(display));

  return (
    <div className="vn-stat" ref={ref}>
      <span className="vn-stat__num">{shown}</span>
      <span className="vn-stat__label">{label}</span>
    </div>
  );
}
