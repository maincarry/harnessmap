import { useRef } from "react";
import type { BodyDef } from "./planets";
import { SpeechBubble } from "./SpeechBubble";

/** Hand-wobbled closed ring (r≈68 in a 160 viewBox) for the navigator
    highlight — deliberately imperfect so it reads as drawn, not orbital. */
const HIGHLIGHT_RING_PATH = (() => {
  const pts: string[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 68 + Math.sin(a * 3 + 0.7) * 3.2 + Math.sin(a * 5 + 2.1) * 1.8;
    pts.push(
      `${i === 0 ? "M" : "L"} ${(80 + Math.cos(a) * r).toFixed(1)} ${(80 + Math.sin(a) * r).toFixed(1)}`,
    );
  }
  return `${pts.join(" ")} Z`;
})();

interface PlanetProps {
  def: BodyDef;
  /** Center position in world px. */
  x: number;
  y: number;
  active: boolean;
  bouncing?: boolean;
  /** Just born via the generator's add-a-body bubble: pop-in animation. */
  newborn?: boolean;
  /** Saying goodbye: spins away and shrinks out before removal. */
  departing?: boolean;
  onTap: (id: string) => void;
  /** Slowly rotate the sprite (used for the Sun's rays). */
  spin?: boolean;
  /** Single squash-and-stretch hop, triggered from the navigator. */
  jumping?: boolean;
  /** Spinning dashed ring, shown when found via the navigator. */
  highlighted?: boolean;
  /** "flash" fades out (navigator find); "steady" stays on (rocket target). */
  highlightMode?: "flash" | "steady";
  /** Chat mode: scale the name label up so it stays readable while the
      camera zooms the family column out. */
  labelBoost?: number;
}

/**
 * Hand-lettered name size for a body: long generated names get a smaller,
 * wrapping label so they read like a caption instead of one endless line.
 * Shared with the chat fan layout, which scales labels to fit the strip.
 */
export function planetLabelSize(size: number, name: string): number {
  return name.length > 16
    ? Math.max(22, Math.min(size * 0.22, 40))
    : Math.max(32, Math.min(size * 0.3, 72));
}

/**
 * A celestial body floating in the world: sprite, name label, tap
 * reaction. Position comes from the parent's orbit math.
 */
export function Planet({ def, x, y, active, bouncing = false, newborn = false, departing = false, onTap, spin, jumping, highlighted, highlightMode = "flash", labelBoost = 1 }: PlanetProps) {
  const downAt = useRef<{ x: number; y: number; t: number } | null>(null);
  const longName = def.name.length > 16;

  let animation: string | undefined;
  if (departing) {
    animation = "body-goodbye 0.68s cubic-bezier(0.5, 0, 0.75, 0.4) 1 both";
  } else if (newborn) {
    animation = "planet-birth 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) 1";
  } else if (jumping) {
    animation = "planet-jump 0.8s cubic-bezier(0.36, 0, 0.66, 1) 1";
  } else if (!bouncing) {
    animation = spin
      ? `sun-spin 90s linear infinite`
      : `planet-breathe ${def.breathe}s ease-in-out ${def.delay}s infinite`;
  }

  const labelSize = planetLabelSize(def.size, def.name);

  return (
    <div
      className={`absolute ${departing ? "pointer-events-none" : ""}`}
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        zIndex: active || highlighted ? 30 : undefined,
      }}
    >
      <button
        type="button"
        aria-label={def.name}
        className={`relative block cursor-pointer touch-manipulation select-none ${bouncing ? "planet-bounce" : ""}`}
        style={{ width: def.size, height: def.size }}
        onPointerDown={(e) => {
          downAt.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        }}
        onPointerUp={(e) => {
          const pd = downAt.current;
          downAt.current = null;
          if (!pd) return;
          const moved = Math.hypot(e.clientX - pd.x, e.clientY - pd.y);
          if (moved < 12 && Date.now() - pd.t < 600) onTap(def.id);
        }}
      >
        <img
          src={def.img}
          alt=""
          width={def.size}
          height={def.size}
          draggable={false}
          className="h-full w-full object-contain"
          style={{ animation }}
        />
        {/* Newborn celebration: sparkle crosses bursting outward. */}
        {newborn &&
          [0, 60, 120, 180, 240, 300].map((a) => {
            const rad = (a * Math.PI) / 180;
            const dx = Math.cos(rad) * def.size * 0.66;
            const dy = Math.sin(rad) * def.size * 0.66;
            const s = Math.max(18, def.size * 0.2);
            return (
              <svg
                key={a}
                viewBox="0 0 24 24"
                aria-hidden
                className="birth-sparkle pointer-events-none absolute"
                style={{
                  left: "50%",
                  top: "50%",
                  width: s,
                  height: s,
                  marginLeft: -s / 2,
                  marginTop: -s / 2,
                  ["--dx" as string]: `${dx}px`,
                  ["--dy" as string]: `${dy}px`,
                  animationDelay: `${a / 850}s`,
                }}
              >
                <path
                  d="M12 2.5v19M2.5 12h19"
                  stroke="#fff3c4"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                />
              </svg>
            );
          })}
        {highlighted && (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2"
            style={{ width: "158%", height: "158%" }}
            aria-hidden
          >
            <svg viewBox="0 0 160 160" className={`h-full w-full ${highlightMode === "steady" ? "navigator-ring-steady" : "navigator-ring"}`}>
              {/* Golden wobbly ring — reads as "found!", not another orbit */}
              <path
                d={HIGHLIGHT_RING_PATH}
                fill="none"
                stroke="#ffd94d"
                strokeWidth="8"
                strokeDasharray="30 18"
                strokeLinecap="round"
              />
              {/* Twinkling finder sparkles on the ring */}
              {[0, 90, 180, 270].map((a) => {
                const rad = (a * Math.PI) / 180;
                const sx = 80 + Math.cos(rad) * 68;
                const sy = 80 + Math.sin(rad) * 68;
                return (
                  <path
                    key={a}
                    d={`M ${sx} ${sy - 11} L ${sx} ${sy + 11} M ${sx - 11} ${sy} L ${sx + 11} ${sy}`}
                    stroke="#fff3c4"
                    strokeWidth="5"
                    strokeLinecap="round"
                    className="navigator-sparkle"
                    style={{ animationDelay: `${a / 500}s` }}
                  />
                );
              })}
            </svg>
          </span>
        )}
      </button>
      <span
        className={`pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 font-hand font-bold uppercase tracking-[0.2em] text-orbit-label transition-opacity duration-500 ${
          departing ? "opacity-0" : ""
        } ${
          longName ? "w-max max-w-[380px] whitespace-normal text-center leading-none [overflow-wrap:anywhere]" : "whitespace-nowrap"
        }`}
        style={{
          fontSize: labelSize * labelBoost,
          textShadow: "0 2px 10px rgba(10, 6, 30, 0.9)",
        }}
      >
        {def.name}
      </span>
      {active && <SpeechBubble text={def.line} />}
    </div>
  );
}
