import type { BodyDef } from "./planets";
import {
  makeOrbitShape,
  mulberry32,
  ORBIT_SHAPE_KINDS,
  type OrbitShape,
  type OrbitShapeKind,
} from "./orbitShapes";
import {
  DRIFTER_SPRITES,
  MOON_SPRITES,
  PLANET_SPRITES,
  SUN_SPRITES,
} from "./spritePool";

const TAU = Math.PI * 2;

export interface GeneratedMoon extends BodyDef {
  orbitR: number;
  period: number;
  startAngle: number;
  /** SVG path of the moon's little ring, centered on (0,0). */
  ringD: string;
  /** Moons can have smaller moons of their own (added at runtime). */
  moons: GeneratedMoon[];
}

export interface GeneratedPlanet extends BodyDef {
  orbit: OrbitShape;
  period: number;
  startAngle: number;
  dash: string;
  ringWidth: number;
  ringOpacity: number;
  moons: GeneratedMoon[];
}

export interface GeneratedDrifter extends BodyDef {
  orbit: OrbitShape;
  /** Base orbit radius (kept for DrifterDef compatibility). */
  orbitR: number;
  period: number;
  startAngle: number;
  dir: 1 | -1;
}

export interface SystemConfig {
  seed: number;
  planetCount: number;
  sun: BodyDef;
  planets: GeneratedPlanet[];
  drifters: GeneratedDrifter[];
}

/** Made-up storybook names for the random planets. */
const PLANET_NAMES = [
  "Mochi", "Bimble", "Zoodle", "Pippin", "Nimbus", "Taffy", "Wobble",
  "Pickle", "Sprout", "Ziggy", "Mallow", "Bloop", "Fizzle", "Tumble",
  "Puddle", "Snicker", "Doodle", "Plop", "Widget", "Gumbo", "Sprocket",
  "Bubbles", "Noodle", "Pudding", "Scoot", "Twinkle", "Fudge", "Rascal",
];

const PLANET_LINES = [
  "I was born five seconds ago!",
  "Fresh out of the galaxy oven.",
  "My orbit is hand-drawn, you know.",
  "I contain multitudes. And paint.",
  "Roll the dice, I dare you.",
  "I'm one of a kind. Mostly.",
  "Wobbling is a lifestyle.",
  "I picked this ring myself.",
  "No two of me exist. Probably.",
  "I dream in gouache.",
  "Orbiting is my cardio.",
  "Ask me again in one revolution.",
];

const SUN_LINES = [
  "I'm the star of this brand-new show.",
  "Freshly squeezed sunshine.",
  "I keep this whole random family together.",
  "Generated, but still glorious.",
];

/**
 * Long storybook names, in the spirit of "Super Big Star 29444 Cajun
 * Cafe" — an opener, a body type, a catalog number and a quirky little
 * establishment. They stress-test the navigator and the wrapping labels.
 */
const LONG_OPENERS = [
  "Super Big", "Mega Tiny", "Ultra Round", "Hyper Happy", "Cosmic Little",
  "Grand Old", "Wobbly", "Sleepy", "Hungry", "Dancing", "Grumpy", "Jolly",
];
const LONG_TYPES = [
  "Star", "Planet", "World", "Blob", "Orb", "Rock", "Marshmallow",
  "Pancake", "Meatball", "Gumball",
];
const LONG_SUFFIXES = [
  "Cajun Cafe", "Moon Diner", "Space Bakery", "Cosmic Laundry",
  "Star Nursery", "Comet Garage", "Nebula Salon", "Orbit School",
  "Meteor Motel", "Galaxy Farm", "Astro Arcade", "Pizza Place",
  "Donut Shop", "Bowling Alley",
];

/**
 * Every sprite URL a generated system will paint — sun, planets, the whole
 * moon trees and the drifters. Used to pre-decode art before a warp swap.
 */
export function collectSystemSpriteUrls(config: SystemConfig): string[] {
  const urls: string[] = [config.sun.img];
  const walkMoons = (moons: GeneratedMoon[]) => {
    for (const m of moons) {
      urls.push(m.img);
      walkMoons(m.moons);
    }
  };
  for (const p of config.planets) {
    urls.push(p.img);
    walkMoons(p.moons);
  }
  for (const d of config.drifters) urls.push(d.img);
  return urls;
}

