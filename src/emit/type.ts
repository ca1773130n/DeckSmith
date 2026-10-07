/**
 * Type specs: the typographic half of a v2 style pack.
 *
 * A pack used to be a palette (`themes/`), and every deck set the same Inter at
 * the same 42/64/40 scale, which is half of why the founder's verdict on 219
 * decks was "always the same". A `TypeSpec` is the rest of a look: which face
 * draws the headline and which draws the body, the eyebrow's size, case, weight
 * and tracking, the headline's size, weight, tracking and leading, and how the
 * title slide's big headline grows.
 *
 * EVERY NUMBER HERE IS GEOMETRY, which is why this is not CSS. `chromeHeight`
 * charges the chrome from these numbers and `chromeCss` draws it from the same
 * numbers, so the two cannot disagree. A spec is chosen by the font stack a theme
 * declares (see `faceOf` in svg.ts), so every emitter that already threads a
 * `Face` gets the right measurement without learning that packs exist.
 *
 * `CLASSIC_TYPE` is today's look, number for number. It is never looked up by
 * stack: any stack no spec claims — `ink`, `mono`, `paper`, a user's own theme —
 * measures as classic, which is what keeps v0.8.0's bytes.
 */
import type { MeasuredFace } from "./faces.js";

/** A Latin face a deck can be measured in. `inter` is svg.ts's own table. */
export type LatinFace = "inter" | MeasuredFace;

export interface TypeSpec {
  /** Stable id, for messages and the gallery. */
  key: string;
  /** Face of everything but the chrome. Measured with this face's table. */
  body: LatinFace;
  /** Face of the eyebrow, the headline and the title slide's headline. */
  display: LatinFace;
  /**
   * The body stack. It IDENTIFIES the spec (`faceOf` matches its tail), so no two
   * specs may share one; the display family rides in it after Inter, where it
   * never draws, purely so a stack names its pair. See `stackFor`.
   */
  stack: string;
  /** The chrome's stack: display face, then Inter for any glyph it lacks. */
  displayStack: string;
  /** `color` is a palette role, so one spec suits a light and a dark pack. */
  eyebrow: {
    size: number;
    weight: 400 | 500 | 600 | 700;
    tracking: number;
    upper: boolean;
    lh: number;
    gap: number;
    color: "muted" | "accent";
  };
  headline: { size: number; weight: 400 | 500 | 600 | 700; tracking: number; lh: number };
  /** `fitText`'s bounds for the title slide, and how the big headline is set. */
  title: { lo: number; hi: number; weight: 400 | 500 | 600 | 700; tracking: number };
}

const FAMILY: Readonly<Record<LatinFace, string>> = {
  inter: "Inter",
  "source-serif-4": "Source Serif 4",
  "space-grotesk": "Space Grotesk",
  "ibm-plex-sans": "IBM Plex Sans",
};

/** The CSS family a face is declared under — what `vendorFace` writes. */
export function familyOf(face: LatinFace): string {
  return FAMILY[face];
}

/**
 * `"<body>", "Inter", "<display>", system-ui, sans-serif`, with duplicates gone.
 *
 * Inter second, always: every Latin deck vendors it, and `measure-faces.mjs`
 * measured each face with Inter as its fallback, so a glyph the face lacks is
 * drawn by the face the table assumed. The display family after Inter never
 * draws a glyph; it is there so (body, display) pairs give distinct stacks.
 */
export function stackFor(body: LatinFace, display: LatinFace): string {
  const names = [...new Set([FAMILY[body], "Inter", FAMILY[display]])];
  return `${names.map((n) => `"${n}"`).join(", ")}, system-ui, sans-serif`;
}

/** Today's chrome, exactly. `title.ts` exported these numbers before specs existed. */
export const CLASSIC_TYPE: TypeSpec = {
  key: "classic",
  body: "inter",
  display: "inter",
  stack: '"Inter", system-ui, sans-serif',
  displayStack: '"Inter", system-ui, sans-serif',
  eyebrow: { size: 42, weight: 500, tracking: 0.14, upper: true, lh: 1.2, gap: 22, color: "muted" },
  headline: { size: 64, weight: 700, tracking: -0.015, lh: 1.15 },
  title: { lo: 88, hi: 156, weight: 700, tracking: -0.025 },
};

function spec(
  key: string,
  body: LatinFace,
  display: LatinFace,
  rest: Pick<TypeSpec, "eyebrow" | "headline" | "title">,
): TypeSpec {
  return {
    key,
    body,
    display,
    stack: stackFor(body, display),
    displayStack: stackFor(display, display),
    ...rest,
  };
}

