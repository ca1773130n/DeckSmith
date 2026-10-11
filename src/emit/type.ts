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

/**
 * THE V2 TYPE SCALE in px at 1920x1080 — the founder's, confirmed 2026-10-10,
 * after "the fonts are too large": a 56px headline, 40-44px body and labels, a
 * 40px kicker. No 160-560px hero numeral and no 64px+ kinetic type; the
 * narration and its subtitles carry the words, so what is ON the slide is
 * minimal and quiet.
 *
 * One table, read by every v2 emitter (the chrome through `TYPES` below, each
 * archetype through `v2Text`), by src/bespoke's prompt, labels and gates, and —
 * restated, because that file may import nothing from here — by the burned
 * caption in src/types.ts, so a size cannot be lowered in one place and left
 * large in another. Never under `floor`: AGENTS.md invariant 5. Classic never
 * reads it — `--design classic` is still the complete rollback.
 */
export const TYPE_SCALE = {
  /** The line that says the slide: headline, title slide, a hero statement. */
  headline: 56,
  /** Body copy and the largest a label is set: labels run `label`..`body`. */
  body: 44,
  /** The smallest a label is set; with `body`, the 40-44px label band. */
  label: 40,
  /** Eyebrow / kicker. */
  kicker: 40,
  /** A burned subtitle (src/types.ts `captionFontSize` restates it). */
  caption: 40,
  /** Never under this (invariant 5). */
  floor: 40,
  /**
   * The largest a display equation is asked at. Not the headline's 56: KaTeX
   * sets a sub- or superscript at 0.7em, and at 64 that is 44.8px — on the body
   * scale, clear of the floor. Classic asked up to 108; v2 grew it to 140.
   */
  math: 64,
} as const;

/**
 * A text size as v2 sets it: `px` held inside `[floor, cap]`. Classic passes
 * through untouched. `cap` defaults to body/label size; a role that IS the
 * headline passes `TYPE_SCALE.headline`.
 */
export function v2Text(v2: boolean, px: number, cap: number = TYPE_SCALE.body): number {
  return v2 ? Math.max(TYPE_SCALE.floor, Math.min(px, cap)) : px;
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
 * SIZE IS NOT A VOICE ANY MORE. Every spec sets the eyebrow at `TYPE_SCALE.kicker`
 * and the headline — the title slide's included — at `TYPE_SCALE.headline`; the
 * pairs differ in face, weight, tracking, case and leading. They used to differ
 * in size too (60-70px headlines, 144-168px titles), and the founder's verdict
 * on those was "the fonts are too large".
 *
 * HEIGHT. A one-line eyebrow plus a one-line headline costs well under classic's
 * 146px in every spec, so nothing here takes room from the body.
 *
 * FLOORS. Every eyebrow is at least 40px (invariant 5). Title tracking is never
 * positive: `fitText` measures untracked, so only a tightening is free.
 */
export const TYPES: Readonly<Record<string, TypeSpec>> = {
  "grotesk-inter": spec("grotesk-inter", "inter", "space-grotesk", {
    eyebrow: {
      size: TYPE_SCALE.kicker,
      weight: 600,
      tracking: 0.2,
      upper: true,
      lh: 1.2,
      gap: 24,
      color: "accent",
    },
    headline: { size: TYPE_SCALE.headline, weight: 700, tracking: -0.03, lh: 1.06 },
    title: { lo: TYPE_SCALE.headline, hi: TYPE_SCALE.headline, weight: 700, tracking: -0.04 },
  }),
  plex: spec("plex", "ibm-plex-sans", "ibm-plex-sans", {
    eyebrow: {
      size: TYPE_SCALE.kicker,
      weight: 500,
      tracking: 0.22,
      upper: true,
      lh: 1.2,
      gap: 20,
      color: "accent",
    },
    headline: { size: TYPE_SCALE.headline, weight: 600, tracking: -0.005, lh: 1.16 },
    title: { lo: TYPE_SCALE.headline, hi: TYPE_SCALE.headline, weight: 600, tracking: -0.015 },
  }),
  "serif-inter": spec("serif-inter", "inter", "source-serif-4", {
    eyebrow: {
      size: TYPE_SCALE.kicker,
      weight: 600,
      tracking: 0.16,
      upper: true,
      lh: 1.2,
      gap: 20,
      color: "accent",
    },
    headline: { size: TYPE_SCALE.headline, weight: 600, tracking: -0.01, lh: 1.12 },
    title: { lo: TYPE_SCALE.headline, hi: TYPE_SCALE.headline, weight: 600, tracking: -0.02 },
  }),
  serif: spec("serif", "source-serif-4", "source-serif-4", {
    eyebrow: {
      size: TYPE_SCALE.kicker,
      weight: 600,
      tracking: 0.01,
      upper: false,
      lh: 1.2,
      gap: 18,
      color: "accent",
    },
    headline: { size: TYPE_SCALE.headline, weight: 700, tracking: -0.012, lh: 1.08 },
    title: { lo: TYPE_SCALE.headline, hi: TYPE_SCALE.headline, weight: 700, tracking: -0.02 },
  }),
  "grotesk-plex": spec("grotesk-plex", "ibm-plex-sans", "space-grotesk", {
    eyebrow: {
      size: TYPE_SCALE.kicker,
      weight: 600,
      tracking: 0.12,
      upper: true,
      lh: 1.2,
      gap: 22,
      color: "accent",
    },
    headline: { size: TYPE_SCALE.headline, weight: 700, tracking: -0.025, lh: 1.1 },
    title: { lo: TYPE_SCALE.headline, hi: TYPE_SCALE.headline, weight: 700, tracking: -0.035 },
  }),
  "plex-serif": spec("plex-serif", "source-serif-4", "ibm-plex-sans", {
    eyebrow: {
      size: TYPE_SCALE.kicker,
      weight: 500,
      tracking: 0.18,
      upper: true,
      lh: 1.2,
      gap: 22,
      color: "muted",
    },
    headline: { size: TYPE_SCALE.headline, weight: 600, tracking: -0.01, lh: 1.15 },
    title: { lo: TYPE_SCALE.headline, hi: TYPE_SCALE.headline, weight: 600, tracking: -0.02 },
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
  const latin = fontStack.replace(/^"Noto (Sans|Serif) (KR|JP|SC|TC)", /, "");
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
