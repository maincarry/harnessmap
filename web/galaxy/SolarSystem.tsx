import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "@tanstack/react-router";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { Dices, MessagesSquare, Minus, Palette, Plus, RotateCcw, Sparkle, Undo } from "lucide-react";
import heroRocketImg from "@/assets/planets/hero-rocket.png";
import { BACKGROUNDS } from "./backgrounds";
import { CENTER, DRIFTERS, MOON, PLANETS, SUN, WORLD } from "./planets";
import { BodyInfoPanel, type BodyPanelInfo } from "./BodyInfoPanel";
import { ChatPanel, type ChatSubjectInfo } from "./ChatPanel";
import {
  chaseChatTarget,
  chatEase,
  computeChatLayout,
  rideChatOrbit,
  rideChatOrbitExit,
  type ChatChaseState,
  type ChatChildInput,
  type ChatLayout,
  type ChatRideState,
} from "./chatLayout";
import { Drifter } from "./Drifter";
import { HeroRocket, ROCKET_H, rocketWorldScale } from "./HeroRocket";
import { HintGuide, type ContextualHint } from "./HintGuide";
import { Navigator, type NavigatorEntry } from "./Navigator";
import { Planet } from "./Planet";
import { RocketChatInvite } from "./RocketChatInvite";
import { RocketSummonInvite } from "./RocketSummonInvite";
import { warmSpritePool } from "./spritePool";
import { Starfield } from "./Starfield";
import { SuggestionStack } from "./SuggestionStack";
import { ZoomOutPill, type ZoomOutTarget } from "./ZoomOutPill";
import { recordCrashEvent, setCrashContext } from "@/lib/crash-reporter";

const TAU = Math.PI * 2;

/** The exploration tour, one hand-lettered tip at a time. */
const CLASSIC_HINTS: ContextualHint[] = [
  { id: "wander", context: "explore", text: "Drag to wander the galaxy — pinch or scroll to zoom!" },
  { id: "navigator", context: "explore", text: "The navigator finds anyone — double-tap a name for tales & tricks!" },
  { id: "palette", context: "explore", text: "Try the palette for new skies… or 'Make your own' galaxy!" },
  { id: "hello", context: "focused", text: "Tap a planet to make it bounce — tap it again quickly for its storybook page!" },
  { id: "zoom-out", context: "focused", text: "Visiting a world? The pill up top flies you back to its parent star!" },
  { id: "summon", context: "summon", text: "One tap sends the little rocket flying over — or drag it there yourself!" },
  { id: "rocket-home", context: "at-host", text: "The little rocket lives here — drag it onto another world, or tap its chip in the navigator!" },
  { id: "chat-link", context: "at-host", text: "Wherever the little rocket lands, that's who answers the chat!" },
  { id: "storybook", context: "storybook", text: "A world's page tells its tales — and can call the rocket over!" },
  { id: "armed", context: "rocket-armed", text: "Move mode! Tap any world — the rocket will fly straight to it!" },
  { id: "flight", context: "rocket-flight", text: "Wherever the little rocket lands, that's who answers the chat!" },
  { id: "chat", context: "chat", text: "The family lines up to listen in — wander the strip, the chat stays with the rocket's host!" },
];

/** Parked rocket stands on its host's upper-right shoulder. */
const PARK_ANGLE = (-80 * Math.PI) / 180;
const PARK_ROT = 10;
/** ...except on the sun: there is no ground to land on, so the rocket
    holds a slow orbit just above the surface, engine idling. */
const SUN_ORBIT_PERIOD = 46;
const SUN_ORBIT_STANDOFF = 1.05;
const SUN_ORBIT_FLAME = 0.45;

