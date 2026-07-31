/**
 * A chart the source never drew.
 *
 * Papers report sweeps as tables and leave the shape of the curve to the reader.
 * Drawing it is the whole point of this archetype, so everything here is derived
 * from the data — the scale especially. A hardcoded axis is how a chart ends up
 * asserting something the numbers do not.
 */
import type { Emitter } from "../kit.js";
import { contentW, esc } from "../kit.js";
import { drawFrom, wrap } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  BODY_SIZE,
  bodyBudget,
  chrome,
  chromeCss,
  chromeIn,
  holdsWithin,
  isPortrait,
  tween,
} from "./title.js";

/** `.chartwrap`'s top margin. Named so the budget and the stylesheet agree. */
const CHART_TOP = 24;
/** `.chartwrap`'s flex gap, and `.readout`'s `max-width`. Same reason. */
const CHART_GAP = 60;
const READOUT_W = 460;
/** `.readout`'s line height. It is set tighter than body copy — see the rule below. */
const READOUT_LH = 1.35;

/**
 * The tallest a portrait plot may be, as a multiple of its own width.
 *
 * Portrait hands this archetype ~1300px of vertical budget against 860 of width.
 * Spending all of it draws an 860x1300 plot, and a rising curve in a box half as
 * wide as it is tall reads as a vertical scribble: the five categories pile into
 * a column, their labels overprint each other, and the diminishing returns the
 * slide is about become invisible because every step looks equally steep.
 * 1.15 is a plot squarer than landscape's and still recognisably a chart; the
 * budget it declines goes back to the slide as margin, which reads as air.
 */
const TALL_ASPECT = 1.15;

export interface Scale {
  min: number;
  max: number;
  step: number;
  decimals: number;
}

/**
 * A round-numbered scale that provably contains every value. Exported because
 * "the axis spans the data" is the one property a chart must never get wrong,
 * and it is worth asserting directly rather than through rendered SVG.
 */
export function chartScale(values: number[]): Scale {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const leading = raw / magnitude;
  const step = (leading <= 1 ? 1 : leading <= 2 ? 2 : leading <= 5 ? 5 : 10) * magnitude;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  return { min, max: max > min ? max : min + step, step, decimals };
}

