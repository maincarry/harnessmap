import type { DrifterDef } from "./planets";

interface DrifterProps {
  def: DrifterDef;
  /** Center position in world px. */
  x: number;
  y: number;
}

/**
 * A decorative character (rocket, astronaut, satellite) slowly drifting
 * through the sky. Purely visual — no label, no tap reaction.
 */
export function Drifter({ def, x, y }: DrifterProps) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      <img
        src={def.img}
        alt=""
        width={def.size}
        height={def.size}
        draggable={false}
        loading="lazy"
        className="h-full w-full object-contain"
        style={{
          width: def.size,
          height: def.size,
          animation: `planet-breathe ${def.breathe}s ease-in-out ${def.delay}s infinite`,
        }}
      />
    </div>
  );
}