interface RocketFlight {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  toId: string;
  fromRot: number;
  startAt: number;
  dur: number;
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOutCubicFn = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
/** Shortest-path angle interpolation (degrees). */
const lerpAngle = (a: number, b: number, t: number) => {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
};

/** "One year: ~12 min" — orbit periods read better as minutes. */
const fmtPeriod = (s: number) =>
  s >= 120 ? `~${Math.round(s / 60)} min` : `~${Math.round(s)} s`;

/** Deterministic pseudo-random so SSR and hydration draw identical rings. */
function seeded(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * A hand-drawn ring: a closed path whose radius wobbles on two sine
 * frequencies, like a circle painted with a brush instead of a compass.
 */
function wobblyRing(cx: number, cy: number, r: number, seed: number): string {
  const rand = seeded(seed);
  const w1 = 2 + Math.floor(rand() * 3);
  const w2 = 5 + Math.floor(rand() * 4);
  const p1 = rand() * TAU;
  const p2 = rand() * TAU;
  const a1 = r * 0.012;
  const a2 = r * 0.007;
  const N = 96;
  let d = "";
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const rr = r + a1 * Math.sin(w1 * a + p1) + a2 * Math.cos(w2 * a + p2);
    d += `${i === 0 ? "M" : "L"}${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }
  return `${d} Z`;
}

interface RingStyle {
  d: string;
  dash: string;
  width: number;
  opacity: number;
  cx: number;
  cy: number;
}

/**
 * Each planet's ring gets its own hand-painted character: slightly
 * off-center, uneven dash length and gap, varied stroke weight.
 */
const RING_STYLES: RingStyle[] = PLANETS.map((p, i) => {
  const rand = seeded(i * 13 + 7);
  const cx = CENTER + (rand() - 0.5) * 26;
  const cy = CENTER + (rand() - 0.5) * 26;
  return {
    d: wobblyRing(cx, cy, p.orbitR, i * 7 + 3),
    dash: `${(34 + rand() * 14).toFixed(0)} ${(22 + rand() * 10).toFixed(0)}`,
    width: 10 + rand() * 3,
    opacity: 0.76 + rand() * 0.16,
    cx,
    cy,
  };
});

export function SolarSystem() {
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Body the camera is currently locked onto (navigator "you are here"). */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** Navigator "find me": dashed ring + single hop. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [jumpId, setJumpId] = useState<string | null>(null);
  /** Which hand-painted sky is showing; restored from localStorage after mount. */
  const [bgIndex, setBgIndex] = useState(0);
  /** Animation clock, seconds. Starts at 0 so SSR and hydration agree. */
  const [t, setT] = useState(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const highlightTimer = useRef<number | undefined>(undefined);
  const jumpTimer = useRef<number | undefined>(undefined);
  const squashTimer = useRef<number | undefined>(undefined);
  /** Auto-hide for the post-landing chat invite. */
  
  /** The rocket's live render pose — mid-flight re-targets launch from
      exactly here, never a teleport back to the old host. */
  const rocketPoseRef = useRef({ x: 0, y: 0, rot: 0 });
  /** Body the hero rocket is parked on (starts on the sun, where it orbits). */
  const [rocketHostId, setRocketHostId] = useState<string>(SUN.id);
  /** Navigator move mode: the next entry pick is the rocket's destination. */
  const [rocketArmed, setRocketArmed] = useState(false);
  /** Live flight, or null while parked. */
  const [flight, setFlight] = useState<RocketFlight | null>(null);
  /** Destination wearing a steady golden ring while the rocket flies. */
  const [rocketInboundId, setRocketInboundId] = useState<string | null>(null);
  const [landingSquash, setLandingSquash] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  /** Post-landing invite: a "Chat with <host>?" bubble over the rocket. */
  const [chatSuggestionId, setChatSuggestionId] = useState<string | null>(null);
  /** The open conversation's partner in chat mode: fixed when chat opens,
      switched only via the post-landing suggestion — the rocket landing
      elsewhere never hijacks the ongoing conversation. */
  const [chatTalkId, setChatTalkId] = useState<string | null>(null);
  /** Body currently showing its information panel. */
  const [infoId, setInfoId] = useState<string | null>(null);
  /** Chat mode: the family lines up in a sky strip beside the chat panel. */
  const [chatOpen, setChatOpen] = useState(false);
  /** Phone shrink for the rocket's fixed on-screen size — decided after
      mount so SSR and hydration render identical park positions. */
  const [rocketShrink, setRocketShrink] = useState(1);
  /** Double-tap detection on the focused body (tap → focus, double-tap → panel). */
  const lastTapRef = useRef<{ id: string; t: number } | null>(null);
  /** Live drag data — read every frame by the render loop. */
  const dragRef = useRef<{
    cur: { x: number; y: number };
    hover: string | null;
    startClient: { x: number; y: number };
    moved: boolean;
    lastX: number;
  } | null>(null);
  /** Alternates the flight arc's bend side. */
  const arcSideRef = useRef(1);
  /** Camera follow: keeps the navigator-picked body centered as it orbits. */
  const followRef = useRef<{
    id: string;
    scale: number;
    from: { x: number; y: number; scale: number };
    startAt: number;
  } | null>(null);
  const setTransformRef = useRef<((x: number, y: number, s: number, ms?: number) => void) | null>(null);
  const resetTransformRef = useRef<(() => void) | null>(null);
  /** Latest camera state, so a glide eases from exactly where the camera
      is now — even mid-flight from a previous pick. */
  const stateRef = useRef<{ positionX: number; positionY: number; scale: number } | null>(null);
  /** Chat column: subject + layout captured when chat opens. */
  const chatSubjectRef = useRef<{ info: ChatSubjectInfo; layout: ChatLayout } | null>(null);
  /** The star the fan is currently lined up around — the chat subject by
      default, re-focused by navigator picks while chat stays open. */
  const fanSubjectRef = useRef<{ id: string; layout: ChatLayout } | null>(null);
  /** True while the camera glides to the fan framing; false once the
      user owns the zoom for exploring inside the family. */
  const chatGlideRef = useRef(false);
  /** 0 = orbits, 1 = column — ramps while chat opens and closes. */
  const chatMixRef = useRef(0);
  /** Per-body rendered pose while the fan forms and dissolves (subject). */
  const chatRenderRef = useRef(new Map<string, ChatChaseState>());
  /** Polar chase state for chat children riding their morphing rings. */
  const chatRideRef = useRef(new Map<string, ChatRideState>());
  /** Per-body ring scale while the orbits rearrange into the fan. */
  const ringScaleRef = useRef(new Map<string, number>());
  /** Camera state captured when chat opens, glided back to on close. */
  const preChatCamRef = useRef<{ positionX: number; positionY: number; scale: number } | null>(null);
  /** The body chat was opened for (focus itself clears when chat opens). */
  const chatFocusRef = useRef<string | null>(null);
  /** The sky strip container — the chat camera frames inside it. */
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    // Phones get a 30fps clock — the ultra-slow orbits look identical and
    // the main thread does half the React work.
    const mobile = window.matchMedia("(max-width: 639px)").matches;
    let lastSet = 0;
    const loop = (now: number) => {
      if (!mobile || now - lastSet >= 33) {
        lastSet = now;
        setT((now - t0) / 1000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("galaxy-bg"));
    if (Number.isInteger(saved) && saved >= 0 && saved < BACKGROUNDS.length) {
      setBgIndex(saved);
    }
  }, []);

  // Flight recorder: last-known world state for the heartbeat.
  useEffect(() => {
    setCrashContext({
      system: "classic",
      bodies: 2 + PLANETS.length + DRIFTERS.length,
      bg: bgIndex,
      chat: chatOpen ? "open" : "closed",
    });
  }, [bgIndex, chatOpen]);

  // Warm the generator's sprite pool + all skies in the background, so
  // palette switches and hopping to "Make your own" never wait on loads.
  // Phones skip the full-pool warm: force-decoding ~50 large images at
  // once spikes memory hard enough to kill a mobile tab. Rendered sprites
  // load via their <img> tags; system swaps pre-decode via
  // ensureSpritesReady.
  useEffect(() => {
    if (window.innerWidth < 640) return;
    warmSpritePool(BACKGROUNDS.map((b) => b.src));
  }, []);

  // Phones open with the whole world in view instead of a 0.36x close-up:
  // one silent transform after mount (SSR keeps the desktop default).
  useEffect(() => {
    if (window.innerWidth >= 640) return;
    setRocketShrink(0.72);
    const s = Math.max(0.12, Math.min(0.36, (window.innerWidth / WORLD) * 1.02));
    setTransformRef.current?.(
      (window.innerWidth - WORLD * s) / 2,
      (window.innerHeight - WORLD * s) / 2,
      s,
      0,
    );
  }, []);

  const cycleBg = useCallback(() => {
    setBgIndex((i) => {
      const next = (i + 1) % BACKGROUNDS.length;
      window.localStorage.setItem("galaxy-bg", String(next));
      return next;
    });
  }, []);

  /** Any manual camera move takes control back from the follow mode. */
  const stopFollow = useCallback(() => {
    followRef.current = null;
    // In chat mode the focus marker belongs to the fan — zooming around
    // must not drop it (or the open info panel).
    if (chatMixRef.current > 0.004) return;
    setFocusedId(null);
  }, []);

  /** Wheel/pinch/zoom-button: in chat mode the user takes the zoom over
      from the fan's camera glide once the fan has settled. */
  const chatUserZoom = () => {
    stopFollow();
    if (chatMixRef.current > 0.9) chatGlideRef.current = false;
  };

  /** Open chat mode: the rocket decides who we chat with. A zoomed body
      summons the rocket over first; with nothing zoomed we chat with the
      body the rocket is parked on (or flying to). The subject anchors the
      bottom of the strip and its children line up above it. */
  const openChat = (subjectOverride?: string) => {
    if (chatOpen) return;
    const rocketAt = flight ? flight.toId : rocketHostId;
    const subjectId = subjectOverride ?? focusedId ?? rocketAt;
    chatFocusRef.current = subjectId;
    stopFollow();
    // The fan's focus marker starts on the chat subject.
    setFocusedId(subjectId);
    setInfoId(null);
    setRocketArmed(false);
    setChatSuggestionId(null);
    // The conversation opens with the subject the rocket flies to.
    setChatTalkId(subjectId);
    const st = stateRef.current;
    preChatCamRef.current = st
      ? { positionX: st.positionX, positionY: st.positionY, scale: st.scale }
      : null;
    chatSubjectRef.current = null;
    fanSubjectRef.current = null; // the fan re-forms around this star
    chatGlideRef.current = true;
    chatRenderRef.current.clear();
    chatRideRef.current.clear();
    ringScaleRef.current.clear();
    setChatOpen(true);
    // Summon the rocket to the chat subject — it carries the conversation.
    if (subjectId !== rocketAt) summonRocketTo(subjectId);
    recordCrashEvent("chat-open", { focused: subjectId });
  };

  const closeChat = () => {
    if (!chatOpen) return;
    setChatOpen(false);
    setChatTalkId(null);
    recordCrashEvent("chat-close", {});
  };

  /** Navigator entries: the Sun, then every planet (Earth carries the Moon). */
  const navItems: NavigatorEntry[] = [
    { id: SUN.id, name: SUN.name, img: SUN.img },
    ...PLANETS.map((p) => ({
      id: p.id,
      name: p.name,
      img: p.img,
      moons:
        p.id === "earth"
          ? [{ id: MOON.id, name: MOON.name, img: MOON.img }]
          : undefined,
    })),
  ];

  // Orbit math: every planet advances along its ring at its own speed.
  const positions = new Map<string, { x: number; y: number }>();
  for (const p of PLANETS) {
    const a = p.startAngle + (t * TAU) / p.period;
    positions.set(p.id, {
      x: CENTER + p.orbitR * Math.cos(a),
      y: CENTER + p.orbitR * Math.sin(a),
    });
  }
  for (const d of DRIFTERS) {
    const a = d.startAngle + (d.dir * t * TAU) / d.period;
    positions.set(d.id, {
      x: CENTER + d.orbitR * Math.cos(a),
      y: CENTER + d.orbitR * Math.sin(a),
    });
  }
  let earth = positions.get("earth") ?? { x: CENTER, y: CENTER };
  const moonAngle = (t * TAU) / MOON.period;
  let moonPos = {
    x: earth.x + MOON.orbitR * Math.cos(moonAngle),
    y: earth.y + MOON.orbitR * Math.sin(moonAngle),
  };

  /** Current world position of any navigator-listed body. */
  const bodyPos = (id: string) =>
    id === SUN.id
      ? { x: CENTER, y: CENTER }
      : id === MOON.id
        ? moonPos
        : (positions.get(id) ?? null);

  // --- Chat mode: line the family up in the sky strip -------------------
  // The mix ramps 0→1 while chat opens and back when it closes; bodies in
  // the chat set chase a blend of their live orbit pose and their column
  // slot, so they glide smoothly in both directions.
  const chatMixTarget = chatOpen ? 1 : 0;
  chatMixRef.current += (chatMixTarget - chatMixRef.current) * 0.12;
  if (!chatOpen && chatMixRef.current < 0.004) {
    chatMixRef.current = 0;
    chatSubjectRef.current = null;
    fanSubjectRef.current = null;
    chatGlideRef.current = false;
    chatRenderRef.current.clear();
    chatRideRef.current.clear();
    ringScaleRef.current.clear();
    preChatCamRef.current = null;
  }
  const chatMix = chatMixRef.current;
  const chatActive = chatMix > 0.004;

  /** Current sky-strip size, with a sane fallback before first layout. */
  const stripSize = () => {
    const r = stripRef.current?.getBoundingClientRect();
    if (r && r.width > 20 && r.height > 20) return { w: r.width, h: r.height };
    if (typeof window === "undefined") return { w: 400, h: 800 };
    return { w: Math.min(460, window.innerWidth), h: window.innerHeight };
  };

  /** Subject glide: the focused body leaves its orbit for the fan base
      at the bottom of the strip (frame-guarded chase). */
  const chatAdjustSubject = (id: string, x: number, y: number, size: number) => {
    const subj = fanSubjectRef.current;
    if (!subj || chatMixRef.current <= 0.004) return { x, y, size };
    const slot = subj.layout.slots.get(id);
    if (!slot) return { x, y, size };
    const e = chatEase(chatMixRef.current);
    const r = chaseChatTarget(
      chatRenderRef.current,
      id,
      { x, y, size },
      {
        x: x + (slot.x - x) * e,
        y: y + (slot.y - y) * e,
        size: size + (slot.size - size) * e,
      },
      t,
    );
    return { x: r.x, y: r.y, size: r.size };
  };

  /** Child ride: a chat-set body travels along its own orbit ring while
      the ring morphs into its fan arc — body and ring always agree. */
  const chatRide = (
    id: string,
    cx: number,
    cy: number,
    angle: number,
    orbitR: number,
    size: number,
    parentId?: string,
  ) => {
    const subj = fanSubjectRef.current;
    const mix = chatMixRef.current;
    const live = {
      x: cx + orbitR * Math.cos(angle),
      y: cy + orbitR * Math.sin(angle),
      size,
    };
    if (!subj || mix <= 0.004) return live;
    const slot = subj.layout.slots.get(id);
    if (!slot || id === subj.layout.parentId) {
      if (id !== subj.layout.parentId) {
        const circ = (aa: number) => ({
          x: orbitR * Math.cos(aa),
          y: orbitR * Math.sin(aa),
        });
        // Just left the fan (it re-focused on another star): glide home
        // along the ring instead of snapping back onto the orbit.
        if (chatRideRef.current.has(id)) {
          const r = rideChatOrbitExit(
            chatRideRef.current,
            id,
            cx,
            cy,
            angle,
            circ,
            size,
            t,
          );
          if (r.done) ringScaleRef.current.delete(id);
          else ringScaleRef.current.set(id, r.ringScale);
          return { x: r.x, y: r.y, size: r.size };
        }
        // A former fan subject glides straight back to its live pose.
        if (chatRenderRef.current.has(id)) {
          const c = chaseChatTarget(chatRenderRef.current, id, live, live, t);
          if (
            Math.abs(c.x - live.x) + Math.abs(c.y - live.y) < 2 &&
            Math.abs(c.size - live.size) < 1
          ) {
            chatRenderRef.current.delete(id);
          }
          return { x: c.x, y: c.y, size: c.size };
        }
        // A moon not in the fan keeps orbiting its parent, tightened so
        // it never swings under the chat panel — eased so entering this
        // band never snaps.
        if (parentId !== undefined) {
          const k = 1 - 0.45 * chatEase(mix);
          const prev = ringScaleRef.current.get(id);
          const next =
            prev !== undefined && Math.abs(prev - k) > 0.008
              ? prev + (k - prev) * 0.16
              : k;
          ringScaleRef.current.set(id, next);
          return {
            x: cx + orbitR * next * Math.cos(angle),
            y: cy + orbitR * next * Math.sin(angle),
            size,
          };
        }
      }
      ringScaleRef.current.delete(id);
      return live;
    }
    // Seed the ride from the ring's current scale so a body sliding out
    // of the compressed band doesn't snap out to its full orbit first.
    if (!chatRideRef.current.has(id)) {
      const rs = ringScaleRef.current.get(id);
      if (rs !== undefined) {
        chatRideRef.current.set(id, { angle, scale: rs, size, frame: t });
      }
    }
    const r = rideChatOrbit(
      chatRideRef.current,
      id,
      cx,
      cy,
      angle,
      (aa) => ({ x: orbitR * Math.cos(aa), y: orbitR * Math.sin(aa) }),
      size,
      slot,
      mix,
      t,
    );
    ringScaleRef.current.set(id, r.ringScale);
    return { x: r.x, y: r.y, size: r.size };
  };

  /** Re-solve the fan for the current strip size (the strip animates to
      its chat width, and the window may move while chat is open). */
  const rebuildChatLayout = () => {
    const fan = fanSubjectRef.current;
    if (!fan) return;
    const id = fan.id;
    const anchor = fan.layout.anchor;
    const strip = stripSize();
    if (id === SUN.id) {
      fan.layout = computeChatLayout(
        SUN.id,
        anchor,
        SUN.size,
        PLANETS.map((pp) => ({ id: pp.id, size: pp.size, name: pp.name })),
        strip.w,
        strip.h,
      );
      return;
    }
    if (id === MOON.id) {
      fan.layout = computeChatLayout(MOON.id, anchor, MOON.size, [], strip.w, strip.h);
      return;
    }
    const p = PLANETS.find((pp) => pp.id === id);
    if (p) {
      fan.layout = computeChatLayout(
        p.id,
        anchor,
        p.size,
        p.id === "earth" ? [{ id: MOON.id, size: MOON.size, name: MOON.name }] : [],
        strip.w,
        strip.h,
      );
    }
  };

  /**
   * Chat-mode zoom-in on a specific star: the fan re-forms around it —
   * it anchors the bottom of the strip where it stands right now and its
   * own children line up above, while the previous fan glides home.
   */
  const focusChatFan = (id: string) => {
    const anchor = bodyPos(id);
    if (!anchor) return;
    const strip = stripSize();
    let size: number;
    let kids: ChatChildInput[];
    if (id === SUN.id) {
      size = SUN.size;
      kids = PLANETS.map((pp) => ({ id: pp.id, size: pp.size, name: pp.name }));
    } else if (id === MOON.id) {
      size = MOON.size;
      kids = [];
    } else {
      const p = PLANETS.find((pp) => pp.id === id);
      if (!p) return;
      size = p.size;
      kids =
        p.id === "earth"
          ? [{ id: MOON.id, size: MOON.size, name: MOON.name }]
          : [];
    }
    fanSubjectRef.current = {
      id,
      layout: computeChatLayout(id, anchor, size, kids, strip.w, strip.h),
    };
    chatGlideRef.current = true;
  };

  // Build the subject once per opening: whatever held focus (the sun by
  // default), anchored where it is right now.
  if (chatOpen && !chatSubjectRef.current) {
    const fid = chatFocusRef.current;
    let subject: { info: ChatSubjectInfo; layout: ChatLayout } | null = null;
    if (fid === MOON.id) {
      subject = {
        info: { id: MOON.id, name: MOON.name, img: MOON.img, line: MOON.line, kindLabel: "Moon" },
        layout: computeChatLayout(MOON.id, moonPos, MOON.size, [], stripSize().w, stripSize().h),
      };
    } else {
      const p = fid ? PLANETS.find((pp) => pp.id === fid) : undefined;
      if (p) {
        const anchor = positions.get(p.id) ?? { x: CENTER, y: CENTER };
        subject = {
          info: { id: p.id, name: p.name, img: p.img, line: p.line, kindLabel: "Planet" },
          layout: computeChatLayout(
            p.id,
            anchor,
            p.size,
            p.id === "earth" ? [{ id: MOON.id, size: MOON.size, name: MOON.name }] : [],
            stripSize().w,
            stripSize().h,
          ),
        };
      }
    }
    if (!subject) {
      subject = {
        info: { id: SUN.id, name: SUN.name, img: SUN.img, line: SUN.line, kindLabel: "Star" },
        layout: computeChatLayout(
          SUN.id,
          { x: CENTER, y: CENTER },
          SUN.size,
          PLANETS.map((pp) => ({ id: pp.id, size: pp.size, name: pp.name })),
          stripSize().w,
          stripSize().h,
        ),
      };
    }
    chatSubjectRef.current = subject;
    fanSubjectRef.current = { id: subject.info.id, layout: subject.layout };
  }
  const chatSubj = chatSubjectRef.current;
  const fanSubj = fanSubjectRef.current;

  // In chat mode the navigator lists only the family on screen: the
  // subject at the top with its children nested below.
  const chatNavItems: NavigatorEntry[] = (() => {
    // The navigator lists the family currently on screen — the fanned
    // star (which may differ from the chat subject after a re-focus).
    const id = fanSubj?.id ?? chatSubj?.info.id;
    if (!id) return navItems;
    if (id === SUN.id) return navItems; // the whole system is on screen
    if (id === MOON.id) return [{ id: MOON.id, name: MOON.name, img: MOON.img }];
    const entry = navItems.find((e) => e.id === id);
    return entry ? [entry] : navItems;
  })();

  // Chat-set planets render at their chased pose; the Moon rides Earth's
  // rendered pose, then takes its own slot if it is a chat child. Bodies
  // that just left the fan (it re-focused on another star) glide back to
  // their live orbits instead of snapping.
  if (fanSubj && chatActive) {
    for (const p of PLANETS) {
      const inFan = fanSubj.layout.slots.has(p.id);
      const wasSubject = chatRenderRef.current.has(p.id);
      const wasRiding = chatRideRef.current.has(p.id);
      if (!inFan && !wasSubject && !wasRiding) continue;
      const q = positions.get(p.id);
      if (!q) continue;
      const a = p.startAngle + (t * TAU) / p.period;
      // chatRide covers fan slots, exit glides and former subjects.
      const r =
        p.id === fanSubj.layout.parentId
          ? chatAdjustSubject(p.id, q.x, q.y, p.size)
          : chatRide(p.id, CENTER, CENTER, a, p.orbitR, p.size);
      positions.set(p.id, { x: r.x, y: r.y });
    }
    earth = positions.get("earth") ?? earth;
    const rm =
      MOON.id === fanSubj.layout.parentId
        ? chatAdjustSubject(
            MOON.id,
            earth.x + MOON.orbitR * Math.cos(moonAngle),
            earth.y + MOON.orbitR * Math.sin(moonAngle),
            MOON.size,
          )
        : chatRide(MOON.id, earth.x, earth.y, moonAngle, MOON.orbitR, MOON.size, "earth");
    moonPos = { x: rm.x, y: rm.y };
  }
  const moonChatSize =
    chatRenderRef.current.get(MOON.id)?.size ??
    chatRideRef.current.get(MOON.id)?.size ??
    MOON.size;

  /**
   * World-pixel radius the camera should frame for a navigator pick:
   * the sun gets every planet ring, a planet gets its moon's ring
   * (or just its own disc when it has no moons), a moon its own disc.
   */
  const frameRadius = (id: string): number => {
    if (id === SUN.id) {
      return Math.max(...PLANETS.map((p) => p.orbitR + p.size / 2)) + 80;
    }
    if (id === MOON.id) return MOON.size * 1.6;
    const p = PLANETS.find((pp) => pp.id === id);
    if (!p) return 200;
    const own = p.size * 1.15;
    return p.id === "earth"
      ? Math.max(own, MOON.orbitR + MOON.size / 2 + 60)
      : own;
  };

  // Camera follow, chase-cam style: every frame we ease from the camera
  // state captured at click time toward the body's *current* position, so
  // the glide bends with the moving body and lands exactly on it — no
  // end-of-glide snap. After the glide the body stays pinned to center.
  useEffect(() => {
    // Chat mode owns the camera while the column is up.
    if (chatMixRef.current > 0.004) return;
    const f = followRef.current;
    const apply = setTransformRef.current;
    if (!f || !apply) return;
    const q = bodyPos(f.id);
    if (!q) {
      followRef.current = null;
      return;
    }
    const tx = window.innerWidth / 2 - q.x * f.scale;
    const ty = window.innerHeight / 2 - q.y * f.scale;
    const p = Math.min(1, (performance.now() - f.startAt) / 650);
    if (p >= 1) {
      apply(tx, ty, f.scale, 0);
      return;
    }
    // easeInOutCubic
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    apply(
      f.from.x + (tx - f.from.x) * e,
      f.from.y + (ty - f.from.y) * e,
      f.from.scale + (f.scale - f.from.scale) * e,
      0,
    );
  }, [t]);

  // Chat-mode camera: while chat is open the camera chases the fan
  // framing inside the sky strip; while it closes it glides back to the
  // pre-chat view. Once the fan has settled the user owns the zoom —
  // wheel/pinch can zoom IN freely, but zooming out stops at the fan
  // framing (the family stays on screen; no drifting off to other
  // stars), where the camera re-locks onto the fan.
  useEffect(() => {
    if (!chatActive) return;
    const fan = fanSubjectRef.current;
    const apply = setTransformRef.current;
    const st = stateRef.current;
    if (!fan || !apply || !st) return;
    let target: { posX: number; posY: number; scale: number } | null = null;
    if (chatOpen) {
      const rect = stripRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 20 || rect.height < 20) return;
      // The strip is still animating to its chat width (or the window
      // moved): re-solve the fan so slots and camera track it.
      if (
        Math.abs(fan.layout.stripW - rect.width) > 2 ||
        Math.abs(fan.layout.stripH - rect.height) > 2
      ) {
        rebuildChatLayout();
        chatGlideRef.current = true;
      }
      const lay = fan.layout;
      const settled = chatMixRef.current > 0.9;
      if (!chatGlideRef.current && settled) {
        // The user is exploring zoomed-in — the camera is theirs until
        // they come all the way back out to the fan framing.
        if (st.scale > lay.camera.scale * 1.03) return;
        chatGlideRef.current = true;
      }
      target = lay.camera;
    } else if (preChatCamRef.current) {
      const pre = preChatCamRef.current;
      target = { posX: pre.positionX, posY: pre.positionY, scale: pre.scale };
    }
    if (!target) return;
    const dx = target.posX - st.positionX;
    const dy = target.posY - st.positionY;
    const ds = target.scale - st.scale;
    if (Math.abs(dx) + Math.abs(dy) > 0.5 || Math.abs(ds) > 0.001) {
      apply(
        st.positionX + dx * 0.14,
        st.positionY + dy * 0.14,
        st.scale + ds * 0.14,
        0,
      );
    } else if (chatOpen) {
      // Arrived — from here the user may zoom in; the fan waits below.
      chatGlideRef.current = false;
    }
  });

  /** Glide the camera so the body and everything orbiting it fits. */
  const focusCamera = (id: string) => {
    const q = bodyPos(id);
    if (!q) return;
    const fit =
      (Math.min(window.innerWidth, window.innerHeight) * 0.82) /
      (2 * frameRadius(id));
    const s = Math.min(Math.max(fit, 0.16), 1.35);
    const st = stateRef.current;
    followRef.current = {
      id,
      scale: s,
      from: st
        ? { x: st.positionX, y: st.positionY, scale: st.scale }
        : {
            x: window.innerWidth / 2 - q.x * s,
            y: window.innerHeight / 2 - q.y * s,
            scale: s,
          },
      startAt: performance.now(),
    };
    setFocusedId(id);
  };

  /**
   * Navigator click or direct planet tap: zoom so the body and everything
   * orbiting it fits (the sun with all planet rings, a planet with its
   * moon rings), glide there, keep it centered, pop its speech bubble,
   * hop once, flash a dashed ring, and mark it in the navigator.
   */
  const handleNavigate = (id: string) => {
    const q = bodyPos(id);
    if (!q) return;
    recordCrashEvent("navigate", id);
    setInfoId(null);
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(jumpTimer.current);
    window.clearTimeout(highlightTimer.current);
    setActiveId(id);
    setJumpId(id);
    setHighlightId(id);
    jumpTimer.current = window.setTimeout(() => setJumpId(null), 850);
    hideTimer.current = window.setTimeout(() => setActiveId(null), 2800);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 2800);
    // In chat mode the picked star becomes the fan's focus: the camera
    // glides over and its own children line up above it. The hop, ring
    // and bubble still play along the way.
    if (chatOpen) {
      setFocusedId(id);
      focusChatFan(id);
    } else {
      focusCamera(id);
    }
  };

  /** Double-tap on the focused body: open its information panel. */
  const openInfo = (id: string) => {
    window.clearTimeout(hideTimer.current);
    setActiveId(null);
    setInfoId(id);
  };

  /** Panel child-row click: fly to that body and open its own panel. */
  const handleInfoSelect = (id: string) => {
    handleNavigate(id);
    setInfoId(id);
  };

  /**
   * Body tap with double-tap detection: a quick second tap on the body
   * that holds camera focus opens its information panel. The first tap
   * still does its usual happy jump — the panel simply replaces it.
   */
  const handleBodyTap = (id: string) => {
    const now = Date.now();
    const last = lastTapRef.current;
    lastTapRef.current = { id, t: now };
    // In chat mode there is no camera focus, so a quick second tap on any
    // lined-up body opens its page. Outside chat the body must hold focus.
    if (last?.id === id && now - last.t < 450 && (chatOpen || focusedId === id)) {
      lastTapRef.current = null;
      openInfo(id);
      return;
    }
    handleNavigate(id);
  };

  /** Display size of any landable body. */
  const bodySize = (id: string): number | null => {
    // While the chat column forms, chat-set bodies render at slot size.
    const cr = chatRenderRef.current.get(id);
    if (cr && chatMixRef.current > 0.004) return cr.size;
    if (id === SUN.id) return SUN.size;
    if (id === MOON.id) return MOON.size;
    const p = PLANETS.find((pp) => pp.id === id);
    return p ? p.size : null;
  };

  /** Where the parked rocket rests: for planets and the moon, the host's
      upper-right shoulder; for the sun, a point on its slow orbit loop.
      The standoff matches the rocket's world-space footprint — which
      only counter-scales when zoomed IN (see rocketWorldScale). */
  const parkPos = (id: string): { x: number; y: number } | null => {
    const c = bodyPos(id);
    const s = bodySize(id);
    if (!c || !s) return null;
    const k = rocketWorldScale(stateRef.current?.scale ?? 1, rocketShrink);
    if (id === SUN.id) {
      const r = s / 2 + ROCKET_H * SUN_ORBIT_STANDOFF * k;
      const a = PARK_ANGLE + (t * TAU) / SUN_ORBIT_PERIOD;
      return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    }
    const r = s / 2 + ROCKET_H * 0.4 * k;
    return {
      x: c.x + r * Math.cos(PARK_ANGLE),
      y: c.y + r * Math.sin(PARK_ANGLE),
    };
  };

  /** Nose heading (deg, 0 = up) along the sun-orbit tangent right now. */
  const sunOrbitRot = () => {
    const a = PARK_ANGLE + (t * TAU) / SUN_ORBIT_PERIOD;
    return (Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI + 90;
  };

  // Flight completion: the rocket becomes parked on its destination,
  // squashes on touchdown and flashes the golden finder ring. Sun
  // arrivals don't squash — the rocket slides into its orbit loop.
  useEffect(() => {
    if (!flight) return;
    if (performance.now() < flight.startAt + flight.dur) return;
    const dest = flight.toId;
    setFlight(null);
    setRocketHostId(dest);
    setRocketInboundId(null);
    recordCrashEvent("rocket-land", { on: dest });
    setCrashContext({ rocket: `parked:${dest}` });
    if (dest !== SUN.id) {
      setLandingSquash(true);
      window.clearTimeout(squashTimer.current);
      squashTimer.current = window.setTimeout(() => setLandingSquash(false), 600);
    }
    window.clearTimeout(highlightTimer.current);
    setHighlightId(dest);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 2800);
    // Every touchdown follows the same handshake: only after the rocket has
    // arrived does it offer a chat with its new host, in either view — and
    // the offer stands until it is answered (accepted or dismissed) or the
    // rocket lands somewhere else. Arriving and re-arriving both ask.
    setChatSuggestionId(dest);
  }, [t, flight, chatOpen]);

  /**
   * Launch the rocket along a hand-drawn arc. The end point is the
   * destination's park spot recomputed every frame, so the rocket homes
   * in on its target even while that body keeps orbiting.
   */
  const launchRocket = (
    from: { x: number; y: number },
    fromRot: number,
    toId: string,
  ) => {
    const end = parkPos(toId);
    if (!end) return;
    const dist = Math.hypot(end.x - from.x, end.y - from.y);
    const dur = Math.min(3.4, Math.max(1.15, dist / 1500)) * 1000;
    arcSideRef.current *= -1;
    // Even a near-zero hop flies — dropping right on the moon's park
    // spot must still land there. Guard the degenerate zero-length normal.
    const nx = dist > 1 ? -(end.y - from.y) / dist : 0;
    const ny = dist > 1 ? (end.x - from.x) / dist : -1;
    const lift = Math.min(430, Math.max(120, dist * 0.26)) * arcSideRef.current;
    setFlight({
      fx: from.x,
      fy: from.y,
      cx: (from.x + end.x) / 2 + nx * lift,
      cy: (from.y + end.y) / 2 + ny * lift,
      toId,
      fromRot,
      startAt: performance.now(),
      dur,
    });
    setRocketInboundId(toId);
    recordCrashEvent("rocket-launch", { to: toId });
    setCrashContext({ rocket: `flying->${toId}` });
  };

  /**
   * Send the rocket to a body — re-targeting smoothly even mid-flight:
   * the new arc starts from the rocket's live pose, never a teleport
   * back to the old host. Chat entry may summon it once; later chat
   * navigation changes only the family view, never the rocket's host.
   */
  const summonRocketTo = (id: string) => {
    if (dragRef.current) return;
    if (!getPanelInfo(id)) return;
    if (flight ? flight.toId === id : rocketHostId === id) return;
    const pose = rocketPoseRef.current;
    const from = flight
      ? { x: pose.x, y: pose.y }
      : (parkPos(rocketHostId) ?? { x: pose.x, y: pose.y });
    launchRocket(
      from,
      flight ? pose.rot : rocketHostId === SUN.id ? sunOrbitRot() : PARK_ROT,
      id,
    );
  };

  /** Navigator move mode / panel summon: send the rocket to the picked
      body — sun, planet or moon. */
  const handleRocketDestination = (id: string) => {
    setRocketArmed(false);
    setInfoId(null);
    if (flight ? flight.toId === id : id === rocketHostId) return;
    summonRocketTo(id);
    if (!chatOpen) focusCamera(id);
  };

  /** Client px → world px using the live pan/zoom transform. */
  const toWorld = (clientX: number, clientY: number) => {
    const st = stateRef.current;
    if (!st) return { x: clientX, y: clientY };
    return {
      x: (clientX - st.positionX) / st.scale,
      y: (clientY - st.positionY) / st.scale,
    };
  };

  /** Nearest landable body under a dragged point, if any. The moon
      counts too — the minimum grab radius is zoom-aware so it stays
      grabbable when zoomed in. */
  const pickHover = (w: { x: number; y: number }): string | null => {
    const scale = stateRef.current?.scale ?? 1;
    let best: string | null = null;
    let bestD = Infinity;
    const consider = (id: string) => {
      const c = bodyPos(id);
      const s = bodySize(id);
      if (!c || !s) return;
      const d = Math.hypot(w.x - c.x, w.y - c.y);
      if (d < Math.max((s / 2) * 1.25, 70 / scale) && d < bestD) {
        best = id;
        bestD = d;
      }
    };
    consider(SUN.id);
    for (const p of PLANETS) consider(p.id);
    consider(MOON.id);
    return best;
  };

  /**
   * Drag the rocket: a capture-phase pointerdown keeps the camera from
   * panning, then window listeners track the drag. Dropping on a body
   * flies the rocket there; dropping on empty sky flies it back home.
   */
  const onRocketDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // No rocket games while the family is lined up for chat.
    if (chatMixRef.current > 0.004) return;
    e.stopPropagation();
    e.preventDefault();
    stopFollow();
    const w = toWorld(e.clientX, e.clientY);
    dragRef.current = {
      cur: w,
      hover: null,
      startClient: { x: e.clientX, y: e.clientY },
      moved: false,
      lastX: w.x,
    };
    setDragActive(true);
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.cur = toWorld(ev.clientX, ev.clientY);
      if (
        Math.hypot(ev.clientX - d.startClient.x, ev.clientY - d.startClient.y) >
        8
      ) {
        d.moved = true;
      }
      d.hover = pickHover(d.cur);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDragActive(false);
      if (!d) return;
      d.cur = toWorld(ev.clientX, ev.clientY);
      const target = d.hover ?? pickHover(d.cur);
      if (target && target !== rocketHostId) {
        launchRocket(d.cur, 0, target);
        focusCamera(target);
      } else if (d.moved) {
        launchRocket(d.cur, 0, rocketHostId);
      } else if (rocketHostId !== SUN.id) {
        // A gentle tap: a little squash hello (not while orbiting the
        // sun — there is no ground to bounce on).
        setLandingSquash(true);
        window.clearTimeout(squashTimer.current);
        squashTimer.current = window.setTimeout(
          () => setLandingSquash(false),
          600,
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** Everything the information panel shows about a body. The classic
      family is hand-made and complete, so growing and goodbyes live in
      the Generator — the panel says so instead of offering them. */
  const getPanelInfo = (id: string): BodyPanelInfo | null => {
    const add = {
      canAdd: false,
      fullNote: "This classic family is complete — the Generator grows new ones!",
    };
    if (id === SUN.id) {
      return {
        id,
        name: SUN.name,
        img: SUN.img,
        kindLabel: "Sun",
        line: SUN.line,
        childrenLabel: "Planets",
        childrenCap: PLANETS.length,
        children: PLANETS.map((p) => ({ id: p.id, name: p.name, img: p.img })),
        add,
      };
    }
    if (id === MOON.id) {
      return {
        id,
        name: MOON.name,
        img: MOON.img,
        kindLabel: "Moon",
        line: MOON.line,
        childrenLabel: "Tiny moons",
        childrenCap: 2,
        children: [],
        add,
      };
    }
    const p = PLANETS.find((pp) => pp.id === id);
    if (!p) return null;
    const hasMoon = p.id === "earth";
    return {
      id,
      name: p.name,
      img: p.img,
      kindLabel: "Planet",
      line: p.line,
      childrenLabel: "Moons",
      childrenCap: 2,
      children: hasMoon
        ? [{ id: MOON.id, name: MOON.name, img: MOON.img }]
        : [],
      add,
    };
  };

  // --- Hero rocket pose ---------------------------------------------------
  const dragNow = dragActive ? dragRef.current : null;
  const dragHoverId = dragNow?.hover ?? null;
  const dragHoverPos = dragHoverId ? bodyPos(dragHoverId) : null;

  // --- Info panel ---------------------------------------------------------
  const panelInfo = infoId ? getPanelInfo(infoId) : null;

  // --- Chat subject: the rocket decides -----------------------------------
  // Galaxy view: we chat with the star the rocket is parked on — or the
  // one it is flying to (it lands there in a moment). Chat mode: the
  // conversation stays with the star it opened on (chatTalkId); the
  // rocket landing elsewhere only OFFERS to switch via the suggestion
  // pill — it never hijacks the open conversation. Falls back to the
  // fan's root subject if the partner can't be resolved right now.
  const talkId = flight ? flight.toId : rocketHostId;
  const chatPartnerPanel =
    chatOpen && chatTalkId ? getPanelInfo(chatTalkId) : null;
  const talkPanel = chatPartnerPanel ?? getPanelInfo(talkId);
  const talkInfo: ChatSubjectInfo | null = talkPanel
    ? {
        id: talkPanel.id,
        name: talkPanel.name,
        img: talkPanel.img,
        kindLabel: talkPanel.kindLabel,
        line: talkPanel.line ?? "",
      }
    : (chatSubj?.info ?? null);

  // Post-landing invite: shared by galaxy and chat mode. It is created by
  // the touchdown effect, so it can never appear while the rocket is flying,
  // and it never expires on its own — the offer stands until answered.
  // Never suggest chatting with the star we're already chatting with — in
  // chat mode the conversation stays put when the rocket lands on a new
  // star, and this pill is the offer to switch the chat over to it.
  const suggestionInfo =
    chatSuggestionId &&
    !flight &&
    !dragActive &&
    !(chatOpen && chatSuggestionId === talkInfo?.id)
      ? getPanelInfo(chatSuggestionId)
      : null;

  // --- Summon-rocket suggestion -----------------------------------------
  // Wherever the camera is visiting — a galaxy-view zoom or a chat-mode
  // fan — if the rocket isn't parked there and isn't already flying
  // there, offer to send it over. Never suggested for the body that
  // already holds it, while dragging it, or mid navigator pick.
  const summonInfo =
    focusedId && focusedId !== talkId && !dragActive && !rocketArmed
      ? getPanelInfo(focusedId)
      : null;

  // --- Contextual hints ---------------------------------------------------
  // The current situation, told to the hint guide so tips surface when they
  // matter. Priority: the mode you're in beats what you're looking at.
  const hintContext = chatActive
    ? "chat"
    : rocketArmed
      ? "rocket-armed"
      : flight
        ? "rocket-flight"
        : infoId
          ? "storybook"
          : focusedId
            ? summonInfo
              ? "summon"
              : focusedId === talkId
                ? "at-host"
                : "focused"
            : "explore";

  // --- Zoom-out pill --------------------------------------------------------
  // The body's parent is the zoom-out landing spot: a planet's parent is
  // the sun, the Moon's parent is Earth. Chat mode plays by the same
  // rule — the fan can step up past the chat's root star, generation by
  // generation, all the way to the Sun, where the last zoom-out is the
  // whole sky (which also closes the conversation).
  const zoomOutTarget: ZoomOutTarget | null = (() => {
    if (!focusedId) return null;
    if (focusedId === SUN.id) {
      return { id: "", name: "Whole sky", img: null };
    }
    if (focusedId === MOON.id) {
      const earth = PLANETS.find((pp) => pp.id === "earth");
      return earth ? { id: earth.id, name: earth.name, img: earth.img } : null;
    }
    const p = PLANETS.find((pp) => pp.id === focusedId);
    return p ? { id: SUN.id, name: SUN.name, img: SUN.img } : null;
  })();

  /** Zoom out one generation — the shared move behind the "visit the
      parent" pill and the chat-mode zoom-out button. From the Sun the
      last step is the whole sky; in chat mode that final zoom-out also
      closes the conversation (you stepped out of the whole family). */
  const handleZoomOut = (id: string) => {
    chatUserZoom();
    if (!id) {
      // "Whole sky": glide all the way back out to the full system.
      setInfoId(null);
      followRef.current = null;
      setFocusedId(null);
      if (chatOpen) {
        // Skip the pre-chat camera restore — the whole-sky reset owns
        // the camera on the way out.
        preChatCamRef.current = null;
        closeChat();
      }
      resetTransformRef.current?.();
      return;
    }
    handleNavigate(id);
  };

  let rocketX = CENTER;
  let rocketY = CENTER;
  let rocketRot = PARK_ROT;
  let rocketFlame = 0;
  if (dragNow) {
    const dx = dragNow.cur.x - dragNow.lastX;
    dragNow.lastX = dragNow.cur.x;
    rocketX = dragNow.cur.x;
    rocketY = dragNow.cur.y;
    rocketRot = Math.max(-24, Math.min(24, dx * 0.5));
    rocketFlame = 0.85;
  } else if (flight) {
    const p = Math.min(1, (performance.now() - flight.startAt) / flight.dur);
    const e = easeInOutCubicFn(p);
    const end = parkPos(flight.toId) ?? { x: CENTER, y: CENTER };
    const u = 1 - e;
    rocketX = u * u * flight.fx + 2 * u * e * flight.cx + e * e * end.x;
    rocketY = u * u * flight.fy + 2 * u * e * flight.cy + e * e * end.y;
    const vx = 2 * u * (flight.cx - flight.fx) + 2 * e * (end.x - flight.cx);
    const vy = 2 * u * (flight.cy - flight.fy) + 2 * e * (end.y - flight.cy);
    const heading = (Math.atan2(vy, vx) * 180) / Math.PI + 90;
    // Sun arrivals slide into the orbit tangent instead of standing tall.
    const toSun = flight.toId === SUN.id;
    const arriveRot = toSun ? sunOrbitRot() : PARK_ROT;
    if (p < 0.16) {
      rocketRot = lerpAngle(flight.fromRot, heading, easeOutCubic(p / 0.16));
    } else if (p > 0.76) {
      rocketRot = lerpAngle(
        heading,
        arriveRot,
        easeInOutCubicFn((p - 0.76) / 0.24),
      );
    } else {
      rocketRot = heading;
    }
    // Sun arrivals keep the engine idling — no touchdown flame-out.
    const flameFloor = toSun ? SUN_ORBIT_FLAME : 0;
    rocketFlame =
      p < 0.12
        ? p / 0.12
        : p > 0.84
          ? Math.max(flameFloor, (1 - p) / 0.16)
          : 1;
  } else {
    const pp = parkPos(rocketHostId);
    if (pp) {
      rocketX = pp.x;
      rocketY = pp.y;
    }
    if (rocketHostId === SUN.id) {
      // Parked on the sun = slowly orbiting it, nose along the travel
      // direction, engine idling — the sun's surface is no place to land.
      rocketRot = sunOrbitRot();
      rocketFlame = SUN_ORBIT_FLAME + 0.1 * Math.sin(t * 7);
    }
  }
  // Keep the live pose reachable between frames: mid-flight re-targets
  // and the chat invite anchor read it.
  rocketPoseRef.current = { x: rocketX, y: rocketY, rot: rocketRot };

  return (
    <div className="fixed inset-0 overflow-hidden bg-space">
      <div className="flex h-full w-full">
      {/* Sky strip: the whole galaxy squeezes here when chat opens */}
      <div
        ref={stripRef}
        className={`relative h-full min-w-0 flex-none overflow-hidden transition-[width] duration-500 ease-in-out ${
          chatOpen ? "w-full sm:w-[clamp(290px,33vw,460px)]" : "w-full"
        }`}
      >
      {/* Hand-painted gouache sky, fixed to the viewport so it stays
          full-bleed and crisp at every zoom level */}
      <img
        key={BACKGROUNDS[bgIndex]!.src}
        src={BACKGROUNDS[bgIndex]!.src}
        srcSet={`${BACKGROUNDS[bgIndex]!.srcSm} 1280w, ${BACKGROUNDS[bgIndex]!.src} 2048w`}
        sizes="100vw"
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
      />
      <TransformWrapper
        initialScale={0.36}
        minScale={chatOpen && fanSubj ? fanSubj.layout.camera.scale : 0.12}
        maxScale={2.5}
        centerOnInit
        limitToBounds={false}
        doubleClick={{ disabled: true }}
        wheel={{ step: 0.15 }}
        panning={{ velocityDisabled: true, disabled: chatActive }}
        onPanningStart={stopFollow}
        onWheel={chatUserZoom}
        onPinchStart={chatUserZoom}
      >
        {({ zoomIn, zoomOut, resetTransform, setTransform, state }) => {
          setTransformRef.current = setTransform;
          resetTransformRef.current = resetTransform;
          stateRef.current = state;
          return (
          <>
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
            >
              <div
                className="relative"
                style={{ width: WORLD, height: WORLD }}
              >
                {/* Twinkling stars and comets — dimmed in chat mode so the
                    family strip stays the star of the show. */}
                <Starfield size={WORLD} chatMix={chatMix} />

                {/* Dashed orbit rings, like the reference drawing */}
                <svg
                  width={WORLD}
                  height={WORLD}
                  viewBox={`0 0 ${WORLD} ${WORLD}`}
                  className="pointer-events-none absolute inset-0"
                  aria-hidden
                >
                  {PLANETS.map((p, i) => {
                    const ring = RING_STYLES[i]!;
                    // In chat mode the ring breathes toward its fan-arc
                    // radius, carrying its planet along with it.
                    const s = ringScaleRef.current.get(p.id) ?? 1;
                    return (
                      <g
                        key={p.id}
                        transform={`translate(${ring.cx} ${ring.cy}) scale(${s}) translate(${-ring.cx} ${-ring.cy})`}
                      >
                        <path
                          d={ring.d}
                          fill="none"
                          stroke="white"
                          strokeOpacity={ring.opacity}
                          strokeWidth={ring.width / s}
                          strokeDasharray={ring.dash
                            .split(" ")
                            .map((v) => (+v / s).toFixed(1))
                            .join(" ")}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}
                  {(() => {
                    const s = ringScaleRef.current.get(MOON.id) ?? 1;
                    return (
                      <g
                        transform={`translate(${earth.x} ${earth.y}) scale(${s}) translate(${-earth.x} ${-earth.y})`}
                      >
                        <path
                          d={wobblyRing(earth.x, earth.y, MOON.orbitR, 99)}
                          fill="none"
                          stroke="white"
                          strokeOpacity={0.72}
                          strokeWidth={6.5 / s}
                          strokeDasharray={`${(22 / s).toFixed(1)} ${(17 / s).toFixed(1)}`}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })()}
                </svg>

                {/* Warm glow behind the Sun */}
                <div
                  className="pointer-events-none absolute rounded-full"
                  style={{
                    left: CENTER,
                    top: CENTER,
                    width: SUN.size * 1.8,
                    height: SUN.size * 1.8,
                    transform: "translate(-50%, -50%)",
                    background:
                      "radial-gradient(circle, oklch(0.9 0.16 95 / 0.4), transparent 65%)",
                  }}
                />

                {/* Drifting characters fly behind the planets, like the
                    rocket and astronaut floating between the posters' rings */}
                {DRIFTERS.map((d) => {
                  const q = positions.get(d.id)!;
                  return <Drifter key={d.id} def={d} x={q.x} y={q.y} />;
                })}

                <Planet
                  def={SUN}
                  x={CENTER}
                  y={CENTER}
                  active={activeId === SUN.id}
                  jumping={jumpId === SUN.id}
                  highlighted={
                    highlightId === SUN.id ||
                    dragHoverId === SUN.id ||
                    rocketInboundId === SUN.id
                  }
                  highlightMode={highlightId === SUN.id ? "flash" : "steady"}
                  onTap={handleBodyTap}
                  spin
                />

                {/* Biggest first so small planets pass in front at
                    conjunction and never disappear behind a giant */}
                {[...PLANETS]
                  .sort((a, b) => b.size - a.size)
                  .map((p) => {
                    const q = positions.get(p.id)!;
                    const cr =
                      chatRenderRef.current.get(p.id) ??
                      chatRideRef.current.get(p.id);
                    const chatSized = cr != null && Math.abs(cr.size - p.size) > 0.5;
                    return (
                      <Planet
                        key={p.id}
                        def={chatSized && cr ? { ...p, size: cr.size } : p}
                        x={q.x}
                        y={q.y}
                        labelBoost={fanSubj?.layout.slots.get(p.id)?.labelBoost ?? 1}
                        active={activeId === p.id}
                        jumping={jumpId === p.id}
                        highlighted={
                          highlightId === p.id ||
                          dragHoverId === p.id ||
                          rocketInboundId === p.id
                        }
                        highlightMode={
                          highlightId === p.id ? "flash" : "steady"
                        }
                        onTap={handleBodyTap}
                      />
                    );
                  })}

                <Planet
                  def={
                    Math.abs(moonChatSize - MOON.size) > 0.5
                      ? { ...MOON, size: moonChatSize }
                      : MOON
                  }
                  x={moonPos.x}
                  y={moonPos.y}
                  labelBoost={fanSubj?.layout.slots.get(MOON.id)?.labelBoost ?? 1}
                  active={activeId === MOON.id}
                  jumping={jumpId === MOON.id}
                  highlighted={
                    highlightId === MOON.id ||
                    dragHoverId === MOON.id ||
                    rocketInboundId === MOON.id
                  }
                  highlightMode={highlightId === MOON.id ? "flash" : "steady"}
                  onTap={handleBodyTap}
                />

                {/* Golden tether from the dragged rocket to its target */}
                {dragNow?.hover && dragHoverPos && (
                  <svg
                    width={WORLD}
                    height={WORLD}
                    viewBox={`0 0 ${WORLD} ${WORLD}`}
                    className="pointer-events-none absolute inset-0 z-[35]"
                    aria-hidden
                  >
                    <line
                      x1={dragNow.cur.x}
                      y1={dragNow.cur.y}
                      x2={dragHoverPos.x}
                      y2={dragHoverPos.y}
                      stroke="#ffd94d"
                      strokeWidth={7}
                      strokeDasharray="26 20"
                      strokeLinecap="round"
                      opacity={0.9}
                      className="rocket-tether"
                    />
                  </svg>
                )}

                <HeroRocket
                  x={rocketX}
                  y={rocketY}
                  rotation={rocketRot}
                  flame={rocketFlame}
                  squash={landingSquash}
                  dragging={dragActive}
                  interactive={!flight && !chatActive}
                  onDown={onRocketDown}
                />

              </div>
            </TransformComponent>

            <header className="pointer-events-none fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-2">
              <Sparkle className="h-5 w-5 text-star" aria-hidden />
              <span className="font-display text-base font-semibold tracking-wide text-star sm:text-xl">
                Pocket Galaxy
              </span>
            </header>

            <Navigator
              key={chatActive ? "strip" : "all"}
              items={chatActive ? chatNavItems : navItems}
              activeId={activeId}
              focusedId={focusedId}
              onSelect={handleNavigate}
              onInfo={handleInfoSelect}
              chatMode={chatActive}
              rocket={{
                img: heroRocketImg,
                hostId: flight ? flight.toId : rocketHostId,
                flying: flight !== null,
                armed: rocketArmed,
                onChip: () => setRocketArmed((a) => !a),
                onDestination: handleRocketDestination,
              }}
            />

            {/* Double-click info panel: details + summon the rocket */}
            {panelInfo && (
              <BodyInfoPanel
                info={panelInfo}
                chatMode={chatActive}
                onAdd={() => {}}
                onSelect={handleInfoSelect}
                onClose={() => setInfoId(null)}
                rocket={{
                  here: (flight ? flight.toId : rocketHostId) === panelInfo.id,
                  flying: flight !== null,
                  onSummon: () => handleRocketDestination(panelInfo.id),
                }}
              />
            )}

            <div
              className={`fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-2 transition-opacity duration-300 ${
                chatActive ? "pointer-events-none opacity-0" : "opacity-100"
              }`}
            >
              <button
                type="button"
                aria-label="Chat with this world"
                title="Chat mode — the rocket introduces its host"
                onClick={() => openChat()}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
              >
                <MessagesSquare className="h-5 w-5" />
              </button>
              <Link
                to="/generator"
                aria-label="Open the Galaxy Generator"
                title="Galaxy Generator — roll a random solar system"
                className="group flex h-11 items-center gap-2 rounded-full border border-border bg-card/90 px-4 font-display text-sm font-semibold text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
              >
                <Dices className="h-4 w-4 group-hover:animate-[dice-wiggle_0.5s_ease-in-out]" />
                Make your own
              </Link>
            </div>

            {/*
              Top-of-sky suggestion stack: the zoom-out pill (hop up to the
              parent star, or the whole sky), a summon-the-rocket offer
              whenever the visited body isn't holding it, and the chat
              invites — one vertical pile in the galaxy view and docked
              over the strip in chat mode.
            */}
            <SuggestionStack chatMode={chatActive}>
              <ZoomOutPill
                key={zoomOutTarget ? `${zoomOutTarget.id}:${zoomOutTarget.name}` : "none"}
                target={zoomOutTarget}
                onZoomOut={handleZoomOut}
              />
              {summonInfo && (
                <RocketSummonInvite
                  key={summonInfo.id}
                  name={summonInfo.name}
                  img={summonInfo.img}
                  onSummon={() => {
                    recordCrashEvent("rocket-summon-pill", { to: summonInfo.id });
                    summonRocketTo(summonInfo.id);
                  }}
                />
              )}
              {/* Post-landing invite: identical timing in both views. */}
              {suggestionInfo && (
                <RocketChatInvite
                  key={suggestionInfo.id}
                  name={suggestionInfo.name}
                  img={suggestionInfo.img}
                  onChat={() => {
                    setChatSuggestionId(null);
                    if (chatActive) {
                      // Switch the open conversation to the rocket's new
                      // host and fan the strip around it.
                      setChatTalkId(suggestionInfo.id);
                      handleNavigate(suggestionInfo.id);
                    } else {
                      openChat(suggestionInfo.id);
                    }
                  }}
                  onDismiss={() => setChatSuggestionId(null)}
                />
              )}
            </SuggestionStack>

            <div
              className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex-col gap-2 transition-opacity duration-300 ${
                chatActive
                  ? "hidden sm:flex left-[calc(clamp(290px,33vw,460px)-3.5rem)]"
                  : "flex right-[max(1rem,env(safe-area-inset-right))]"
              }`}
            >
              <button
                type="button"
                aria-label={`Change background (now: ${BACKGROUNDS[bgIndex]!.name})`}
                title={`Sky: ${BACKGROUNDS[bgIndex]!.name}`}
                onClick={cycleBg}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
              >
                <Palette className="h-5 w-5" />
              </button>

              {chatActive ? (
                <button
                  type="button"
                  aria-label={
                    zoomOutTarget
                      ? `Zoom out to ${zoomOutTarget.name}`
                      : "Zoom out"
                  }
                  title={
                    zoomOutTarget
                      ? `Zoom out to ${zoomOutTarget.name}`
                      : "Zoom out"
                  }
                  disabled={!zoomOutTarget}
                  onClick={() =>
                    zoomOutTarget && handleZoomOut(zoomOutTarget.id)
                  }
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-30"
                >
                  <Undo className="h-5 w-5" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => {
                      chatUserZoom();
                      zoomIn();
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => {
                      chatUserZoom();
                      zoomOut();
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Recenter"
                    onClick={() => {
                      chatUserZoom();
                      resetTransform();
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            <HintGuide
              pageId="classic"
              hints={CLASSIC_HINTS}
              context={hintContext}
              docked={chatActive}
            />
          </>
          );
        }}
      </TransformWrapper>
      </div>
      {chatSubj && (chatOpen || chatActive) && talkInfo && (
        <ChatPanel
          key={talkInfo.id}
          subject={talkInfo}
          // Wait only while the rocket is on its way to the star we're
          // chatting with — flights to other stars don't interrupt us.
          waiting={!!flight && flight.toId === talkInfo.id}
          onClose={closeChat}
        />
      )}
      </div>
    </div>
  );
}
