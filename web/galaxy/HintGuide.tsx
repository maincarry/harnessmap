import { useCallback, useEffect, useRef, useState } from "react";
import { Lightbulb, Sparkle, X } from "lucide-react";

export interface ContextualHint {
  /** Stable id — remembered as "seen" across visits. */
  id: string;
  /** Hand-lettered tip. */
  text: string;
  /** The app situation this tip belongs to (see the parent's hintContext). */
  context: string;
}

interface HintGuideProps {
  /** Persistence key — seen tips are remembered per page. */
  pageId: string;
  /** All tips, each tagged with the situation it explains. */
  hints: ContextualHint[];
  /** The app's current situation, computed from live state by the parent. */
  context: string;
  /** Chat mode: dock the bubble (and the lightbulb) to the galaxy strip. */
  docked?: boolean;
}

const AUTO_ADVANCE_MS = 7000;
const LAST_LINGER_MS = 9000;

/**
 * The exploration guide: a hand-lettered hint bubble that surfaces tips
 * WHEN THEY MATTER instead of marching through a fixed tour. Each tip is
 * tagged with a situation (exploring, visiting a star, rocket flying,
 * chatting…); whenever the app's situation changes, the first not-yet-seen
 * tip for that situation pops up, lingers, and quietly marks itself seen.
 * Situations with nothing new to say stay silent. The little lightbulb
 * replays the current situation's tips anytime. Styled like the Navigator
 * and info panel (deep-space glass, dashed golden border, Amatic SC).
 */
export function HintGuide({ pageId, hints, context, docked = false }: HintGuideProps) {
  const storageKey = `galaxy-hints-v2-${pageId}`;
  /** Ids queued for the current situation; queue[0] is on screen. */
  const [queue, setQueue] = useState<string[]>([]);
  /** How many tips were queued when the current run started (for "2/3"). */
  const [queueTotal, setQueueTotal] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());
  const bootedRef = useRef(false);
  /** Mirror of the live queue so the context effect can farewell the tip
      being replaced (a shown tip counts as seen, even when interrupted). */
  const queueRef = useRef<string[]>([]);

  const startQueue = useCallback((ids: string[]) => {
    setQueue(ids);
    setQueueTotal(ids.length);
  }, []);

  const persistSeen = useCallback(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...seenRef.current]));
    } catch {
      /* private mode — tips simply resurface next visit */
    }
  }, [storageKey]);

  // Load the seen-set once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) seenRef.current = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  // Keep the queue mirror current (declared before the context effect so
  // the swap below still sees the outgoing queue).
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // Situation changed → offer its unseen tips. The very first pop waits a
  // beat so the scene can settle; later swaps are immediate.
  useEffect(() => {
    const outgoing = queueRef.current[0];
    if (outgoing) {
      seenRef.current.add(outgoing);
      persistSeen();
    }
    const fresh = hints
      .filter((h) => h.context === context && !seenRef.current.has(h.id))
      .map((h) => h.id);
    if (!bootedRef.current) {
      bootedRef.current = true;
      const t = window.setTimeout(() => startQueue(fresh), 1400);
      return () => window.clearTimeout(t);
    }
    startQueue(fresh);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  const current = queue[0] ?? null;
  const currentHint = current
    ? (hints.find((h) => h.id === current) ?? null)
    : null;

  const markSeen = useCallback(
    (id: string) => {
      seenRef.current.add(id);
      persistSeen();
    },
    [persistSeen],
  );

  // Auto-advance through the situation's queue; the last tip lingers a
  // little longer, then fades away.
  useEffect(() => {
    if (!current) return;
    const last = queue.length <= 1;
    const t = window.setTimeout(
      () => {
        markSeen(current);
        setQueue((q) => q.slice(1));
      },
      last ? LAST_LINGER_MS : AUTO_ADVANCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [current, queue.length, markSeen]);

  const advance = () => {
    if (current) markSeen(current);
    setQueue((q) => q.slice(1));
  };

  const skipAll = () => {
    queue.forEach(markSeen);
    setQueue([]);
  };

  // The lightbulb replays the CURRENT situation's tips, seen or not.
  const replay = () => {
    startQueue(hints.filter((h) => h.context === context).map((h) => h.id));
  };

  return (
    <>
      {currentHint && (
        <div
          key={currentHint.id}
          role="status"
          className={
            docked
              ? // Chat mode: dock to the bottom of the galaxy strip, desktop
                // only — phones run chat fullscreen and rest the chrome.
                "animate-panel-in fixed bottom-5 left-[calc(clamp(290px,33vw,460px)/2)] z-30 hidden w-[24rem] max-w-[calc(clamp(290px,33vw,460px)-1rem)] -translate-x-1/2 sm:block"
              : "animate-panel-in fixed left-1/2 top-[max(7rem,calc(env(safe-area-inset-top)+6rem))] z-30 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 sm:bottom-5 sm:top-auto"
          }
        >
          <div className="flex items-center gap-3 rounded-3xl border-2 border-dashed border-star/70 bg-space-deep/90 px-4 py-2.5 shadow-xl backdrop-blur-sm">
            <Sparkle
              className="h-5 w-5 shrink-0 animate-pulse text-star"
              aria-hidden
            />
            <p className="flex-1 font-hand text-xl font-bold uppercase leading-tight tracking-wider text-white">
              {currentHint.text}
            </p>
            {queueTotal > 1 && (
              <span className="shrink-0 font-display text-xs font-semibold text-white/50">
                {queueTotal - queue.length + 1}/{queueTotal}
              </span>
            )}
            <button
              type="button"
              onClick={advance}
              className="shrink-0 rounded-full bg-star px-3 py-1 font-hand text-lg font-bold uppercase leading-none tracking-wider text-space shadow transition-transform hover:scale-105 active:scale-95"
            >
              {queue.length <= 1 ? "Off you go!" : "Got it!"}
            </button>
            <button
              type="button"
              aria-label="Skip the hints"
              onClick={skipAll}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/20 hover:text-white sm:h-6 sm:w-6"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label="Show a hint for what you're doing"
        title="Hints"
        onClick={replay}
        className={
          docked
            ? // Strip's bottom-left corner, beside the docked controls.
              "fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-20 hidden h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 sm:flex"
            : "fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(4.5rem,calc(env(safe-area-inset-right)+3.5rem))] z-20 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
        }
      >
        <Lightbulb className="h-5 w-5" />
      </button>
    </>
  );
}
