import { ArrowUp, Sparkles } from "lucide-react";

export interface ZoomOutTarget {
  /** Parent body id — "" means "the whole sky" (zoom all the way out). */
  id: string;
  name: string;
  /** The parent's face; null for the whole-sky target. */
  img: string | null;
}

interface ZoomOutPillProps {
  target: ZoomOutTarget | null;
  onZoomOut: (id: string) => void;
}

/**
 * "Visit the parent" pill: sits at the top of the SuggestionStack whenever
 * the camera is visiting a body that has somewhere to zoom out to. It
 * shows the parent's face and hand-lettered name so the landing spot is
 * never a surprise — one tap glides up one generation with the usual
 * navigation ceremony (hop, golden ring, speech bubble). At the root sun
 * it offers the whole-sky view instead — in chat mode that final step
 * also closes the conversation, so the pill is always available there,
 * stepping the fan up past the chat's root star one generation at a
 * time. Positioning is the stack's job.
 */
export function ZoomOutPill({ target, onZoomOut }: ZoomOutPillProps) {
  if (!target) return null;
  return (
    <button
      type="button"
      onClick={() => onZoomOut(target.id)}
      aria-label={`Zoom out to ${target.name}`}
      title={`Zoom out to ${target.name}`}
      className="animate-pop-in flex items-center gap-2.5 rounded-full border border-white/20 bg-space-deep/90 py-1.5 pl-2 pr-4 shadow-xl backdrop-blur-sm transition-transform hover:scale-105 active:scale-95"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
        {target.img ? (
          <img
            src={target.img}
            alt=""
            draggable={false}
            className="h-9 w-9 select-none rounded-full bg-space/60 object-contain p-0.5 ring-1 ring-white/25"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-space/60 ring-1 ring-white/25">
            <Sparkles className="h-5 w-5 text-star" aria-hidden />
          </span>
        )}
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-star shadow">
          <ArrowUp className="h-3 w-3 text-space-deep" strokeWidth={3} aria-hidden />
        </span>
      </span>
      <span className="max-w-[38vw] truncate font-hand text-2xl font-bold uppercase leading-none tracking-wider text-white sm:max-w-52">
        {target.name}
      </span>
    </button>
  );
}
