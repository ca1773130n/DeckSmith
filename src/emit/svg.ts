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
 * Advance width of one character in ems, erring wide.
 *
 * These are eyeball fits against Inter, not metrics read from the font: reading
 * real metrics would mean parsing the subsetted bundle at emit time, and the
 * only decision that depends on them is "does this fit", which wants a
 * conservative bound rather than an exact answer. Every value is rounded up, so
 * a box sized through here is never too small — only occasionally too generous.
 */
function charUnits(c: string): number {
  if (c === " ") return 0.3;
  const code = c.codePointAt(0) ?? 0;
  // Hangul, kana, CJK, full-width forms and emoji all advance a full em or more.
  if (code > 0x2e7f) return 1.02;
  // Figures measure ~0.58, and a decimal point or thousands comma inside a run of
  // them is set on the same tabular advance — narrow them and "1.592" comes out
  // under the 0.58/char that `line-chart` sized its right pad against, which is
  // the near-clip this module was written to make impossible.
  if ((c >= "0" && c <= "9") || c === "." || c === ",") return 0.6;
  if ("MW@%".includes(c)) return 0.95;
  if ("mw".includes(c)) return 0.88;
  if ("ijltI:;'`|!()[]".includes(c)) return 0.33;
  if (c >= "A" && c <= "Z") return 0.72;
  // Latin-1 capitals (0xC0-0xDF) sort past "Z", so they miss the range test above.
  if (code >= 0xc0 && code <= 0xdf) return 0.72;
  return 0.56;
}

/** Bold is set wider than regular at the same size, and boxes get sized off labels. */
function weightFactor(weight: number): number {
  return weight >= 700 ? 1.07 : weight >= 600 ? 1.04 : 1;
}

/**
 * Estimated rendered width in px. Linear in `fontSize`, which is what lets
 * `fitBoxes` solve for a size instead of searching for one.
 *
 * Every archetype sizes its boxes and padding through this function. When two of
 * them disagree about how wide "Reconstruction" is, one of them clips.
 */
export function textWidth(text: string, fontSize: number, weight = 400, tracking = 0): number {
  let units = 0;
  let chars = 0;
  for (const c of text) {
    units += charUnits(c);
    chars++;
  }
  // `tracking` is CSS `letter-spacing`, in em, and it is not decoration: the
  // eyebrow is set at `.14em` AND uppercased, which together made a 60-character
  // eyebrow render on two lines where this predicted one. Every archetype that
  // asks `chromeHeight` how much room is left inherited that as room it did not
  // have. The headline's `-.015em` runs the other way and cost a line.
  //
  // Applied per character, including the last — which is what the browser does
  // when it measures a run for wrapping.
  return units * fontSize * weightFactor(weight) + tracking * fontSize * chars;
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
