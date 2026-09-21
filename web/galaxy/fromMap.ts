// The seam: a HarnessMap node tree → a galaxy SystemConfig (2026-09-21, galaxy mode).
// Root/project → the sun; top-level nodes → planets; descendants → moons (recursive, capped at render depth).
// Placement is DETERMINISTIC + identity-stable (sprite/orbit from node id + stable birth order) AND spaced
// with GUARANTEED CLEARANCE so nothing overlaps no matter how many nodes there are — rings are laid out by
// summing each body's diameter + its moon span + a margin, so the field GROWS with the map instead of
// cramming it into a fixed budget (the crowding Jacob caught). Status drives lit/dim (asleep = dimmed).
import type { BodyDef } from "./planets";
import { makeOrbitShape, makeRingCircle } from "./orbitShapes";
import { PLANET_SPRITES, MOON_SPRITES, SUN_SPRITES } from "./spritePool";
import type { SystemConfig, GeneratedPlanet, GeneratedMoon } from "./systemGenerator";

const TAU = Math.PI * 2;
const SUN_SIZE = 720;
const MARGIN = 120;        // clear space between a body's edge (incl. its moons) and the next ring
const MOON_GAP = 26;       // space between a planet's edge and its first moon, and between moons

export interface MapNodeLite {
  id: string; parentId: string | null; content: string; title?: string | null;
  type?: string | null; status: string; author?: string | null; createdAt?: string;
}
export interface MapToSystemOpts { projectName?: string; litIds?: Set<string> | null; }
export interface GalaxyBody extends BodyDef { dimmed?: boolean; nodeId?: string; nodeStatus?: string; }

// Only genuinely DORMANT nodes sleep — most content stays awake so the map feels alive. (Not
// done/decided/answered/accepted: those are normal, active content.)
const SLEEPY = new Set(["parked", "rejected", "dropped", "mooted", "retracted", "reversed", "lifted"]);
function hash(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const pickBy = <T,>(arr: readonly T[], seed: number): T => arr[seed % arr.length]!;
const isTutorial = (n: MapNodeLite) => n.author === "system" || /getting started/i.test(String(n.title ?? "")) || /getting started \(tutorial\)/i.test(String(n.content ?? ""));
function bodyDim(n: MapNodeLite, _o: MapToSystemOpts): boolean { return SLEEPY.has(n.status); }
function nameOf(n: MapNodeLite): string { const t = String(n.title ?? "").trim(); if (t) return t.slice(0, 40); return String(n.content ?? "node").trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 40) || "node"; }
function lineOf(n: MapNodeLite): string { return String(n.content ?? "").trim().slice(0, 240); }

