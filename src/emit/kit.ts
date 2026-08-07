/**
 * The seam between the deck shell and the explanatory vocabulary.
 *
 * `composition.ts` owns the document: head, theme CSS, scene wrappers, the root
 * timeline, the slideshow island. An archetype emitter owns one scene's insides
 * and nothing else. Adding a domain means adding an emitter — the shell never
 * learns what a camera frustum or an orderbook is.
 */
import type { Archetype, BeatOf, Format, Source } from "../types.js";

/* ------------------------------------------------------- the content box */

/**
 * `.scene`'s padding, in reference px. `contentW`/`contentH` are what is left.
 *
 * They live here rather than in `theme.ts` or `title.ts` because both of those
 * need them and neither may import the other: `baseCss` writes the padding into
 * the stylesheet, every archetype does arithmetic against what is left. They
 * were the same two numbers in both places by maintenance rather than by
 * construction, and a stylesheet that disagrees with the arithmetic clips at the
 * canvas edge, which no gate reads.
 */
export const PAD_X = 110;
export const PAD_Y = 84;

/**
 * The canvas every absolute measurement in this codebase was chosen against.
 *
 * The type scale, the padding, the font floor, the gaps and the stroke weights
 * were all picked by eye on a 1920x1080 slide. That was fine while 1920x1080 was
 * the only canvas, and became wrong the moment a second one existed: a 76px
 * headline is 3.96% of the width at 1920 and 7.04% at 1080, so the same slide
 * design arrives 78% heavier in portrait. It reads as shouting, and it is why a
 * vertical deck cannot carry anything complicated — the type has eaten the room
 * the content needed.
 */
export const REF_W = 1920;

/**
 * HOW FAR A NARROW CANVAS TRAVELS BACK TOWARDS THE REFERENCE ONE. The whole
 * typographic argument of this file is this one number.
 *
 * An archetype lays out in REFERENCE SPACE — one unit system, `refWidth` wide, at
 * the target's aspect ratio — and `baseCss` scales the finished scene onto the
 * real canvas exactly once. So every absolute measurement in the vocabulary (the
 * type scale, the 40px floor, ~171 gap/radius/stroke literals) becomes a fraction
 * of the canvas rather than a count of its pixels, without any of them being
 * touched.
 *
 * `refWidth = REF_W^k · width^(1-k)`, so:
 *
 *   k = 0   reference space IS the canvas. What shipped before this existed.
 *   k = 1   the portrait deck is the landscape deck, photographically reduced:
 *           type is the same PERCENTAGE of the width in both.
 *
 * k = 1 is the tempting answer and it is too far. Equal percentage-of-width only
 * means equal legibility if the two screens subtend the same angle, and they do
 * not: a 13" laptop is ~29cm wide at ~55cm (0.52 rad), a phone ~7cm at ~30cm
 * (0.23 rad). The phone is worth about half. Halving the angular size of every
 * glyph to buy room is trading the wrong way — 40px at k=1 lands at 8.1 CSS px on
 * a 390px-wide phone, which is not text any more.
 *
 * k = 1/2 is the geometric mean of the two readings, and it is what the 390px
 * screenshots support: the floor lands at 30 canvas px (10.8 CSS px on the phone,
 * against 14.4 today) and the content box grows 1.33x in each direction — 1.78x
 * the area, which is the room the extra table rows and pipeline stages come from.
 *
 * Identity at 1920 for every k, since `1920^k · 1920^(1-k) = 1920`. That is what
 * keeps the shipping 16:9 deck byte-identical: at k anything, `zoomOf` returns
 * exactly 1 there and `baseCss` emits no scaling rule at all.
 */
export const REF_PULL = 0.5;

/**
 * The width of the unit system an archetype lays out in.
 *
 * Rounded to an integer so `contentW` is an integer and the emitted geometry is
 * the same kind of number it has always been — `n()` prints two decimals, and a
 * content box of 1272.7924 would put a long tail on half the coordinates in the
 * document for no benefit.
 */
export function refWidth(format: Format): number {
  return Math.round(REF_W ** REF_PULL * format.width ** (1 - REF_PULL));
}

