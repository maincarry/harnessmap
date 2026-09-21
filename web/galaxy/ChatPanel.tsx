import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import heroRocketImg from "@/assets/planets/hero-rocket.png";

export interface ChatSubjectInfo {
  id: string;
  name: string;
  img: string;
  line: string;
  kindLabel: string;
}

interface ChatMessage {
  from: "me" | "body";
  text: string;
}

/**
 * Small-talk pool. The first answer is always the body's own storybook
 * line; after that the conversation drifts through these quips.
 */
const QUIPS = [
  "Keep looking up — the view is great from here!",
  "My whole family lined up in the sky just to listen.",
  "Space weather report: calm, starry, slight chance of comets.",
  "Orbiting is just dancing that never ends.",
  "Did you hear the little rocket? Always looking for parking.",
  "I twinkle, therefore I am.",
  "Somewhere out there a baby moon is learning to wobble.",
];

const SUGGESTIONS = [
  "Hello!",
  "Tell me about yourself",
  "What's it like up there?",
];

interface ChatPanelProps {
  subject: ChatSubjectInfo;
  onClose: () => void;
  /** The rocket is still flying to this subject — the conversation (and
      its suggestions) only begin once it lands. */
  waiting?: boolean;
}

/**
 * Chat mode panel: a full-screen overlay on phones, a deep-space glass
 * column taking the right of the screen on desktop (the galaxy squeezes
 * into a strip beside it). Styled like the Navigator and info panel —
 * hand-lettered Amatic names, golden accents, dashed-star charm.
 */
export function ChatPanel({ subject, onClose, waiting = false }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const replyTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => window.clearTimeout(replyTimer.current), []);

  // Escape closes the chat, like any good door.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || typing || waiting) return;
    const replyCount = messages.filter((m) => m.from === "body").length;
    const reply =
      replyCount === 0
        ? subject.line
        : QUIPS[(replyCount - 1 + subject.id.length) % QUIPS.length]!;
    setMessages((m) => [...m, { from: "me", text }]);
    setDraft("");
    setTyping(true);
    replyTimer.current = window.setTimeout(() => {
      setMessages((m) => [...m, { from: "body", text: reply }]);
      setTyping(false);
    }, 650 + Math.random() * 550);
  };

  return (
    <aside
      aria-label={`Chat with ${subject.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-space-deep sm:static sm:inset-auto sm:z-auto sm:h-full sm:min-w-0 sm:flex-1 sm:border-l sm:border-white/20 sm:bg-space-deep/95 sm:backdrop-blur-sm"
    >
      {/* Header: who's talking */}
      <div className="flex items-center gap-3 border-b border-white/15 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <img
          src={subject.img}
          alt=""
          draggable={false}
          className="h-12 w-12 shrink-0 select-none rounded-full bg-space/60 object-contain p-1 ring-2 ring-star/70"
        />
        <div className="min-w-0 flex-1">
          <span className="font-hand text-xs font-bold uppercase tracking-[0.28em] text-white/60">
            {subject.kindLabel} · {waiting ? "rocket flying over" : "now chatting"}
          </span>
          <h2 className="truncate font-hand text-3xl font-bold uppercase leading-tight tracking-wider text-star">
            {subject.name}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={onClose}
          className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {waiting ? (
        /* The rocket carries the conversation — nobody answers until it
           lands, so the greeting and suggestions wait for touchdown. */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <img
            src={heroRocketImg}
            alt=""
            draggable={false}
            className="h-24 w-24 select-none object-contain animate-bounce [animation-duration:1.6s]"
          />
          <p className="font-hand text-4xl font-bold uppercase tracking-[0.12em] text-orbit-label">
            The little rocket is flying over…
          </p>
          <p className="max-w-xs font-display text-sm text-white/60 [overflow-wrap:anywhere]">
            {subject.name} answers as soon as the rocket lands.
          </p>
        </div>
      ) : messages.length === 0 ? (
        /* Empty state: big portrait + conversation starters */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <img
            src={subject.img}
            alt=""
            draggable={false}
            className="h-28 w-28 select-none rounded-full bg-space/60 object-contain p-2 ring-2 ring-star/50"
          />
          <p className="max-w-md font-hand text-4xl font-bold uppercase tracking-[0.12em] text-orbit-label [overflow-wrap:anywhere]">
            Say hi to {subject.name}!
          </p>
          <p className="max-w-xs font-display text-sm text-white/60">
            The whole family lined up in the sky strip to listen in.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-white/20 bg-space/60 px-4 py-2 font-display text-sm font-semibold text-white transition-transform hover:scale-105 active:scale-95"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Transcript */
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
        >
          {messages.map((m, i) =>
            m.from === "me" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-star px-3.5 py-2 font-display text-sm font-semibold text-space shadow-md">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-end gap-2">
                <img
                  src={subject.img}
                  alt=""
                  draggable={false}
                  className="h-8 w-8 shrink-0 select-none rounded-full bg-space/60 object-contain p-0.5 ring-1 ring-star/50"
                />
                <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-white/15 bg-space/60 px-3.5 py-2 font-display text-sm text-white/90">
                  {m.text}
                </div>
              </div>
            ),
          )}
          {typing && (
            <div className="flex items-end gap-2">
              <img
                src={subject.img}
                alt=""
                draggable={false}
                className="h-8 w-8 shrink-0 select-none rounded-full bg-space/60 object-contain p-0.5 ring-1 ring-star/50"
              />
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-white/15 bg-space/60 px-4 py-3">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-orbit-label"
                    style={{ animationDelay: `${d * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <form
        className="flex items-center gap-2 border-t border-white/15 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={waiting}
          placeholder={waiting ? "Waiting for the rocket…" : `Message ${subject.name}…`}
          aria-label={`Message ${subject.name}`}
          className="min-w-0 flex-1 rounded-full border border-white/20 bg-space/60 px-4 py-2.5 font-display text-sm text-white outline-none placeholder:text-white/40 focus:border-star/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={waiting || !draft.trim() || typing}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-star text-space shadow-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </aside>
  );
}
