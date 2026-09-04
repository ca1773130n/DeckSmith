/**
 * Geometry, text metrics and SVG strings. Nothing above that.
 *
 * Six diagrammatic archetypes draw vector graphics that the source document
 * never contained. Left to themselves each would re-derive the same four things
 * — how wide a label renders, where N things go across a canvas, how to draw an
 * arrowhead, how to escape a caption — and they would each get them slightly
 * wrong in a different way. `line-chart` shipped 3.6px from clipping because it
 * guessed its own em-factor; that guess now lives here, once.
 *
 * This module knows about characters, boxes and paths. It does not know what a
 * pipeline stage or a receptive field is — that knowledge belongs to the emitter
 * that composes these primitives, and putting it here is how a primitive layer
 * turns into six hand-rolled one-offs wearing a shared import.
 */
import { esc, fromTo, sec, type Tween, type Vars } from "./kit.js";

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Raw SVG attribute names to values. `undefined` and `""` are dropped. */
export type Attrs = Record<string, string | number | undefined>;

/**
 * Audience text is never smaller than this at 1920x1080. Below it a slide passes
 * every automated gate and is unreadable from the third row, which is the only
 * test that matters and the only one we cannot run.
 */
export const MIN_FONT = 40;

/**
 * Two decimals. Floating point makes `x(3)` print as `412.00000000000006`, and a
 * render that differs from the last one by a digit is a regression test we can
 * no longer run — byte-identical output is the cheapest correctness signal here.
 */
export function n(v: number): string {
  return nv(v).toString();
}

/**
 * `n`, where a NUMBER rather than its text is wanted — a tween's vars payload is
 * now a typed object, so a coordinate that used to be interpolated into a string
 * has to arrive as the value it is. Same rounding, so `String(nv(x)) === n(x)`
 * by construction and geometry that goes through a tween still prints exactly
 * what the same geometry in an SVG attribute prints.
 */
