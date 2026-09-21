import type { ReactNode } from "react";

interface SuggestionStackProps {
  /** Chat mode docks the stack centered on the sky strip instead of the screen. */
  chatMode: boolean;
  children: ReactNode;
}

/**
 * The top-of-sky suggestion stack: the zoom-out pill, summon-the-rocket
 * offers and chat invites all live here as one vertical pile of
 * notification pills, so any combination of them stays neatly stacked
 * instead of fighting over fixed rows. In chat mode the stack docks over
 * the galaxy strip (desktop only — phones rest the strip's chrome, same
 * as the other controls).
 */
export function SuggestionStack({ chatMode, children }: SuggestionStackProps) {
  return (
    <div
      className={`fixed z-10 flex flex-col items-center gap-2 ${
        chatMode
          ? // Centered on the galaxy strip, on the navigator-toggle row.
            "left-[calc(clamp(290px,33vw,460px)/2)] top-[max(4rem,calc(env(safe-area-inset-top)+3rem))] hidden -translate-x-1/2 sm:flex"
          : // Centered on the screen; phones drop it a row so the title stays clear.
            "left-1/2 top-[max(4rem,calc(env(safe-area-inset-top)+3rem))] -translate-x-1/2 sm:top-[max(1rem,env(safe-area-inset-top))]"
      }`}
    >
      {children}
    </div>
  );
}
