/**
 * A chart the source never drew.
 *
 * Papers report sweeps as tables and leave the shape of the curve to the reader.
 * Drawing it is the whole point of this archetype, so everything here is derived
 * from the data — the scale especially. A hardcoded axis is how a chart ends up
 * asserting something the numbers do not.
 */
import type { Emitter } from "../kit.js";
import { contentW, esc, sec } from "../kit.js";
import { DRAW_FROM, DRAW_TO, faceOf, nv, reshape, textWidth, travel, wrap } from "../svg.js";
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

/**
 * How long the baseline curve takes to become the result, and how far it fades
 * once it has been left behind.
 *
 * 1.2s is slow enough that the eye can follow one point moving rather than see a
 * cut, and short enough that the beat still has room for its own dots and values
 * afterwards. 0.28 leaves the ghost legible as a shape while making it
 * unmistakably the thing that is no longer being asserted — at 0 it is a cut, at
 * 0.5 the two curves compete.
 */
const RESHAPE_SECONDS = 1.2;
const GHOST_OPACITY = 0.28;

/**
 * The curve going on, and the half-second the copy takes to leave it.
 *
 * `DRAW_SECONDS` is the length a draw-on is authored at; `DRAW_FLOOR` is the
 * least a short beat may compress it to — under a second a curve stops arriving
 * and starts appearing, which is the cut the reshape exists to avoid. The floor
 * also keeps the ghost's own 0.5s fade, which starts at 1.2s, finished before
 * the copy lifts at `0.8 + DRAW_FLOOR`.
 */
const DRAW_SECONDS = 1.8;
const DRAW_FLOOR = 1.0;
const SEPARATE = 0.5;
/**
 * The least the point-by-point reveal may be staggered by. Below this the dots
 * — 0.3s each — overlap so far that they arrive as one pop, and a reveal that is
 * not point by point is not doing the thing it is there for.
 */