/** Two decimals of SVG precision, so two renders of the same beat are byte-identical. */
function n(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/** `r` is only the floor — the last point's labels can need more, see `padR`. */
// `t` is 96, not the 60 the plot alone would want: the y-axis name is set at the
// svg's top-left and the topmost tick label is right-anchored just left of the
// plot, so at 60 the two shared a band and "(dB)" printed through "31". Both are
// 40px type, so the gap has to be a whole line.
const PAD = { l: 150, r: 40, t: 96, b: 140 };

/**
 * Where a category sits along the axis.
 *
 * Evenly spaced categories flatten the very curve a diminishing-returns slide is
 * claiming (EXPERIMENT-006, "Known, not fixed"): "T=0, T=1, T=2, T=4" drawn at
 * four equal steps says the last gain took one tick when it took two. So when
 * every category carries a number, the axis is that number. When one does not —
 * "baseline", "ours" — the categories are nominal and equal steps are correct.
 *
 * Ties would divide by zero, and are also not a scale, so they fall back too.
 */
function axisValues(labels: string[]): number[] | undefined {
  const nums = labels.map((l) => Number(/-?\d+(\.\d+)?/.exec(l)?.[0] ?? Number.NaN));
  if (nums.some(Number.isNaN)) return undefined;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (hi === lo) return undefined;
  // Strictly increasing, or the polyline doubles back on itself and the "curve"
  // is a scribble — which is worse than the even spacing it replaced.
  if (nums.some((v, i) => i > 0 && v <= (nums[i - 1] ?? v))) return undefined;
  return nums.map((v) => (v - lo) / (hi - lo));
}

export const lineChart: Emitter<"line-chart"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  const scale = chartScale(p.points.map((pt) => pt.y));
  const box = contentW(ctx.format);
  // PORTRAIT: the readout goes UNDER the chart. Beside it, the readout's 460px
  // took more than half of the 860px box and left the plot 400 wide — five
  // categories 62px apart, so "T=0 T=1 T=2 T=3 T=4" printed on top of itself as
  // "T=0#12=34" and every value label collided with the delta beside it. The
  // whole box is the least a chart can be drawn in here.
  // LANDSCAPE: beside, as before — 1700 has room for both and a readout under a
  // 1700px-wide chart is a caption nobody reads.
  const tall = isPortrait(ctx.format);
  // `.chartwrap` is a flex row in landscape: the readout takes its own
  // `max-width` plus the gap, and the chart gets the rest of the content box.
  // Stated as arithmetic because the svg's viewBox has to be the width the flex
  // box will hand it.
  const width = tall ? box : box - (p.readout ? CHART_GAP + READOUT_W : 0);
  // Stacked, the readout is below the chart and so comes out of its height
  // budget rather than out of its width.
  const below =
    tall && p.readout
      ? wrap(p.readout, BODY_SIZE, box).length * Math.round(BODY_SIZE * READOUT_LH) + CHART_GAP
      : 0;
  // The chart is the argument, so it takes the room the chrome and the readout
  // leave rather than a flat 600 that fitted a two-line headline and nothing
  // else. `CHART_TOP` is `.chartwrap`'s margin.
  const budget = bodyBudget(ctx.format, p.eyebrow, p.headline, below, CHART_TOP);
  const H = Math.round(tall ? Math.min(budget, width * TALL_ASPECT) : budget);
  // The last point's value and axis labels are centred on the last x, so half of
  // the wider one hangs past it — which at a flat 40px pad the layout gate
  // reports as container_overflow.
  //
  // Estimate the two separately: a value is tabular figures (~0.58em, as in the
  // table), while a category name is proportional and reaches ~0.68em once it
  // has capitals. Measuring them with one number left the widest real label
  // 3.6px from the clip edge, so carry explicit slack rather than round down to
  // a near miss — this is the cheap side of the trade.
  const last = p.points[p.points.length - 1];
  const valueW = String(last?.y ?? "").length * 40 * 0.58;
  const labelW = (last?.x ?? "").length * 40 * 0.68;
  const padR = Math.max(PAD.r, Math.ceil(Math.max(valueW, labelW) / 2) + 16);
  const plotW = width - PAD.l - padR;
  const plotH = H - PAD.t - PAD.b;
  const at = axisValues(p.points.map((pt) => pt.x));
  const x = (i: number) => PAD.l + (at ? (at[i] ?? 0) : i / (p.points.length - 1)) * plotW;
  const y = (v: number) => PAD.t + ((scale.max - v) / (scale.max - scale.min)) * plotH;

  const ticks = Array.from(
    { length: Math.round((scale.max - scale.min) / scale.step) + 1 },
    (_, i) => scale.min + i * scale.step,
  );

  const grid = ticks
    .map((v) => `<line x1="${PAD.l}" y1="${n(y(v))}" x2="${width - padR}" y2="${n(y(v))}" />`)
    .join("");
  const yLabels = ticks
    .map((v) => `<text x="${PAD.l - 22}" y="${n(y(v) + 13)}">${v.toFixed(scale.decimals)}</text>`)
    .join("");
  const xLabels = p.points
    .map((pt, i) => `<text x="${n(x(i))}" y="${H - PAD.b + 56}">${esc(pt.x)}</text>`)
    .join("");

  const path = p.points.map((pt, i) => `${i === 0 ? "M" : "L"}${n(x(i))},${n(y(pt.y))}`).join(" ");
  // The dash animation needs the path length. `getTotalLength()` would mean a DOM
  // measurement at render time; a polyline's length is just the sum of its segments.
  const length = p.points.reduce(
    (total, pt, i) =>
      i === 0 ? 0 : total + Math.hypot(x(i) - x(i - 1), y(pt.y) - y(p.points[i - 1]?.y ?? pt.y)),
    0,
  );

  const dots = p.points
    .map(
      (pt, i) =>
        `<circle class="dot" cx="${n(x(i))}" cy="${n(y(pt.y))}" r="${i === p.points.length - 1 ? 11 : 9}" fill="${i === p.points.length - 1 ? theme.tones.b : theme.accent}" />`,
    )
    .join("");
  // HOW MANY LABELS THE PLOT CAN CARRY.
  //
  // A value sits over every point and a delta over every midpoint, so both are
  // spaced by the step between points. `points` has no maximum in the schema:
  // at 5 points the step is ~240px and 40px labels clear each other, at 16 it is
  // ~75px and "28.90" prints straight through its neighbour — 69 overlapping
  // pairs on one slide, with every gate green.
  //
  // Thinned rather than shrunk: 40px IS the audience floor (invariant 5), so
  // there is nowhere to shrink to. The first and last always survive because
  // they carry the range the chart is about; the rest are dropped evenly.
  const LABEL_SIZE = 40;
  /** Tabular figures run ~0.58em, the same estimate `padR` above uses. */
  const runW = (s: string) => s.length * LABEL_SIZE * 0.58;
  const widestValue = Math.max(...p.points.map((pt) => runW(String(pt.y))));
  const lastPoint = p.points.length - 1;

  // Chosen by walking the axis and keeping a label only where the previous one
  // has ended, rather than by a fixed stride.
  //
  // A stride plus "always keep the last" is what a modulo gives you, and the two
  // rules meet badly at the end: at 16 points the stride kept index 14 and the
  // rule kept 15, which are one step — 68px — apart under 116px labels. Six
  // overlapping pairs, in the fix for overlapping pairs. Walking the real edges
  // has no seam to get wrong, and handles labels of different widths, which a
  // stride cannot.
  /** The first is anchored at the start, not centred, so it occupies only its right half. */
  const leftEdgeOf = (i: number) =>
    i === 0 ? x(i) : x(i) - runW(String(p.points[i]?.y ?? "")) / 2;
  const rightEdgeOf = (i: number) => {
    const w = runW(String(p.points[i]?.y ?? ""));
    return i === 0 ? x(i) + w : x(i) + w / 2;
  };

  const kept: number[] = [];
  for (let i = 0; i <= lastPoint; i++) {
    const previous = kept[kept.length - 1];
    if (i === lastPoint) {
      // The last always survives: with the first it carries the range the chart
      // is about. Anything it would land on gives way instead.
      while (kept.length > 0 && rightEdgeOf(kept[kept.length - 1] as number) + 8 > leftEdgeOf(i)) {
        kept.pop();
      }
      kept.push(i);
    } else if (previous === undefined || leftEdgeOf(i) >= rightEdgeOf(previous) + 8) {
      kept.push(i);
    }
  }
  const shownValues = new Set(kept);
  const showsValue = (i: number) => shownValues.has(i);

  const values = p.points
    .map((pt, i) => ({ pt, i }))
    .filter(({ i }) => showsValue(i))
    .map(({ pt, i }) => {
      // The first point sits ON the axis (x(0) === PAD.l), so a middle-anchored
      // value hangs half its width to the LEFT of the plot and prints straight
      // through the y-axis label beside it — measured at 16.4px of baseline
      // separation inside a 40px line at 9:16, and it is just as wrong at 16:9.
      // The existing `Math.max(44, …)` guards the top edge only, and the test at
      // test/archetypes.test.ts checks the LAST label against the frame; this is
      // the same hazard at the other end, against the axis instead of the frame.
      const anchor = i === 0 ? ' text-anchor="start"' : "";
      return `<text class="pv"${anchor} x="${n(x(i))}" y="${n(Math.max(44, y(pt.y) - 26))}">${esc(String(pt.y))}</text>`;
    })
    .join("");
  // Deltas share the band with the values in landscape and sit half a step from
  // them, so they need that half-step to hold both halves plus air. Stacked
  // below the line in portrait they only have to clear each OTHER, a full step
  // apart. Where neither holds the deltas are dropped: the values and the line
  // still carry the shape, and a legible chart missing its annotations beats an
  // illegible one that has them.
  /** A label's painted box: middle-anchored on `cx`, sitting on baseline `cy`. */
  const labelBox = (cx: number, cy: number, text: string, anchorStart = false) => {
    const w = runW(text);
    return { x: anchorStart ? cx : cx - w / 2, y: cy - LABEL_SIZE, w, h: LABEL_SIZE };
  };
  const valueBoxes = p.points
    .map((pt, i) => ({ pt, i }))
    .filter(({ i }) => showsValue(i))
    .map(({ pt, i }) => labelBox(x(i), Math.max(44, y(pt.y) - 26), String(pt.y), i === 0));

  // WHETHER THE DELTAS FIT IS A QUESTION ABOUT BOXES, NOT ABOUT SPACING.
  //
  // A horizontal rule alone gets this wrong in both directions. A delta sits half
  // a step from the values either side, which makes the spacing tighter than it
  // looks — but it also rides the MIDPOINT of two points' heights while a value
  // rides its own point, so on a rising curve they are vertically separated and
  // never meet however close they are horizontally. The demo's five points are
  // exactly that case: a step-based test drops four deltas the chart has always
  // shown and that measure clean.
  //
  // So the real boxes are compared, the same way the layout gate compares them.
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 8 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 8;
  const deltaBoxes = (p.deltas ?? []).slice(0, p.points.length - 1).map((d, i) => {
    const a = p.points[i];
    const b = p.points[i + 1];
    if (!a || !b) return null;
    const mid = (y(a.y) + y(b.y)) / 2;
    return labelBox((x(i) + x(i + 1)) / 2, tall ? mid + 52 : Math.max(44, mid - 28), d);
  });
  // All or none: a chart showing the gain between some pairs and not others reads
  // as data missing rather than as a layout decision.
  const deltasFit = deltaBoxes.every(
    (d, i) =>
      d !== null &&
      !valueBoxes.some((v) => overlaps(d, v)) &&
      deltaBoxes.slice(i + 1).every((o) => o === null || !overlaps(d, o)),
  );
  const deltas = (deltasFit ? (p.deltas ?? []) : [])
    .slice(0, p.points.length - 1)
    .map((d, i) => {
      const a = p.points[i];
      const b = p.points[i + 1];
      if (!a || !b) return "";
      const mid = (y(a.y) + y(b.y)) / 2;
      // PORTRAIT: below the line. A delta sits over the midpoint between two
      // points and a value sits over each point, so they are only half a step
      // apart horizontally — at 1700 that half-step is ~240px and the two 40px
      // labels clear each other, at 860 it is ~80px and "+0.09" printed through
      // "30.47". Below the line they cannot meet at all, and on a rising curve
      // that half of the plot is the empty one.
      // LANDSCAPE: above, where it has always been and has the room.
      const dy = tall ? mid + 52 : Math.max(44, mid - 28);
      return `<text class="dv" x="${n((x(i) + x(i + 1)) / 2)}" y="${n(dy)}">${esc(d)}</text>`;
    })
    .join("");

  const readout = p.readout
    ? `\n  <div class="readout" id="${sid}-read">${esc(p.readout)}</div>`
    : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, box)}
