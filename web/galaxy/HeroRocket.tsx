import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTransformEffect } from "react-zoom-pan-pinch";
import heroRocketImg from "@/assets/planets/hero-rocket.png";
import heroFlameImg from "@/assets/planets/hero-flame.png";

/**
 * Display height in SCREEN px when zoomed in — see rocketWorldScale.
 */
export const ROCKET_H = 96;

/** Phones shrink the fixed on-screen size — 96px looms on a 390px screen.
    Client-only: reading window during render would hydration-mismatch, so
    render paths receive the factor from post-mount state instead. */
const mobileShrink = () =>
  typeof window !== "undefined" && window.innerWidth < 640 ? 0.72 : 1;

/**
 * World-space scale of the rocket at a camera zoom. Zoomed IN past 1x the
 * rocket counter-scales against the camera (fixed ~96px on screen, ~69px
 * on phones via `shrink`), so it can be seen, grabbed and parked even on
 * tiny moons. Zoomed OUT it keeps its world size and shrinks along with
 * everything else — otherwise it would loom disproportionately large over
 * a small body at overview. Pure: safe to call during SSR.
 */
export const rocketWorldScale = (cameraScale: number, shrink = 1) =>
  shrink / Math.max(1, cameraScale);
/** Sprite aspect is 407x1067 after alpha-trimming. */
export const ROCKET_W = Math.round((ROCKET_H * 407) / 1067);
const FLAME_H = 61;
const FLAME_W = 33;

interface HeroRocketProps {
  /** Center position in world px. */
  x: number;
  y: number;
  /** Degrees; 0 = nose up. */
  rotation: number;
  /** Flame size, 0 (parked) to 1 (full thrust). */
  flame: number;
  /** Touchdown squash-and-settle. */
  squash: boolean;
  dragging: boolean;
  /** False while flying — the rocket can't be grabbed mid-flight. */
  interactive: boolean;
  onDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * The hero rocket: a classic red-and-cream toy rocket the user flies
 * between bodies. Parked, it stands on its host's shoulder with a gentle
 * sway; in flight a brushy flame flickers underneath. Drag it onto any
 * body — sun, planet or moon — or send it via the navigator. It holds a
 * fixed on-screen size when zoomed in, and shrinks with the world when
 * zoomed out (see rocketWorldScale).
 */
export function HeroRocket({
  x,
  y,
  rotation,
  flame,
  squash,
  dragging,
  interactive,
  onDown,
}: HeroRocketProps) {
  // Counter-scale against the camera zoom only when zoomed IN: the
  // rocket's footprint in world px shrinks as you zoom in, keeping its
  // on-screen size constant; zooming out lets it shrink with the world.
  const scaleRef = useRef<HTMLDivElement>(null);
  useTransformEffect(({ state }) => {
    const el = scaleRef.current;
    // Client-only effect, so reading the viewport here is hydration-safe.
    if (el) el.style.transform = `scale(${rocketWorldScale(state.scale, mobileShrink())})`;
  });

  return (
    <div
      className="pointer-events-none absolute z-40"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      <div ref={scaleRef} style={{ transformOrigin: "center center" }}>
        <div
          role="button"
          aria-label="Rocket — drag me onto any star, planet or moon"
          className={`relative touch-none select-none ${
            interactive || dragging ? "pointer-events-auto" : "pointer-events-none"
          } ${dragging ? "cursor-grabbing" : interactive ? "cursor-grab" : ""}`}
          style={{
            width: ROCKET_W,
            height: ROCKET_H,
            transform: `rotate(${rotation}deg)`,
          }}
          onPointerDownCapture={interactive ? onDown : undefined}
        >
          <img
            src={heroRocketImg}
            alt=""
            width={ROCKET_W}
            height={ROCKET_H}
            draggable={false}
            className={`h-full w-full object-contain ${
              squash
                ? "rocket-land"
                : flame > 0.02 || dragging
                  ? ""
                  : "rocket-parked"
            }`}
          />
          {flame > 0.02 && (
            <div
              className="pointer-events-none absolute left-1/2"
              aria-hidden
              style={{
                top: ROCKET_H - 6,
                width: FLAME_W,
                height: FLAME_H,
                transform: `translateX(-50%) scale(${flame})`,
                transformOrigin: "top center",
              }}
            >
              <img
                src={heroFlameImg}
                alt=""
                width={FLAME_W}
                height={FLAME_H}
                draggable={false}
                className="rocket-flame h-full w-full object-contain"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
