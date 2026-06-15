// Seamless, gap-free CSS marquee (no JS animation, does not pause on hover).
// The item list is duplicated so the -50% keyframe loop is invisible. Each item
// is a {label, value} pair fed from the backend snapshot.
export default function Ticker({ items = [] }) {
  if (!items.length) return null;
  const loop = [...items, ...items];
  return (
    <div className="vn-ticker" aria-hidden="true">
      <div className="vn-ticker__track">
        {loop.map((item, i) => (
          <span className="vn-ticker__item" key={`${item.label}-${i}`}>
            <span className="vn-ticker__label">{item.label}</span>
            <span className="vn-ticker__value">{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
