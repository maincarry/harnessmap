import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, List, Sparkle, X } from "lucide-react";

export interface NavigatorEntry {
  id: string;
  name: string;
  img: string;
  /** Nested moons — and moons can have their own smaller moons. */
  moons?: NavigatorEntry[] | undefined;
}

export interface NavigatorRocket {
  img: string;
  /** Entry the chip sits on — the destination while the rocket flies. */
  hostId: string | null;
  flying: boolean;
  /** Move mode: the next pick (sun, planet or moon) becomes the destination. */
  armed: boolean;
  onChip: () => void;
  onDestination: (id: string) => void;
}

interface NavigatorProps {
  items: NavigatorEntry[];
  activeId: string | null;
  /** Body the camera is following right now — the "you are here" marker. */
  focusedId?: string | null;
  onSelect: (id: string) => void;
  /** Double-click an entry: fly there and open its information panel. */
  onInfo?: ((id: string) => void) | undefined;
  /** Bodies mid-goodbye animation — their entries dim and go inert. */
  departingIds?: string[] | undefined;
  rocket?: NavigatorRocket | undefined;
  /** Chat mode: slimmer panel listing only the bodies on screen; hidden on
      phones where the chat sheet already covers the whole display. */
  chatMode?: boolean;
}

/**
 * Top-left navigator: every body in the system listed as a small circular
 * "profile picture" plus its hand-lettered name in quote marks (Amatic SC,
 * the reference poster's lettering). Clicking an entry pans the camera to
 * the body, which hops once and flashes a dashed ring so you can spot it.
 * Moons nest under planets, and mini-moons nest under their moons, each
 * generation smaller, along a dashed connector line.
 *
 * The hero rocket appears as a small chip on the entry it's parked at.
 * Clicking the chip arms "move mode": the next body picked here becomes
 * the rocket's destination instead of a camera target. The rocket can
 * land on anything — sun, planet or moon — so every entry stays live.
 */
