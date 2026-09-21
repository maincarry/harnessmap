const TAU = Math.PI * 2;

/** mulberry32 — tiny deterministic PRNG so SSR and hydration agree. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OrbitShape {
  /** The family this curve was drawn from. */
  kind: OrbitShapeKind;
  /** SVG path of the closed curve, centered near (0,0). */
  d: string;
  /** Point on the curve at parameter angle a (radians). */
  pointAt: (a: number) => { x: number; y: number };
  /** Largest distance from the origin, for layout spacing. */
  maxR: number;
}

/**
 * The six hand-painted orbit families. Every shape is a closed polar
 * curve r(θ) > 0 (or an ellipse), so it can never cross itself — the
 * asymmetry comes from harmonics, offsets and tilts, like the wobbly
 * egg-shaped and bean-shaped rings in the reference posters.
 */
export const ORBIT_SHAPE_KINDS = [
  "ring",
  "egg",
  "bean",
  "peanut",
  "tilt",
  "wobble",
] as const;
export type OrbitShapeKind = (typeof ORBIT_SHAPE_KINDS)[number];

export function makeOrbitShape(
  kind: OrbitShapeKind,
  r: number,
  seed: number,
  /** Max center offset in px — small for moon rings, loose for planet rings. */
  jitter = 44,
): OrbitShape {
  const rand = mulberry32(seed);
  const ox = (rand() - 0.5) * jitter;
  const oy = (rand() - 0.5) * jitter;
  let pointAt: (a: number) => { x: number; y: number };
  let maxR = r;

  switch (kind) {
    case "egg": {
      // Stretched toward one side, like an egg.
      const e = 0.1 + rand() * 0.07;
      const p = rand() * TAU;
      const w = 2 + Math.floor(rand() * 3);
      const wp = rand() * TAU;
      pointAt = (a) => {
        const rr = r * (1 + e * Math.cos(a + p) + 0.015 * Math.sin(w * a + wp));
        return { x: ox + rr * Math.cos(a), y: oy + rr * Math.sin(a) };
      };
      maxR = r * (1 + e + 0.015) + jitter / 2;
      break;
    }
    case "bean": {
      // Lop-sided kidney bean.
      const a1 = 0.07 + rand() * 0.06;
      const b1 = 0.05 + rand() * 0.04;
      const p1 = rand() * TAU;
      const p2 = rand() * TAU;
      pointAt = (a) => {
        const rr = r * (1 + a1 * Math.cos(a + p1) + b1 * Math.sin(2 * a + p2));
        return { x: ox + rr * Math.cos(a), y: oy + rr * Math.sin(a) };
      };
      maxR = r * (1 + a1 + b1) + jitter / 2;
      break;
    }
    case "peanut": {
      // Softly squeezed oval.
      const e = 0.09 + rand() * 0.07;
      const p = rand() * TAU;
      pointAt = (a) => {
        const rr = r * (1 + e * Math.cos(2 * a + p));
        return { x: ox + rr * Math.cos(a), y: oy + rr * Math.sin(a) };
      };
      maxR = r * (1 + e) + jitter / 2;
      break;
    }
    case "tilt": {
      // True ellipse, rotated to a jaunty angle.
      const e = 0.08 + rand() * 0.1;
      const A = r * (1 + e);
      const B = r * (1 - e);
      const rot = rand() * TAU;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      pointAt = (a) => {
        const ex = A * Math.cos(a);
        const ey = B * Math.sin(a);
        return { x: ox + ex * cosR - ey * sinR, y: oy + ex * sinR + ey * cosR };
      };
      maxR = A + jitter / 2;
      break;
    }
    case "wobble": {
      // Exaggerated brush wobble, two harmonics.
      const w1 = 2 + Math.floor(rand() * 3);
      const w2 = 4 + Math.floor(rand() * 4);
      const p1 = rand() * TAU;
      const p2 = rand() * TAU;
      const a1 = 0.05 + rand() * 0.04;
      const a2 = 0.03 + rand() * 0.03;
      pointAt = (a) => {
        const rr = r * (1 + a1 * Math.sin(w1 * a + p1) + a2 * Math.cos(w2 * a + p2));
        return { x: ox + rr * Math.cos(a), y: oy + rr * Math.sin(a) };
      };
      maxR = r * (1 + a1 + a2) + jitter / 2;
      break;
    }
    default: {
      // "ring" — the classic gentle wobble from the main map.
      const w1 = 2 + Math.floor(rand() * 3);
      const w2 = 5 + Math.floor(rand() * 4);
      const p1 = rand() * TAU;
      const p2 = rand() * TAU;
      pointAt = (a) => {
        const rr = r * (1 + 0.012 * Math.sin(w1 * a + p1) + 0.007 * Math.cos(w2 * a + p2));
        return { x: ox + rr * Math.cos(a), y: oy + rr * Math.sin(a) };
      };
      maxR = r * 1.02 + jitter / 2;
    }
  }

  const N = 128;
  let d = "";
  for (let i = 0; i <= N; i++) {
    const pt = pointAt((i / N) * TAU);
    d += `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }
  return { kind, d: `${d} Z`, pointAt, maxR };
}
