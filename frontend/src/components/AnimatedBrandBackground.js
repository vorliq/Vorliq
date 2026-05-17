function AnimatedBrandBackground() {
  const nodes = [
    [8, 22],
    [16, 18],
    [25, 30],
    [15, 46],
    [30, 58],
    [9, 70],
    [53, 18],
    [46, 34],
    [58, 48],
    [42, 64],
    [56, 76],
    [90, 18],
    [80, 35],
    [94, 48],
    [78, 66],
    [90, 78],
  ];

  const particles = [
    [9, 16, 0],
    [20, 74, 2],
    [33, 30, 4],
    [44, 86, 1],
    [55, 20, 6],
    [68, 62, 3],
    [76, 28, 5],
    [88, 86, 7],
  ];

  return (
    <div className="brand-background" aria-hidden="true">
      <div className="brand-glow glow-green" />
      <div className="brand-glow glow-cyan" />
      <div className="brand-glow glow-blue" />
      <div className="brand-particles">
        {particles.map(([left, top, delay]) => (
          <span style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s` }} key={`${left}-${top}`} />
        ))}
      </div>
      <svg className="brand-network" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="vorliqLineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--brand-green)" />
            <stop offset="52%" stopColor="var(--brand-cyan)" />
            <stop offset="100%" stopColor="var(--brand-blue)" />
          </linearGradient>
        </defs>
        <path d="M8 22 L16 18 L25 30 L15 46 L30 58 L9 70" />
        <path d="M53 18 L46 34 L58 48 L42 64 L56 76" />
        <path d="M90 18 L80 35 L94 48 L78 66 L90 78" />
        <path d="M16 18 L46 34 L80 35" />
        <path d="M25 30 L58 48 L94 48" />
        <path d="M30 58 L42 64 L78 66" />
        {nodes.map(([cx, cy]) => (
          <circle cx={cx} cy={cy} r="0.55" key={`${cx}-${cy}`} />
        ))}
      </svg>
      <div className="brand-dots" />
      <div className="brand-dots brand-dots-right" />
      <div className="brand-horizon">
        <div className="horizon-arc" />
        <div className="horizon-grid" />
      </div>
    </div>
  );
}

export default AnimatedBrandBackground;