/**
 * Build a whole random solar-system-like world from a seed. Deterministic:
 * the same seed and planet count always produce the same system, so SSR
 * and hydration render identical frames.
 */
export function generateSystem(seed: number, planetCount: number): SystemConfig {
  const rand = mulberry32(seed * 7919 + planetCount * 104729);
  const pick = <T,>(arr: readonly T[]): T =>
    arr[Math.floor(rand() * arr.length)]!;
  const shuffled = <T,>(arr: readonly T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };

  // --- Names -------------------------------------------------------------
  // ~45% of bodies get a long catalog name like "Super Big Star 29444
  // Cajun Cafe"; the rest get a short storybook name. All unique.
  const usedNames = new Set<string>();
  const uniqueName = (base: string): string => {
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    const numerals = ["II", "III", "IV", "V", "VI"];
    for (const n of numerals) {
      const candidate = `${base} ${n}`;
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
    }
    const fallback = `${base} ${Math.floor(rand() * 900) + 100}`;
    usedNames.add(fallback);
    return fallback;
  };
  const makeLongName = () =>
    uniqueName(
      `${pick(LONG_OPENERS)} ${pick(LONG_TYPES)} ${1000 + Math.floor(rand() * 98999)} ${pick(LONG_SUFFIXES)}`,
    );
  const shortNames = shuffled(PLANET_NAMES);
  let shortIdx = 0;
  const planetName = () =>
    rand() < 0.45 ? makeLongName() : uniqueName(shortNames[shortIdx++ % shortNames.length]!);

  // --- Sun -------------------------------------------------------------
  const sunSprite = pick(SUN_SPRITES);
  const sun: BodyDef = {
    id: "sun",
    name: rand() < 0.4 ? makeLongName() : sunSprite.name,
    img: sunSprite.img,
    size: 700 + rand() * 90,
    line: pick(SUN_LINES),
    breathe: 6,
    delay: 0,
  };

  // --- Planets -----------------------------------------------------------
  const sprites = shuffled(PLANET_SPRITES).slice(0, planetCount);
  // Innermost ring must clear the biggest sun (radius ~395) plus a
  // gas giant's half-width (~155), so nothing parks on the sun's face.
  const inner = 580;
  const outer = 1620;
  const gap = planetCount > 1 ? (outer - inner) / (planetCount - 1) : 0;

  const planets: GeneratedPlanet[] = sprites.map((sprite, i) => {
    const roll = rand();
    const size =
      roll < 0.25
        ? 250 + rand() * 60 // gas giant
        : roll < 0.7
          ? 150 + rand() * 65 // mid
          : 85 + rand() * 50; // small
    const orbitR = inner + gap * i + (rand() - 0.5) * 36;
    const kind: OrbitShapeKind = pick(ORBIT_SHAPE_KINDS);
    const orbit = makeOrbitShape(kind, orbitR, Math.floor(rand() * 1e9));
    const period = 315 * Math.pow(orbitR / 445, 1.35) * (0.9 + rand() * 0.2);

    // 0, 1 or 2 moons — weighted so every count shows up often.
    const moonRoll = rand();
    const moonCount = moonRoll < 0.35 ? 0 : moonRoll < 0.7 ? 1 : 2;
    const moonSprites = shuffled(MOON_SPRITES);
    const moons: GeneratedMoon[] = [];
    for (let m = 0; m < moonCount; m++) {
      const ms = moonSprites[m % moonSprites.length]!;
      const mOrbitR = size * 0.72 + 50 + m * 62;
      moons.push({
        id: `moon-${i}-${m}`,
        name: ms.name,
        img: ms.img,
        size: 44 + rand() * 26,
        orbitR: mOrbitR,
        period: 90 + rand() * 78.75,
        startAngle: rand() * TAU,
        ringD: makeOrbitShape("ring", mOrbitR, Math.floor(rand() * 1e9), 10).d,
        line: "I'm a little moon, short and stout.",
        breathe: 2.8 + rand() * 1.2,
        delay: rand() * 1.5,
        moons: [],
      });
    }

    return {
      id: `planet-${i}-${sprite.id}`,
      name: planetName(),
      img: sprite.img,
      size,
      orbit,
      period,
      startAngle: rand() * TAU,
      dash: `${(30 + rand() * 18).toFixed(0)} ${(20 + rand() * 12).toFixed(0)}`,
      ringWidth: 9 + rand() * 4,
      ringOpacity: 0.72 + rand() * 0.2,
      moons,
      line: pick(PLANET_LINES),
      breathe: 3 + rand() * 2.4,
      delay: rand() * 1.6,
    };
  });

  // --- Drifting friends ---------------------------------------------------
  const drifterCount = 3 + Math.floor(rand() * 3);
  const drifters: GeneratedDrifter[] = shuffled(DRIFTER_SPRITES)
    .slice(0, drifterCount)
    .map((sprite, i) => {
      const orbitR = 560 + rand() * 1180;
      return {
        id: `drifter-${i}-${sprite.id}`,
        name: sprite.name,
        img: sprite.img,
        size: 80 + rand() * 40,
        orbit: makeOrbitShape(pick(ORBIT_SHAPE_KINDS), orbitR, Math.floor(rand() * 1e9)),
        orbitR,
        period: 112.5 + rand() * 105,
        startAngle: rand() * TAU,
        dir: rand() < 0.5 ? -1 : 1,
        line: "",
        breathe: 3.6 + rand() * 1.8,
        delay: rand() * 1.4,
      };
    });

  return { seed, planetCount, sun, planets, drifters };
}

