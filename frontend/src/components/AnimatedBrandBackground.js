function AnimatedBrandBackground() {
  const nodes = [
    [6, 22],
    [14, 18],
    [22, 28],
    [12, 42],
    [25, 52],
    [8, 64],
    [90, 20],
    [82, 34],
    [94, 46],
    [78, 62],
    [90, 74],
  ];

  return (
    <div className="brand-background" aria-hidden="true">
      <div className="brand-glow glow-green" />
      <div className="brand-glow glow-cyan" />
      <div className="brand-glow glow-blue" />
      <svg className="brand-network" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="vorliqLineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--brand-green)" />
            <stop offset="52%" stopColor="var(--brand-cyan)" />
            <stop offset="100%" stopColor="var(--brand-blue)" />
          </linearGradient>
        </defs>
        <path d="M6 22 L14 18 L22 28 L12 42 L25 52 L8 64" />
        <path d="M90 20 L82 34 L94 46 L78 62 L90 74" />
        <path d="M14 18 L12 42 L22 28 L25 52" />
        <path d="M82 34 L90 20 L94 46 L90 74" />
        {nodes.map(([cx, cy]) => (
          <circle cx={cx} cy={cy} r="0.55" key={`${cx}-${cy}`} />
        ))}
      </svg>
      <div className="brand-dots" />
      <div className="brand-horizon">
        <div className="horizon-arc" />
        <div className="horizon-grid" />
      </div>
    </div>
  );
}

export default AnimatedBrandBackground;