export function nv(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The `from` and `to` vars of a stroke draw-on, measured by the browser.
 *
 * The `drawFrom` this replaced needed the emitter to know the path's length at
 * BUILD time —
 * `Math.hypot(knee.x - start.x, knee.y - start.y) + b.w` in annotated-figure,
 * `perimeter(b)` in grid — which is arithmetic about a shape the browser is
 * going to measure anyway, kept in step by hand. DrawSVG asks the path.
 *
 * It also retires a bug the hand-computed version had. GSAP writes
 * `strokeDashoffset` back as an integer px, so a leader of length 720.21 came to
 * rest at an offset of 720 and left 0.21px of dash exposed at the path start,
 * which `stroke-linecap: round` paints as a full-width dot: a yellow dot sat on
 * the grid one reveal before its own region was drawn, inside the frame, above
 * the type floor, and invisible to every gate. That is why the old `drawFrom`
 * rounded up and added a pixel of slack. A percentage has no remainder to leave.
 *
 * Safe under capture because a plugin's `render()` is part of being seeked,
 * unlike a callback — see `DRAWSVG_SRC` in composition.ts for the measurement.
 * Anything drawn this way still obeys invariant 2: it is a `fromTo`, always.
 */
export const DRAW_FROM: Vars = { drawSVG: "0%" };
export const DRAW_TO: Vars = { drawSVG: "100%" };

/**
 * Something travels a polyline — a pulse along an arrow, a marker ring along a
 * curve, a highlight down a divider: one `x`/`y` `fromTo` per leg, each leg's
 * share of `seconds` proportional to its length, `ease: "none"` until the last
 * leg, which settles with `power2.out`. Only the first leg renders
 * immediately; every later one is `immediateRender: false` and starts exactly
 * where the leg before it ended, so the route reads as one motion under any
 * seek. `x`/`y` are TRANSLATIONS, so author the traveller at the origin —
 * `<circle r="6">` — and give the route in the same user space as the parts it
 * passes. A transform rather than `attr: { cx, cy }` so one verb moves an SVG
 * dot and an HTML rule alike; not MotionPath, which is not loaded.
 *
 * ONE CALL PER ELEMENT. The first leg's immediate render is the one that
 * (element, x/y) gets; a second route on the same element would need
 * `immediateRender: false` and a `from` equal to the first route's end, which
 * is not where a second route starts. A pulse per arrow, not one pulse reused.
 *
 * Every leg starts where the last one ended, printed at two places, and lint
 * reads `at + duration` back in floating point: 0.1 + 0.2 is 0.30000000000000004,
 * which `overlapping_gsap_tweens` reports as a 4e-17s overlap with the leg at
 * 0.3 (measured on 0.7.90). So a leg whose float sum overshoots its successor
 * is shortened by a hundredth — a rest at the corner under one frame long —
 * and the corner itself, and the arrival at `at + seconds`, stay where they
 * were scheduled.
 */
export function travel(target: string, route: readonly Pt[], at: number, seconds: number): Tween[] {
  if (!(seconds > 0)) throw new Error(`travel ${target}: ${seconds}s is no time to travel in`);
  const legs: { from: Pt; to: Pt; length: number }[] = [];
  let prev: Pt | undefined;
  for (const p of route) {
    const q = { x: nv(p.x), y: nv(p.y) };
    if (prev === undefined) {
      prev = q;
      continue;
    }
    const length = Math.hypot(q.x - prev.x, q.y - prev.y);
    // A repeated corner is not a leg: a zero-length tween would be a snap.
    if (length === 0) continue;
    legs.push({ from: prev, to: q, length });
    prev = q;
  }
  if (legs.length === 0) throw new Error(`travel ${target}: a route needs two distinct points`);
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  const end = sec(at + seconds);
  let start = sec(at);
  let run = 0;
  return legs.map((leg, i) => {
    run += leg.length;
    const last = i === legs.length - 1;
    const next = last ? end : sec(at + (seconds * run) / total);
    let duration = sec(next - start);
    if (!last && start + duration > next) duration = sec(duration - 0.01);
    const tween = fromTo(
      target,
      { x: leg.from.x, y: leg.from.y },
      {
        x: leg.to.x,
        y: leg.to.y,
        duration,
        ease: last ? "power2.out" : "none",
        ...(i > 0 ? { immediateRender: false } : {}),
      },
      start,
    );
    start = next;
    return tween;
  });
}

/** Scene-scoped element id. Every timeline selector is built from one of these. */
export function id(sid: string, part: string, i?: number): string {
  return i === undefined ? `${sid}-${part}` : `${sid}-${part}${i}`;
}

/* ------------------------------------------------------------ text metrics */

/**
 * Advance width of one character in ems, MEASURED in Inter.
 *
 * This was eight buckets of eyeball fits, and the contract above them —
 * "rounded up, so a box sized through here is never too small" — was false. A
 * bucket cannot be both safe and tight when the truth inside it spans a factor
 * of four: `0.56` covered "·" at 0.313 AND "—" at 1.000, so a lone em dash was
 * measured at half its width while a run of full stops was measured at double.
 * Every bucket had entries above its own value:
 *
 *     claimed             measured over it
 *     digits      0.60    every tabular digit is 0.649
 *     capitals    0.72    O Q 0.767, N 0.757, G U H 0.745+, W 0.918, M 0.913
 *     "ijlt…"     0.33    ( ) [ ] 0.391
 *     everything  0.56    b d g p q 0.62, — 1.000, → 0.955, ‰ 1.354, Æ 1.004
 *
 * The digit one is the sharpest: `data-table` sets `font-variant-numeric:
 * tabular-nums`, which is why the old comment reasoned about tabular advances —
 * and Inter's tabular figure is 0.649, not 0.60, so every table solved its
 * column widths 8% short. The arrow one is the ugliest: "L1 0.0346 → 0.0235" is
 * demo copy, and its arrow was charged 0.56 against a true 0.955.
 *
 * So the table is the measurement. Each value is the ISOLATED advance — kerning,
 * `calt` and `liga` off — taken as the max over the four weights this deck sets
 * (400/500/600/700) and over both figure modes, divided by that weight's
 * `weightFactor`. That last division couples this table to `weightFactor` below:
 * change one and the guarantee needs re-measuring. Rounded up at 3dp.
 *
 * KERNING OFF IS THE WHOLE TRICK, and getting it wrong cost a round. Measuring a
 * glyph as `width("nn" + c + "nn") - width("nnnn")` folds in the n/c kern pair,
 * which Inter sets NEGATIVE for the capitals that lean — so T came out 0.528
 * against a true 0.653, W 0.918 against 1.003, and every all-caps eyebrow in the
 * demo was then predicted 3-4% SHORT. `KERN_SLACK` covers what is left.
 *
 * MEASURED, NOT PARSED. Reading real metrics at emit time means parsing the
 * subsetted bundle, and a Latin deck ships no bundle at all — HyperFrames
 * resolves Inter itself (src/source/fonts.ts). So the numbers are taken once, in
 * Chrome, against the Inter that Google Fonts serves, and pinned here.
 *
 * `node scripts/measure-type.mjs` re-derives every number in this block and
 * prints it ready to paste; `test/svg.test.ts` holds the result against ten
 * widths read out of the same browser. A pinned constant with no way to redo it
 * is folklore, and this file was eight of them.
 *
 * RE-DERIVED 2026-08-02 AND DELIBERATELY NOT RE-PASTED. Six of the 128 entries
 * disagree with what the harness measures now, and every one of them is pinned
 * WIDER than the truth — the safe direction, since this table's only promise is
 * never to under-predict:
 *
 * ```
 *   ( ) [ ]   0.391 pinned, 0.365 measured   -6.6%
 *   *         0.649 pinned, 0.535 measured  -17.6%
 *   -         0.649 pinned, 0.460 measured  -29.1%
 * ```
 *
 * `*` and `-` are the interesting pair: 0.649 is exactly `TABULAR_FIGURE`, so
 * those two were not measured proportionally at all — they carry a table's
 * figure width, which is what Inter gives them under `tabular-nums` and not what
 * a headline sets them at. A hyphen in a headline is therefore charged 29% more
 * room than it takes.
 *
 * Left alone because re-pasting is not the small edit it looks like. Every
 * `drawn` value in `test/svg.test.ts` was read out of the Inter of the day, so
 * correcting the table without re-measuring those ten widths in a browser
 * replaces a known over-prediction with an unknown pair of numbers being
 * compared to each other. Do both together, or neither.
 */
// biome-ignore format: a measured table reads as a grid. One entry per line is 190 lines in which no row of the alphabet is visible at once, and the thing a reader wants to do here is compare neighbours.
const ADVANCE: Readonly<Record<string, number>> = {
  /* digits, PROPORTIONAL — see `TABULAR_FIGURE` for a table's */
  "0": 0.646, "1": 0.413, "2": 0.61, "3": 0.618, "4": 0.648, "5": 0.596, "6": 0.622,
  "7": 0.566, "8": 0.624, "9": 0.622, ".": 0.32, ",": 0.32,
  /* capitals */
  A: 0.715, B: 0.655, C: 0.731, D: 0.722, E: 0.602, F: 0.591, G: 0.747,
  H: 0.744, I: 0.269, J: 0.571, K: 0.689, L: 0.566, M: 0.904, N: 0.754,
  O: 0.765, P: 0.639, Q: 0.765, R: 0.644, S: 0.642, T: 0.646, U: 0.745,
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: X's advance in Inter, measured. It is near 1/sqrt(2) by coincidence and means nothing of the sort.
  V: 0.715, W: 0.993, X: 0.707, Y: 0.7, Z: 0.636,
  /* lowercase */
  a: 0.562, b: 0.613, c: 0.572, d: 0.613, e: 0.584, f: 0.381, g: 0.614,
  h: 0.596, i: 0.26, j: 0.26, k: 0.555, l: 0.26, m: 0.876, n: 0.596,
  o: 0.6, p: 0.613, q: 0.613, r: 0.39, s: 0.537, t: 0.351, u: 0.596,
  v: 0.574, w: 0.819, x: 0.556, y: 0.576, z: 0.553,
  /* ASCII punctuation */
  "!": 0.324, '"': 0.528, "#": 0.634, $: 0.642, "%": 0.982, "&": 0.645, "'": 0.325,
  "(": 0.391, ")": 0.391, "*": 0.649, "+": 0.662, "-": 0.649, "/": 0.372, ":": 0.32,
  ";": 0.329, "<": 0.662, "=": 0.662, ">": 0.662, "?": 0.536, "@": 0.973, "[": 0.391,
  "\\": 0.372, "]": 0.391, "^": 0.472, _: 0.457, "`": 0.35, "{": 0.449, "|": 0.356,
  "}": 0.449, "~": 0.662, " ": 0.282,
  /* dashes, arrows, marks */
  "·": 0.32, "—": 1.0, "–": 0.5, "…": 0.959, "×": 0.662, "÷": 0.662, "°": 0.456,
  "±": 0.662, "≈": 0.662, "≤": 0.662, "≥": 0.662, "→": 0.955, "←": 0.955, "↑": 0.867,
  "↓": 0.867, "↔": 1.341, "⟶": 1.341, "“": 0.517, "”": 0.51, "‘": 0.298, "’": 0.298,
  "«": 0.632, "»": 0.632, "€": 0.667, "£": 0.612, "¥": 0.55, "§": 0.569, "¶": 0.603,
  "†": 0.558, "‡": 0.558, "•": 0.563, "‰": 1.336, "′": 0.263, "″": 0.524,
  /* Latin-1 letters — the accent rides above, so ï advances exactly as i does */
  À: 0.715, Á: 0.715, Â: 0.715, Ã: 0.715, Ä: 0.715, Å: 0.715, Æ: 0.994,
  Ç: 0.731, È: 0.602, É: 0.602, Ê: 0.602, Ë: 0.602, Ì: 0.269, Í: 0.269,
  Î: 0.269, Ï: 0.269, Ð: 0.735, Ñ: 0.754, Ò: 0.765, Ó: 0.765, Ô: 0.765,
  Õ: 0.765, Ö: 0.765, Ø: 0.765, Ù: 0.745, Ú: 0.745, Û: 0.745, Ü: 0.745,
  Ý: 0.7, Þ: 0.641, ß: 0.63, à: 0.562, á: 0.562, â: 0.562, ã: 0.562,
  ä: 0.562, å: 0.562, æ: 0.918, ç: 0.572, è: 0.584, é: 0.584, ê: 0.584,
  ë: 0.584, ì: 0.26, í: 0.26, î: 0.26, ï: 0.26, ð: 0.583, ñ: 0.596,
  ò: 0.6, ó: 0.6, ô: 0.6, õ: 0.6, ö: 0.6, ø: 0.6, ù: 0.596,
  ú: 0.596, û: 0.596, ü: 0.596, ý: 0.576, þ: 0.613, ÿ: 0.576,
};

/**
 * What a SHAPED run can be that a sum of isolated advances cannot see.
 *
 * Kerning runs both ways — "AV" sets 1.4% tighter than its two advances, "carry"
 * 1.4% looser — and a per-character sum has no pair to consult. Only the loose
 * direction can break the never-under-predict rule, so only the loose direction
 * is paid for. MEASURED over 4,732 runs (every string in demo/storyboard.json
 * and demo/source.json, plus each one uppercased and each of their words, at all
 * four weights): 16 came out wider than their sum, the worst by 0.61%.
 */
const KERN_SLACK = 1.007;

/**
 * A figure and its separators when `font-variant-numeric: tabular-nums` is set.
 *
 * `data-table` sets it, so its columns line up; nothing else does. The two modes
 * are far enough apart to matter in both directions: Inter's proportional "1" is
 * 0.413 against a tabular 0.649, and its tabular "." is 0.269 against a
 * proportional 0.320. Charging one advance for both is not a rounding — the old
 * table charged every caller the tabular figure, which under-served the table by
 * 8% AND over-charged a pipeline label reading "192x192x3" by 16%, enough that
 * the box no longer admitted its own unbreakable token.
 *
 * So `textWidth` takes the mode, the way it already takes weight and tracking:
 * three CSS properties the emitter sets that change what the browser measures.
 */
const TABULAR_FIGURE = 0.649;
const TABULAR_SEPARATOR = 0.269;

/**
 * Advance of one character in the CJK faces this project bundles, per BLOCK.
 *
 * A block is the right unit here in a way it never was for Inter. Latin advances
 * vary per glyph by a factor of four, which is why `ADVANCE` is per character;
 * a CJK face is drawn on an em grid, and all 11,172 Hangul syllables in Noto
 * Sans KR are one number. Measured, they are: 11,172 codepoints, ONE distinct
 * advance, at every weight.
 *
 * WHY THIS EXISTS. Everything here used to cost a flat 1.02em — the blanket
 * below — and Hangul draws at 0.920. A Korean deck was measured 11% wider than
 * it sets, and the whole cost of that lands as beats refused for room they
 * actually have. Nothing else in the project could see it: over-predicting is
 * the safe direction, so every gate stayed green while Korean decks quietly
 * dropped content.
 *
 * ONE NUMBER PER BLOCK, ACROSS ALL FOUR FAMILIES. `charUnits` is handed a
 * character, not a language, so it cannot know whether a "가" is being set in
 * Noto Sans KR (0.920) or Noto Sans SC (0.865). The max over the families is
 * therefore what gets pinned, which is exact for the family that peaks and
 * over-predicts for the rest — the safe direction, again.
 *
 * WHAT THIS ASSUMES, SAID OUT LOUD: that the deck's bundle carries the glyphs
 * the deck sets. `bundleFont` subsets the family `familyFor(lang)` chose over
 * exactly those glyphs, so this holds for the language a deck is written in.
 * It does NOT hold for a stray script — Hangul inside a `ja` deck bundles no
 * Hangul, falls back to whatever the render host has, and is then measured
 * against a face nobody chose. That deck is already broken by invariant 9,
 * which is about the same silence.
 *
 * `node scripts/measure-type.mjs` re-derives this block, exhaustively over every
 * codepoint the four families declare, and prints it ready to paste.
 */
/**
 * What a CJK face charges for a LATIN character, where that is more than Inter.
 *
 * A deck whose language needs a bundled face sets EVERYTHING in it, not only the
 * CJK: `fontStack` puts "Noto Sans KR" ahead of Inter, so the ASCII inside a
 * Korean sentence is drawn by the Korean face too. `ADVANCE` is Inter's, and for
 * 31 of the 104 characters this project sets, the CJK faces are wider — so a
 * mixed run was measured against a font it is not drawn in, and the error is all
 * in the unrecoverable direction.
 *
 * THE MIDDLE DOT IS THE ONE THAT MATTERS. Korean uses "·" as a list separator
 * the way English uses a comma, and the CJK faces set it on the em grid: 1.0em
 * against Inter's 0.288. That is 247% under-charged, per dot. It surfaced as a
 * note running past its column in a real Korean deck, caught by
 * `container_overflow` at a hold — after a browser had drawn it, which is the
 * only thing in this stack that can see a width the model gets wrong.
 *
 * ONE TABLE, BECAUSE THE FOUR FAMILIES AGREE — measured, exhaustively, over
 * every character this project sets: Noto Sans KR, JP, SC and TC give the SAME
 * Latin advance for all 31, with exactly one exception. Korean sets "·" at
 * 0.561 where the other three set it on the em grid at 1.0, and that one
 * character is worth splitting: a blanket 1.0 over-predicted a real Korean note
 * by 18%, and this file's own history records what over-predicting Korean costs
 * — beats refused for room they actually have, invisibly, because
 * over-prediction is the safe direction and no gate can see it.
 *
 * APPLIED ONLY TO A RUN THAT CONTAINS CJK, which is the whole of the heuristic
 * and its whole limitation. A run with a Hangul syllable in it is certainly set
 * in the Korean face; a run of pure ASCII in a Korean deck is too, and this does
 * NOT catch that one — it stays measured as Inter, a little light, exactly as it
 * was before. Catching it needs the deck's language at every one of the 37
 * `textWidth` call sites, which is a different change with a different blast
 * radius.
 */
const CJK_LATIN: Readonly<Record<string, number>> = {
  "·": 1,
  "`": 0.606,
  "≈": 1,
  "≤": 1,
  "§": 1,
  "×": 1,
  "1": 0.555,
  _: 0.559,
  "^": 0.555,
  l: 0.284,
  "…": 1,
  t: 0.377,
  i: 0.275,
  j: 0.275,
  "!": 0.323,
  I: 0.293,
  "/": 0.392,
  "\\": 0.392,
  "–": 0.536,
  m: 0.926,
  "&": 0.68,
  n: 0.61,
  r: 0.388,
  h: 0.607,
  u: 0.607,
  '"': 0.474,
  d: 0.62,
  p: 0.62,
  q: 0.62,
  o: 0.606,
  b: 0.618,
};

/**
 * The one character the four families disagree about. Hangul in the run means
 * the Korean face is drawing it, and Korean sets the middle dot at 0.561.
 */
const HANGUL_LATIN: Readonly<Record<string, number>> = { "·": 0.561 };

/** Hangul, specifically — the one script with its own Latin advance above. */
const HANGUL_RANGE = /[\u3130-\u318f\uac00-\ud7a3]/;

/** The scripts whose faces this project bundles, and therefore sets ASCII in. */
const CJK_RANGE =
  /[\u3000-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60]/;

const BLOCK_ADVANCE: readonly (readonly [number, number, number])[] = [
  [0x3000, 0x303f, 1], // CJK symbols and punctuation
  [0x3040, 0x309f, 1], // hiragana
  [0x30a0, 0x30ff, 1], // katakana
  [0x3130, 0x318f, 0.92], // Hangul compatibility jamo
  [0x3400, 0x4dbf, 1], // CJK unified ideographs, extension A
  [0x4e00, 0x9fff, 1], // CJK unified ideographs
  [0xac00, 0xd7a3, 0.92], // Hangul syllables
  [0xf900, 0xfaff, 1], // CJK compatibility ideographs
  [0xff01, 0xff60, 1], // full-width forms
];

/**
 * A character neither table carries costs a little over a full em.
 *
 * This covers the tail nothing here deliberately tabulates — Greek, Cyrillic,
 * Latin Extended, the arrows and operators outside `ADVANCE`, emoji, and the
 * two CJK-adjacent blocks `BLOCK_ADVANCE` refuses on purpose. It over-predicts
 * a Cyrillic "ш" by half and under-predicts nothing measured: emoji come back
 * at 1.000em, and half-width forms at 0.500. Over-predicting costs room;
 * under-predicting draws off the canvas, and only one of those is recoverable.
 * Measuring a script the product ships no face for would be inventing data.
 */
const UNMEASURED = 1.02;

/**
 * Units for `c`, and whether that number grows with font weight.
 *
 * It does for Inter, which is the whole reason `weightFactor` exists. It does
 * NOT for the CJK faces: Noto Sans KR sets Hangul at 0.920 at 400, at 500 and
 * at 700 alike, because the em grid is the design and weight only fills it. The
 * drawn widths in `test/svg.test.ts` say so twice over — "영상 복원 결과" at
 * weight 700 measures 238.97px, which is six syllables of exactly 0.920em plus
 * its spaces, with nothing left over for a bold penalty.
 *
 * Applying `weightFactor` to them anyway charged a bold Korean line 4.5% it
 * never spends. That is the same failure as the blanket, one layer down.
 */
function charUnits(
  c: string,
  tabular: boolean,
  cjkRun: boolean,
  hangul: boolean,
): [units: number, scalesWithWeight: boolean] {
  if (tabular) {
    if (c >= "0" && c <= "9") return [TABULAR_FIGURE, true];
    if (c === "." || c === ",") return [TABULAR_SEPARATOR, true];
  }
  // Before Inter's own table: in a run the CJK face is drawing, its Latin
  // advance is the real one. `scalesWithWeight` is false for the same reason it
  // is false for the CJK blocks — the em grid is the design, and weight fills it
  // rather than widening it.
  if (cjkRun) {
    const wide = (hangul ? HANGUL_LATIN[c] : undefined) ?? CJK_LATIN[c];
    if (wide !== undefined) return [wide, false];
  }
  const measured = ADVANCE[c];
  if (measured !== undefined) return [measured, true];
  // `for (const c of text)` iterates code points, so an astral character
  // arrives whole and `codePointAt` reads it rather than half a surrogate.
  const cp = c.codePointAt(0) ?? 0;
  for (const [lo, hi, units] of BLOCK_ADVANCE) if (cp >= lo && cp <= hi) return [units, false];
  // The unmeasured tail keeps the weight factor: most of it is Inter setting
  // Greek or Cyrillic, and paying the factor over-predicts, which is safe.
  return [UNMEASURED, true];
}

/**
 * How much wider Inter sets at each weight the deck uses. MEASURED, per glyph,
 * as the mean over the whole table.
 *
 * Was 1 / 1.04 / 1.07 by eye, with nothing at all for 500 — and 500 is the
 * eyebrow's weight, so every eyebrow was predicted short before the table above
 * was even consulted. `scripts/measure-type.mjs` reports means of 1.0174, 1.0347
 * and 1.0521; these sit just under, which costs nothing because `ADVANCE` is
 * derived by dividing by exactly these numbers — lowering one raises the entries
 * that peak at that weight, and the product is unchanged.
 *
 * A single factor per weight cannot be exact — the per-glyph spread at 700 runs
 * 0.84 to 1.16 — and it does not have to be: `ADVANCE` is the max over weights
 * of the true advance DIVIDED BY the factor here, so the product is above the
 * truth for every glyph at every one of these four weights whatever this
 * function returns. Choosing the measured mean rather than a guess is what makes
 * that bound tight instead of merely true: over the demo's 68 runs it moved the
 * mean over-prediction from 1.047 to 1.033 and let `KERN_SLACK` fall from 1.015
 * to 1.007. The two are one unit — re-measure both together.
 */
function weightFactor(weight: number): number {
  return weight >= 700 ? 1.045 : weight >= 600 ? 1.03 : weight >= 500 ? 1.015 : 1;
}

/**
 * Estimated rendered width in px. Linear in `fontSize`, which is what lets
 * `fitBoxes` solve for a size instead of searching for one.
 *
 * Every archetype sizes its boxes and padding through this function. When two of
 * them disagree about how wide "Reconstruction" is, one of them clips.
 */
/**
 * Which face actually draws a run.
 *
 * A deck that bundles a CJK family sets EVERY run in it, ASCII included, because
 * `fontStack` puts that family ahead of Inter and it covers Latin. So the face is
 * a property of the DECK, not of the characters in one run — and a run of pure
 * ASCII inside a Korean deck is drawn by the Korean face even though nothing in
 * it is Korean.
 *
 * `"latin"` is not "no CJK in this string"; it is "this deck bundles no CJK
 * family". Passing it for a run that does contain CJK would be a lie, which is
 * why the auto-detection below still runs underneath: the parameter can only
 * widen what a run is charged, never narrow it.
 */
export type Face = "latin" | "cjk" | "hangul";

/**
 * The face a theme's stack will use, from the family `familyFor` put in front.
 *
 * Korean is split out because it is the one character the four bundled families
 * disagree about: KR draws the middle dot at 0.561em where JP, SC and TC draw it
 * on the em grid at 1.0.
 */
export function faceOf(fontStack: string): Face {
  if (/Noto Sans KR/.test(fontStack)) return "hangul";
  if (/Noto Sans (JP|SC|TC)/.test(fontStack)) return "cjk";
  return "latin";
}

export function textWidth(
  text: string,
  fontSize: number,
  weight = 400,
  tracking = 0,
  tabular = false,
  face: Face = "latin",
): number {
  // Two pools, because only one of them answers to weight. See `charUnits`.
  let weighted = 0;
  let emGrid = 0;
  let chars = 0;
  // The run's own characters, OR the deck's face when the caller knows it. The
  // two are OR'd rather than the parameter replacing the sniff, because the
  // sniff is never wrong when it fires — a run containing Hangul IS drawn by a
  // Hangul face — while `face` defaults to "latin" at the call sites that have
  // not been threaded yet, and must not un-charge those runs.
  const cjkRun = CJK_RANGE.test(text) || face !== "latin";
  const hangul = (cjkRun && HANGUL_RANGE.test(text)) || face === "hangul";
  for (const c of text) {
    const [units, scalesWithWeight] = charUnits(c, tabular, cjkRun, hangul);
    if (scalesWithWeight) weighted += units;
    else emGrid += units;
    chars++;
  }
  // `tracking` is CSS `letter-spacing`, in em, and it is not decoration: the
  // eyebrow is set at `.14em` AND uppercased, which together made a 60-character
  // eyebrow render on two lines where this predicted one. Every archetype that
  // asks `chromeHeight` how much room is left inherited that as room it did not
  // have. The headline's `-.015em` runs the other way and cost a line.
  //
  // Applied per character, including the last — which is what the browser does
  // when it measures a run for wrapping. Tracking is purely additive: measured,
  // a run set at .14em is its own width plus .14em per character exactly, so it
  // is outside `KERN_SLACK` rather than multiplied by it.
  // KEEP THE ORIGINAL BRACKETING WHEN THERE IS NOTHING TO SPLIT. Text with no
  // em-grid character is every Latin deck, and for it the two pools collapse
  // back to one sum — but `(u * f) * K * size` and `u * K * size * f` are not
  // the same double. They differ on a third of inputs, by about 1e-12px, and
  // that is enough: reassociating alone flipped `b06-stack:4` from ok to a real
  // label overprint, because its layout sat exactly on a fit boundary. The
  // sweep caught it; nothing else would have.
  if (emGrid === 0) {
    return weighted * KERN_SLACK * fontSize * weightFactor(weight) + tracking * fontSize * chars;
  }
  return (
    (weighted * weightFactor(weight) + emGrid) * KERN_SLACK * fontSize + tracking * fontSize * chars
  );
}

/**
 * Greedy word wrap to `maxWidth`. A word wider than the line is broken by
 * character — which is also how Korean and Chinese wrap, since they arrive as
 * one unbroken "word".
 */
export function wrap(
  text: string,
  fontSize: number,
  maxWidth: number,
  weight = 400,
  tracking = 0,
  face: Face = "latin",
): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  let line = "";
  const push = () => {
    if (line) lines.push(line);
    line = "";
  };
  // `face` matters MORE here than in a bare `textWidth`, because this decides a
  // LINE COUNT and a caller turns that into a height. Measuring an ASCII run in
  // a CJK deck as Inter fits one more word per line than the browser will, so the
  // block is budgeted a line short and the last one is drawn outside its box.
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, fontSize, weight, tracking, false, face) <= maxWidth) {
      line = candidate;
      continue;
    }
    push();
    if (textWidth(word, fontSize, weight, tracking, false, face) <= maxWidth) {
      line = word;
      continue;
    }
    for (const c of word) {
      if (line && textWidth(line + c, fontSize, weight, tracking, false, face) > maxWidth) push();
      line += c;
    }
  }
  push();
  return lines.length > 0 ? lines : [text];
}