// --- Runtime additions ------------------------------------------------------
// Bodies the user grows by double-clicking a focused body. Not seeded —
// Math.random is fine here because this only runs client-side, after
// interaction.

export const MAX_SYSTEM_PLANETS = 8;
export const MAX_MOONS_PER_BODY = 2;
/** A moon smaller than this can't host a mini-moon of its own. */
export const MIN_MOON_PARENT_SIZE = 46;

const ADDED_MOON_LINES = [
  "I'm a little moon, short and stout.",
  "I'm the tiniest moon around!",
  "I orbit my big sibling!",
  "Freshly hatched moon!",
];

const pickRandom = <T,>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]!;

/** Every name already taken in this system (sun, planets, whole moon tree). */
const collectUsedNames = (system: SystemConfig): Set<string> => {
  const used = new Set<string>([system.sun.name]);
  const walk = (moons: GeneratedMoon[]) => {
    for (const m of moons) {
      used.add(m.name);
      walk(m.moons);
    }
  };
  for (const p of system.planets) {
    used.add(p.name);
    walk(p.moons);
  }
  return used;
};

const uniqueRuntimeName = (base: string, used: Set<string>): string => {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const numerals = ["II", "III", "IV", "V", "VI", "VII"];
  for (const n of numerals) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base} ${Math.floor(Math.random() * 900) + 100}`;
  used.add(fallback);
  return fallback;
};

const runtimePlanetName = (used: Set<string>): string =>
  Math.random() < 0.45
    ? uniqueRuntimeName(
        `${pickRandom(LONG_OPENERS)} ${pickRandom(LONG_TYPES)} ${1000 + Math.floor(Math.random() * 98999)} ${pickRandom(LONG_SUFFIXES)}`,
        used,
      )
    : uniqueRuntimeName(pickRandom(PLANET_NAMES), used);

/** Find a moon by id anywhere in the planets' moon trees. */
export function findMoonById(
  planets: GeneratedPlanet[],
  id: string,
): GeneratedMoon | null {
  const walk = (moons: GeneratedMoon[]): GeneratedMoon | null => {
    for (const m of moons) {
      if (m.id === id) return m;
      const sub = walk(m.moons);
      if (sub) return sub;
    }
    return null;
  };
  for (const p of planets) {
    const hit = walk(p.moons);
    if (hit) return hit;
  }
  return null;
}

/** Find the direct parent (planet or moon) of a moon anywhere in the tree. */
export function findMoonParent(
  planets: GeneratedPlanet[],
  id: string,
): { id: string; name: string } | null {
  const walk = (
    moons: GeneratedMoon[],
    parent: { id: string; name: string },
  ): { id: string; name: string } | null => {
    for (const m of moons) {
      if (m.id === id) return parent;
      const sub = walk(m.moons, { id: m.id, name: m.name });
      if (sub) return sub;
    }
    return null;
  };
  for (const p of planets) {
    const hit = walk(p.moons, { id: p.id, name: p.name });
    if (hit) return hit;
  }
  return null;
}

/**
 * Add a planet to the system (double-click the sun). The new orbit parks
 * in the widest gap between existing rings so the family stays evenly
 * spread; the sprite is one nobody in the system uses yet. Null when the
 * system already has 8 planets.
 */
export function addPlanetToSystem(
  system: SystemConfig,
): { next: SystemConfig; newId: string } | null {
  if (system.planets.length >= MAX_SYSTEM_PLANETS) return null;
  const used = collectUsedNames(system);
  const usedImgs = new Set(system.planets.map((p) => p.img));
  const fresh = PLANET_SPRITES.filter((s) => !usedImgs.has(s.img));
  const sprite = pickRandom(fresh.length > 0 ? fresh : PLANET_SPRITES);

  const radii = system.planets.map((p) => p.orbit.maxR).sort((a, b) => a - b);
  const edges = [560, ...radii, 1740];
  let gapStart = edges[0]!;
  let gapEnd = edges[1]!;
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1]! - edges[i]! > gapEnd - gapStart) {
      gapStart = edges[i]!;
      gapEnd = edges[i + 1]!;
    }
  }
  const orbitR = (gapStart + gapEnd) / 2;

  const roll = Math.random();
  const size =
    roll < 0.25
      ? 250 + Math.random() * 60
      : roll < 0.7
        ? 150 + Math.random() * 65
        : 85 + Math.random() * 50;
  const orbit = makeOrbitShape(
    pickRandom(ORBIT_SHAPE_KINDS),
    orbitR,
    Math.floor(Math.random() * 1e9),
  );
  const planet: GeneratedPlanet = {
    id: `planet-new-${Date.now().toString(36)}-${sprite.id}`,
    name: runtimePlanetName(used),
    img: sprite.img,
    size,
    orbit,
    period: 315 * Math.pow(orbitR / 445, 1.35) * (0.9 + Math.random() * 0.2),
    startAngle: Math.random() * TAU,
    dash: `${(30 + Math.random() * 18).toFixed(0)} ${(20 + Math.random() * 12).toFixed(0)}`,
    ringWidth: 9 + Math.random() * 4,
    ringOpacity: 0.72 + Math.random() * 0.2,
    moons: [],
    line: pickRandom(PLANET_LINES),
    breathe: 3 + Math.random() * 2.4,
    delay: Math.random() * 1.6,
  };
  return {
    next: { ...system, planets: [...system.planets, planet] },
    newId: planet.id,
  };
}

/**
 * Add a moon to a planet — or a smaller mini-moon to a moon (yes, moons
 * can have moons). Null when the parent already has 2 moons or is too
 * tiny to host one.
 */
export function addMoonToSystem(
  system: SystemConfig,
  parentId: string,
): { next: SystemConfig; newId: string } | null {
  const used = collectUsedNames(system);
  const makeChild = (
    parentSize: number,
    siblingCount: number,
    isPlanet: boolean,
  ): GeneratedMoon => {
    const sprite = pickRandom(MOON_SPRITES);
    const size = isPlanet
      ? Math.min(44 + Math.random() * 26, parentSize * 0.55)
      : parentSize * (0.45 + Math.random() * 0.15);
    const orbitR = isPlanet
      ? parentSize * 0.72 + 50 + siblingCount * 62
      : parentSize * 0.85 + 34 + siblingCount * 40;
    return {
      id: `moon-new-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
      name: uniqueRuntimeName(sprite.name, used),
      img: sprite.img,
      size,
      orbitR,
      period: 60 + Math.random() * 60,
      startAngle: Math.random() * TAU,
      ringD: makeOrbitShape("ring", orbitR, Math.floor(Math.random() * 1e9), 10).d,
      line: pickRandom(ADDED_MOON_LINES),
      breathe: 2.8 + Math.random() * 1.2,
      delay: Math.random() * 1.5,
      moons: [],
    };
  };

  // Parent is a planet?
  const planet = system.planets.find((p) => p.id === parentId);
  if (planet) {
    if (planet.moons.length >= MAX_MOONS_PER_BODY) return null;
    const child = makeChild(planet.size, planet.moons.length, true);
    return {
      next: {
        ...system,
        planets: system.planets.map((p) =>
          p.id === parentId ? { ...p, moons: [...p.moons, child] } : p,
        ),
      },
      newId: child.id,
    };
  }

  // Parent is a moon somewhere in the tree.
  const parent = findMoonById(system.planets, parentId);
  if (
    !parent ||
    parent.moons.length >= MAX_MOONS_PER_BODY ||
    parent.size < MIN_MOON_PARENT_SIZE
  ) {
    return null;
  }
  const child = makeChild(parent.size, parent.moons.length, false);
  const insert = (moons: GeneratedMoon[]): GeneratedMoon[] | null => {
    let changed = false;
    const next = moons.map((m) => {
      if (m.id === parentId) {
        changed = true;
        return { ...m, moons: [...m.moons, child] };
      }
      const sub = insert(m.moons);
      if (sub) {
        changed = true;
        return { ...m, moons: sub };
      }
      return m;
    });
    return changed ? next : null;
  };
  let changedAny = false;
  const planets = system.planets.map((p) => {
    const sub = insert(p.moons);
    if (sub) {
      changedAny = true;
      return { ...p, moons: sub };
    }
    return p;
  });
  if (!changedAny) return null;
  return { next: { ...system, planets }, newId: child.id };
}

