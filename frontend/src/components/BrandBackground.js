// Decorative, theme-aware site background. Fixed behind all content, no pointer
// events, no layout impact. Glows, particles and a low-opacity node network use
// the existing brand-* CSS (which themes for dark and light). All motion is
// disabled under prefers-reduced-motion by the global reduced-motion rule.

const PARTICLES = [
  { left: "12%", top: "22%", delay: "0s" },
  { left: "26%", top: "68%", delay: "-2s" },
  { left: "44%", top: "34%", delay: "-4s" },
  { left: "58%", top: "78%", delay: "-1s" },
  { left: "71%", top: "28%", delay: "-5s" },
  { left: "83%", top: "60%", delay: "-3s" },
  { left: "37%", top: "12%", delay: "-6s" },
  { left: "64%", top: "48%", delay: "-2.5s" },
];

const NODES = [
  { cx: 14, cy: 26 },
  { cx: 33, cy: 14 },
  { cx: 30, cy: 46 },
  { cx: 52, cy: 30 },
  { cx: 68, cy: 18 },
  { cx: 62, cy: 52 },
  { cx: 84, cy: 34 },
  { cx: 46, cy: 70 },
  { cx: 76, cy: 66 },
];

const LINKS = [
  "M14 26 L33 14",
  "M14 26 L30 46",
  "M33 14 L52 30",
  "M30 46 L52 30",
  "M52 30 L68 18",
  "M52 30 L62 52",
  "M68 18 L84 34",
  "M62 52 L84 34",
  "M30 46 L46 70",
  "M62 52 L46 70",
  "M62 52 L76 66",
  "M84 34 L76 66",
];

function BrandBackground() {
  return (
    <div className="brand-background" aria-hidden="true">
      <span className="brand-glow glow-green" />
      <span className="brand-glow glow-cyan" />
      <span className="brand-glow glow-blue" />
      <div className="brand-particles">
        {PARTICLES.map((p, i) => (
          <span key={i} style={{ left: p.left, top: p.top, animationDelay: p.delay }} />
        ))}
      </div>
      <svg className="brand-network" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="vorliqLineGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-green)" />
            <stop offset="0.5" stopColor="var(--accent-cyan)" />
            <stop offset="1" stopColor="var(--accent-blue)" />
          </linearGradient>
        </defs>
        {LINKS.map((d, i) => (
          <path key={d} d={d} style={{ animationDelay: `${i * -0.6}s` }} />
        ))}
        {NODES.map((n) => (
          <circle key={`${n.cx}-${n.cy}`} cx={n.cx} cy={n.cy} r="0.7" />
        ))}
      </svg>
    </div>
  );
}

export default BrandBackground;
