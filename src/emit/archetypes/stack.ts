/**
 * A stack, drawn as a stack.
 *
 * An encoder stack, a feature pyramid, a protocol layering: the source states
 * these as a list and leaves the reader to hold the ordering in their head.
 * Drawing them as offset planes receding up-right puts the ordering on the
 * screen — and the build order *is* the explanation, so each plane arrives on
 * its own beat instead of the pile fading in whole.
 *
 * Two decisions are worth knowing before changing anything here.
 *
 * The labels sit on a fixed right-hand spine, one per plane, so they read as a
 * column rather than as seven captions scattered across a slanted pile. That
 * spine is what makes the slide legible with the headline covered.
 *
 * The pile grows upward, so the top plane and its label are where this
 * overflows — and the overflow is not a rounding error, it is structural: seven
 * layers each carrying a note is more text than 1080px has room for once the
 * chrome and the slide note have taken their share. So the rise is *solved*
 * from the height that is actually left rather than assumed and hoped for, and
 * the solve reserves the largest plane it might later choose so that clamping
 * `sy` can never push the pile back out of the box.
 */
import type { BeatOf, Format } from "../../types.js";
import type { Emitter } from "../kit.js";
import { contentH, contentW, esc } from "../kit.js";
import { circle, group, id, line, MIN_FONT, n, path, svg, text, textWidth, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  chrome,
  chromeCss,
  chromeHeight,
  chromeIn,
  holdsWithin,
  isPortrait,
  noteCss,
  noteHeight,
  noteWidth,
  tween,
} from "./title.js";

type Params = BeatOf<"stack">["params"];

/** Plane's right vertex to the label spine. */
const GAP = 44;
/** The index numerals get their own left spine; `NUM_X` is their right edge. */
const NUM_X = 48;
const NUM_W = 70;

const LABEL_SIZE = 46;
/**
 * Above this, two layers read as two unrelated slides rather than one pile — and
 * how far apart that is depends on how big the plane between them is.
 *
 * Portrait has roughly 1400px for four layers where landscape has 570, so a pile
 * held to the landscape rise sits in the middle of 600px of nothing. It gets a
 * larger rise, and larger slabs to go under it: a 230px gap over a 100px-deep
 * slab still reads as one pile, the same gap over a 46px one reads as four
 * separate diagrams. The two numbers move together or neither should move.
 */
const RISE_MAX = { wide: 180, tall: 230 };
/** Below this the planes stop being separable. The canvas outranks it anyway. */
const RISE_MIN = 24;
/** The rise solver reserves these, then picks the real plane inside them. */
const SY_MAX = { wide: 100, tall: 132 };
const T_MAX = { wide: 18, tall: 24 };

/** Space above and below the diagram, before label overhang is added. */
const EDGE = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface StackLayout {
  /**
   * False when the rise the canvas allows is shorter than the tallest label
   * block — i.e. adjacent labels would overlap. `stackLayout` re-composes rather
   * than shipping that, so a returned layout is only `!fits` when no composition
   * fitted and the caller is looking at the least-bad one.
   */
  fits: boolean;
  /** Notes set beside their label rather than beneath it. See `stackLayout`. */
  inline: boolean;
  /** The svg's own box. `width` is the full content column. */
  width: number;
  height: number;
  /** Vertical room the svg was allowed, after chrome, its margin and the note. */
  avail: number;
  chromeH: number;
  noteH: number;
  /** Distance between adjacent planes' front edges. */
  rise: number;
  /** The recede vector, and the slab's thickness. */
  sx: number;
  sy: number;
  t: number;
  /** Plane geometry: left edge of the front face, and its width. */
  x0: number;
  w: number;
  /** Label spine: left edge and width of the label column. */
  labelX: number;
  colW: number;
  labelSize: number;
  /** Tallest label+note block. Adjacent labels collide once `rise` drops below it. */
  blockH: number;
  /** Half `blockH`, floored — the outermost labels overhang the pile by this. */
  pad: number;
  /** Front-face y of the bottom plane. Layer `i` sits `i * rise` above it. */
  yBase: number;
  /**
   * Per-layer wrapped text and the width each ran against, so the emitter and
   * the fit test cannot disagree about how many lines a label took.
   */
  lines: { label: string[]; note: string[]; noteW: number; labelMaxW: number }[];
}

