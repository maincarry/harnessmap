import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, Rocket, Trash2, X } from "lucide-react";
import { MAX_BODY_NAME } from "./systemGenerator";

export interface BodyPanelChild {
  id: string;
  name: string;
  img: string;
}

export interface BodyPanelAdd {
  canAdd: boolean;
  actionLabel?: string | undefined;
  fullNote?: string | undefined;
}

export interface BodyPanelRocket {
  /** Parked on this body — or inbound to it while flying. */
  here: boolean;
  flying: boolean;
  onSummon: () => void;
}

export interface BodyPanelInfo {
  id: string;
  name: string;
  img: string;
  /** "Sun", "Planet", "Moon" or "Tiny moon". */
  kindLabel: string;
  /** Personality quote, shown in a dashed bubble. */
  line?: string | undefined;
  childrenLabel: string;
  childrenCap: number;
  children: BodyPanelChild[];
  add: BodyPanelAdd;
}

interface BodyInfoPanelProps {
  info: BodyPanelInfo;
  onAdd: () => void;
  /** Fly to a child body and open its own panel. */
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Summon the hero rocket to this body. */
  rocket?: BodyPanelRocket | undefined;
  /** Chat mode: the panel floats over the chat sheet instead of the galaxy. */
  chatMode?: boolean;
  /** "Say goodbye" — omitted for the sun and for the chat subject. */
  onDelete?: (() => void) | undefined;
  /** Pencil by the name: hand the body a new one (capped, never empty). */
  onRename?: ((name: string) => void) | undefined;
}

/**
 * The double-tap information panel: a card docked right on desktop, a
 * bottom sheet on phones, styled like the Navigator — deep-space glass, hand-lettered
 * Amatic SC names in quote marks, dashed golden accents. For the skeleton
 * UI it keeps only the portrait, the story, the children list, and the
 * single "grow this family" primary action.
 */