/* -------------------------------------------------------------- primitives */

function attrs(a: Attrs): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(" ");
}

/** The SVG root. Width and height match the viewBox so px and user units agree. */
export function svg(elementId: string, w: number, h: number, body: string): string {
  return `<svg id="${esc(elementId)}" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">${body}</svg>`;
}

export function rect(b: Box, a: Attrs = {}): string {
  return `<rect ${attrs({ x: n(b.x), y: n(b.y), width: n(b.w), height: n(b.h), ...a })} />`;
}

export function roundRect(b: Box, r: number, a: Attrs = {}): string {
  // Clamped, because a radius past half the short side renders as a lozenge in
  // some engines and a clipped corner in others.
  const rr = Math.min(r, b.w / 2, b.h / 2);
  return rect(b, { rx: n(rr), ...a });
}

export function line(from: Pt, to: Pt, a: Attrs = {}): string {
  return `<line ${attrs({ x1: n(from.x), y1: n(from.y), x2: n(to.x), y2: n(to.y), ...a })} />`;
}

export function path(d: string, a: Attrs = {}): string {
  return `<path ${attrs({ d, fill: "none", ...a })} />`;
}

export function circle(c: Pt, r: number, a: Attrs = {}): string {
  return `<circle ${attrs({ cx: n(c.x), cy: n(c.y), r: n(r), ...a })} />`;
}

