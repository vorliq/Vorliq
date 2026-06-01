import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export function PageShell({ children, className = "" }) {
  return <div className={`bg-[#0A0E1A] text-white ${className}`}>{children}</div>;
}

export function Section({ id, children, className = "" }) {
  return (
    <section id={id} className={`relative mx-auto w-[min(1180px,calc(100%_-_32px))] py-16 md:py-20 ${className}`}>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }) {
  return (
    <div
      className={`rounded-lg border border-vorliq-border bg-[#111827]/72 shadow-panel backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

export function ButtonLink({ to, href, children, variant = "primary", className = "", ...props }) {
  const base =
    "inline-flex min-h-11 items-center justify-center rounded-full px-5 py-3 text-sm font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vorliq-accent";
  const variants = {
    primary: "bg-vorliq-accent text-[#06101c] shadow-glow hover:translate-y-[-1px]",
    secondary: "border border-vorliq-border bg-white/[0.04] text-white hover:border-vorliq-accent hover:bg-white/[0.07]",
    quiet: "text-vorliq-accent hover:text-white",
  };
  const classes = `${base} ${variants[variant]} ${className}`;

  if (href) {
    return (
      <a className={classes} href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link className={classes} to={to} {...props}>
      {children}
    </Link>
  );
}

export function Reveal({ children, className = "", delay = 0, x = 0 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18, x }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.32, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function StatCount({ value, suffix = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return undefined;
    const duration = 360;
    const started = performance.now();
    let frame = 0;

    function tick(now) {
      const progress = Math.min((now - started) / duration, 1);
      setCount(Math.round(value * progress));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    }

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [inView, value]);

  return (
    <span ref={ref}>
      {count}
      {suffix}
    </span>
  );
}

export function StatusPill({ children, tone = "teal" }) {
  const tones = {
    teal: "border-vorliq-accent/40 bg-vorliq-accent/10 text-vorliq-accent",
    gold: "border-vorliq-gold/40 bg-vorliq-gold/10 text-vorliq-gold",
    muted: "border-vorliq-border bg-white/[0.04] text-vorliq-muted",
    danger: "border-red-400/40 bg-red-500/10 text-red-200",
  };

  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-black ${tones[tone]}`}>
      {children}
    </span>
  );
}
