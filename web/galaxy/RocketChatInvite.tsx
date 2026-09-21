import { MessageCircleHeart, X } from "lucide-react";

/**
 * The rocket's post-landing handshake: after the rocket touches down on a
 * star it offers to start a conversation with its new host. It wears the
 * same doodle-pill costume as the "visit the parent" and summon-rocket
 * pills — hand-lettered uppercase text, the host's sprite with a golden
 * corner badge, pop-in bounce — stacked below them, plus a small dismiss
 * cross since this offer stands until answered.
 */
export function RocketChatInvite({
  name,
  img,
  onChat,
  onDismiss,
}: {
  name: string;
  img: string;
  onChat: () => void;
  onDismiss: () => void;
}) {
  const label = `Chat with ${name}`;
  return (
    <div
      role="status"
      aria-label={label}
      className="pointer-events-auto animate-pop-in transition-transform hover:scale-105"
    >
      <div
        className="flex items-center gap-2.5 rounded-full border border-white/20 bg-space-deep/90 py-1.5 pl-2 pr-2 shadow-xl backdrop-blur-sm"
        title={label}
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          <img
            src={img}
            alt=""
            draggable={false}
            className="h-9 w-9 select-none rounded-full bg-space/60 object-contain p-0.5 ring-1 ring-white/25"
          />
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-star shadow">
            <MessageCircleHeart
              className="h-2.5 w-2.5 text-space-deep"
              strokeWidth={3}
              aria-hidden
            />
          </span>
        </span>
        <button
          type="button"
          onClick={onChat}
          className="max-w-[46vw] truncate font-hand text-2xl font-bold uppercase leading-none tracking-wider text-white transition-colors hover:text-star active:scale-95 sm:max-w-64"
        >
          Chat with <span className="text-star">{name}</span>?
        </button>
        <button
          type="button"
          aria-label="Dismiss chat suggestion"
          onClick={onDismiss}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white active:scale-95"
        >
          <X className="h-3.5 w-3.5" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
