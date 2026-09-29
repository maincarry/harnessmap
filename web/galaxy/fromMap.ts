// The seam: a HarnessMap node tree → a galaxy SystemConfig (2026-09-21, galaxy mode).
// Root/project → the sun; top-level nodes → planets; descendants → moons (recursive, capped at render depth).
// Placement is DETERMINISTIC + identity-stable (sprite/orbit from node id + stable birth order) AND spaced
// with GUARANTEED CLEARANCE so nothing overlaps no matter how many nodes there are — rings are laid out by
// summing each body's diameter + its moon span + a margin, so the field GROWS with the map instead of
// cramming it into a fixed budget (the crowding Jacob caught). Lit drives sleep: awake = lit, asleep = dim (Jacob 2026-09-29).
import type { BodyDef } from "./planets";
import { makeOrbitShape, ORBIT_SHAPE_KINDS } from "./orbitShapes";
import { PLANET_SPRITES, MOON_SPRITES, SUN_SPRITES, DRIFTER_SPRITES } from "./spritePool";
import type { SystemConfig, GeneratedPlanet, GeneratedMoon, GeneratedDrifter } from "./systemGenerator";

const TAU = Math.PI * 2;
// keep the FULL hand-drawn shape variety (egg/bean/peanut/tilt/wobble; drop only the near-circular "ring");
// the wobble INTENSITY is dialed via the amp multiplier below, not by dropping shapes.
const WOBBLY_KINDS = ORBIT_SHAPE_KINDS.filter((k) => k !== "ring");
const SUN_SIZE = 720;
// PROPORTION is the art style (Jacob): the whole system lives in a COMPACT band so the sun always
// dominates. Planets are distributed evenly across [PLANET_INNER, outer]; they are NOT pushed outward
// additively with node count (the old fromMap grew the world with the map, shrinking the sun into a
// huge sparse field — the "spacing obviously wrong" bug). The band only widens past PLANET_OUTER when
// a large map needs the minimum gap, so small/medium maps read exactly like the Lovable reference.
const PLANET_INNER = 580;   // innermost ring clears the sun's face (sun radius ~360)
const PLANET_OUTER = 1620;  // outermost ring for a typical map
const PLANET_MIN_GAP = 155; // minimum center-to-center between adjacent planet rings

// Center-to-center orbit radius for a small body — clearance from both painted discs plus storybook
// breathing room and a per-sibling step. Verbatim from the reference's proportionalMoonOrbit so moons
// sit in proportion to their parent (no absolute floor: an infinite branch keeps shrinking cleanly).
function proportionalMoonOrbit(parentSize: number, childSize: number, siblingIndex = 0): number {
  const clearance = parentSize / 2 + childSize / 2;
  const breathingRoom = Math.max(parentSize * 0.1, childSize * 0.22);
  const siblingStep = siblingIndex * Math.max(childSize * 0.72, parentSize * 0.16);
  return clearance + breathingRoom + siblingStep;
}

export interface MapNodeLite {
  id: string; parentId: string | null; content: string; title?: string | null;
  type?: string | null; status: string; author?: string | null; createdAt?: string;
}
export interface MapToSystemOpts { projectName?: string; litIds?: Set<string> | null; }
export interface GalaxyBody extends BodyDef { dimmed?: boolean; nodeId?: string; nodeStatus?: string; }