/**
 * Solve the whole composition before a byte of SVG exists.
 *
 * Exported because every way this archetype can fail is a number in here: the
 * pile leaving the canvas, a label set below `MIN_FONT`, a label column narrower
 * than its longest label. Asserting those against rendered markup means parsing
 * text extents back out of SVG, which is a second implementation of the metrics
 * and would agree with the first right up until it mattered.
 *
 * The hard case is seven layers that each carry a note. Two lines of audience
 * type per layer is ~106px, seven of those want 740px of rise, and after an
 * eyebrow, a headline and a slide note there are barely 580px left — the
 * stacked label simply does not fit, and clamping the rise to make it fit is
 * how notes end up printed through the label below. So when it does not fit the
 * composition changes rather than the type: the note moves beside its label, on
 * the same line, right-aligned against the spine.
 */
export function stackLayout(p: Params, format: Format): StackLayout {
  const stacked = solve(p, format, false);
  if (stacked.fits || !p.layers.some((l) => l.note)) return stacked;
  const inline = solve(p, format, true);
  return inline.fits || inline.blockH < stacked.blockH ? inline : stacked;
}

/**
 * The weight a layer's label is DRAWN at, which the layout has to measure at.
 *
 * The top layer is set bolder to mark it as the outcome, and `solve` measured
 * every label at 600 anyway. `textWidth` scales with weight, so on
 * `experiments/018-duration` the emitter believed "Compact thought process" was
 * one line at 600, budgeted one line of height for it, and the browser then set
 * it in two at 700 — putting the second line's descenders straight through the
 * note underneath. Nothing saw it: the pair is SVG text, which `content_overlap`
 * exempts, and it took `svg_text_overprint` to find. One function, used by every
 * measurement here and by the emitter, so the two cannot disagree again.
 */
function labelWeight(i: number, count: number): number {
  return i === count - 1 ? 700 : 600;
}

