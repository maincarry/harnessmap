// The seam: a HarnessMap node tree → a galaxy SystemConfig (2026-09-21, galaxy mode).
// Root/project → the sun; top-level nodes → planets; their descendants → moons and
// mini-moons (recursive, capped at the depth the galaxy renders). Placement is
// DETERMINISTIC and identity-stable: a node's sprite/orbit derive from its id and its
// stable birth-order among siblings, so adding a sibling does not reshuffle the others
// (the concern Jacob raised). Status drives lit/dim (asleep = dimmed). No new art —
// bodies reuse the existing sprite pool.
import type { BodyDef } from "./planets";
import { makeOrbitShape, ORBIT_SHAPE_KINDS } from "./orbitShapes";
import { PLANET_SPRITES, MOON_SPRITES, SUN_SPRITES } from "./spritePool";
import type { SystemConfig, GeneratedPlanet, GeneratedMoon } from "./systemGenerator";

const TAU = Math.PI * 2;

export interface MapNodeLite {
  id: string;
  parentId: string | null;
  content: string;
  title?: string | null;
  type?: string | null;
  status: string;
  author?: string | null;
  createdAt?: string;
}

export interface MapToSystemOpts {
  projectName?: string;
  /** Node ids that are "awake"/lit; any node NOT in this set is dimmed. If omitted, dim by status. */
  litIds?: Set<string> | null;
  inner?: number;
  outer?: number;
}

// Statuses that read as "asleep/settled/gone" when no litIds set is supplied.
const SLEEPY = new Set(["removed", "parked", "rejected", "dropped", "mooted", "retracted", "reversed", "lifted", "done", "answered", "accepted", "decided", "chosen", "cited"]);

// Stable 32-bit hash of a string (FNV-1a) → deterministic sprite/shape/angle per node id.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const pickBy = <T,>(arr: readonly T[], seed: number): T => arr[seed % arr.length]!;

const isTutorial = (n: MapNodeLite) =>
  n.author === "system" || /getting started/i.test(String(n.title ?? "")) || /getting started \(tutorial\)/i.test(String(n.content ?? ""));

function bodyDim(n: MapNodeLite, opts: MapToSystemOpts): boolean {
  if (opts.litIds) return !opts.litIds.has(n.id);
  return SLEEPY.has(n.status);
}
function nameOf(n: MapNodeLite): string {
  const t = String(n.title ?? "").trim();
  if (t) return t.slice(0, 40);
  return String(n.content ?? "node").trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 40) || "node";
}
function lineOf(n: MapNodeLite): string { return String(n.content ?? "").trim().slice(0, 240); }

export interface GalaxyBody extends BodyDef { dimmed?: boolean; nodeId?: string; nodeStatus?: string; }

export function mapToSystem(nodesIn: MapNodeLite[], opts: MapToSystemOpts = {}): SystemConfig {
  const inner = opts.inner ?? 580, outer = opts.outer ?? 1620;
  const nodes = nodesIn.filter((n) => n.status !== "removed" && !isTutorial(n));
  const kids = new Map<string | null, MapNodeLite[]>();
  for (const n of nodes) { const k = n.parentId; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(n); }
  // stable birth order among siblings
  for (const arr of kids.values()) arr.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.id.localeCompare(b.id));

  // top-level = nodes whose parent is null OR whose parent is not in the (filtered) set
  const present = new Set(nodes.map((n) => n.id));
  const topLevel = nodes.filter((n) => !n.parentId || !present.has(n.parentId));
  topLevel.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.id.localeCompare(b.id));

  const sun: GalaxyBody = {
    id: "sun", name: (opts.projectName ?? "Map").slice(0, 40), img: pickBy(SUN_SPRITES, 0).img,
    size: 720, line: `${topLevel.length} topics orbit here.`, breathe: 6, delay: 0,
  };

  const count = Math.max(1, topLevel.length);
  const gap = count > 1 ? (outer - inner) / (count - 1) : 0;

  const makeMoons = (parent: MapNodeLite, parentSize: number, depth: number): GeneratedMoon[] => {
    const children = kids.get(parent.id) ?? [];
    if (!children.length || depth > 2) return [];
    return children.map((c, m): GeneratedMoon => {
      const h = hash(c.id);
      const mOrbitR = parentSize * 0.72 + 50 + m * 62;
      const size = Math.max(34, Math.min(74, 40 + ((h >> 3) % 30)));
      const body: GalaxyBody = {
        id: c.id, name: nameOf(c), img: pickBy(MOON_SPRITES, h).img, size,
        line: lineOf(c), breathe: 2.8 + ((h % 12) / 10), delay: (h % 15) / 10,
        dimmed: bodyDim(c, opts), nodeId: c.id, nodeStatus: c.status,
      };
      return {
        ...body, orbitR: mOrbitR, period: 90 + (h % 79),
        startAngle: ((h >> 5) % 628) / 100,
        ringD: makeOrbitShape("ring", mOrbitR, h, 10).d,
        moons: makeMoons(c, size, depth + 1),
      };
    });
  };

  const planets: GeneratedPlanet[] = topLevel.map((n, i): GeneratedPlanet => {
    const h = hash(n.id);
    const descendants = (kids.get(n.id) ?? []).length;
    // size by child-count: hubs are bigger, leaves smaller (deterministic, meaningful)
    const size = descendants >= 4 ? 250 + (h % 60) : descendants >= 1 ? 170 + (h % 60) : 110 + (h % 45);
    const orbitR = inner + gap * i; // even spread by stable birth order → adding a sibling appends, others hold
    const kind = pickBy(ORBIT_SHAPE_KINDS, h);
    const body: GalaxyBody = {
      id: n.id, name: nameOf(n), img: pickBy(PLANET_SPRITES, h).img, size,
      line: lineOf(n), breathe: 3 + ((h % 24) / 10), delay: (h % 16) / 10,
      dimmed: bodyDim(n, opts), nodeId: n.id, nodeStatus: n.status,
    };
    return {
      ...body, orbit: makeOrbitShape(kind, orbitR, h),
      period: 315 * Math.pow(orbitR / 445, 1.35),
      startAngle: (h % 628) / 100,
      dash: `${30 + (h % 18)} ${20 + ((h >> 4) % 12)}`,
      ringWidth: 9 + (h % 4), ringOpacity: 0.72 + ((h % 20) / 100),
      moons: makeMoons(n, size, 1),
    };
  });

  return { seed: hash(opts.projectName ?? "map"), planetCount: planets.length, sun, planets, drifters: [] };
}