const STEP_FLOOR = 0.15;

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
  // Every run measured below is ASCII, so `textWidth`'s own sniff sees Latin —
  // but a CJK deck sets ASCII in the CJK family too, where 31 of those glyphs
  // are wider. Under-charging is the unrecoverable direction: the layout keeps
  // a label the browser then draws past the frame.
  const face = faceOf(theme.fontStack);

  // BOTH SERIES, or the baseline draws outside its own plot. The schema has
  // already established that `compare` runs over the same x labels, so the only
  // thing the second series can change is the y range — and a scale fitted to
  // one of two curves is the hardcoded axis this file's header warns about,
  // arrived at from the other direction.
  const cmp = p.compare;
  const scale = chartScale([...p.points, ...(cmp?.points ?? [])].map((pt) => pt.y));
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
      ? wrap(p.readout, BODY_SIZE, box, 400, 0, face).length * Math.round(BODY_SIZE * READOUT_LH) +
        CHART_GAP
      : 0;
  // The chart is the argument, so it takes the room the chrome and the readout
  // leave rather than a flat 600 that fitted a two-line headline and nothing
  // else. `CHART_TOP` is `.chartwrap`'s margin.
  const budget = bodyBudget(ctx.format, p.eyebrow, p.headline, below, CHART_TOP, undefined, face);
  const H = Math.round(tall ? Math.min(budget, width * TALL_ASPECT) : budget);
  // The last point's value and axis labels are centred on the last x, so half of
  // the wider one hangs past it — which at a flat 40px pad the layout gate
  // reports as container_overflow.
  //
  // Both through `textWidth`. They used to be two hand-rolled em factors here —
  // 0.58 a character for a value, 0.68 for a category name — which is a second
  // opinion about a question this project has exactly one answer to, and the
  // reason `test/svg.test.ts` had to assert that `textWidth` stayed above them.
  // Neither survives contact with a measured table: "SET5" is 2.539em, not the
  // 2.72 that 0.68/char claims, and "T=9" is 1.957 against 2.04.
  const last = p.points[p.points.length - 1];
  const valueW = textWidth(String(last?.y ?? ""), 40, 400, 0, false, face);
  const labelW = textWidth(last?.x ?? "", 40, 400, 0, false, face);
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
  /**
   * WHICH OF A ROW OF LABELS THE AXIS CAN CARRY.
   *
   * `points` has no maximum in the schema, and every row along the x axis — the
   * category names, the values over the points — is spaced by the step between
   * points. At 5 points that step is ~250px and 40px labels clear each other; at
   * 16 it is ~68px and they print through their neighbours.
   *
   * Chosen by walking the axis and keeping a label only where the previous one
   * has ended, rather than by a stride. A stride plus "always keep the last" is
   * two rules that meet badly at the end — the stride keeps index 14, the rule
   * keeps 15, and they are one step apart. Walking the real edges has no seam,
   * and handles labels of different widths, which a stride computed from the
   * widest cannot.
   *
   * Thinned rather than shrunk, because 40px IS the audience floor (invariant 5)
   * and there is nowhere to shrink to. First and last always survive: together
   * they carry the range the chart is about.
   */
  const fitIndices = (widthAt: (i: number) => number, firstAnchoredStart: boolean): Set<number> => {
    const leftEdge = (i: number) => (i === 0 && firstAnchoredStart ? x(i) : x(i) - widthAt(i) / 2);
    const rightEdge = (i: number) =>
      i === 0 && firstAnchoredStart ? x(i) + widthAt(i) : x(i) + widthAt(i) / 2;
    const kept: number[] = [];
    const last = p.points.length - 1;
    for (let i = 0; i <= last; i++) {
      const previous = kept[kept.length - 1];
      if (i === last) {
        // Anything the last would land on gives way instead of crowding it.
        while (kept.length > 0 && rightEdge(kept[kept.length - 1] as number) + 8 > leftEdge(i)) {
          kept.pop();
        }
        kept.push(i);
      } else if (previous === undefined || leftEdge(i) >= rightEdge(previous) + 8) {
        kept.push(i);
      }
    }
    return new Set(kept);
  };

  const LABEL_SIZE = 40;
  /** One answer to "how wide is this", shared with every other archetype. */
  const runW = (s: string) => textWidth(s, LABEL_SIZE, 400, 0, false, face);
  const catW = (s: string) => textWidth(s, LABEL_SIZE, 400, 0, false, face);
  /** The same, at `.axname`'s declared 500. */
  const nameW = (s: string) => textWidth(s, LABEL_SIZE, 500, 0, false, face);
  /**
   * And at `.ghostlab`'s 600. Measuring the ghost with `runW` under-charges its
   * width, so the predicate accepts a candidate the browser then overprints — the
   * same weight mismatch the perturbation sweep already found once in `stack`,
   * measured at 600 and drawn at 700 so its second line printed through the note.
   */
  const ghostW = (s: string) => textWidth(s, LABEL_SIZE, 600, 0, false, face);

  // The category names were the six collisions left after the values were
  // thinned: "T=9" through "T=15" printing into each other along the bottom of a
  // 16-point chart. Same disease, same cure.
  const shownX = fitIndices((i) => catW(p.points[i]?.x ?? ""), false);
  const xLabels = p.points
    .map((pt, i) =>
      shownX.has(i) ? `<text x="${n(x(i))}" y="${H - PAD.b + 56}">${esc(pt.x)}</text>` : "",
    )
    .join("");

  const pathOf = (pts: readonly { y: number }[]) =>
    pts.map((pt, i) => `${i === 0 ? "M" : "L"}${n(x(i))},${n(y(pt.y))}`).join(" ");
  const path = pathOf(p.points);
  const basePath = cmp ? pathOf(cmp.points) : "";

  const dots = p.points
    .map(
      (pt, i) =>
        `<circle class="dot" cx="${n(x(i))}" cy="${n(y(pt.y))}" r="${i === p.points.length - 1 ? 11 : 9}" fill="${i === p.points.length - 1 ? theme.tones.b : theme.accent}" />`,
    )
    .join("");
  // The values, by the same walk. The first is anchored at the START rather than
  // centred — see the axis note below — so it occupies only its right half.
  const shownValues = fitIndices((i) => runW(String(p.points[i]?.y ?? "")), true);
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

  /**
   * The reader: a hollow ring that walks the curve while it draws, sitting on
   * each point as that point's value appears.
   *
   * Drawn AT the first point in the chart's own coordinates, so the identity
   * transform is the start of the walk and a build whose timeline never runs
   * leaves it somewhere sane. It is what turns "a line appears" into "each tick
   * buys less than the one before it" — the eye is taken along the curve
   * instead of being handed the finished shape.
   */
  const first = { x: x(0), y: y(p.points[0]?.y ?? 0) };
  const ring =
    p.points.length > 1
      ? `<circle id="${sid}-ring" cx="${n(first.x)}" cy="${n(first.y)}" r="20" fill="none" stroke="${theme.tones.b}" stroke-width="5" opacity="0" />`
      : "";

  /**
   * THE RESHAPE, DRAWN AS THREE PATHS RATHER THAN ONE.
   *
   * `-base` is drawn on and never reshaped; `-line` is reshaped and never drawn
   * on; `-target` is geometry only, carrying the final `d` for MorphSVG to read.
   *
   * THE HAZARD THAT SPLIT WAS FOR, AND NO LINT SEES IT. DrawSVG and MorphSVG
   * write different GSAP properties, so `overlapping_gsap_tweens` stays quiet
   * about the two of them on one element — but after `drawSVG: 100%` GSAP leaves
   * `stroke-dasharray` at the OLD path's length, and reshaping to a longer path
   * then leaves the tail unpainted: inside the frame, above the type floor, and
   * invisible to every gate. Sequencing around it would work until someone
   * changed the sequence. Two elements cannot interact.
   *
   * `-target` is `stroke="none"`: present for `document.querySelector`, painting
   * nothing. Not `display:none`, which some browsers refuse to measure.
   */
  const lineTag = (part: string, d: string, extra = "") =>
    `<path class="chartline" id="${sid}-${part}" d="${d}" fill="none" stroke="${theme.accent}"${extra} />`;
  const chartlines = cmp
    ? [
        lineTag("base", basePath),
        lineTag("line", basePath, ' opacity="0"'),
        `<path id="${sid}-target" d="${path}" fill="none" stroke="none" />`,
      ].join("\n    ")
    : lineTag("line", path);

  /**
   * THE VERTICAL BAND ONE OF THE TWO CURVES OCCUPIES BETWEEN TWO X POSITIONS.
   *
   * Both series are polylines, so over any x range their y values form one
   * unbroken interval — the vertices inside the range, plus the interpolated y
   * at each edge. Continuity does the rest: every y in that interval is reached
   * at some x inside the range, so a box whose own y range meets the interval is
   * a box the curve is drawn through. Nothing has to be sampled, and there is no
   * step size to get wrong.
   */
  const curveBand = (pts: readonly { y: number }[], x0: number, x1: number): [number, number] => {
    const ys: number[] = [];
    const py = (i: number) => y(pts[i]?.y ?? 0);
    for (let i = 0; i < pts.length; i++) {
      if (x(i) >= x0 && x(i) <= x1) ys.push(py(i));
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, bx] = [x(i), x(i + 1)];
      for (const edge of [x0, x1]) {
        if (edge > Math.min(ax, bx) && edge < Math.max(ax, bx)) {
          ys.push(py(i) + ((py(i + 1) - py(i)) * (edge - ax)) / (bx - ax));
        }
      }
    }
    // An empty band never overlaps: `-Infinity - Infinity` is not greater than 8.
    return ys.length > 0
      ? [Math.min(...ys), Math.max(...ys)]
      : [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  };

  /**
   * THE TEXT THIS CHART SETS WHATEVER THE DATA SAYS.
   *
   * `valueBoxes` and `deltaBoxes` are the runs the DATA puts on the plot, and
   * they were the whole of what the ghost was tested against — which left out
   * every run that is there on every line chart this file has ever emitted. The
   * y-axis NAME is the one that bites. It is set at the svg's top-left, and a
   * first-x candidate is `start`-anchored at `x(0)` — which is `PAD.l`, 150 —
   * with its baseline clamped up to at least 44, so the two share a band by
   * construction rather than by coincidence.
   *
   * MEASURED on this emitter, points [80, 60, 45, 40] against [100, 55, 70, 42]
   * with "PSNR (dB)" on the axis and "Baseline" as the ghost: both last-x
   * candidates are blocked, the ghost falls through to the first x and the away
   * side clamps to 70, and the emitted `<text class="ghostlab" …
   * text-anchor="start" x="150" y="70">` ran straight through "PSNR (dB)", which
   * this file charges 204.87px at `.axname`'s declared 500 and so occupies
   * x 0-204.87 at y 2-42. 54.87px of horizontal overlap, 12px of vertical.
   * With the set below in the collision test that beat drops the ghost outright
   * — all four candidates are rejected — which is the `deltasFit` answer and the
   * right one: an unnamed ghost is still legibly the fainter, earlier curve.
   *
   * THE OTHER THREE ARE HERE BECAUSE THE RULE IS "EVERY ALWAYS-DRAWN RUN", NOT
   * BECAUSE ANY OF THEM HAS BEEN SEEN TO COLLIDE. On today's clamps none can.
   * The tick labels are `end`-anchored at `PAD.l - 22`, so they end 22px left of
   * where the first-x candidates begin. The category names sit on a baseline of
   * `H - PAD.b + 56`, so their boxes start 12px below `H - PAD.b + 4`, the
   * lowest baseline `toward` can reach; the x-axis name's box starts 80px below
   * it. They are in the set so that moving one of those clamps — or the padding
   * either is measured from — cannot silently re-open this.
   *
   * AND THAT IS ALL OF THEM. The runs this archetype sets are the two `.axname`s,
   * the tick labels, the category names, the `.pv` values, the `.dv` deltas, the
   * `.ghostlab` itself, the `.readout`, and the eyebrow and headline `chrome`
   * puts above the chart. The first four are here, the values and deltas are the
   * two data-driven sets the candidate is tested against below, and the last
   * three CANNOT be in this set: the readout and the chrome are HTML siblings of
   * the `<svg>`, laid out by flex in the slide's coordinates, and comparing them
   * against a box in the viewBox's would be arithmetic between two different
   * spaces. They are kept clear by `bodyBudget` and `.chartwrap` instead.
   */
  const fixedBoxes = [
    // `.axname` is the one run here set at weight 500 rather than 400, and
    // under-charging a width is the unrecoverable direction (see `padR`).
    // No `text-anchor` on the y half, so it runs rightwards from x=0.
    { x: 0, y: 42 - LABEL_SIZE, w: nameW(p.yLabel), h: LABEL_SIZE },
    {
      x: PAD.l + plotW / 2 - nameW(p.xLabel) / 2,
      y: H - 16 - LABEL_SIZE,
      w: nameW(p.xLabel),
      h: LABEL_SIZE,
    },
    ...ticks.map((v) => {
      const w = runW(v.toFixed(scale.decimals));
      return { x: PAD.l - 22 - w, y: y(v) + 13 - LABEL_SIZE, w, h: LABEL_SIZE };
    }),
    ...p.points
      .map((pt, i) => ({ pt, i }))
      .filter(({ i }) => shownX.has(i))
      .map(({ pt, i }) => labelBox(x(i), H - PAD.b + 56, pt.x)),
  ];

  /**
   * THE GHOST'S NAME, THROUGH THE SAME BOXES AS EVERY OTHER LABEL HERE.
   *
   * Anchored at one END of the baseline and set away from the frame — at the
   * last x it is `end`-anchored and spans leftwards, at the first x it is
   * `start`-anchored and spans rightwards — so it cannot hang past `padR` or
   * `PAD.l` the way a middle-anchored label on either x would. That is the whole
   * of what is fixed about it. WHERE it goes is a collision question: the end of
   * the curve first, because that is where a series label is looked for, and on
   * the side away from the result, because that is the side the endpoint's own
   * value label is not on. Everything after the first candidate is what happens
   * when the preferred place is taken.
   *
   * WHAT EACH CANDIDATE IS TESTED AGAINST. Every other run this emitter sets:
   * `fixedBoxes` above — the axis names, the tick labels and the category names,
   * which are there whatever the data is — plus the drawn value labels and the
   * drawn deltas, which are there because of it. All of them are 40px runs in
   * the same band, and two of those printing through each other is invisible to
   * every layout gate. Measured twice on this emitter against the value labels:
   * with a "Loss" chart converging on 1.10 against 1.12, the ghost's
   * baseline landed at y=578.64 and the last value "1.1" at y=590.2, both at
   * x=1645; and with 30.47 against 30.55, the ghost and the last `.pv` overlapped
   * 32.3px vertically. `fitIndices` FORCE-KEEPS the last index, so the endpoint's
   * value is always there to be hit — this fires whenever the two series converge,
   * which is the shape a comparison beat is most often about.
   *
   * And both curves, because the label spans its own width sideways and a steep
   * segment draws straight through the name of the thing it is: compare y
   * [10, 11, 12, 95] against points y [40, 55, 70, 99] and the baseline's last
   * leg crosses its own label.
   *
   * NOTHING CLEAR MEANS NO NAME, the way `deltasFit` drops the deltas rather than
   * collide. An unnamed ghost is still legibly the fainter, earlier curve; a name
   * printed through a number is a defect in both of them.
   *
   * AND THIS ONE IS SILENT, unlike the degrade below: no `Scene.warnings` entry,
   * so `build` prints nothing and the job's warnings say nothing. The judgement
   * is that an unnamed ghost is legible where a dropped comparison is not. It
   * does mean a plan whose `compare.label` never reaches the slide gets no word
   * about it, which is the failure `warnings` was added for — revisit it here if
   * a real plan ever loses a label this way.
   */
  const lastI = p.points.length - 1;
  const ghost = (() => {
    if (!cmp) return undefined;
    const w = ghostW(cmp.label);
    if (w > plotW) {
      throw new Error(
        `line-chart ${beat.id}: the compare label "${cmp.label}" is ${Math.ceil(w)}px against the ${Math.floor(plotW)}px of plot it is set in. Shorten it.`,
      );
    }
    /** Both sides of one end of the baseline, the one away from the result first. */
    const atEnd = (i: number, start: boolean) => {
      const cy = y(cmp.points[i]?.y ?? 0);
      const away = Math.max(44, cy - 26);
      const toward = Math.min(cy + 52, H - PAD.b + 4);
      const sides = cy < y(p.points[i]?.y ?? 0) ? [away, toward] : [toward, away];
      return sides.map((by) => ({ i, start, by }));
    };
    const drawnDeltas = deltasFit ? deltaBoxes : [];
    return [...atEnd(lastI, false), ...atEnd(0, true)].find((c) => {
      const box = { x: c.start ? x(c.i) : x(c.i) - w, y: c.by - LABEL_SIZE, w, h: LABEL_SIZE };
      if (fixedBoxes.some((f) => overlaps(box, f))) return false;
      if (valueBoxes.some((v) => overlaps(box, v))) return false;
      if (drawnDeltas.some((d) => d !== null && overlaps(box, d))) return false;
      return ![p.points, cmp.points].some((series) => {
        const [top, bottom] = curveBand(series, box.x, box.x + box.w);
        return Math.min(box.y + box.h, bottom) - Math.max(box.y, top) > 8;
      });
    });
  })();
  const ghostLabel =
    cmp && ghost
      ? `\n    <text class="ghostlab" id="${sid}-ghostlab" text-anchor="${ghost.start ? "start" : "end"}" x="${n(x(ghost.i))}" y="${n(ghost.by)}">${esc(cmp.label)}</text>`
      : "";

  const readout = p.readout
    ? `\n  <div class="readout" id="${sid}-read">${esc(p.readout)}</div>`
    : "";
  const html = `${chrome(sid, p.eyebrow, p.headline, box, face)}
<div class="chartwrap${tall ? " chartstack" : ""}">
  <svg id="${sid}-chart" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">
    <g class="grid">${grid}</g>
    <g class="axlab" text-anchor="end">${yLabels}</g>
    <g class="axlab" text-anchor="middle">${xLabels}</g>
    <!-- Baseline, not top edge: at 40px a y of 26 puts the cap height 13px above
         the svg and the layout gate reports container_overflow. -->
    <text class="axname" x="0" y="42">${esc(p.yLabel)}</text>
    <text class="axname" x="${n(PAD.l + plotW / 2)}" y="${H - 16}" text-anchor="middle">${esc(p.xLabel)}</text>
    ${chartlines}${ghostLabel}
    <g>${dots}</g>
    ${ring}
    <g class="ptlab" text-anchor="middle">${values}</g>
    <g class="delta" text-anchor="middle">${deltas}</g>
  </svg>${readout}
</div>`;

  const draw = 0.8;
  const count = p.points.length;
  /** The stagger a beat with room to spare gets: the reveal spans the draw-on. */
  const idealStep = Math.min(0.45, DRAW_SECONDS / count);
  /**
   * WHAT A COMPARE SCHEDULE COSTS BEFORE ONE POINT HAS BEEN REVEALED. None of it
   * depends on the data: `draw` before the baseline starts, `SEPARATE` for the
   * copy to lift off it, `RESHAPE_SECONDS`, the readout's own 0.8s where there is
   * one, and `holdsWithin`'s 0.15s margin at the end.
   */
  const spine = draw + SEPARATE + RESHAPE_SECONDS + (p.readout ? 0.8 : 0) + 0.15;
  /** The deltas actually drawn — `deltasFit` keeps all of them or none. */
  const shownDeltas = deltas ? Math.min((p.deltas ?? []).length, count - 1) : 0;
  /**
   * WHEN THE CHART IS FINISHED, MEASURED FROM `settled`: the last of the four
   * things the reveal starts, not whichever one is usually last.
   *
   * The ring's walk plus the 0.4s it takes to leave is the longest of them at the
   * authored 0.45 stagger — but the deltas begin 0.6s in and run 0.35s, so below
   * a 0.275 stagger THEY are, and a fitted schedule reaches steps that short. A
   * hold placed at "the end" without asking every tail is a stop on a delta still
   * fading up, which is the same defect this whole block is about.
   */
  const tailAfter = (s: number) =>
    Math.max(
      s * count + 0.4, // the ring: its walk, then the 0.4s it takes to leave
      0.3 + s * (count - 1), // the dots
      0.5 + s * (count - 1), // the values, 0.2s behind them
      ...(shownDeltas > 0 ? [0.95 + s * (shownDeltas - 1)] : []),
    );
  /**
   * THE TWO SPANS THAT CAN GIVE, FITTED TO THE BEAT.
   *
   * `beat.seconds` is the planner's — `prompt.ts` tells it 5 to 12 is typical and
   * `durationPlan` hands out about 5 apiece for a twelve-beat minute — and held
   * at their authored length these two put the second hold at 6.5s on ANY chart
   * of four points or more, whatever the beat was planned as. At `seconds: 5`,
   * the prompt's own lower bound, `holdsWithin` then clamped that hold to 4.85
   * and the stop landed on one dot of four, one value of four, and the ring
   * parked mid-curve — in frame, above the type floor, and green in every gate,
   * because `beatSeconds` returns the authored value on a silent deck and no
   * verify rule compares a scene's duration against the end of its own timeline.
   *
   * THE DRAW-ON GIVES UP ITS LENGTH FIRST, all the way to `DRAW_FLOOR`, and only
   * then does the reveal give up any of its. The reveal is what the second hold
   * lands in and what the beat is about; compressing it first would crush the
   * point-by-point read while the baseline was still being laid down at leisure.
   *
   * Both are found by taking hundredths OFF until `tailAfter` fits, rather than
   * by inverting it. Inverting a max of four lines is four cases to keep in step
   * with the four tweens below, and the fifth tail somebody adds later would be
   * in none of them; a descent over the same function the schedule itself uses
   * cannot drift from it. In whole hundredths, because a fitted span rounded UP
   * is a schedule that stops fitting by a centisecond — and in integer
   * hundredths, because `0.23 - 0.01` is `0.21999999999999997` and would skip a
   * step on the way down.
   */
  const room = beat.seconds - spine;
  let drawCents = Math.round(DRAW_SECONDS * 100);
  let stepCents = Math.floor(idealStep * 100);
  if (cmp) {
    while (drawCents / 100 + tailAfter(stepCents / 100) > room) {
      if (drawCents > Math.round(DRAW_FLOOR * 100)) drawCents--;
      else if (stepCents > Math.round(STEP_FLOOR * 100)) stepCents--;
      else break;
    }
  }
  const drawFor = cmp ? drawCents / 100 : DRAW_SECONDS;
  const step = cmp ? stepCents / 100 : idealStep;
  /** When the baseline curve is whole and named — the moment before it is left behind. */
  const lift = sec(draw + drawFor);
  /**
   * When the curve on screen is the one the dots, values and ring are about.
   *
   * Without a comparison that is the instant the draw-on starts, and everything
   * rides the stroke as it is laid down. With one it is the instant the reshape
   * LANDS: the ring's route comes from `p.points`, so starting it any earlier
   * walks the final route over an intermediate curve — a marker beside its own
   * line, in frame, above the type floor, and green everywhere.
   */
  const settled = cmp ? sec(lift + SEPARATE + RESHAPE_SECONDS) : draw;
  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(
      `#${sid}-${cmp ? "base" : "line"}`,
      DRAW_FROM,
      { ...DRAW_TO, duration: drawFor, ease: "none" },
      draw,
    ),
  ];
  if (cmp) {
    tl.push(
      // Only where the ghost survived its own collision check — a tween on an id
      // nothing carries is a selector GSAP resolves to nothing, which is silent.
      ...(ghost
        ? [tween(`#${sid}-ghostlab`, { opacity: 0 }, { opacity: 1, duration: 0.5 }, draw + 0.4)]
        : []),
      // The copy lifts off — same geometry, so the half-second reads as one line
      // separating from itself rather than as a second line arriving.
      tween(`#${sid}-line`, { opacity: 0 }, { opacity: 1, duration: SEPARATE }, lift),
      tween(`#${sid}-base`, { opacity: 1 }, { opacity: GHOST_OPACITY, duration: SEPARATE }, lift),
      reshape(`#${sid}-line`, `#${sid}-target`, lift + SEPARATE, RESHAPE_SECONDS, true),
    );
  }
  tl.push(
    tween(
      `#${sid} .dot`,
      // Origin in both halves, or GSAP's smoothOrigin compensates the change with
      // a translate that survives the tween — the dots rested 9px off the very
      // polyline they mark, inside the frame and so invisible to every gate.
      { opacity: 0, scale: 0, transformOrigin: "center" },
      { opacity: 1, scale: 1, transformOrigin: "center", duration: 0.3, stagger: step },
      settled,
    ),
    tween(
      `#${sid} .pv`,
      { opacity: 0 },
      { opacity: 1, duration: 0.3, stagger: step },
      settled + 0.2,
    ),
  );
  if (deltas) {
    tl.push(
      tween(
        `#${sid} .dv`,
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.35, stagger: step },
        settled + 0.6,
      ),
    );
  }

  // The ring rides the same 1.8s the line takes to draw, point by point, so it
  // is always at the head of the stroke rather than racing it or trailing it.
  // With a comparison there is no stroke to ride — the curve is already whole by
  // then — and it reads instead as the reader going back over what the reshape
  // just produced, point by point, as each value appears. So THERE it paces the
  // values rather than a stroke: a hardcoded 1.8 is only the same span while
  // `step` is at its authored 0.45, and on a beat short enough to have
  // compressed the stagger it parks the ring mid-curve at the hold — on the
  // line, in frame, and green everywhere.
  const walk = cmp ? sec(step * count) : DRAW_SECONDS;
  if (count > 1) {
    const route = p.points.map((pt, i) => ({ x: nv(x(i) - first.x), y: nv(y(pt.y) - first.y) }));
    tl.push(
      tween(`#${sid}-ring`, { opacity: 0 }, { opacity: 1, duration: 0.25 }, settled),
      ...travel(`#${sid}-ring`, route, settled, walk),
      // And it leaves once the curve is whole: a marker parked on the last
      // point for the rest of the beat reads as a defect, not as emphasis.
      tween(
        `#${sid}-ring`,
        { opacity: 1 },
        { opacity: 0, duration: 0.4, immediateRender: false },
        settled + walk,
      ),
    );
  }

  // The compare path asks every tail; the plain one keeps the form its bytes are
  // pinned to in `test/wiring.test.ts`. THEY DO NOT AGREE EVERYWHERE, which the
  // sentence here used to claim. Walked over `tailAfter` at every count from 2 to
  // 30: they agree at 4 to 18 points without deltas, and only at 4 to 6 with
  // them. Below four the 0.45 cap binds, so `step * count` falls under the 1.8s
  // the ring still walks for — at two points the hold is at 2.1 while the ring is
  // fading out at 3.0. With deltas from seven up, `step` drops under the 0.275
  // where `tailAfter`'s delta line overtakes the ring's: at twelve points the hold
  // is 3.0 against a delta still fading up at 3.25. Without deltas the values
  // overtake it at nineteen, by 5ms. All of it is the defect `tailAfter` exists to
  // stop, and the plain path keeps the wrong form anyway because a fix moves bytes
  // `test/wiring.test.ts` pins — a change to make deliberately, not in passing.
  const drawn = settled + (cmp ? tailAfter(step) : step * count + 0.4);
  // TWO STOPS WHEN THERE IS A COMPARISON, and `REVEALS["line-chart"]` says so.
  // The baseline alone is a claim in its own right — it is what the result is
  // measured against — so it gets the pause that lets a sentence be said over
  // it, rather than being drawn and abandoned inside one breath.
  const holds = cmp ? [lift, drawn] : [drawn];
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

  /*
   * DROP THE COMPARISON, NOT THE BEAT.
   *
   * Both spans above are at their floors by the time this can fire, so there is
   * nothing left to give — and `holdsWithin` would clamp the second stop onto a
   * half-drawn chart, in frame, above the type floor, green in every gate. That
   * much was already true. What was wrong was the remedy: this threw, and a
   * throw goes to `onBeatError`, which DROPS THE WHOLE BEAT.
   *
   * MEASURED against what a planner actually writes. The floors here run from
   * 4.35s (two points, no deltas, no readout) to 6.65s (twelve points with a
   * readout), and the shortest committed planner output in this repository,
   * experiments/013-vocabulary/planner/runs/B0-02/out.json, authors its eleven
   * beats at 4.6, 4.9, 5.2, 5.3, 5.8, 5.8, 6, 6.2, 6.4, 6.4 and 6.5 seconds.
   * Four of those eleven refuse a four-point comparison carrying a readout and
   * deltas, which needs 5.7s — 5.45s without the deltas, and the same four beats
   * either way; all eleven refuse a twelve-point one. So the refusal
   * turned "the comparison animates a bit fast" into "the slide is not in the
   * deck" across most of a real plan.
   *
   * So the chart is emitted WITHOUT the comparison instead: the same beat, one
   * series, on the plain schedule whose bytes `test/wiring.test.ts` pins. The
   * data survives and only the reshape is lost, which is the trade the right way
   * round. Re-entering with `compare` removed is what makes that exact — the
   * degraded scene is not a special case built here to look like a plain chart,
   * it IS the plain chart, down to `plugins` being absent so the head vendors
   * none of MorphSVG's 21,195 bytes. It recurses exactly once: `cmp` is
   * `undefined` on the way back in, so this branch cannot be reached again.
   *
   * SAID OUT LOUD, because a deck quietly missing the comparison it was planned
   * around is this project's own recurring failure. `Scene.warnings` is the
   * channel; `build` prints it and the server puts it in the job's warnings.
   */
  const end = holds[holds.length - 1] ?? 0;
  const need = sec(end + 0.15);
  if (cmp && need > beat.seconds + 1e-9) {
    return {
      ...lineChart({ ...beat, params: { ...p, compare: undefined } }, ctx),
      warnings: [
        `line-chart ${beat.id}: a comparison against "${cmp.label}" over ${count} points needs ${need}s and the beat is ${beat.seconds}s, so the chart was drawn without it. Lengthen the beat to keep the comparison.`,
      ],
    };
  }

  return {
    html,
    tl,
    // Named only when a beat actually reshapes, which is what keeps MorphSVG's
    // 21,195 bytes off every deck that does not. See `PLUGINS` in composition.ts.
    ...(cmp ? { plugins: ["morphSVG"] } : {}),
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
      // Only when a ghost was actually named — not merely when there is a ghost,
      // since the label is dropped where neither side of the baseline is clear.
      // An unconditional rule would move the stylesheet bytes of every line chart
      // ever built for a part they do not draw, which is the whole thing
      // `Scene.plugins` is careful about one level up. `muted`, not `dim`: it
      // names a series, so it is read, and the curve it names is the thing that
      // has been faded, not its label.
      ...(ghost ? [`.ghostlab{font-size:40px;fill:${theme.muted};font-weight:600}`] : []),
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