<div class="chartwrap${tall ? " chartstack" : ""}">
  <svg id="${sid}-chart" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">
    <g class="grid">${grid}</g>
    <g class="axlab" text-anchor="end">${yLabels}</g>
    <g class="axlab" text-anchor="middle">${xLabels}</g>
    <!-- Baseline, not top edge: at 40px a y of 26 puts the cap height 13px above
         the svg and the layout gate reports container_overflow. -->
    <text class="axname" x="0" y="42">${esc(p.yLabel)}</text>
    <text class="axname" x="${n(PAD.l + plotW / 2)}" y="${H - 16}" text-anchor="middle">${esc(p.xLabel)}</text>
    <path class="chartline" id="${sid}-line" d="${path}" fill="none" stroke="${theme.accent}" />
    <g>${dots}</g>
    <g class="ptlab" text-anchor="middle">${values}</g>
    <g class="delta" text-anchor="middle">${deltas}</g>
  </svg>${readout}
</div>`;

  const draw = 0.8;
  const step = Math.min(0.45, 1.8 / p.points.length);
  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(
      `#${sid}-line`,
      drawFrom(length),
      { strokeDashoffset: 0, duration: 1.8, ease: "none" },
      draw,
    ),
    tween(
      `#${sid} .dot`,
      // Origin in both halves, or GSAP's smoothOrigin compensates the change with
      // a translate that survives the tween — the dots rested 9px off the very
      // polyline they mark, inside the frame and so invisible to every gate.
      { opacity: 0, scale: 0, transformOrigin: "center" },
      { opacity: 1, scale: 1, transformOrigin: "center", duration: 0.3, stagger: step },
      draw,
    ),
    tween(`#${sid} .pv`, { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: step }, draw + 0.2),
  ];
  if (deltas) {
    tl.push(
      tween(
        `#${sid} .dv`,
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.35, stagger: step },
        draw + 0.6,
      ),
    );
  }

  const drawn = draw + step * p.points.length + 0.4;
  const holds = [drawn];
  if (p.readout) {
    tl.push(
      // It enters from wherever it sits: from the right when it is beside the
      // chart, from below when it is under it.
      tall
        ? tween(`#${sid}-read`, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7 }, drawn)
        : tween(`#${sid}-read`, { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.7 }, drawn),
    );
    holds.push(drawn + 0.8);
  }

  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      `.chartwrap{display:flex;gap:${CHART_GAP}px;align-items:center;margin-top:${CHART_TOP}px}`,
      // PORTRAIT only. The readout stops being a side note and becomes the line
      // under the chart, so it also stops being capped at `READOUT_W` — 460px
      // inside an 860px box would set it in a column narrower than the chart it
      // is captioning, with the other 400px empty beside it.
      //
      // Named `.chartstack`, not `.stackwrap`: `.stackwrap` is stack.ts's class
      // (`align-self:center;margin-top:20px`) and one stylesheet serves the whole
      // deck, so sharing the name hands this wrapper stack's `align-self:center`
      // — which stops a flex item stretching, i.e. exactly what `stretch` here is
      // asking for. It survives today only because the svg is already the full
      // box width; a chart narrower than its box would sit centred with the
      // readout ragged beside it.
      ".chartstack{flex-direction:column;align-items:stretch}",
      ".chartstack .readout{max-width:none}",
      `.grid line{stroke:${theme.rule};stroke-width:1}`,
      `.chartline{stroke-width:5;stroke-linejoin:round;stroke-linecap:round}`,
      `.axlab{font-size:40px;fill:${theme.dim}}`,
      `.axname{font-size:40px;fill:${theme.muted};font-weight:500}`,
      `.ptlab{font-size:40px;fill:${theme.fg};font-weight:600}`,
      `.delta{font-size:40px;fill:${theme.tones.b};font-weight:600}`,
      // 1.7 set the two lines of a wrapped readout 68px apart, which reads as two
      // unrelated fragments rather than one sentence. 1.35 keeps it a paragraph.
      `.readout{font-size:${BODY_SIZE}px;line-height:${READOUT_LH};color:${theme.muted};max-width:${READOUT_W}px}`,
      // The last point — the one the readout is about. It is drawn larger and in
      // a different tone for the same reason. Its own `<g>` holds circles only,
      // so `:last-of-type` is the endpoint. The dots' entrance owns `scale`.
      ambient(sid, " .dot:last-of-type", BREATHE),
    ].join("\n"),
  };
};