export function group(children: string | string[], a: Attrs = {}): string {
  const body = Array.isArray(children) ? children.join("") : children;
  const head = attrs(a);
  return `<g${head ? ` ${head}` : ""}>${body}</g>`;
}

export interface TextOptions {
  size: number;
  fill?: string;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  /** Wrap to this width. Omit for a single line. */
  maxWidth?: number;
  /** Baseline separation as a multiple of `size`. */
  lineHeight?: number;
  /**
   * `"baseline"` (default) puts the first baseline at `y`. `"middle"` centres the
   * whole block on `y` — the one a caller labelling a box wants, and the one that
   * is wrong in a different way for every line count if each emitter derives it.
   */
  vAlign?: "baseline" | "middle";
  class?: string;
  id?: string;
  /**
   * The face the deck's stack will draw this in. Only consulted when `maxWidth`
   * makes this text wrap — an unwrapped run is measured by nothing here.
   */
  face?: Face;
}

export function text(content: string, at: Pt, o: TextOptions): string {
  const weight = o.weight ?? 400;
  const lines = o.maxWidth ? wrap(content, o.size, o.maxWidth, weight, 0, o.face) : [content];
  const lh = (o.lineHeight ?? 1.3) * o.size;
  // 0.34em lifts the baseline to put the cap box, not the baseline, on `y`.
  const first = o.vAlign === "middle" ? -((lines.length - 1) * lh) / 2 + o.size * 0.34 : 0;
  const a: Attrs = {
    x: n(at.x),
    y: n(at.y),
    class: o.class,
    id: o.id,
    "font-size": n(o.size),
    "font-weight": o.weight,
    fill: o.fill,
    "text-anchor": o.anchor && o.anchor !== "start" ? o.anchor : undefined,
  };
  const body =
    lines.length === 1 && first === 0
      ? esc(lines[0] ?? "")
      : lines
          .map((l, i) => `<tspan x="${n(at.x)}" dy="${n(i === 0 ? first : lh)}">${esc(l)}</tspan>`)
          .join("");
  return `<text ${attrs(a)}>${body}</text>`;
}

