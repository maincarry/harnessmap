import { Rocket } from "lucide-react";

interface RocketSummonInviteProps {
  /** Destination body's display name. */
  name: string;
  /** Destination body's face. */
  img: string;
  onSummon: () => void;
}

/**
 * Summon-the-rocket suggestion: shown whenever the visited body isn't
 * holding the hero rocket (parked or inbound). One tap sends the rocket
 * flying over — never offered for the body that already has it. It is
 * state-driven like the zoom-out pill: no dismiss button, it simply
 * disappears once the rocket is on its way or the camera moves on.
 */
export function RocketSummonInvite({
  name,
  img,
  onSummon,
}: RocketSummonInviteProps) {
  return (
    <button
      type="button"
      onClick={onSummon}
      aria-label={`Send the rocket to ${name}`}
      title={`Send the rocket to ${name}`}
      className="animate-pop-in flex items-center gap-2.5 rounded-full border border-white/20 bg-space-deep/90 py-1.5 pl-2 pr-4 shadow-xl backdrop-blur-sm transition-transform hover:scale-105 active:scale-95"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
        <img
          src={img}
          alt=""
          draggable={false}
          className="h-9 w-9 select-none rounded-full bg-space/60 object-contain p-0.5 ring-1 ring-white/25"
        />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-star shadow">
          <Rocket className="h-2.5 w-2.5 text-space-deep" strokeWidth={3} aria-hidden />
        </span>
      </span>
      <span className="max-w-[46vw] truncate font-hand text-2xl font-bold uppercase leading-none tracking-wider text-white sm:max-w-64">
        Rocket to <span className="text-star">{name}</span>?
      </span>
    </button>
  );
}
