import { setCrashContext } from "@/lib/crash-reporter";
import sunImg from "@/assets/planets/sun.png";
import sun2Img from "@/assets/planets/sun-2.png";
import sun3Img from "@/assets/planets/sun-3.png";
import sun4Img from "@/assets/planets/sun-4.png";
import sun5Img from "@/assets/planets/sun-5.png";
import sun6Img from "@/assets/planets/sun-6.png";
import sun7Img from "@/assets/planets/sun-7.png";
import sun8Img from "@/assets/planets/sun-8.png";
import sun9Img from "@/assets/planets/sun-9.png";
import sun10Img from "@/assets/planets/sun-10.png";
import mercuryImg from "@/assets/planets/mercury.png";
import venusImg from "@/assets/planets/venus.png";
import earthImg from "@/assets/planets/earth.png";
import marsImg from "@/assets/planets/mars.png";
import jupiterImg from "@/assets/planets/jupiter.png";
import saturnImg from "@/assets/planets/saturn.png";
import uranusImg from "@/assets/planets/uranus.png";
import neptuneImg from "@/assets/planets/neptune.png";
import plutoImg from "@/assets/planets/pluto.png";
import planetMintImg from "@/assets/planets/planet-mint.png";
import planetLavenderImg from "@/assets/planets/planet-lavender.png";
import planetTangerineImg from "@/assets/planets/planet-tangerine.png";
import planetDottealImg from "@/assets/planets/planet-dotteal.png";
import planetCrimsonImg from "@/assets/planets/planet-crimson.png";
import planetLemonImg from "@/assets/planets/planet-lemon.png";
import planetSkyImg from "@/assets/planets/planet-sky.png";
import planetGrapeImg from "@/assets/planets/planet-grape.png";
import planetLimeImg from "@/assets/planets/planet-lime.png";
import planetCocoaImg from "@/assets/planets/planet-cocoa.png";
import planetFrostImg from "@/assets/planets/planet-frost.png";
import planetMagentaImg from "@/assets/planets/planet-magenta.png";
import planetStormImg from "@/assets/planets/planet-storm.png";
import planetPeachImg from "@/assets/planets/planet-peach.png";
import planetEmeraldImg from "@/assets/planets/planet-emerald.png";
import planetCoralImg from "@/assets/planets/planet-coral.png";
import planetBlueberryImg from "@/assets/planets/planet-blueberry.png";
import planetButterImg from "@/assets/planets/planet-butter.png";
import planetRoseImg from "@/assets/planets/planet-rose.png";
import planetPistachioImg from "@/assets/planets/planet-pistachio.png";
import planetMidnightImg from "@/assets/planets/planet-midnight.png";
import moonImg from "@/assets/planets/moon.png";
import moonLavenderImg from "@/assets/planets/moon-lavender.png";
import moonPeachImg from "@/assets/planets/moon-peach.png";
import moonMintImg from "@/assets/planets/moon-mint.png";
import moonGoldImg from "@/assets/planets/moon-gold.png";
import moonSkyImg from "@/assets/planets/moon-sky.png";
import moonRoseImg from "@/assets/planets/moon-rose.png";
import moonSlateImg from "@/assets/planets/moon-slate.png";
import moonSageImg from "@/assets/planets/moon-sage.png";
import moonClayImg from "@/assets/planets/moon-clay.png";
import rocketImg from "@/assets/planets/rocket.png";
import astronautImg from "@/assets/planets/astronaut.png";
import satelliteImg from "@/assets/planets/satellite.png";
import ufoImg from "@/assets/planets/ufo.png";
import alienImg from "@/assets/planets/alien.png";
import shootingStarImg from "@/assets/planets/shooting-star.png";
import capsuleImg from "@/assets/planets/capsule.png";
import probeImg from "@/assets/planets/probe.png";
import drifterCometImg from "@/assets/planets/drifter-comet.png";
import drifterRoverImg from "@/assets/planets/drifter-rover.png";
import drifterCatImg from "@/assets/planets/drifter-cat.png";
import drifterTelescopeImg from "@/assets/planets/drifter-telescope.png";

export interface SpriteOption {
  id: string;
  name: string;
  img: string;
}

/**
 * The full cast of hand-painted gouache sprites the generator assembles
 * systems from: 10 suns, 30 planets, 10 moons and 12 drifting friends.
 */
export const SUN_SPRITES: SpriteOption[] = [
  { id: "sun", name: "Sun", img: sunImg },
  { id: "sun-2", name: "Coral Sun", img: sun2Img },
  { id: "sun-3", name: "Lemon Sun", img: sun3Img },
  { id: "sun-4", name: "Rose Sun", img: sun4Img },
  { id: "sun-5", name: "Amber Sun", img: sun5Img },
  { id: "sun-6", name: "Mint Sun", img: sun6Img },
  { id: "sun-7", name: "Lavender Sun", img: sun7Img },
  { id: "sun-8", name: "Sky Sun", img: sun8Img },
  { id: "sun-9", name: "Peach Sun", img: sun9Img },
  { id: "sun-10", name: "Berry Sun", img: sun10Img },
];

