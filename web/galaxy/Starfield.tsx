import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  speed: number;
  phase: number;
  color: string;
}

interface SolidStar {
  x: number;
  y: number;
  r: number;
  rot: number;
  speed: number;
  phase: number;
  color: string;
}

interface Sparkle {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
  color: string;
}

interface Spiral {
  x: number;
  y: number;
  maxR: number;
  rotSpeed: number;
  phase: number;
  color: string;
}

interface Comet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  rgb: string;
}

const DOT_COLORS = [
  "#ffffff", "#ffffff", "#ffffff", "#ffe066", "#7de2d1",
  "#ff9de2", "#ffd6a5", "#ffb3c8", "#9fd8ff",
];
const SOLID_STAR_COLORS = [
  "#ffd93d", "#ffb347", "#ff8a5c", "#ff6b9d",
  "#7de2d1", "#4dd0e1", "#b388eb", "#fff3b0",
];
const SPARKLE_COLORS = ["#ffffff", "#ffe066", "#7de2d1", "#ff9de2"];
const SPIRAL_COLORS = ["#b388eb", "#7de2d1", "#ff9de2", "#8e7cc3"];
const COMET_COLORS = ["255, 240, 180", "255, 180, 110", "255, 150, 210"];

/**
 * Dense storybook sky: confetti dots, solid 5-point candy stars, pulsing
 * sparkle crosses, slow-turning spiral swirls, and colorful comets —
 * matching the packed backgrounds of the user's reference posters.
 */
export function Starfield({
  size,
  width,
  height,
  chatMix = 0,
}: {
  size: number;
  width?: number;
  height?: number;
  chatMix?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatMixRef = useRef(chatMix);
  const w = width ?? size;
  const h = height ?? size;

  // Keep the draw loop reading the latest chat mix without re-running the
  // canvas effect (which would reset star positions).
  chatMixRef.current = chatMix;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Coarse pointers (phones): smaller backing store + sparser sky — the
    // full-density canvas costs real GPU memory and CPU on a small screen.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    // Cap backing-store pixels so huge worlds stay cheap on mobile GPUs.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5, (coarse ? 1024 : 2048) / Math.max(w, h));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

    // Twinkling confetti dots — an extremely slow animated layer over the painted sky.
    const stars: Star[] = Array.from({ length: coarse ? 240 : 420 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 1 + Math.random() * 3,
      base: 0.35 + Math.random() * 0.65,
      speed: 0.05 + Math.random() * 0.15,
      phase: Math.random() * Math.PI * 2,
      color: pick(DOT_COLORS),
    }));

    // Solid 5-point candy stars — small but luminous against the dark sky.
    const solidStars: SolidStar[] = Array.from({ length: coarse ? 14 : 20 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      speed: 0.05 + Math.random() * 0.15,
      phase: Math.random() * Math.PI * 2,
      color: pick(SOLID_STAR_COLORS),
    }));

    // Plus-shaped sparkles scattered between the dots.
    const sparkles: Sparkle[] = Array.from({ length: coarse ? 20 : 32 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: 7 + Math.random() * 8,
      speed: 0.08 + Math.random() * 0.18,
      phase: Math.random() * Math.PI * 2,
      color: pick(SPARKLE_COLORS),
    }));

    // Hand-drawn spiral swirls, very slowly turning.
    const spirals: Spiral[] = Array.from({ length: coarse ? 5 : 8 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      maxR: 16 + Math.random() * 18,
      rotSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.01 + Math.random() * 0.02),
      phase: Math.random() * Math.PI * 2,
      color: pick(SPIRAL_COLORS),
    }));

    const starPath = (cx: number, cy: number, r: number, rot: number) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
        const px = cx + rad * Math.cos(a);
        const py = cy + rad * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    const comets: Comet[] = [];
    let nextCometIn = (coarse ? 2 : 1) * (2000 + Math.random() * 2500);
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      const t = now / 1000;
      // In chat mode the larger background stars quiet down so the family
      // lineup in the strip stays readable. Small dots remain as twinkle.
      const mix = chatMixRef.current;
      const dim = 1 - 0.85 * mix;
      ctx.clearRect(0, 0, w, h);

      // Confetti dots — keep the tiny background texture visible.
      for (const s of stars) {
        ctx.globalAlpha = s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Solid candy stars with a gentle pulse — dimmed in chat mode.
      for (const s of solidStars) {
        const pulse = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
        ctx.globalAlpha = dim * (0.55 + 0.45 * pulse);
        ctx.fillStyle = s.color;
        starPath(s.x, s.y, s.r * (0.85 + 0.2 * pulse), s.rot);
        ctx.fill();
      }

      // Spiral swirls, slowly rotating — dimmed in chat mode.
      ctx.lineCap = "round";
      ctx.lineWidth = 4.5;
      for (const sp of spirals) {
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(sp.phase + t * sp.rotSpeed);
        ctx.globalAlpha = dim * (0.45 + 0.2 * Math.sin(t * 0.7 + sp.phase));
        ctx.strokeStyle = sp.color;
        ctx.beginPath();
        const steps = 56;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * 2.6 * Math.PI * 2;
          const r = (i / steps) * sp.maxR;
          const px = r * Math.cos(a);
          const py = r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Plus-shaped sparkle crosses that pulse in and out — dimmed in chat mode.
      ctx.lineWidth = 3.5;
      for (const sp of sparkles) {
        const pulse = 0.5 + 0.5 * Math.sin(t * sp.speed + sp.phase);
        const len = sp.size * (0.55 + 0.45 * pulse);
        ctx.globalAlpha = dim * (0.3 + 0.7 * pulse);
        ctx.strokeStyle = sp.color;
        ctx.beginPath();
        ctx.moveTo(sp.x - len, sp.y);
        ctx.lineTo(sp.x + len, sp.y);
        ctx.moveTo(sp.x, sp.y - len);
        ctx.lineTo(sp.x, sp.y + len);
        ctx.stroke();
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      nextCometIn -= dt;
      if (nextCometIn <= 0) {
        nextCometIn = (coarse ? 2 : 1) * (3500 + Math.random() * 4500);
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.12 + Math.random() * 0.18; // px per ms (very slow)
        comets.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.6,
          vx: Math.cos(angle) * speed,
          vy: Math.abs(Math.sin(angle)) * speed * 0.6 + 0.04,
          life: 0,
          maxLife: 1100 + Math.random() * 500,
          rgb: pick(COMET_COLORS),
        });
      }

      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        if (!c) continue;
        c.life += dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (c.life > c.maxLife) {
          comets.splice(i, 1);
          continue;
        }
        const fade = 1 - c.life / c.maxLife;
        const tailX = c.x - c.vx * 130;
        const tailY = c.y - c.vy * 130;
        const grad = ctx.createLinearGradient(c.x, c.y, tailX, tailY);
        grad.addColorStop(0, `rgba(${c.rgb}, ${dim * 0.9 * fade})`);
        grad.addColorStop(1, `rgba(${c.rgb}, 0)`);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = grad;
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.fillStyle = `rgba(${c.rgb}, ${dim * fade})`;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, w, h]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{ width: w, height: h }}
      aria-hidden
    />
  );
}
