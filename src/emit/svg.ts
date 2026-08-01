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
import { esc, type Vars } from "./kit.js";

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
 * The `from` vars of a stroke draw-on, with the path fully hidden.
 *
 * The length is rounded UP rather than to two decimals, and then given a pixel
 * of slack, because GSAP writes `strokeDashoffset` back as an integer px: a
 * leader of length 720.21 came to rest at an offset of 720 and left 0.21px of
 * the dash exposed at the path start, which `stroke-linecap: round` paints as a
 * full-width dot. A yellow dot therefore sat on the grid one reveal before its
 * own region was drawn — inside the frame, above the type floor, and invisible
 * to every gate. Any offset between the length and twice it is still inside the
 * pattern's gap, so the slack costs nothing.
 */
export function drawFrom(length: number): Vars {
  const l = Math.ceil(length) + 1;
  return { strokeDasharray: l, strokeDashoffset: l };
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
 * A character the table does not carry costs a full em.
 *
 * Hangul, kana, CJK, full-width forms and emoji genuinely do. So does the tail
 * this deliberately does not tabulate — Greek, Cyrillic, Latin Extended, the
 * arrows and operators outside the set above — where 1.02 over-predicts a
 * Cyrillic "ш" by half and under-predicts nothing. Over-predicting costs room;
 * under-predicting draws off the canvas, and only one of those is recoverable.
 * Measuring a script the product does not claim to set would be inventing data.
 */
function charUnits(c: string, tabular: boolean): number {
  if (tabular) {
    if (c >= "0" && c <= "9") return TABULAR_FIGURE;
    if (c === "." || c === ",") return TABULAR_SEPARATOR;
  }
  return ADVANCE[c] ?? 1.02;
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
export function textWidth(
  text: string,
  fontSize: number,
  weight = 400,
  tracking = 0,
  tabular = false,
): number {
  let units = 0;
  let chars = 0;
  for (const c of text) {
    units += charUnits(c, tabular);
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
  return units * KERN_SLACK * fontSize * weightFactor(weight) + tracking * fontSize * chars;
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
): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  let line = "";
  const push = () => {
    if (line) lines.push(line);
    line = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, fontSize, weight, tracking) <= maxWidth) {
      line = candidate;
      continue;
    }
    push();
    if (textWidth(word, fontSize, weight, tracking) <= maxWidth) {
      line = word;
      continue;
    }
    for (const c of word) {
      if (line && textWidth(line + c, fontSize, weight, tracking) > maxWidth) push();
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
}

export function text(content: string, at: Pt, o: TextOptions): string {
  const weight = o.weight ?? 400;
  const lines = o.maxWidth ? wrap(content, o.size, o.maxWidth, weight) : [content];
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