/**
 * The v2 type specs. Five pairings, each a different voice rather than a
 * different size of the same one:
 *
 * - `grotesk-inter`: a geometric grotesk headline, tight and large, over Inter.
 * - `plex`: IBM Plex Sans throughout, a little compact — engineering drawings.
 * - `serif-inter`: a text serif headline at display size over Inter.
 * - `serif`: Source Serif 4 throughout, the eyebrow in sentence case — a journal.
 * - `grotesk-plex`: Space Grotesk headline over a Plex body.
 * - `plex-serif`: a Plex headline over a serif body, the inverse of `serif-inter`.
 *
 * HEIGHT. A one-line eyebrow plus a one-line headline costs at most classic's
 * 146px in every spec, so a pack's bigger type comes out of its leading and
 * gaps rather than out of the body's room. Measured why: `serif` at 44/70 cost
 * a real deck a six-bar chart (`costsNothing` in themes/pick.ts now refuses
 * such a pack, but a pack that rarely needs refusing is the better pack).
 *
 * FLOORS. Every eyebrow is at least 40px (invariant 5). Title tracking is never
 * positive: `fitText` measures untracked, so only a tightening is free.
 */
export const TYPES: Readonly<Record<string, TypeSpec>> = {
  "grotesk-inter": spec("grotesk-inter", "inter", "space-grotesk", {
    eyebrow: {
      size: 40,
      weight: 600,
      tracking: 0.2,
      upper: true,
      lh: 1.2,
      gap: 24,
      color: "accent",
    },
    headline: { size: 70, weight: 700, tracking: -0.03, lh: 1.06 },
    title: { lo: 96, hi: 168, weight: 700, tracking: -0.04 },
  }),
  plex: spec("plex", "ibm-plex-sans", "ibm-plex-sans", {
    eyebrow: {
      size: 40,
      weight: 500,
      tracking: 0.22,
      upper: true,
      lh: 1.2,
      gap: 20,
      color: "accent",
    },
    headline: { size: 60, weight: 600, tracking: -0.005, lh: 1.16 },
    title: { lo: 84, hi: 144, weight: 600, tracking: -0.015 },
  }),
  "serif-inter": spec("serif-inter", "inter", "source-serif-4", {
    eyebrow: {
      size: 40,
      weight: 600,
      tracking: 0.16,
      upper: true,
      lh: 1.2,
      gap: 20,
      color: "accent",
    },
    headline: { size: 68, weight: 600, tracking: -0.01, lh: 1.12 },
    title: { lo: 92, hi: 160, weight: 600, tracking: -0.02 },
  }),
  serif: spec("serif", "source-serif-4", "source-serif-4", {
    eyebrow: {
      size: 42,
      weight: 600,
      tracking: 0.01,
      upper: false,
      lh: 1.2,
      gap: 18,
      color: "accent",
    },
    headline: { size: 68, weight: 700, tracking: -0.012, lh: 1.08 },
    title: { lo: 96, hi: 164, weight: 700, tracking: -0.02 },
  }),
  "grotesk-plex": spec("grotesk-plex", "ibm-plex-sans", "space-grotesk", {
    eyebrow: {
      size: 40,
      weight: 600,
      tracking: 0.12,
      upper: true,
      lh: 1.2,
      gap: 22,
      color: "accent",
    },
    headline: { size: 66, weight: 700, tracking: -0.025, lh: 1.1 },
    title: { lo: 92, hi: 160, weight: 700, tracking: -0.035 },
  }),
  "plex-serif": spec("plex-serif", "source-serif-4", "ibm-plex-sans", {
    eyebrow: {
      size: 40,
      weight: 500,
      tracking: 0.18,
      upper: true,
      lh: 1.2,
      gap: 22,
      color: "muted",
    },
    headline: { size: 62, weight: 600, tracking: -0.01, lh: 1.15 },
    title: { lo: 88, hi: 148, weight: 600, tracking: -0.02 },
  }),
};

/**
 * The spec a theme's stack names, or undefined for classic.
 *
 * Exact, after the one prefix `deckLook` adds: a CJK deck puts its bundled Noto
 * family first and keeps the pack's stack behind it. A stack that merely
 * CONTAINS a spec's families — a user's own theme — is not that spec.
 */
export function typeForStack(fontStack: string): TypeSpec | undefined {
  const latin = fontStack.replace(/^"Noto Sans (KR|JP|SC|TC)", /, "");
  return Object.values(TYPES).find((t) => t.stack === latin);
}

/** One line box, the way `title.ts` has always rounded it. */
export function lineBox(size: number, lh: number): number {
  return Math.round(size * lh);
}

/**
 * A tracking value as the CSS this project has always written: `.14em`,
 * `-.015em`, `0`. Leading zero dropped, so the classic chrome is byte-identical.
 */
export function em(tracking: number): string {
  if (tracking === 0) return "0";
  return `${tracking < 0 ? "-" : ""}${String(Math.abs(tracking)).replace(/^0\./, ".")}em`;
}