export function Navigator({ items, activeId, focusedId, onSelect, onInfo, departingIds, rocket, chatMode = false }: NavigatorProps) {
  // null = not yet decided. Phones start collapsed so the world stays
  // visible; desktop starts open. Decided after mount so SSR and
  // hydration render identical markup (no window reads during render).
  const [open, setOpen] = useState<boolean | null>(null);
  const [closing, setClosing] = useState(false);

  // Chat mode enters with the navigator folded away — the lined-up
  // family keeps the strip; one tap on the list button brings it back.
  useEffect(() => {
    setOpen(window.matchMedia("(min-width: 640px)").matches && !chatMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fold the menu away first, then swap to the round list button. */
  const collapse = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 210);
  };

  if (open === null) return null;

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open the navigator"
        title="Navigator"
        onClick={() => setOpen(true)}
        className={`animate-pop-in fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(4rem,calc(env(safe-area-inset-top)+3rem))] z-20 ${chatMode ? "hidden sm:flex" : "flex"} h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-space-deep/90 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105 active:scale-95`}
      >
        <List className="h-5 w-5" />
      </button>
    );
  }

  const armed = rocket?.armed ?? false;
  // Running cascade index — each entry (and each nested moon) steps in a
  // beat after the previous one whenever the menu (re)generates.
  let cascade = 0;

  const renderEntry = (entry: NavigatorEntry, depth: number) => {
    const focused = focusedId === entry.id;
    const departing = departingIds?.includes(entry.id) ?? false;
    // The rocket can park on any body, at any depth of the moon tree.
    const rocketHere = rocket?.hostId === entry.id;
    const handleClick = () => {
      if (departing) return;
      if (armed) {
        rocket!.onDestination(entry.id);
      } else {
        onSelect(entry.id);
      }
      // Chat mode and phones: the pick is done — fold back to the round
      // button so the fan (and the zoom-out pill) get the sky back.
      if (chatMode || !window.matchMedia("(min-width: 640px)").matches) {
        collapse();
      }
    };
    // Same storybook art style in every mode — chat mode only changes
    // WHICH bodies are listed, never how the entries look.
    const avatarSize =
      depth === 0 ? "h-9 w-9" : depth === 1 ? "h-7 w-7" : "h-6 w-6";
    const nameSize =
      depth === 0 ? "text-2xl" : depth === 1 ? "text-lg" : "text-base";
    return (
      <div className="relative">
        <button
          type="button"
          onClick={handleClick}
          onDoubleClick={() => {
            // Move mode owns clicks — a double-click there picks the
            // destination, it doesn't open the panel.
            if (!armed) onInfo?.(entry.id);
          }}
          aria-current={focused ? "true" : undefined}
          disabled={departing}
          className={`flex w-full items-center gap-2.5 rounded-2xl px-2.5 text-left transition-all duration-500 ${
            departing ? "scale-95 opacity-35 saturate-50" : ""
          } ${
            armed
              ? "cursor-pointer hover:bg-star/20 hover:ring-1 hover:ring-star/50"
              : "hover:bg-white/10"
          } ${
            focused
              ? "bg-star/15 ring-1 ring-star/60"
              : activeId === entry.id
                ? "bg-white/20"
                : ""
          } ${depth === 0 ? "py-2.5 sm:py-1.5" : "py-2 sm:py-1"} ${rocketHere ? "pr-10" : ""}`}
        >
          <img
            src={entry.img}
            alt=""
            draggable={false}
            className={`shrink-0 select-none rounded-full bg-space/60 object-contain p-0.5 ${avatarSize} ${
              focused ? "ring-2 ring-star" : ""
            }`}
          />
          {/* Long catalog names truncate to one line — the full name is
              a hover title away, and the info panel shows it in full. */}
          <span
            title={entry.name}
            className={`min-w-0 flex-1 truncate font-hand font-bold uppercase leading-none tracking-wider ${
              focused ? "text-star" : "text-white"
            } ${nameSize}`}
          >
            &ldquo;{entry.name}&rdquo;
          </span>
          {focused && (
            <Sparkle
              className="ml-auto h-4 w-4 shrink-0 animate-pulse text-star"
              aria-label="Camera is following"
            />
          )}
        </button>
        {rocketHere && rocket && (
          <button
            type="button"
            aria-label={
              armed
                ? "Cancel rocket move"
                : `Move the rocket (parked at ${entry.name})`
            }
            title={armed ? "Cancel rocket move" : "Move the rocket"}
            onClick={rocket.onChip}
            className={`absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-transform hover:scale-110 active:scale-95 sm:h-7 sm:w-7 ${
              armed ? "border-star bg-star/40" : "border-star/60 bg-star/15"
            } ${rocket.flying ? "animate-pulse" : ""}`}
          >
            <img
              src={rocket.img}
              alt=""
              draggable={false}
              className="h-4 w-4 rotate-45 object-contain"
            />
          </button>
        )}
      </div>
    );
  };

  /** One entry plus its nested moon tree, indented along a dashed line. */
  const renderItem = (item: NavigatorEntry, depth: number): ReactNode => {
    // Cap the cascade so long lists don't keep you waiting at the bottom.
    const delay = Math.min(cascade++, 14) * 42;
    return (
    <li
      key={item.id}
      className="nav-item-in flex flex-col gap-0.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      {renderEntry(item, depth)}
      {item.moons && item.moons.length > 0 && (
        <ul
          className={`flex flex-col gap-0.5 border-l-2 border-dashed border-white/40 pl-2 ${
            depth === 0 ? "ml-6" : "ml-5"
          }`}
        >
          {item.moons.map((m) => renderItem(m, depth + 1))}
        </ul>
      )}
    </li>
    );
  };

  return (
    <nav
      aria-label="System navigator"
      className={`${closing ? "nav-out" : "animate-pop-in"} fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(4rem,calc(env(safe-area-inset-top)+3rem))] z-20 ${chatMode ? "hidden sm:flex" : "flex"} max-h-[62vh] flex-col overflow-hidden rounded-3xl border border-white/20 bg-space-deep/90 shadow-xl backdrop-blur-sm ${
        chatMode
          ? // Fill the galaxy strip (its width minus the side margins).
            "w-[calc(clamp(290px,33vw,460px)-2rem)]"
          : "w-[min(15rem,calc(100vw-5rem))]"
      }`}
    >
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <span className="font-hand text-2xl font-bold uppercase tracking-[0.2em] text-white">
          {armed ? "Fly the rocket to…" : "Navigator"}
        </span>
        <div className="flex items-center gap-1">
          {armed && (
            <button
              type="button"
              aria-label="Cancel rocket move"
              onClick={rocket!.onChip}
              className="flex h-9 w-9 items-center justify-center rounded-full text-star transition-colors hover:bg-star/20 sm:h-7 sm:w-7"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            aria-label="Collapse the navigator"
            onClick={collapse}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white sm:h-7 sm:w-7"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {items.map((item) => renderItem(item, 0))}
      </ul>
    </nav>
  );
}