/**
 * The reference canvas keeps the TARGET's aspect ratio, not the reference one.
 *
 * This is what lets `isPortrait` and every branch under it keep working: the
 * reference canvas for `short-9x16` is 1440x2560, which is still 9:16. Reference
 * space is a change of unit, never a change of shape.
 */
export function refHeight(format: Format): number {
  return Math.round((format.height * refWidth(format)) / format.width);
}

/**
 * Reference px per canvas px — what `baseCss` scales the scene by.
 *
 * WIDTH, not height and not diagonal. Text wraps against width, so width is what
 * decides how much a given type size costs; a taller canvas at the same width
 * buys lines, not room per line.
 *
 * Exactly 1 at 1920 wide, because `refWidth` returns exactly 1920 there.
 */
export function zoomOf(format: Format): number {
  return format.width / refWidth(format);
}

/**
 * `.scene`'s padding, and the box it leaves an archetype to draw in.
 *
 * These live here rather than in `theme.ts` or `title.ts` because both need them
 * and neither may import the other: `baseCss` writes the padding into the
 * stylesheet, every archetype does arithmetic against what is left. They were the
 * same two numbers in both places by maintenance rather than construction, and a
 * stylesheet that disagrees with the arithmetic clips at the canvas edge, which
 * no gate reads.
 *
 * Reference px, so the gutter is the same FRACTION of every canvas without
 * anything here knowing the canvas: 110 of 1440 is 110 of 1920 once the scene has
 * been scaled. A canvas-px gutter took 20.4% of the width at 1080 against 11.5%
 * at 1920 — nearly twice the proportional margin on the canvas that can least
 * afford it.
 */
export function contentW(format: Format): number {
  return refWidth(format) - 2 * PAD_X;
}

export function contentH(format: Format): number {
  return refHeight(format) - 2 * PAD_Y;
}

export interface Theme {
  bg: string;
  fg: string;
  muted: string;
  dim: string;
  rule: string;
  panel: string;
  accent: string;
  /** Highlight tones, addressed by `tone: "a" | "b" | "c" | "d"`. */
  tones: { a: string; b: string; c: string; d: string };
  fontStack: string;
}

export interface EmitContext {
  source: Source;
  format: Format;
  theme: Theme;
  /**
   * This scene's root element id, e.g. `"s3"`. Every GSAP selector must be
   * scoped with it — an unscoped class selector reaches into other scenes and
   * `hyperframes lint` rejects it (`unscoped_gsap_selector`).
   */
  sid: string;
}

/* ------------------------------------------------- the animation vocabulary */

/**
 * A value in a GSAP vars payload that is JavaScript rather than data.
 *
 * `ease: dsZoom` names a function the scene's own `measure` declared, and
 * `scale: dsFramed.k` reads a number it measured. Neither is expressible as a
 * number or a string — a string would be quoted, and `ease: "dsZoom"` is a GSAP
 * ease NAME that does not exist, so GSAP falls back to `power1.out` and the
 * camera lands on the wrong curve with every gate green. So raw JS is a distinct
 * kind of value, spelled at the call site, rather than a string the serialiser
 * has to guess about.
 */
export interface Raw {
  readonly __raw: string;
}

export function raw(js: string): Raw {
  return { __raw: js };
}

export type VarValue = number | string | boolean | Raw | Vars | readonly VarValue[];

/** A GSAP vars payload — the `{ opacity: 0, y: 14 }` half of a `fromTo`. */
export interface Vars {
  readonly [key: string]: VarValue;
}

/**
 * ONE TWEEN. Invariant 2 — "every tween is `fromTo`" — is this interface.
 *
 * It used to be a line of GSAP source text, which had three consequences worth
 * the change. A `from()` was a review question rather than a type error. The
 * animation vocabulary was invisible to the type checker: `duration` and
 * `duraiton` were the same string. And `pace()` had to recover the position
 * argument by running a regex over the emitted statement —
 * `/,\s*(-?\d*\.?\d+)\s*\)\s*;?\s*$/` — which is a parser for a language nobody
 * had written a grammar for, sitting on the path every deck's timing goes
 * through.
 *
 * `from` is REQUIRED and there is no other constructor, so a tween that does
 * not declare where it starts cannot be written down. That is what makes the
 * invariant checkable by `tsc` instead of by a human reading a diff.
 *
 * `at` is a position in seconds from the scene's start, ALREADY ROUNDED by
 * whoever built the tween (invariant 10). The serialiser prints it and rounds
 * nothing: two roundings on one number is how a byte moves.
 */