function solve(p: Params, format: Format, inline: boolean): StackLayout {
  const width = contentW(format);
  const boxH = contentH(format);
  const count = p.layers.length;
  const k = isPortrait(format) ? "tall" : "wide";
  const riseMax = RISE_MAX[k];
  const syMax = SY_MAX[k];
  const tMax = T_MAX[k];

  // The column is sized to its content first: a spine narrower than its longest
  // label wraps every label, and wrapped labels are what eats the rise. Inline
  // notes share the line, so they are part of what the column must hold.
  const noteW = (l: Params["layers"][number]) =>
    inline && l.note !== undefined ? textWidth(l.note, MIN_FONT, 400) + 28 : 0;
  const want = Math.max(
    ...p.layers.map((l, i) => textWidth(l.label, LABEL_SIZE, labelWeight(i, count)) + noteW(l)),
  );
  const colCap = inline ? width * 0.56 : width * 0.5;
  const colW = clamp(Math.ceil(want) + 12, Math.min(520, width * 0.34), colCap);
  const labelX = width - colW;

  // Notes are set at the floor and never shrink; the label gives way first,
  // because a label pushed under 40px is the failure this whole file guards.
  const labelRoom = Math.min(
    ...p.layers.map(
      (l, i) => (colW - noteW(l)) / Math.max(1, textWidth(l.label, 1, labelWeight(i, count))),
    ),
  );
  const labelSize = Math.max(MIN_FONT, Math.min(LABEL_SIZE, labelRoom));

  const lines = p.layers.map((l, i) => {
    const nw = noteW(l);
    const labelMaxW = Math.max(labelSize, colW - nw);
    return {
      label: wrap(l.label, labelSize, labelMaxW, labelWeight(i, count)),
      // Inline notes stay on one line by contract — the schema calls a note "one
      // short line" — and wrapping one would put its second line under the label.
      note: l.note === undefined ? [] : inline ? [l.note] : wrap(l.note, MIN_FONT, colW, 400),
      noteW: nw,
      labelMaxW,
    };
  });
  const blockH = Math.max(
    ...lines.map((l) =>
      inline
        ? Math.max(l.label.length * labelSize, l.note.length * MIN_FONT) * 1.16
        : l.label.length * labelSize * 1.16 +
          (l.note.length > 0 ? 6 + l.note.length * MIN_FONT * 1.16 : 0),
    ),
  );
  const pad = Math.max(EDGE, blockH / 2);

  // Chrome and note are measured, not guessed: a headline that wraps to two
  // lines costs 76px, which is most of a layer's rise at seven layers.
  const chromeH = chromeHeight(p.eyebrow, p.headline, width);
  const noteH = noteHeight(p.note, noteWidth(format), 28);
  const free = boxH - chromeH - 20 - noteH;
  // A beat whose chrome has eaten the slide leaves nothing to solve against, and
  // a negative rise inverts the planes. Report it below rather than draw it.
  const avail = Math.max(300, free);

  // Reserve the *largest* plane the clamp below could return. Solving against
  // the plane we actually pick is circular, and solving against the smallest
  // lets a clamped `sy` push the pile back out of the box.
  const room = (avail - 2 * pad - syMax - tMax) / Math.max(1, count - 1);
  // The canvas wins over the rise a label block would like: a crowded pile is
  // ugly, a pile hanging off the top of the slide is broken.
  const rise = clamp(room, RISE_MIN, riseMax);
  // The plane grows with the rise, so a tight pile gets thin sheets and a loose
  // one gets slabs; either way roughly a quarter of the rise stays as air.
  const sy = clamp(rise * 0.62, 46, syMax);
  const t = clamp(rise * 0.14, 10, tMax);

  const span = width - NUM_W - GAP - colW;
  const sx = clamp(span * 0.2, 110, 220);
  const height = 2 * pad + (count - 1) * rise + sy + t;

  return {
    // A rise shorter than a label block prints the note through the label below.
    fits: room >= blockH + 10 && height <= free,
    inline,
    width,
    height,
    avail,
    chromeH,
    noteH,
    rise,
    sx,
    sy,
    t,
    x0: NUM_W,
    w: span - sx,
    labelX,
    colW,
    labelSize,
    blockH,
    pad,
    yBase: pad + (count - 1) * rise + sy,
    lines,
  };
}

/** Top face, front face, right face. Drawn in that order so the top face wins. */
function slab(
  x0: number,
  y0: number,
  L: StackLayout,
  fill: string,
  lift: number,
  stroke: string,
): string {
  const { w, sx, sy, t } = L;
  const top = `M${n(x0)},${n(y0)} L${n(x0 + w)},${n(y0)} L${n(x0 + w + sx)},${n(y0 - sy)} L${n(x0 + sx)},${n(y0 - sy)} Z`;
  const front = `M${n(x0)},${n(y0)} L${n(x0)},${n(y0 + t)} L${n(x0 + w)},${n(y0 + t)} L${n(x0 + w)},${n(y0)} Z`;
  const side = `M${n(x0 + w)},${n(y0)} L${n(x0 + w)},${n(y0 + t)} L${n(x0 + w + sx)},${n(y0 + t - sy)} L${n(x0 + w + sx)},${n(y0 - sy)} Z`;
  const edge = { stroke, "stroke-width": 2, "stroke-opacity": 0.75 };
  return (
    path(front, { fill, "fill-opacity": n(lift * 0.5), ...edge }) +
    path(side, { fill, "fill-opacity": n(lift * 0.3), ...edge }) +
    path(top, { fill, "fill-opacity": n(lift), stroke, "stroke-width": 2 })
  );
}

