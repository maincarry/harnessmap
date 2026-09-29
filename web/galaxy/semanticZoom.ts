export type SemanticDetail = "hidden" | "context" | "quiet" | "full";

export interface SemanticVisibilityInput {
  depth: number;
  focusDepth: number;
  apparentSize: number;
  /** Shortest parent/child hops from the current focus. */
  familyDistance: number;
  protected?: boolean;
  mobile?: boolean;
  /** Number of family generations kept in the readable presentation window. */
  generationWindow?: 3 | 5;
}

export interface SemanticVisibility {
  detail: SemanticDetail;
  opacity: number;
  scale: number;
  labelOpacity: number;
  ringOpacity: number;
  interactive: boolean;
}

const smoothstep = (lo: number, hi: number, value: number) => {
  const x = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};

/**
 * Three readable family generations, plus a faint fourth during handoff.
 * This is presentation-only: callers retain the complete body tree.
 */
export function semanticVisibility({
  depth,
  focusDepth,
  apparentSize,
  familyDistance,
  protected: keep = false,
  mobile = false,
  generationWindow = 3,
}: SemanticVisibilityInput): SemanticVisibility {
  // Galaxy view stays concise at three generations. Chat's tall strip can
  // carry five: the last two remain progressively quieter instead of leaving
  // deep families visually empty. The complete body tree is never changed.
  const generationAlpha = generationWindow === 5
    ? familyDistance <= 1
      ? 1
      : familyDistance === 2
        ? (mobile ? 0.62 : 0.7)
        : familyDistance === 3
          ? (mobile ? 0.4 : 0.5)
          : familyDistance === 4
            ? (mobile ? 0.22 : 0.3)
            : familyDistance === 5
              ? (mobile ? 0.07 : 0.12)
              : 0
    : familyDistance <= 1
      ? 1
      : familyDistance === 2
        ? (mobile ? 0.44 : 0.56)
        : familyDistance === 3
          ? (mobile ? 0.1 : 0.2)
          : 0;

  // Tiny bodies disappear while zoomed out. Extremely oversized ancestors
  // also soften away while zoomed deeply into a local family.
  const tiny = smoothstep(mobile ? 11 : 8, mobile ? 28 : 22, apparentSize);
  const oversized = 1 - smoothstep(mobile ? 760 : 980, mobile ? 1250 : 1650, apparentSize);
  const sizeAlpha = Math.min(tiny, oversized);
  const opacity = keep ? Math.max(0.92, sizeAlpha) : sizeAlpha * generationAlpha;

  if (opacity <= 0.025) {
    return { detail: "hidden", opacity: 0, scale: 0.82, labelOpacity: 0, ringOpacity: 0, interactive: false };
  }
  if (opacity < 0.38) {
    return { detail: "context", opacity, scale: 0.9, labelOpacity: 0, ringOpacity: opacity * 0.45, interactive: generationWindow === 5 && familyDistance <= 4 };
  }
  if (apparentSize < (mobile ? 54 : 46) || opacity < 0.78) {
    return { detail: "quiet", opacity, scale: 0.96, labelOpacity: familyDistance <= 1 ? smoothstep(30, 66, apparentSize) : 0, ringOpacity: opacity * (familyDistance <= 1 ? 0.68 : 0.18), interactive: familyDistance <= 2 };
  }
  return { detail: "full", opacity, scale: 1, labelOpacity: familyDistance <= 1 ? smoothstep(38, 76, apparentSize) : 0, ringOpacity: opacity * (familyDistance <= 1 ? 1 : 0.18), interactive: true };
}