export interface Tween {
  readonly target: string;
  readonly from: Vars;
  readonly to: Vars;
  readonly at: number;
}

export function fromTo(target: string, from: Vars, to: Vars, at: number): Tween {
  return { target, from, to, at };
}

/**
 * THE ONE PLACE A TWEEN BECOMES GSAP TEXT.
 *
 * Byte-for-byte what fifty-eight call sites used to build by hand: one space
 * inside each brace, `", "` between entries, `key: value`. The spacing is not
 * cosmetic — the deck's regression test is that two builds of one storyboard
 * are byte-identical, and the cheapest proof this refactor changed nothing is
 * that it also matches every build made before it.
 */
export function tweenText(t: Tween): string {
  return `tl.fromTo("${t.target}", ${varsText(t.from)}, ${varsText(t.to)}, ${t.at});`;
}

function varsText(v: Vars): string {
  const entries = Object.entries(v).map(([k, val]) => `${k}: ${valueText(val)}`);
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

function valueText(v: VarValue): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // A string is DATA and is quoted; `raw()` is the way to write code. See `Raw`.
  if (typeof v === "string") return `"${v}"`;
  if (Array.isArray(v)) return `[${v.map(valueText).join(", ")}]`;
  if (typeof (v as Raw).__raw === "string") return (v as Raw).__raw;
  return varsText(v as Vars);
}

