/**
 * Chat-mode fan layout: when the chat panel opens, the focused body
 * anchors the bottom of the remaining sky strip — large, lower body
 * running off the bottom edge so its face reads as "looking up" — and
 * its direct children ride their own orbit rings while the rings morph
 * into a fan of concentric arcs above the subject, like the reference
 * poster: not a rigid vertical column, every child keeps a jaunty
 * angular offset along its arc. Grandchildren are untouched: they keep
 * orbiting their (now lined-up) parents. Pure math, shared by the
 * classic page and the generator.
 */

import { planetLabelSize } from "./Planet";

export interface ChatChildInput {
  id: string;
  size: number;
  name: string;
}

export interface ChatSlot {
  x: number;
  y: number;
  size: number;
  /** Polar placement around the anchor — the orbit-morph target. */
  angle: number;
  /** World distance from the anchor (the morphed ring's radius). */
  radius: number;
  /** Per-body label scale so the hand-lettered name fits the fan. */
  labelBoost: number;
}

export interface ChatLayout {
  parentId: string;
  /** Subject's world position — the fan grows upward from here. */
  anchor: { x: number; y: number };
  parentSize: number;
  /** Target slot for the parent and every direct child. */
  slots: Map<string, ChatSlot>;
  /** Strip size the layout was solved for — rebuild when it changes. */
  stripW: number;
  stripH: number;
  /** Camera transform framing the fan inside the sky strip. */
  camera: { posX: number; posY: number; scale: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Eased ramp used by every chat blend (position, size, ring morph). */
export const chatEase = (mix: number) => 1 - Math.pow(1 - mix, 3);

/** Shortest signed angular distance from `from` to `to`. */
export const shortAngle = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

interface KidPlan {
  id: string;
  name: string;
  /** Screen diameter in the fan. */
  dia: number;
  /** Screen font size for the hand-lettered name. */
  font: number;
  /** Vertical room reserved below the body (its hanging name). */
  gap: number;
  /** Arc radius from the subject's center (screen px). */
  rho: number;
  /** Final angle, straight up plus a staggered tilt. */
  angle: number;
}

/**
 * Solve the fan in screen space (where "fits the strip" is decidable),
 * then convert to world coordinates through the camera scale.
 */
export function computeChatLayout(
  parentId: string,
  anchor: { x: number; y: number },
  parentSize: number,
  children: ChatChildInput[],
  stripW: number,
  stripH: number,
): ChatLayout {
  // The subject looms large at the bottom — like the sun in the
  // reference poster, only its upper half (and face) on screen.
  const r0max = clamp(stripW * 0.62, 130, 380);
  let scale = clamp((r0max * 2) / parentSize, 0.12, 2.0);
  let r0 = (parentSize * scale) / 2;
  const sx = stripW * 0.5;
  const sy = stripH * 0.94;

  // Children compressed toward a friendly portrait range — biggest kids
  // stay biggest, but the spread reads as family, not size chart.
  const maxC = Math.max(1, ...children.map((c) => c.size));
  const plan = (): KidPlan[] => {
    let rho = r0 * 0.85;
    return children.map((c, i) => {
      const dia = clamp(
        stripW * 0.34 * Math.pow(c.size / maxC, 0.45),
        46,
        stripW * 0.38,
      );
      const longName = c.name.length > 16;
      const font = longName
        ? clamp(dia * 0.2, 11, 20)
        : clamp(dia * 0.28, 14, 30);
      const gap = font * (longName ? 2.3 : 1.2) + 10 + Math.max(16, dia * 0.22);
      rho += gap + dia / 2;
      const kid: KidPlan = { id: c.id, name: c.name, dia, font, gap, rho, angle: -Math.PI / 2 };
      rho += dia / 2;
      // Staggered tilt, alternating sides like the poster's cascade —
      // clamped so the disc AND its hanging name never leave the strip.
      // The name is centered under the disc, so its half-width counts:
      // short names are one nowrap line (~0.68em per glyph with the
      // hand-lettered tracking); long names wrap at the 380px world cap.
      const nameHalfW = longName
        ? Math.min(190 * scale, c.name.length * font * 0.34)
        : (c.name.length * font * 0.68) / 2;
      const deg = 12 + ((i * 37) % 10);
      const maxSin = clamp(
        (stripW * 0.5 - 10 - Math.max(dia / 2, nameHalfW)) / rho,
        0,
        0.45,
      );
      const tilt = Math.min((deg * Math.PI) / 180, Math.asin(maxSin));
      kid.angle = -Math.PI / 2 + (i % 2 === 0 ? -tilt : tilt);
      return kid;
    });
  };

  let kids = plan();
  // Vertical fit: the topmost child (with its name) must clear the
  // strip's top edge — shrink the children first, the subject last.
  const topNeed = () =>
    kids.length > 0 ? kids[kids.length - 1]!.rho + kids[kids.length - 1]!.dia / 2 : 0;
  if (topNeed() > sy - 12 && kids.length > 0) {
    const f = clamp((sy - 12) / topNeed(), 0.42, 1);
    children = children.map((c) => ({ ...c, size: c.size * f * f }));
    const saved = kids;
    kids = plan();
    if (topNeed() > sy - 12) {
      // Extreme case (many kids, short strip): shrink the subject too.
      const f2 = clamp((sy - 12) / topNeed(), 0.55, 1);
      scale = clamp(scale * Math.max(f, f2), 0.12, 2.0);
      r0 = (parentSize * scale) / 2;
      kids = plan();
    }
    void saved;
  }

  const slots = new Map<string, ChatSlot>();
  slots.set(parentId, {
    x: anchor.x,
    y: anchor.y,
    size: parentSize,
    angle: -Math.PI / 2,
    radius: 0,
    labelBoost: 1,
  });
  for (const k of kids) {
    const radius = k.rho / scale;
    const size = k.dia / scale;
    // Belt and braces: whatever the wobble shapes and chase do, the
    // settled disc and its hanging name must end up inside the strip.
    const longName = k.name.length > 16;
    const nameHalfW = longName
      ? Math.min(190 * scale, k.name.length * k.font * 0.34)
      : (k.name.length * k.font * 0.68) / 2;
    const maxOff = Math.max(0, stripW * 0.5 - 8 - Math.max(k.dia / 2, nameHalfW));
    const off = k.rho * Math.cos(k.angle);
    const clampedOff = Math.abs(off) > maxOff ? Math.sign(off) * maxOff : off;
    const yOff = k.rho * Math.sin(k.angle);
    slots.set(k.id, {
      x: anchor.x + clampedOff / scale,
      y: anchor.y + yOff / scale,
      size,
      angle: Math.atan2(yOff, clampedOff),
      radius: Math.hypot(clampedOff, yOff) / scale,
      labelBoost: k.font / (planetLabelSize(size, k.name) * scale),
    });
  }

  return {
    parentId,
    anchor,
    parentSize,
    slots,
    stripW,
    stripH,
    camera: {
      scale,
      posX: sx - anchor.x * scale,
      posY: sy - anchor.y * scale,
    },
  };
}

/** Per-body rendered pose while the fan forms or dissolves. */
export interface ChatChaseState {
  x: number;
  y: number;
  size: number;
  /** Clock second this entry was last advanced on (frame guard). */
  frame: number;
}

/**
 * Exponential chase toward a target pose. Frame-guarded: repeated reads
 * within one frame return the stored value instead of advancing twice,
 * so every consumer in a render pass agrees on the pose. Used for the
 * subject itself, which glides straight to the fan's base.
 */
export function chaseChatTarget(
  rendered: Map<string, ChatChaseState>,
  id: string,
  from: { x: number; y: number; size: number },
  target: { x: number; y: number; size: number },
  frame: number,
): ChatChaseState {
  const prev = rendered.get(id);
  if (prev && prev.frame === frame) return prev;
  const start = prev ?? { ...from, frame };
  const k = 0.16;
  const cur = {
    x: start.x + (target.x - start.x) * k,
    y: start.y + (target.y - start.y) * k,
    size: start.size + (target.size - start.size) * k,
    frame,
  };
  rendered.set(id, cur);
  return cur;
}

/** Polar chase state for a child riding its morphing orbit ring. */
export interface ChatRideState {
  angle: number;
  /** Ring scale: 1 = live orbit, slot.radius/shape = fan arc. */
  scale: number;
  size: number;
  frame: number;
}

/**
 * A chat-set child travels along its own orbit ring while the ring
 * itself rearranges: angle and ring scale chase toward the fan slot, so
 * the body is always exactly on its (reshaping) ring — the lineup reads
 * as the orbits swinging into the fan, not bodies flying across space.
 * Returns the rendered pose plus the ring scale to draw with.
 */
export function rideChatOrbit(
  rendered: Map<string, ChatRideState>,
  id: string,
  cx: number,
  cy: number,
  angle: number,
  pointAt: (a: number) => { x: number; y: number },
  size: number,
  slot: ChatSlot,
  mix: number,
  frame: number,
): { x: number; y: number; size: number; ringScale: number } {
  const e = chatEase(mix);
  const qS = pointAt(slot.angle);
  const rShape = Math.hypot(qS.x, qS.y) || 1;
  const tAngle = angle + shortAngle(angle, slot.angle) * e;
  const tScale = 1 + (slot.radius / rShape - 1) * e;
  const tSize = size + (slot.size - size) * e;
  const prev = rendered.get(id);
  const state =
    prev && prev.frame === frame
      ? prev
      : (() => {
          const start = prev ?? { angle, scale: 1, size, frame };
          const k = 0.16;
          const cur = {
            angle: start.angle + shortAngle(start.angle, tAngle) * k,
            scale: start.scale + (tScale - start.scale) * k,
            size: start.size + (tSize - start.size) * k,
            frame,
          };
          rendered.set(id, cur);
          return cur;
        })();
  const q = pointAt(state.angle);
  return {
    x: cx + q.x * state.scale,
    y: cy + q.y * state.scale,
    size: state.size,
    ringScale: state.scale,
  };
}

/**
 * A body that just left the fan (the fan re-focused on another star)
 * glides back to its live orbit instead of snapping: angle, ring scale
 * and size chase home along its own ring. Returns done=true once close
 * enough to hand back to the live loop (the entry is then deleted).
 */
export function rideChatOrbitExit(
  rendered: Map<string, ChatRideState>,
  id: string,
  cx: number,
  cy: number,
  angle: number,
  pointAt: (a: number) => { x: number; y: number },
  size: number,
  frame: number,
): { x: number; y: number; size: number; ringScale: number; done: boolean } {
  const prev = rendered.get(id);
  if (!prev) {
    const q0 = pointAt(angle);
    return { x: cx + q0.x, y: cy + q0.y, size, ringScale: 1, done: true };
  }
  if (prev.frame === frame) {
    const qp = pointAt(prev.angle);
    return {
      x: cx + qp.x * prev.scale,
      y: cy + qp.y * prev.scale,
      size: prev.size,
      ringScale: prev.scale,
      done: false,
    };
  }
  const k = 0.16;
  const dA = shortAngle(prev.angle, angle);
  const cur = {
    angle: prev.angle + dA * k,
    scale: prev.scale + (1 - prev.scale) * k,
    size: prev.size + (size - prev.size) * k,
    frame,
  };
  if (
    Math.abs(dA) < 0.012 &&
    Math.abs(cur.scale - 1) < 0.012 &&
    Math.abs(cur.size - size) < 1
  ) {
    rendered.delete(id);
    const q1 = pointAt(angle);
    return { x: cx + q1.x, y: cy + q1.y, size, ringScale: 1, done: true };
  }
  rendered.set(id, cur);
  const q = pointAt(cur.angle);
  return {
    x: cx + q.x * cur.scale,
    y: cy + q.y * cur.scale,
    size: cur.size,
    ringScale: cur.scale,
    done: false,
  };
}