/* ----------------------------------------------------------------- arrows */

export interface ArrowOptions {
  stroke: string;
  width?: number;
  /** e.g. `"14 12"` for a feedback loop that should read as a return path. */
  dash?: string;
  /** Pull the head back off the target's edge. */
  inset?: number;
  class?: string;
  id?: string;
}

/**
 * A marker cannot inherit its line's colour portably, so there is one marker per
 * colour and its id is derived from the colour itself. That way `arrow` finds
 * its head without the caller carrying an index alongside every connector.
 */
function headId(sid: string, color: string): string {
  return `${sid}-ah-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
}

/** Emit once per scene, with every colour that scene's arrows use. */
export function arrowDefs(sid: string, colors: string[]): string {
  const markers = [...new Set(colors)]
    .map(
      (c) =>
        // userSpaceOnUse: the head is a fixed 26px whatever the stroke width, so a
        // hairline connector and a heavy one still look like the same diagram.
        `<marker id="${headId(sid, c)}" viewBox="0 0 12 12" refX="10.5" refY="6" markerWidth="26" markerHeight="26" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L12,6 L0,12 Z" fill="${esc(c)}" /></marker>`,
    )
    .join("");
  return `<defs>${markers}</defs>`;
}

function strokeAttrs(o: ArrowOptions): Attrs {
  return {
    class: o.class,
    id: o.id,
    fill: "none",
    stroke: o.stroke,
    "stroke-width": n(o.width ?? 4),
    "stroke-linecap": "round",
    "stroke-dasharray": o.dash,
  };
}