export const stack: Emitter<"stack"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const L = stackLayout(p, ctx.format);
  const count = p.layers.length;
  const last = count - 1;

  const body = p.layers
    .map((layer, i) => {
      const y0 = L.yBase - i * L.rise;
      const mid = y0 - L.sy / 2;
      const top = i === last;
      const tint = top ? theme.tones.b : theme.accent;
      const stroke = top ? theme.tones.b : theme.rule;
      // Fill opacity climbs with the pile, so depth reads even in greyscale.
      const lift = 0.09 + 0.13 * (i / Math.max(1, last));

      const leader = line(
        { x: L.x0 + L.w + L.sx / 2 + 8, y: mid },
        { x: L.labelX - 14, y: mid },
        { stroke: theme.rule, "stroke-width": 2 },
      );
      const dot = circle({ x: L.x0 + L.w + L.sx / 2 + 8, y: mid }, 6, { fill: tint });

      const block = L.lines[i] ?? { label: [], note: [], noteW: 0, labelMaxW: L.colW };
      const labelH = block.label.length * L.labelSize * 1.16;
      const noteH = block.note.length > 0 ? 6 + block.note.length * MIN_FONT * 1.16 : 0;
      const label = text(
        layer.label,
        { x: L.labelX, y: L.inline ? mid : mid - noteH / 2 },
        {
          size: L.labelSize,
          weight: labelWeight(i, count),
          fill: top ? theme.tones.b : theme.fg,
          maxWidth: block.labelMaxW,
          lineHeight: 1.16,
          vAlign: "middle",
        },
      );
      // Beside the label and right-aligned on the spine when the pile is too
      // tall to give every layer two lines; beneath it otherwise.
      const note =
        layer.note === undefined
          ? ""
          : text(
              layer.note,
              L.inline
                ? { x: L.labelX + L.colW, y: mid }
                : // Relative to the label's own centre (`mid - noteH/2`), not to
                  // `mid`: measuring the drop from `mid` put the note 20px low, so
                  // it sat 26px under its own label and 18px over the *next* one —
                  // a note reads as belonging to whichever label it is nearer, and
                  // that was the wrong one. Half a lead below the label's baseline
                  // box centres the pair on the leader dot again.
                  { x: L.labelX, y: mid + labelH / 2 + 3 },
              {
                size: MIN_FONT,
                fill: theme.muted,
                anchor: L.inline ? "end" : "start",
                maxWidth: L.inline ? undefined : L.colW,
                lineHeight: 1.16,
                vAlign: "middle",
              },
            );
      const num = text(
        String(i + 1),
        { x: NUM_X, y: mid },
        { size: MIN_FONT, weight: 600, fill: theme.dim, anchor: "end", vAlign: "middle" },
      );

      return (
        group(slab(L.x0, y0, L, tint, lift, stroke), { id: id(sid, "lay", i), class: "lay" }) +
        group(num + leader + dot + label + note, { id: id(sid, "cap", i), class: "cap" })
      );
    })
    .join("");

  const noteHtml = p.note ? `\n<div class="stnote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, contentW(ctx.format))}
<div class="stackwrap">${svg(id(sid, "stack"), L.width, L.height, body)}</div>${noteHtml}`;

  const first = 0.9;
  const step = Math.min(0.8, Math.max(0.4, (beat.seconds - first - 1.5) / count));
  const tl = [...chromeIn(sid, p.eyebrow !== undefined)];
  const holds: number[] = [];

  p.layers.forEach((_, i) => {
    const at = first + i * step;
    // The plane travels the last stretch of its own rise, so the pile is seen
    // being built rather than assembled off-screen and switched on.
    tl.push(
      tween(
        `#${sid}-lay${i}`,
        { opacity: 0, y: 34 },
        { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" },
        at,
      ),
    );
    tl.push(tween(`#${sid}-cap${i}`, { opacity: 0 }, { opacity: 1, duration: 0.4 }, at + 0.2));
    holds.push(at + 0.62);
  });

  if (p.note) {
    const at = first + count * step;
    tl.push(tween(`#${sid}-note`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, at));
    holds.push(at + 0.7);
  }

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // Every size the diagram picks is per-beat, so it rides on the elements as
      // attributes; what is left here is identical for every stack scene and the
      // shell emits it once.
      ".stackwrap{align-self:center;margin-top:20px}",
      noteCss("stnote", theme, 28),
      // The top plane is the focal point — last built, differently toned, and the
      // one the final hold sits on. Its entrance owns `opacity` and `transform`,
      // so the breath takes `filter`, the property nothing else writes.
      ambient(sid, `-lay${last}`, BREATHE),
    ].join("\n"),
  };
};