export interface Scene {
  /** The scene's inner HTML. The wrapper `<div class="scene clip">` is added by the shell. */
  html: string;
  /**
   * For each id suffix this scene drew that CARRIES A LABEL, the label it drew
   * there: `{ stage0: "Encode", stage1: "Window" }`. Only the archetypes with
   * enterable interiors populate it, and only for the parts a camera can be
   * aimed at.
   *
   * WHY IT EXISTS. `inside.element` is an INDEX — `stage2` is the third thing in
   * `params.stages` — so a reference that names the right kind of part and the
   * wrong number resolves to a real id, measures a real rect and hands GSAP
   * valid numbers. The deck renders a smooth, convincing dive into the wrong
   * box, and `lint`, `check`, the type floor and `drift` are all green over it.
   * `insideSchema.label` is what the plan thought it was entering; this is what
   * the archetype actually drew, and the two are compared before the camera is
   * built. `experiments/015-decision/runs-n32/menu-20/plan.json` is a committed
   * plan where they disagree.
   *
   * WHY NOT AN ATTRIBUTE IN THE HTML, and why not a table in `withCamera`. A
   * `data-` attribute would move the bytes of every built deck, which is the one
   * thing the camera is not allowed to do (`renders byte-identical output when
   * nothing is annotated`). A table in the shell is what `assertInsideResolves`
   * already rejected in its own words — it would drift from the emitter. `Scene`
   * is in-memory and never serialised, so this is archetype-sourced and costs
   * zero emitted bytes.
   *
   * IF YOU ARE WRITING AN ARCHETYPE WITH AN ENTERABLE INTERIOR, RETURN THIS.
   * Omitting it does not merely leave the new archetype unchecked — a supplied
   * `label` over a part reporting none is a build ERROR, not a skip
   * (`partLabelProblem` says why), so an archetype that populates the map and
   * forgets it in the return object REFUSES ITS OWN CORRECT REFERENCES with
   * "does not label ... It labels: nothing". `stack` shipped that way for the
   * length of one review: the map was filled in the layer loop and dropped at
   * the return, and because every test for this was written against `pipeline`,
   * `tsc` and `biome` both saw a merely-unused local. Test the archetype you
   * added, not the one that already worked.
   */
  parts?: Readonly<Record<string, string>>;
  /**
   * Tweens appended to this scene's own paused timeline, with times RELATIVE to
   * the scene's start. `Tween` is a `fromTo` by construction — `from()` records
   * its end state when the timeline is built and breaks under the arbitrary
   * seeking that deck navigation performs.
   */
  tl: Tween[];
  /** Statements run as the document parses, before anything else, e.g.
   * `katex.render(...)`. Anything that CHANGES layout belongs here, so that a
   * `measure` below reads the finished document. */
  setup?: string[];
  /**
   * SEAM B. Statements run once inside the ready gate's barrier — after
   * `document.fonts.ready` and after every image has decoded — and immediately
   * before this scene's timeline is built, in the same closure, so a `tl` entry
   * can read a variable declared here.
   *
   * Declaring any makes the scene DEFERRED: `sceneHtml` wraps the timeline in a
   * builder that the gate awaits instead of registering it during parse. That is
   * how a scene measures the rendered document — font metrics have arrived, and
   * the answer is taken at one instant for the whole deck rather than whenever
   * some tween first happens to render.
   *
   * WHY IT CANNOT BE DONE IN `setup`, AND WHY NOT LAZILY EITHER. `setup` runs
   * during parse, before webfonts resolve, so it measures fallback metrics —
   * measured at 8.6px of travel error in `experiments/014-seam-b`. Lazily, on a
   * tween's first render, is worse: `hyperframes render` shards frames
   * contiguously across workers, so "first render" is a different point in the
   * deck in every worker, and the same input then renders differently at 1 worker
   * and at 2 — measured at 39 of 594 frames and 14.96 dB, a camera landing 18px
   * off, against 7 frames of antialiasing once deferred. Both failures are
   * invisible to every gate. `cameraMeasure` carries the numbers and the controls.
   *
   * INVARIANT 11 IS THE TRAP HERE. This is not a callback on a tween. `seek()`
   * passes `suppressEvents`, so measuring from an `onUpdate` — the obvious way to
   * "measure late" — renders a frozen video with every gate green. Measurement
   * happens before the timeline exists, and what it produces is ordinary tween
   * values.
   */
  measure?: string[];
  /**
   * Hold points in seconds from the scene's start — where a presenter should
   * pause. The shell converts these to absolute island fragment times.
   */
  holds: number[];
  /** CSS this archetype needs. Deduplicated by the shell, emitted once. */
  css?: string;
}

export type Emitter<A extends Archetype> = (beat: BeatOf<A>, ctx: EmitContext) => Scene;

/** Escape text destined for HTML text content or a quoted attribute. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Text that may carry inline TeX, as `$...$`.
 *
 * A markdown table's cells arrive with their maths still in them — a column
 * really is called `PSNR$_{\mathrm{RGB}}$` — and every archetype ran the whole
 * string through `esc()`, so the slide showed the dollar signs and the
 * backslashes to the audience. `esc()` is right for the prose around it and
 * wrong for the maths inside it, so the two are separated here and KaTeX renders
 * the marked spans at setup time (see `mathSetup` in ./composition.ts).
 *
 * Conservative on purpose. A bare `$` is money far more often than it is maths,
 * so a span only counts when it looks like TeX: a backslash, a sub/superscript,
 * a brace — or a single symbol, which is what `$T$` is. "$5 and $10" is left
 * alone, which is the failure worth having.
 */
const TEX = /\$([^$\n]+)\$/g;
const LOOKS_LIKE_TEX = /[\\_^{}]/;

export function mathy(raw: string): string {
  if (!raw.includes("$")) return esc(raw);
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(TEX)) {
    const inner = m[1] as string;
    if (!LOOKS_LIKE_TEX.test(inner) && inner.trim().length > 3) continue;
    out += esc(raw.slice(last, m.index));
    out += `<span class="ds-tex">${esc(inner)}</span>`;
    last = (m.index as number) + m[0].length;
  }
  return out + esc(raw.slice(last));
}

/** Whether a scene needs the KaTeX pass. Cheap enough to ask per scene. */
export const TEX_MARK = "ds-tex";

/** Escape a string for embedding inside a single-quoted JS literal. */
export function js(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}