export const PLANET_SPRITES: SpriteOption[] = [
  { id: "mercury", name: "Mercury", img: mercuryImg },
  { id: "venus", name: "Venus", img: venusImg },
  { id: "earth", name: "Earth", img: earthImg },
  { id: "mars", name: "Mars", img: marsImg },
  { id: "jupiter", name: "Jupiter", img: jupiterImg },
  { id: "saturn", name: "Saturn", img: saturnImg },
  { id: "uranus", name: "Uranus", img: uranusImg },
  { id: "neptune", name: "Neptune", img: neptuneImg },
  { id: "pluto", name: "Pluto", img: plutoImg },
  { id: "mint", name: "Mint", img: planetMintImg },
  { id: "lavender", name: "Lavender", img: planetLavenderImg },
  { id: "tangerine", name: "Tangerine", img: planetTangerineImg },
  { id: "dotteal", name: "Dotteal", img: planetDottealImg },
  { id: "crimson", name: "Crimson", img: planetCrimsonImg },
  { id: "lemon", name: "Lemon", img: planetLemonImg },
  { id: "sky", name: "Sky", img: planetSkyImg },
  { id: "grape", name: "Grape", img: planetGrapeImg },
  { id: "lime", name: "Lime", img: planetLimeImg },
  { id: "cocoa", name: "Cocoa", img: planetCocoaImg },
  { id: "frost", name: "Frost", img: planetFrostImg },
  { id: "magenta", name: "Magenta", img: planetMagentaImg },
  { id: "storm", name: "Storm", img: planetStormImg },
  { id: "peach", name: "Peach", img: planetPeachImg },
  { id: "emerald", name: "Emerald", img: planetEmeraldImg },
  { id: "coral", name: "Coral", img: planetCoralImg },
  { id: "blueberry", name: "Blueberry", img: planetBlueberryImg },
  { id: "butter", name: "Butter", img: planetButterImg },
  { id: "rose", name: "Rose", img: planetRoseImg },
  { id: "pistachio", name: "Pistachio", img: planetPistachioImg },
  { id: "midnight", name: "Midnight", img: planetMidnightImg },
];

export const MOON_SPRITES: SpriteOption[] = [
  { id: "moon", name: "Moon", img: moonImg },
  { id: "moon-lavender", name: "Lune", img: moonLavenderImg },
  { id: "moon-peach", name: "Pip", img: moonPeachImg },
  { id: "moon-mint", name: "Nib", img: moonMintImg },
  { id: "moon-gold", name: "Glim", img: moonGoldImg },
  { id: "moon-sky", name: "Wisp", img: moonSkyImg },
  { id: "moon-rose", name: "Petal", img: moonRoseImg },
  { id: "moon-slate", name: "Slate", img: moonSlateImg },
  { id: "moon-sage", name: "Sage", img: moonSageImg },
  { id: "moon-clay", name: "Clay", img: moonClayImg },
];

export const DRIFTER_SPRITES: SpriteOption[] = [
  { id: "rocket", name: "Rocket", img: rocketImg },
  { id: "astronaut", name: "Astronaut", img: astronautImg },
  { id: "satellite", name: "Satellite", img: satelliteImg },
  { id: "ufo", name: "UFO", img: ufoImg },
  { id: "alien", name: "Alien", img: alienImg },
  { id: "shooting-star", name: "Shooting Star", img: shootingStarImg },
  { id: "capsule", name: "Capsule", img: capsuleImg },
  { id: "probe", name: "Probe", img: probeImg },
  { id: "comet", name: "Comet", img: drifterCometImg },
  { id: "rover", name: "Rover", img: drifterRoverImg },
  { id: "space-cat", name: "Space Cat", img: drifterCatImg },
  { id: "telescope", name: "Telescope", img: drifterTelescopeImg },
];

/** Every sprite URL across all pools — used to warm the browser cache. */
export const ALL_SPRITE_URLS: string[] = [
  ...SUN_SPRITES,
  ...PLANET_SPRITES,
  ...MOON_SPRITES,
  ...DRIFTER_SPRITES,
].map((s) => s.img);

const decodedUrls = new Set<string>();

/**
 * Fetch + decode one sprite into the browser image cache. Always resolves —
 * a failed sprite must never hold up a system swap.
 */
const decodeOne = (url: string): Promise<void> => {
  if (decodedUrls.has(url)) return Promise.resolve();
  const img = new Image();
  img.src = url;
  const done = () => {
    decodedUrls.add(url);
    // Flight recorder: decoded-bitmap count is the prime OOM suspect.
    setCrashContext({ spritesDecoded: decodedUrls.size });
  };
  if (typeof img.decode === "function") {
    return img.decode().then(done, done);
  }
  return new Promise<void>((resolve) => {
    img.onload = img.onerror = () => {
      done();
      resolve();
    };
  });
};

let poolWarming = false;

/**
 * Warm the whole sprite pool (plus any extra art like sky backgrounds) in the
 * background, a few at a time, so a later "New system" swap or palette switch
 * never waits on image loads. Runs once per session.
 */
export const warmSpritePool = (extraUrls: string[] = []) => {
  if (poolWarming) return;
  poolWarming = true;
  const queue = [...ALL_SPRITE_URLS, ...extraUrls];
  const step = () => {
    const batch = queue.splice(0, 6);
    if (batch.length === 0) return;
    void Promise.all(batch.map(decodeOne)).then(() => {
      window.setTimeout(step, 90);
    });
  };
  window.setTimeout(step, 350);
};

/**
 * Resolve once every URL is fetched and decoded — the warp transition holds
 * its exit beat on this so the new world never pops in half-painted.
 */
export const ensureSpritesReady = (urls: string[]): Promise<void> =>
  Promise.all(urls.map(decodeOne)).then(() => undefined);
