// Brand background for the hero: a living network of softly glowing nodes
// connected by faint links, with occasional bright pulses that travel along the
// links representing transactions flowing between nodes — what Vorliq actually
// is. It runs entirely in requestAnimationFrame, caps node and pulse counts so it
// stays smooth on a mid-range phone, pauses when the tab is hidden (Page
// Visibility API), renders a single static frame for prefers-reduced-motion, and
// fully cleans up on unmount. Colours come from the logo palette.
import { useEffect, useRef } from "react";

const TEAL = "0, 168, 150";
const BLUE = "30, 111, 217";
const GREEN = "86, 200, 112";
const LINK_DISTANCE = 150;
const LINK_DISTANCE_SQ = LINK_DISTANCE * LINK_DISTANCE;
const MAX_PULSES = 7;
const PULSE_INTERVAL_MS = 900; // average gap between new transactions

export default function ParticleField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let nodes = [];
    let pulses = [];
    let rafId = null;
    let running = true;
    let lastTime = 0;
    let pulseTimer = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Fewer nodes on small screens keeps the per-frame link test (O(n^2)) cheap.
      const target = Math.min(56, Math.round((width * height) / 22000));
      nodes = Array.from({ length: target }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.4 + 1.1,
      }));
      // Drop pulses whose endpoints no longer exist after a resize.
      pulses = pulses.filter((p) => p.from < nodes.length && p.to < nodes.length);
    }

    // Pick a node that currently has at least one neighbour within link range,
    // and return [nodeIndex, neighbourIndex]. Returns null if the graph is too
    // sparse this instant (e.g. immediately after a resize).
    function pickConnectedPair(preferFrom = -1) {
      const start = preferFrom >= 0 && preferFrom < nodes.length ? preferFrom : Math.floor(Math.random() * nodes.length);
      // Search outward from the chosen start so a chained pulse continues from
      // its current node when possible.
      for (let attempt = 0; attempt < nodes.length; attempt += 1) {
        const i = (start + attempt) % nodes.length;
        const a = nodes[i];
        const neighbours = [];
        for (let j = 0; j < nodes.length; j += 1) {
          if (j === i) continue;
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy < LINK_DISTANCE_SQ) neighbours.push(j);
        }
        if (neighbours.length) {
          return [i, neighbours[Math.floor(Math.random() * neighbours.length)]];
        }
        if (preferFrom >= 0) break; // a chained pulse only tries its own node
      }
      return null;
    }

    function spawnPulse(preferFrom = -1) {
      if (pulses.length >= MAX_PULSES || nodes.length < 2) return;
      const pair = pickConnectedPair(preferFrom);
      if (!pair) return;
      pulses.push({ from: pair[0], to: pair[1], t: 0, speed: 0.006 + Math.random() * 0.006 });
    }

    function draw(now) {
      const dt = lastTime ? Math.min(now - lastTime, 50) : 16;
      lastTime = now;
      ctx.clearRect(0, 0, width, height);

      // Move nodes, bouncing softly off the edges.
      for (let i = 0; i < nodes.length; i += 1) {
        const p = nodes[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      }

      // Links between nearby nodes.
      for (let i = 0; i < nodes.length; i += 1) {
        const p = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const q = nodes[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < LINK_DISTANCE_SQ) {
            const alpha = (1 - Math.sqrt(distSq) / LINK_DISTANCE) * 0.1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${BLUE}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Softly glowing nodes: a faint halo plus a brighter core.
      for (let i = 0; i < nodes.length; i += 1) {
        const p = nodes[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${TEAL}, 0.05)`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${TEAL}, 0.5)`;
        ctx.fill();
      }

      // Periodically start a new transaction pulse.
      pulseTimer += dt;
      if (pulseTimer >= PULSE_INTERVAL_MS) {
        pulseTimer = 0;
        spawnPulse();
      }

      // Advance and draw pulses travelling along their link.
      const survivors = [];
      for (let k = 0; k < pulses.length; k += 1) {
        const pulse = pulses[k];
        pulse.t += pulse.speed * (dt / 16);
        const a = nodes[pulse.from];
        const b = nodes[pulse.to];
        if (!a || !b) continue;
        const t = Math.min(pulse.t, 1);
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        // Bright travelling dot with a soft glow.
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${GREEN}, 0.12)`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${GREEN}, 0.95)`;
        ctx.fill();

        if (pulse.t >= 1) {
          // Arrived: occasionally hop onward to a neighbour of the destination,
          // so a transaction visibly propagates through the network.
          if (Math.random() < 0.5) spawnPulse(pulse.to);
        } else {
          survivors.push(pulse);
        }
      }
      pulses = survivors;

      if (running) rafId = window.requestAnimationFrame(draw);
    }

    function start() {
      if (rafId == null && running) {
        lastTime = 0;
        rafId = window.requestAnimationFrame(draw);
      }
    }
    function stop() {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    function onVisibility() {
      running = !document.hidden && !prefersReduced;
      if (running) start();
      else stop();
    }

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    if (prefersReduced) {
      // One static frame: nodes and links, no motion or pulses.
      draw(0);
      running = false;
      stop();
    } else {
      // Seed a couple of pulses so the network looks alive immediately.
      spawnPulse();
      spawnPulse();
      start();
    }

    return () => {
      running = false;
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="vn-hero__canvas" aria-hidden="true" />;
}