/** Move `back` px from `to` towards `from`. */
function pullBack(from: Pt, to: Pt, back: number): Pt {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d === 0 || back <= 0) return to;
  const k = Math.max(0, (d - back) / d);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/** A straight connector with a head at `to`. */
export function arrow(sid: string, from: Pt, to: Pt, o: ArrowOptions): string {
  const end = pullBack(from, to, o.inset ?? 0);
  return line(from, end, { ...strokeAttrs(o), "marker-end": `url(#${headId(sid, o.stroke)})` });
}

export interface ElbowOptions extends ArrowOptions {
  /** The coordinate of the long middle leg: a y when `axis` is `"v"`, else an x. */
  via: number;
  /** `"v"` leaves and arrives vertically — the shape a feedback loop under a row wants. */
  axis?: "v" | "h";
  /** Corner radius, clamped to half the shortest leg. */
  radius?: number;
}

/**
 * A three-leg orthogonal connector: out, along, back in. This is what a feedback
 * arrow needs — a straight line from the last stage to the first would cut
 * through every box between them.
 */
export function elbow(sid: string, from: Pt, to: Pt, o: ElbowOptions): string {
  const vertical = (o.axis ?? "v") === "v";
  // Solve it in one orientation and swap coordinates for the other, so there is
  // one path builder to get right rather than two that drift apart.
  const f = vertical ? from : { x: from.y, y: from.x };
  const t = vertical ? to : { x: to.y, y: to.x };
  const end = { x: t.x, y: t.y - Math.sign(t.y - o.via) * (o.inset ?? 0) };

  const legs = [Math.abs(o.via - f.y), Math.abs(t.x - f.x), Math.abs(end.y - o.via)];
  const r = Math.min(o.radius ?? 18, ...legs.map((l) => l / 2));
  const p = (x: number, y: number) => (vertical ? `${n(x)},${n(y)}` : `${n(y)},${n(x)}`);

  let d: string;
  if (r < 1) {
    d = `M${p(f.x, f.y)} L${p(f.x, o.via)} L${p(end.x, o.via)} L${p(end.x, end.y)}`;
  } else {
    const s1 = Math.sign(o.via - f.y);
    const s2 = Math.sign(t.x - f.x);
    const s3 = Math.sign(end.y - o.via);
    d =
      `M${p(f.x, f.y)} L${p(f.x, o.via - s1 * r)} Q${p(f.x, o.via)} ${p(f.x + s2 * r, o.via)}` +
      ` L${p(end.x - s2 * r, o.via)} Q${p(end.x, o.via)} ${p(end.x, o.via + s3 * r)}` +
      ` L${p(end.x, end.y)}`;
  }
  return path(d, { ...strokeAttrs(o), "marker-end": `url(#${headId(sid, o.stroke)})` });
}