// Only genuinely DORMANT nodes sleep — most content stays awake so the map feels alive. (Not
// done/decided/answered/accepted: those are normal, active content.)
// A star sleeps (dim, "z z z") when its topic is at rest: either CONCLUDED (finished, no further
// work expected) or SET ASIDE / OVERTURNED. In-progress statuses (live, open, floated, proposed,
// provisional, todo, doing, exploratory, noted, accepted, chosen) stay awake and colorful so the
// map is alive by default. Widened from dormant-only (v3) because on real maps NO node ever carried
// a dormant status — the feature never fired (Jacob: "fading works in mysterious manners", 2026-09-21).
const SLEEPY = new Set([
  "done", "answered", "decided", "resolved", "closed", "completed", "mooted",
  "parked", "rejected", "dropped", "retracted", "reversed", "lifted", "superseded",
]);
function hash(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const pickBy = <T,>(arr: readonly T[], seed: number): T => arr[seed % arr.length]!;
const isTutorial = (n: MapNodeLite) => n.author === "system" || /getting started/i.test(String(n.title ?? "")) || /getting started \(tutorial\)/i.test(String(n.content ?? ""));
function bodyDimByStatus(n: MapNodeLite): boolean { return SLEEPY.has(n.status); }
// Jacob (2026-09-29): "sleep means dim, awake means lit." A body is awake iff it is lit —
// and lighting a node lights everything under it (map UI: "light as background, incl.
// everything under it"), so a node counts as lit when it OR any ancestor is in the lit set.
// build*() computes the closure of lit ids over the parent chain; when no lit set is
// provided at all (a non-map caller), fall back to the status-based sleep.
function litClosureOf(nodes: MapNodeLite[], litIds: Set<string>): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const closure = new Set<string>();
  for (const n of nodes) {
    const chain: string[] = [];
    let cur: MapNodeLite | undefined = n;
    while (cur) {
      chain.push(cur.id);
      if (litIds.has(cur.id)) { for (const id of chain) closure.add(id); break; }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return closure;
}
function nameOf(n: MapNodeLite): string { const t = String(n.title ?? "").trim(); if (t) return t.slice(0, 40); return String(n.content ?? "node").trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 40) || "node"; }
function lineOf(n: MapNodeLite): string { return String(n.content ?? "").trim().slice(0, 240); }

export function mapToSystem(nodesIn: MapNodeLite[], opts: MapToSystemOpts = {}): SystemConfig {
  const nodes = nodesIn.filter((n) => n.status !== "removed" && !isTutorial(n));
  // sleep = dim, awake = lit (Jacob). With a lit set present, a body is dim unless it is in the
  // lit closure; with no lit set at all, fall back to status-based sleep.
  const litClosure = opts.litIds ? litClosureOf(nodes, opts.litIds) : null;
  const isDim = (n: MapNodeLite): boolean => (litClosure ? !litClosure.has(n.id) : bodyDimByStatus(n));
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

  // moons for a body, placed by PROPORTIONAL clearance around it (the reference art style): every moon
  // is genuinely smaller than its parent (≤55%), and spacing derives from both painted discs. Folded at
  // overview; they unfold on zoom, so they don't clutter the overview or affect the planet band.
  const buildMoons = (parent: MapNodeLite, parentSize: number, depth: number): GeneratedMoon[] => {
    const children = depth > 2 ? [] : (kids.get(parent.id) ?? []);
    if (!children.length) return [];
    const out: GeneratedMoon[] = [];
    children.forEach((c, i) => {
      const h = hash(c.id);
      const size = Math.min(parentSize * 0.55, 66 - depth * 5);  // smaller than parent, shrinking with depth
      const sub = buildMoons(c, size, depth + 1);                // grandchildren
      const mOrbitR = proportionalMoonOrbit(parentSize, size, i);
      out.push({
        id: c.id, name: nameOf(c), img: pickBy(MOON_SPRITES, h).img, size,
        line: lineOf(c), breathe: 2.8 + ((h % 12) / 10), delay: (h % 15) / 10,
        dimmed: isDim(c), nodeId: c.id, nodeStatus: c.status,
        orbitR: mOrbitR, period: 90 + (h % 79), startAngle: ((h >> 5) % 628) / 100,
        ringD: makeOrbitShape("ring", mOrbitR, h, 10).d, moons: sub,
      } as GeneratedMoon & GalaxyBody);
    });
    return out;
  };

  // Planets sit in a COMPACT band so the sun dominates (the reference proportion). They are spread
  // evenly across [PLANET_INNER, bandOuter]; the band only widens past PLANET_OUTER when a large map
  // needs the minimum gap. Sizes stay in the reference's ranges (85–310) but are chosen by importance
  // (child count) so busy topics read bigger. Moons are FOLDED and unfold on zoom, so they don't
  // affect the band. Wobbly orbits use the default hand-drawn jitter (radii are compact now, so a
  // fixed jitter reads as intended instead of vanishing at huge radii).
  const N = planetNodes.length;
  const bandOuter = Math.max(PLANET_OUTER, PLANET_INNER + PLANET_MIN_GAP * (N - 1));
  const gap = N > 1 ? (bandOuter - PLANET_INNER) / (N - 1) : 0;
  const planets: GeneratedPlanet[] = planetNodes.map((n, i): GeneratedPlanet => {
    const h = hash(n.id); const desc = (kids.get(n.id) ?? []).length;
    const size = desc >= 4 ? 250 + (h % 60) : desc >= 1 ? 150 + (h % 65) : 85 + (h % 50);
    const moons = buildMoons(n, size, 1);
    const orbitR = PLANET_INNER + gap * i + ((h % 72) - 36);   // even spread + small deterministic jitter
    const body: GalaxyBody = {
      id: n.id, name: nameOf(n), img: pickBy(PLANET_SPRITES, h).img, size,
      line: lineOf(n), breathe: 3 + ((h % 24) / 10), delay: (h % 16) / 10,
      dimmed: isDim(n), nodeId: n.id, nodeStatus: n.status,
    };
    return {
      ...body, orbit: makeOrbitShape(pickBy(WOBBLY_KINDS, h), orbitR, h),
      period: 315 * Math.pow(orbitR / 445, 1.35), startAngle: (h % 628) / 100,
      dash: `${30 + (h % 18)} ${20 + ((h >> 4) % 12)}`, ringWidth: 9 + (h % 4), ringOpacity: 0.72 + ((h % 20) / 100),
      moons,
    } as GeneratedPlanet & GalaxyBody;
  });

  // Drifting space friends — a few whimsical wanderers (space cats, astronauts, comets, UFOs)
  // float among the worlds so the map feels alive even when sparse. Deterministic from the project
  // seed (stable across reloads), scaled to the world's actual extent so they wander the whole field
  // instead of clustering at a fixed radius. (Lovable populates these; the map fork had left it empty.)
  const dseed = hash(opts.projectName ?? "map");
  const drifterCount = 3 + (dseed % 3);                 // 3–5, like the generator
  const inner = SUN_SIZE * 0.9;
  // drifters wander across the planet band so they're seen at the opening zoom, never inside the sun.
  const outer = Math.max(bandOuter, SUN_SIZE * 1.6);
  const drifters: GeneratedDrifter[] = DRIFTER_SPRITES
    .map((s) => ({ s, k: hash(`${dseed}:${s.id}`) }))   // deterministic shuffle: order by a seeded hash
    .sort((a, b) => a.k - b.k)
    .slice(0, drifterCount)
    .map(({ s }, i): GeneratedDrifter => {
      const h = hash(`${dseed}:${s.id}:${i}`);
      const orbitR = inner + ((h % 1000) / 1000) * (outer - inner);
      return {
        id: `drifter-${i}-${s.id}`, name: s.name, img: s.img, size: 80 + (h % 40),
        orbit: makeOrbitShape(pickBy(ORBIT_SHAPE_KINDS, h), orbitR, h),
        orbitR, period: 320 + (h % 220), startAngle: ((h >> 3) % 628) / 100,
        dir: (h & 1) ? 1 : -1, line: "", breathe: 3.6 + ((h % 18) / 10), delay: ((h >> 6) % 14) / 10,
      };
    });

  return { seed: dseed, planetCount: planets.length, sun, planets, drifters };
}