/**
 * Remove a body from the system (the info panel's "say goodbye"). A
 * planet leaves with its whole moon tree; a moon leaves with its own
 * mini-moons. The sun can never be removed. Null when the id isn't found.
 */
export function removeBodyFromSystem(
  system: SystemConfig,
  id: string,
): SystemConfig | null {
  // A planet goes with everything orbiting it.
  if (system.planets.some((p) => p.id === id)) {
    return { ...system, planets: system.planets.filter((p) => p.id !== id) };
  }
  // A moon goes with its own mini-moons, wherever it sits in the tree.
  const strip = (moons: GeneratedMoon[]): GeneratedMoon[] | null => {
    if (moons.some((m) => m.id === id)) {
      return moons.filter((m) => m.id !== id);
    }
    let changed = false;
    const next = moons.map((m) => {
      const sub = strip(m.moons);
      if (sub) {
        changed = true;
        return { ...m, moons: sub };
      }
      return m;
    });
    return changed ? next : null;
  };
  let changedAny = false;
  const planets = system.planets.map((p) => {
    const sub = strip(p.moons);
    if (sub) {
      changedAny = true;
      return { ...p, moons: sub };
    }
    return p;
  });
  return changedAny ? { ...system, planets } : null;
}

/**
 * Cap for user-given names. Long storybook names are the whole point
 * ("Super Big Star 29444 Cajun Cafe"), but past this the labels, pills
 * and panels stop fitting anywhere — long, not endless.
 */
export const MAX_BODY_NAME = 60;

/**
 * Rename the sun, a planet, or any moon in the tree (the info panel's
 * pencil). Ids never change, so the rocket, camera follow and chat fan
 * all keep their bearings. Returns the same system when the id is
 * unknown.
 */
export function renameBodyInSystem(
  system: SystemConfig,
  id: string,
  name: string,
): SystemConfig {
  if (system.sun.id === id) {
    return { ...system, sun: { ...system.sun, name } };
  }
  const renameMoons = (moons: GeneratedMoon[]): GeneratedMoon[] | null => {
    let changed = false;
    const next = moons.map((m) => {
      if (m.id === id) {
        changed = true;
        return { ...m, name };
      }
      const sub = renameMoons(m.moons);
      if (sub) {
        changed = true;
        return { ...m, moons: sub };
      }
      return m;
    });
    return changed ? next : null;
  };
  let changedAny = false;
  const planets = system.planets.map((p) => {
    if (p.id === id) {
      changedAny = true;
      return { ...p, name };
    }
    const sub = renameMoons(p.moons);
    if (sub) {
      changedAny = true;
      return { ...p, moons: sub };
    }
    return p;
  });
  return changedAny ? { ...system, planets } : system;
}