/* ----------------------------------------------------------------- layout */

export interface Track {
  x: number;
  w: number;
}

/**
 * `count` equal tracks spanning `width`, separated by `gap`. Use it for columns
 * or, with the result read as `y`/`h`, for rows — the arithmetic is the same and
 * having it twice is how a diagram ends up 1px off its own grid.
 */
export function tracks(width: number, count: number, gap: number, x0 = 0): Track[] {
  const w = count > 1 ? (width - gap * (count - 1)) / count : width;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), w }));
}

export interface FitRequest {
  labels: string[];
  width: number;
  /** Preferred type size. Only reduced once `gap` has already reached `minGap`. */
  size: number;
  gap: number;
  minGap?: number;
  /** Inner padding per side, as a multiple of the type size. */
  padEm?: number;
  weight?: number;
  x0?: number;
}

export interface Fit {
  /**
   * False when the labels cannot be set at `MIN_FONT` in `width`. The geometry is
   * still returned so a caller can see by how much, but it will clip — the point
   * of reporting is that the caller picks a different composition (stack them,
   * split the beat) instead of shipping a slide nobody can read.
   */
  ok: boolean;
  size: number;
  gap: number;
  boxes: Track[];
  /** Width the composition would need at the floor. Present only when `!ok`. */
  needed?: number;
}