export function mapToSystem(nodesIn: MapNodeLite[], opts: MapToSystemOpts = {}): SystemConfig {
  const nodes = nodesIn.filter((n) => n.status !== "removed" && !isTutorial(n));
  const kids = new Map<string | null, MapNodeLite[]>();
  for (const n of nodes) { const k = n.parentId; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(n); }
  for (const arr of kids.values()) arr.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.id.localeCompare(b.id));
  const present = new Set(nodes.map((n) => n.id));
  const byCreated = (a: MapNodeLite, b: MapNodeLite) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.id.localeCompare(b.id);
  const topLevel = nodes.filter((n) => !n.parentId || !present.has(n.parentId)).sort(byCreated);

  // Pick what the PLANETS are. Real maps usually hang everything under one root container
  // ("Crowded Project", "Keras CNN learning"), with empty system buckets ("to sort", "untitled")
  // and the getting-started tutorial alongside. If there is a single dominant root with children,
  // UNWRAP it: that root becomes the sun, its children become the planets (else everything piles
  // onto one planet as moons — the bug Jacob hit). Otherwise the top-level nodes are the planets.
  const isBucket = (n: MapNodeLite) => /^(to sort|untitled)$/i.test(String(n.title ?? n.content ?? "").trim());
  const roots = topLevel.filter((n) => !isBucket(n));
  const withKids = roots.filter((n) => (kids.get(n.id)?.length ?? 0) > 0);
  let sunName = opts.projectName ?? "Map";
  let planetNodes: MapNodeLite[];
  if (withKids.length === 1) {
    // descend through single-child wrapper chains (e.g. "Keras CNN learning" → "Keras CNN" → [topics])
    // so the PLANETS are the real chapters, not one lonely wrapper planet.
    let root = withKids[0]!;
    while (true) {
      const ch = (kids.get(root.id) ?? []).filter((c) => !isBucket(c));
      if (ch.length === 1 && (kids.get(ch[0]!.id)?.length ?? 0) > 0) root = ch[0]!;
      else break;
    }
    sunName = String(root.title ?? root.content ?? sunName).slice(0, 40);
    planetNodes = (kids.get(root.id) ?? []).filter((c) => !isBucket(c)).slice().sort(byCreated);
  } else {
    planetNodes = (roots.length ? roots : topLevel).slice().sort(byCreated);
  }

  const sun: GalaxyBody = { id: "sun", name: sunName.slice(0, 40), img: pickBy(SUN_SPRITES, 0).img, size: SUN_SIZE, line: `${planetNodes.length} topics orbit here.`, breathe: 6, delay: 0 };

  const moonSize = (id: string) => Math.max(38, Math.min(70, 42 + ((hash(id) >> 3) % 28)));
  // moons for a body, placed by clearance around it; returns {moons, span} where span = farthest moon edge from body center
  const buildMoons = (parent: MapNodeLite, parentSize: number, depth: number): { moons: GeneratedMoon[]; span: number } => {
    const children = depth > 2 ? [] : (kids.get(parent.id) ?? []);
    if (!children.length) return { moons: [], span: parentSize / 2 };
    let ringR = parentSize / 2; const out: GeneratedMoon[] = [];
    for (const c of children) {
      const h = hash(c.id); const size = moonSize(c.id);
      const sub = buildMoons(c, size, depth + 1);              // grandchildren
      const reach = sub.span;                                   // how far this moon's own moons extend
      ringR += MOON_GAP + reach;                                // clear the previous body + this moon's sub-span
      const mOrbitR = ringR + size / 2;
      out.push({
        id: c.id, name: nameOf(c), img: pickBy(MOON_SPRITES, h).img, size,
        line: lineOf(c), breathe: 2.8 + ((h % 12) / 10), delay: (h % 15) / 10,
        dimmed: bodyDim(c, opts), nodeId: c.id, nodeStatus: c.status,
        orbitR: mOrbitR, period: 120 + (h % 90), startAngle: ((h >> 5) % 628) / 100,
        ringD: makeRingCircle(mOrbitR).d, moons: sub.moons,
      } as GeneratedMoon & GalaxyBody);
      ringR = mOrbitR + size / 2 + reach;                       // advance past this moon (and its own moons)
    }
    return { moons: out, span: ringR };
  };

  // Keep planets BIG and characterful (toy-sized); grow the WORLD with the map instead of shrinking
  // bodies. Rings are placed with clearance so they never overlap; the view opens at the toy's zoom
  // (big inner planets) and you pan / zoom / navigate outward. Moons are FOLDED into their planet and
  // unfold by ZOOM (rendered only when big enough on screen — see GeneratorSystem), so they neither
  // clutter the overview nor affect ring spacing.
  const N = planetNodes.length;
  const RING_MARGIN = 105;
  let prevEdge = SUN_SIZE / 2;
  const planets: GeneratedPlanet[] = planetNodes.map((n): GeneratedPlanet => {
    const h = hash(n.id); const desc = (kids.get(n.id) ?? []).length;
    const size = desc >= 4 ? 250 + (h % 60) : desc >= 1 ? 175 + (h % 60) : 120 + (h % 50);
    const { moons } = buildMoons(n, size, 1);
    const orbitR = prevEdge + RING_MARGIN + size / 2;   // clearance → never overlap, world grows with count
    prevEdge = orbitR + size / 2;
    const body: GalaxyBody = {
      id: n.id, name: nameOf(n), img: pickBy(PLANET_SPRITES, h).img, size,
      line: lineOf(n), breathe: 3 + ((h % 24) / 10), delay: (h % 16) / 10,
      dimmed: bodyDim(n, opts), nodeId: n.id, nodeStatus: n.status,
    };
    return {
      // clean, perfectly concentric rings so they never cross (the wobbly/jittered shapes tangle
      // once rings sit close together — the map has many more rings than the 9-planet toy).
      ...body, orbit: makeRingCircle(orbitR),
      period: 315 * Math.pow(orbitR / 445, 1.35), startAngle: (h % 628) / 100,
      dash: `${30 + (h % 18)} ${20 + ((h >> 4) % 12)}`, ringWidth: 9 + (h % 4), ringOpacity: 0.72 + ((h % 20) / 100),
      moons,
    } as GeneratedPlanet & GalaxyBody;
  });

  return { seed: hash(opts.projectName ?? "map"), planetCount: planets.length, sun, planets, drifters: [] };
}