export function BodyInfoPanel({
  info,
  onAdd,
  onSelect,
  onClose,
  rocket,
  chatMode = false,
  onDelete,
  onRename,
}: BodyInfoPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Another body (or a rename landing) closes the editor.
  useEffect(() => setEditing(false), [info.id, info.name]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = () => {
    setDraft(info.name);
    setEditing(true);
  };
  const commitEdit = () => {
    // Tidy the input: no empty names, no double spaces, no head/tail
    // padding — the cap itself is enforced by the input's maxLength.
    const name = draft.trim().replace(/\s+/g, " ");
    setEditing(false);
    if (name && name !== info.name) onRename?.(name);
  };

  return (
    <aside
      aria-label={`About ${info.name}`}
      className={
        chatMode
          ? "animate-sheet-in fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] flex max-h-[52vh] flex-col overflow-hidden rounded-3xl border border-white/20 bg-space-deep/90 shadow-xl backdrop-blur-sm sm:animate-panel-in sm:bottom-3 sm:left-auto sm:right-3 sm:top-3 sm:max-h-none sm:w-80"
          : "animate-sheet-in fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex max-h-[52vh] flex-col overflow-hidden rounded-3xl border border-white/20 bg-space-deep/90 shadow-xl backdrop-blur-sm sm:animate-panel-in sm:bottom-auto sm:left-auto sm:right-4 sm:top-16 sm:max-h-[calc(100vh-7rem)] sm:w-72 sm:max-w-[calc(100vw-2rem)]"
      }
    >
      <div className="flex items-start gap-3 px-4 pb-2 pt-3">
        <img
          src={info.img}
          alt=""
          draggable={false}
          className="h-14 w-14 shrink-0 select-none rounded-full bg-space/60 object-contain p-1 ring-2 ring-star/70"
        />
        <div className="min-w-0 flex-1">
          <span className="font-hand text-sm font-bold uppercase tracking-[0.28em] text-white/60">
            {info.kindLabel}
          </span>
          {editing ? (
            <div className="mt-0.5 flex flex-col gap-1.5">
              <input
                ref={inputRef}
                value={draft}
                maxLength={MAX_BODY_NAME}
                aria-label={`Rename this ${info.kindLabel.toLowerCase()}`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="w-full min-w-0 rounded-xl border-2 border-dashed border-star/70 bg-space/70 px-2 py-0.5 font-hand text-2xl font-bold uppercase leading-tight tracking-wider text-star outline-none placeholder:text-white/30 focus:border-star"
                placeholder="Name it…"
              />
              <div className="flex items-center gap-1.5">
                <span
                  className={`font-hand text-base font-bold uppercase tracking-widest ${
                    draft.length >= MAX_BODY_NAME ? "text-star" : "text-white/45"
                  }`}
                >
                  {draft.length}/{MAX_BODY_NAME}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label="Save the new name"
                  title="Save name"
                  onClick={commitEdit}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-star text-space shadow transition-transform hover:scale-110 active:scale-95"
                >
                  <Check className="h-4 w-4" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  aria-label="Keep the old name"
                  title="Cancel"
                  onClick={() => setEditing(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-1">
              {/* Long names wrap whole words; an unbroken string still
                  breaks anywhere instead of flooding the panel. */}
              <h2 className="min-w-0 font-hand text-3xl font-bold uppercase leading-tight tracking-wider text-star [overflow-wrap:anywhere]">
                &ldquo;{info.name}&rdquo;
              </h2>
              {onRename && (
                <button
                  type="button"
                  aria-label={`Rename ${info.name}`}
                  title="Give it a new name"
                  onClick={startEdit}
                  className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-star/20 hover:text-star"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close the info panel"
          onClick={onClose}
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white sm:h-7 sm:w-7"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 pt-1 [touch-action:pan-y]">
        {info.line && (
          <p className="rounded-2xl border-2 border-dashed border-white/25 px-3 py-2 font-hand text-xl font-bold leading-snug text-white/90">
            &ldquo;{info.line}&rdquo;
          </p>
        )}

        <section>
          <h3 className="font-hand text-xl font-bold uppercase tracking-[0.18em] text-white/70">
            {info.childrenLabel}
            <span className="ml-1.5 text-star">
              {info.children.length}/{info.childrenCap}
            </span>
          </h3>
          {info.children.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {info.children.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className="flex w-full items-center gap-2.5 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-white/10 sm:py-1"
                  >
                    <img
                      src={c.img}
                      alt=""
                      draggable={false}
                      className="h-7 w-7 shrink-0 select-none rounded-full bg-space/60 object-contain p-0.5"
                    />
                    <span
                      title={c.name}
                      className="min-w-0 flex-1 truncate font-hand text-lg font-bold uppercase leading-none tracking-wider text-white"
                    >
                      &ldquo;{c.name}&rdquo;
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 font-hand text-lg font-bold uppercase tracking-wider text-white/40">
              Nothing orbiting yet
            </p>
          )}
        </section>

        {/* Summon the hero rocket — kept as a compact secondary action */}
        {rocket && !rocket.here && (
          <button
            type="button"
            onClick={rocket.onSummon}
            disabled={rocket.flying}
            className="flex w-full items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-star/60 px-4 py-1.5 font-hand text-xl font-bold uppercase leading-none tracking-wider text-star transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
          >
            <Rocket className="h-5 w-5" strokeWidth={2.5} />
            {rocket.flying ? "Rocket is flying…" : "Summon rocket"}
          </button>
        )}
        {rocket && rocket.here && (
          <p className="rounded-2xl border-2 border-dashed border-white/15 px-3 py-2 text-center font-hand text-lg font-bold uppercase leading-tight tracking-wider text-star">
            {rocket.flying ? "The rocket is on its way!" : "The rocket is parked here!"}
          </p>
        )}

        {/* The single primary action: grow this family */}
        <section className="rounded-2xl border-2 border-dashed border-star/60 bg-star/10 px-3 py-2.5">
          <h3 className="font-hand text-lg font-bold uppercase tracking-[0.18em] text-star">
            Grow this family
          </h3>
          {info.add.canAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-star px-4 py-1.5 font-hand text-2xl font-bold uppercase leading-none tracking-wider text-space shadow-md transition-transform hover:scale-105 active:scale-95"
            >
              <Plus className="h-5 w-5" strokeWidth={3} />
              {info.add.actionLabel}
            </button>
          ) : (
            <p className="mt-1 font-hand text-xl font-bold uppercase leading-tight tracking-wider text-star">
              {info.add.fullNote}
            </p>
          )}
        </section>

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/20 px-3 py-1.5 font-hand text-xl font-bold uppercase tracking-wider text-white/50 transition-colors hover:border-red-300/60 hover:bg-red-400/10 hover:text-red-200 active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
            Say goodbye
          </button>
        )}
      </div>
    </aside>
  );
}