/**
 * Fit N labelled boxes across a width.
 *
 * Gaps go first because whitespace is cheaper than legibility, and type stops at
 * `MIN_FONT` because below it the slide passes every gate and fails the room.
 * `textWidth` is linear in size, so the largest size that fits is a division
 * rather than a search.
 */
export function fitBoxes(req: FitRequest): Fit {
  const count = req.labels.length;
  const minGap = req.minGap ?? 24;
  const padEm = req.padEm ?? 0.8;
  const weight = req.weight ?? 600;
  const x0 = req.x0 ?? 0;
  // Width of the widest box at 1px type, padding included: box = unit * size.
  // Floored at one em so an unlabelled box still has a size to be solved for.
  const unit = Math.max(1, ...req.labels.map((l) => textWidth(l, 1, weight) + 2 * padEm));

  const sizeAt = (gap: number) =>
    count < 1 ? req.size : (req.width - gap * (count - 1)) / count / unit;

  if (sizeAt(req.gap) >= req.size) {
    return { ok: true, size: req.size, gap: req.gap, boxes: tracks(req.width, count, req.gap, x0) };
  }
  if (count > 1 && sizeAt(minGap) >= req.size) {
    // Room exists at the tight gap, so give the slack back to the gap rather than
    // leaving the boxes crammed against each other for no reason.
    const gap = (req.width - count * req.size * unit) / (count - 1);
    return { ok: true, size: req.size, gap, boxes: tracks(req.width, count, gap, x0) };
  }
  const size = sizeAt(minGap);
  if (size >= MIN_FONT) {
    return { ok: true, size, gap: minGap, boxes: tracks(req.width, count, minGap, x0) };
  }
  return {
    ok: false,
    size: MIN_FONT,
    gap: minGap,
    boxes: tracks(req.width, count, minGap, x0),
    needed: count * MIN_FONT * unit + minGap * (count - 1),
  };
}
