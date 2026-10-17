/**
 * place — items positioned by the source's numbers.
 *
 * POINTS (`form` plane or strip, `measure` value): each item at its values on
 * one or two axes, each running low to high as the source plots it (an axis
 * where lower is better says so with an arrow and the `better` word), its label and its values written beside it as
 * the source writes them. Items are revealed in spoken order, or group by
 * group (`reveal` groups); a group with `connect` is a series drawn as a line,
 * which is how the source's rows over steps (a loss curve) are shown. A
 * `curve` is a stated formula evaluated across the x axis and drawn under the
 * points, revealed left to right; the gate grounds it by checks the source
 * prints (src/plan/coverage.ts). Each axis carries 3–6 round tick values
 * (scale marks, not data); a label far from its dot is joined to it by a
 * leader line; \`diagonal\` puts both axes on one scale under y = x.
 *
 * The word forms keep their own renderers (./place-*.ts): `measure` margin
 * (results against the best other method), `measure` length (quantities to
 * scale), `form` combos (experiments not run) and `form` sets (what was and
 * was not evaluated).
 */
import type { Theme } from "../../emit/kit.js";
import type { Literal } from "../../types.js";
import { evaluate, parseFormula } from "../formula.js";
import { type KindImpl, type KindSpec, lab, namedIn, subjectOf } from "../kind.js";
import type { Cue, Layers } from "../kit.js";
import type { Frame, MechanismResult, Prim, Region, Role } from "./common.js";
import { fillTemplate, TYPE, wrapBy } from "./common.js";
import { combosForm } from "./place-combos.js";
import { lengthsForm } from "./place-lengths.js";
import { marginsForm } from "./place-margins.js";
import { setsForm } from "./place-sets.js";
import { paramRecord } from "./read.js";
import { stagedFragment, textLines, type VerbCtx, verbKind, withPushRoom } from "./stage.js";

type Ctx = VerbCtx<"place">;
type PlaceLit = Extract<Literal, { kind: "place" }>;

/** The first number a value states ("88.84", "4.46 s", "3.4X"). */
export function numberIn(v: string, what: string): number {
  const m = /[-−]?\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?/i.exec(v);
  if (!m) throw new Error(`${what} states no number: "${v}"`);
  return Number(m[0].replace(/,/g, "").replace("−", "-"));
}

/** Which renderer a place scene is drawn with. */
export function placeForm(lit: PlaceLit): "points" | "margins" | "lengths" | "combos" | "sets" {
  if (lit.form === "combos") return "combos";
  if (lit.form === "sets") return "sets";
  if (lit.measure === "margin") return "margins";
  if (lit.measure === "length") return "lengths";
  return "points";
}

/** The slots a word form cannot do without (optional in the docs, because the other forms do not read them). */
const NEEDS: Record<string, readonly string[]> = {
  margins: ["ahead", "behind", "zero", "scaled"],
  combos: ["on", "off", "missing"],
};

/** The share of the scene a `figure` takes beside the plot, and the gap between them. */
const FIGURE_SHARE = 0.27;
const FIGURE_GAP = 48;

/**
 * Points, inset for the camera's push (`withPushRoom`); with a `figure`, the
 * plot takes the left of the scene and the source's own picture of what was
 * measured stands at the right under its `scene` title (the approved look,
 * .planning/designs/2026-10-12-verb-looks.md).
 */
export const points = (c: Ctx): MechanismResult => {
  const fig = c.lit.figure;
  if (!fig) return withPushRoom(pointsIn)(c);
  const title = c.labels.scene?.trim();
  if (!title) throw new Error("place with a `figure` needs the `scene` slot: what was measured");
  const { width: W, height: H } = c.region;
  const side = Math.round(W * FIGURE_SHARE);
  const r = withPushRoom(pointsIn)({
    ...c,
    region: { width: W - side - FIGURE_GAP, height: H },
  });
  const lines = wrapBy(title, TYPE.label, side, c.measure);
  const top = 8 + lines.length * Math.round(TYPE.label * 1.18) + 16;
  if (H - top < 200)
    throw new Error(`place: the \`scene\` title leaves its figure ${H - top}px; shorten it`);
  const col: Prim[] = [
    ...textLines(lines, W - side, 8, TYPE.label, "muted"),
    {
      p: "image",
      x: W - side,
      y: top,
      w: side,
      h: H - top,
      layer: `fig:${fig}`,
      fit: true,
      top: true,
    },
  ];
  return { ...r, frames: r.frames.map((f) => ({ ...f, prims: [...f.prims, ...col] })) };
};

/** A value that states no number: a method the source gives only the other axis for ("--"). */
const unstated = (v: string) => !/\d/.test(v);

/** The widest a key column beside the plot may be, as a share of the scene; wider goes under. */
const KEY_SHARE = 0.55;

/** A plane names each point beside it up to this many; past it, a key (`KEYED`). */
export const NAMED_MAX = 8;

/** The marker shapes a crossed key tells its labels apart by, in order. */
const SHAPES = ["circle", "square", "triangle", "diamond"] as const;
type Shape = (typeof SHAPES)[number];

/**
 * How the points are named: each beside its dot (`labels`); or, when they are
 * too many to name (> `NAMED_MAX`) or a name finds no free place, by a KEY —
 * `crossed` when the items are a few labels each measured under every group
 * (3 model sizes × 4 tasks: shape per label, colour per group, no words on the
 * plot), else `numbered` (each dot's number is placed beside it as a label is,
 * and a key beside or under the plot reads number, name and values). A label is never drawn over a point, a
 * line or another word: r2 struck a point's label through with its own series
 * and printed 12 labels over each other on a theory-against-measured plane.
 */
type Mode = "labels" | "crossed" | "numbered";

function pointsIn(c0: Ctx): MechanismResult {
  const all = c0.lit;
  const two = all.form === "plane";
  const nAxes = two ? 2 : 1;
  if (all.axes.length !== nAxes)
    throw new Error(`place ${all.form} needs ${nAxes} axis(es), got ${all.axes.length}`);
  // A method the source gives one number for is a line at it, not a point.
  const refs = two ? all.items.filter((it) => it.values.some(unstated)) : [];
  for (const it of refs)
    if (it.values.length !== 2 || it.values.every(unstated))
      throw new Error(`item "${it.label}" states no number for either axis`);
  if (refs.length > 4)
    throw new Error(`place draws at most 4 one-number lines, got ${refs.length}`);
  const d = { ...all, items: all.items.filter((it) => !refs.includes(it)) };
  const c = { ...c0, lit: d };
  if (d.compare)
    for (const name of [d.compare.ours, d.compare.rival])
      if (!d.items.some((it) => it.label === name))
        throw new Error(`place \`compare\` names "${name}", which is not a point's label`);
  if (d.compare && !c.labels.delta?.trim())
    throw new Error("place with `compare` needs the `delta` slot, naming {dx} and {dy}");
  // A curve is drawn under the paper's own points, never alone: an r2 plan
  // gave curves and no items twice, and "2–16 items" did not say where the points were.
  if (d.items.length < 2 && d.curves.length)
    throw new Error(
      `place draws a curve under its points: give the rows its checks come from as \`items\` (label, values [${d.curves[0]?.x ?? "x"}, output]), 2–16 of them; got ${d.items.length}`,
    );
  if (d.items.length < 2 || d.items.length > 16)
    throw new Error(`place draws 2–16 items, got ${d.items.length}`);
  if (d.curves.length && !two) throw new Error("place draws curves on a plane only");
  if (d.curves.length > 6) throw new Error("place draws at most 6 curves");
  for (const it of d.items)
    if (it.values.length !== nAxes)
      throw new Error(`item "${it.label}" gives ${it.values.length} values for ${nAxes} axis(es)`);
  const groups = [...new Set(d.items.map((it) => it.group ?? ""))];
  if (groups.length > 4) throw new Error(`place colours at most 4 groups, got ${groups.length}`);
  if (d.diagonal && (!two || d.axes[0]?.lowerIsBetter !== d.axes[1]?.lowerIsBetter))
    throw new Error("place `diagonal` needs a plane whose two axes agree on lowerIsBetter");
  if (d.diagonal && !!d.axes[0]?.log !== !!d.axes[1]?.log)
    throw new Error("place `diagonal` needs both axes linear or both logarithmic");
  const labels = [...new Set(d.items.map((it) => it.label))];
  const crossed =
    groups.length >= 2 &&
    groups.every(Boolean) &&
    labels.length >= 2 &&
    labels.length <= SHAPES.length &&
    new Set(d.items.map((it) => `${it.label}\u0000${it.group}`)).size === d.items.length &&
    labels.every((l) => d.items.filter((it) => it.label === l).length >= 2);
  const keyed: Mode = crossed ? "crossed" : "numbered";
  if (d.items.length > NAMED_MAX) return layoutPoints(c, keyed, false, refs) as MechanismResult;
  // Each point named beside it, on one line; else the name over its values, which is
  // narrower and finds a place where a long line does not; else a key.
  return (
    layoutPoints(c, "labels", false, refs) ??
    layoutPoints(c, "labels", true, refs) ??
    (two ? layoutPoints(c, "labels", false, refs, true) : null) ??
    (layoutPoints(c, keyed, false, refs) as MechanismResult)
  );
}

/** The scene in one naming mode; null when a label finds no free place (`labels` only). */
function layoutPoints(
  c: Ctx,
  mode: Mode,
  stacked = false,
  refs: PlaceLit["items"] = [],
  short = false,
): MechanismResult | null {
  const d = c.lit;
  const two = d.form === "plane";
  const vals = d.items.map((it) => it.values.map((v) => numberIn(v, `item "${it.label}"`)));
  const { width: W, height: H } = c.region;
  const groups = [...new Set(d.items.map((it) => it.group ?? ""))];
  const roles = ["a", "b", "c", "d"] as const;
  const roleOf = (g: string) => roles[groups.indexOf(g)] ?? "a";
  const labelsSeen = [...new Set(d.items.map((it) => it.label))];
  const shapeOf = (label: string): Shape => SHAPES[labelsSeen.indexOf(label)] ?? "circle";
  const nameW = (k: number) => c.measure((d.axes[k] as PlaceLit["axes"][number]).name, TYPE.label);
  const nameH = TYPE.label * 1.2;
  // Items that share one label differ only by group: the group names the
  // point and there is no legend. r1 labelled four points with one model name and put
  // the real distinction, and the axis title, in a two-row legend.
  const byName = groups.every(Boolean) && labelsSeen.length === 1;
  const nameOf = (it: PlaceLit["items"][number]) => (byName ? (it.group as string) : it.label);
  const ax0 = d.axes[0] as PlaceLit["axes"][number];
  const ax1 = d.axes[1];
  const betterWord = c.labels.better?.trim();
  const xBetter = !!betterWord && ax0.lowerIsBetter;
  const yBetter = two && !!betterWord && !!ax1?.lowerIsBetter;
  const betterW = betterWord ? c.measure(`← ${betterWord}`, TYPE.label) : 0;
  const tr = (k: number) => {
    const a = d.axes[k] as PlaceLit["axes"][number];
    return (v: number) => {
      if (a.log && !(v > 0))
        throw new Error(`axis "${a.name}" is logarithmic and an item has ${v}`);
      return a.log ? Math.log10(v) : v;
    };
  };
  // Curves: the stated formula across the x axis, with its fixed values.
  const xs = vals.map((v) => v[0] as number);
  const xlo = Math.min(...xs);
  const xhi = Math.max(...xs);
  const curves = d.curves.map((cv) => {
    const ast = parseFormula(cv.expr);
    const fixed = paramRecord(cv.fixed, { params: {} }, `curve "${cv.label}"`, true);
    const at = cv.checks.flatMap((ck) =>
      ck.inputs.filter((i) => i.name === cv.x).map((i) => Number(i.value)),
    );
    const lo = Math.min(xlo, ...at);
    const hi = Math.max(xhi, ...at);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 80; i++) {
      const x = lo + ((hi - lo) * i) / 80;
      const y = evaluate(ast, { ...fixed, [cv.x]: x });
      if (Number.isFinite(y)) pts.push([x, y]);
    }
    if (pts.length < 2)
      throw new Error(`curve "${cv.label}" gives no finite value across the axis`);
    return { label: cv.label, pts };
  });
  const range = (k: number) => {
    const f = tr(k);
    const vs = [
      ...vals.map((v) => f(v[k] as number)),
      ...curves.flatMap((cv) => cv.pts.map((p) => f(p[k] as number))),
      ...refs.flatMap((it) => {
        const v = it.values[k] as string;
        return unstated(v) ? [] : [f(numberIn(v, `item "${it.label}"`))];
      }),
    ];
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
    return [lo - pad, hi + pad] as const;
  };
  let rx = range(0);
  let ry = two ? range(1) : ([0, 1] as const);
  if (d.diagonal) {
    // One scale on both axes, so y = x runs corner to corner at 45°.
    const both = [Math.min(rx[0], ry[0]), Math.max(rx[1], ry[1])] as const;
    rx = both;
    ry = both;
  }
  // Ticks: 3–6 round values across each axis's drawn range. Scale marks, not
  // data — without them r1's planes had positions nobody could read.
  const xTicks = ticksOf(rx, !!ax0.log);
  const yTicks = two ? ticksOf(ry, !!ax1?.log) : [];
  const yTickW =
    two && yTicks.length ? Math.max(...yTicks.map((t) => c.measure(t.text, TYPE.label))) + 20 : 0;
  // A curve is named in the legend, in its colour, unless a group of that name already is.
  // Unnamed points are the rows a curve's checks come from: the first curve takes their colour.
  const curveRole = (label: string, k: number) =>
    groups.includes(label)
      ? roleOf(label)
      : (roles[((groups.every((g) => !g) ? 0 : groups.length) + k) % 4] ?? "a");
  const entries: LegendEntry[] = [
    ...(!byName && groups.length > 1 && groups.every(Boolean)
      ? groups.map((g) => ({ name: g, role: roleOf(g), shape: "circle" as const }))
      : []),
    ...curves.flatMap((cv, k) =>
      groups.includes(cv.label)
        ? []
        : [{ name: cv.label, role: curveRole(cv.label, k), shape: "line" as const }],
    ),
    ...(mode === "crossed"
      ? labelsSeen.map((l) => ({ name: l, role: "muted" as const, shape: shapeOf(l) }))
      : []),
  ];
  // The top row: the y axis's name and its "better" (a plane), or the strip's
  // name and its "better" at the right; the legend in what is left, in as many
  // rows as it needs. Every word of it is outside the plot.
  const yNameX = 24 + yTickW;
  const legend = legendOf(
    entries,
    two ? yNameX + nameW(1) + 48 + (yBetter ? betterW + 32 : 0) : 24,
    two ? W - 24 : W - 24 - nameW(0) - 48 - (xBetter ? betterW + 32 : 0),
    { left: 24, right: W - 24 },
    c.measure,
  );
  const top = 64 + Math.max(0, legend.rows - 1) * LEGEND_ROW;
  // A numbered key is a column beside the plot: number, name and values.
  const keyLines =
    mode === "numbered" ? d.items.map((it, i) => `${i + 1}  ${nameOf(it)}: ${valueText(it)}`) : [];
  const keyW = keyLines.length
    ? Math.max(...keyLines.map((l) => c.measure(l, TYPE.label))) + 32
    : 0;
  const KEY_LH = 52;
  // Beside the plot where the column fits (`KEY_SHARE` of the width) and its
  // lines fit down the scene; else under the plot, where it costs height.
  const besideOk = keyW <= W * KEY_SHARE && keyLines.length * KEY_LH <= H - top;
  const below = keyLines.length > 0 && !besideOk;
  const keyH = below ? keyLines.length * KEY_LH + 16 : 0;
  if (below && keyW > W - 48)
    throw new Error(
      `place: the key's longest line is ${Math.ceil(keyW)}px, wider than the scene; shorten the item names or give fewer items`,
    );
  const sideW = below ? 0 : keyW;
  // A plane's x-axis name has its own row under the tick values, so no tick
  // is ever dropped for it (r2 lost its 4s tick under "预测时域").
  const plot = two
    ? { x: 24 + yTickW, y: top, w: W - 48 - yTickW - sideW, h: H - top - 72 - nameH - 8 - keyH }
    : { x: 24, y: top, w: W - 48 - sideW, h: H - top - 24 - keyH };
  // A REFUSAL A REDRAW CAN AIM AT (2026-10-17). "the key leaves the plot 192px"
  // read as an overflow and named no limit; Chinchilla's isoflop plane came back
  // with the same names and was dropped. So it names both budgets in pixels and
  // lines, and the count of items that would fit.
  const PLOT_MIN = 240;
  if (plot.h < PLOT_MIN && below) {
    const sideLine = Math.floor(W * KEY_SHARE) - 32;
    const fit = Math.max(0, Math.floor((plot.h + keyH - PLOT_MIN - 16) / KEY_LH));
    const besideRows = Math.floor((H - top) / KEY_LH);
    const why =
      keyW - 32 > sideLine
        ? `its longest line is ${Math.ceil(keyW - 32)}px and a line beside the plot may be ${sideLine}px`
        : `${keyLines.length} lines are more than the ${besideRows} that fit beside the plot`;
    throw new Error(
      `place: the numbered key fits neither beside the plot (${why}) nor under it (${fit} of its ${keyLines.length} lines fit before the plot is under ${PLOT_MIN}px). ` +
        `Each line is an item's number, name and values: shorten the names${fit >= 2 ? `, or give at most ${fit} items` : ""}`,
    );
  }
  if (plot.h < PLOT_MIN)
    throw new Error(
      `place: the plot is left ${Math.floor(plot.h)}px tall, under ${PLOT_MIN}px; give fewer legend entries or shorter names`,
    );
  const X = (v: number) => {
    const t = (tr(0)(v) - rx[0]) / (rx[1] - rx[0]);
    return plot.x + plot.w * t;
  };
  const Y = (v: number) => {
    const t = (tr(1)(v) - ry[0]) / (ry[1] - ry[0]);
    return plot.y + plot.h * (1 - t);
  };
  const lineY = two ? plot.y + plot.h : plot.y + plot.h / 2;
  const prims: Prim[] = [];
  // What a label may not cover: words and points (`taken`), and lines (`strokes`). A leader
  // may cross a line, never a word or a point.
  const taken: Box[] = [...legend.boxes];
  const strokes: Box[] = [];
  const leaderBoxes: Box[] = [];
  // The axes: lines and their names, outside the plot.
  prims.push({
    p: "rect",
    x: plot.x,
    y: plot.y,
    w: plot.w,
    h: plot.h,
    fill: "panel",
    opacity: 0.5,
    cam: true,
  });
  if (two) {
    prims.push(
      {
        p: "line",
        x1: plot.x,
        y1: lineY,
        x2: plot.x + plot.w,
        y2: lineY,
        role: "rule",
        width: 3,
        arrow: true,
        cam: true,
      },
      {
        p: "line",
        x1: plot.x,
        y1: lineY,
        x2: plot.x,
        y2: plot.y,
        role: "rule",
        width: 3,
        arrow: true,
        cam: true,
      },
    );
    const xNameY = lineY + TICK_Y + nameH + 8;
    prims.push(
      {
        p: "text",
        x: plot.x + plot.w,
        y: xNameY,
        size: TYPE.label,
        role: "muted",
        anchor: "end",
        text: ax0.name,
      },
      {
        p: "text",
        x: yNameX,
        y: 8,
        size: TYPE.label,
        role: "muted",
        anchor: "start",
        text: (ax1 as PlaceLit["axes"][number]).name,
      },
    );
    taken.push(
      { x0: plot.x + plot.w - nameW(0), y0: xNameY, x1: plot.x + plot.w, y1: xNameY + nameH },
      { x0: yNameX, y0: 8, x1: yNameX + nameW(1), y1: 8 + nameH },
    );
    // Every axis runs low to high, as the source plots it (the approved look); where lower
    // is better, the slot's word for "better" points down it, beside its name, outside the plot.
    if (xBetter) {
      const x1 = plot.x + plot.w - nameW(0) - 32;
      prims.push({
        p: "text",
        x: x1,
        y: xNameY,
        size: TYPE.label,
        role: "accent",
        anchor: "end",
        text: `← ${betterWord}`,
      });
      taken.push({ x0: x1 - betterW, y0: xNameY, x1, y1: xNameY + nameH });
    }
    if (yBetter) {
      const x0 = yNameX + nameW(1) + 32;
      prims.push({
        p: "text",
        x: x0,
        y: 8,
        size: TYPE.label,
        role: "accent",
        anchor: "start",
        text: `↓ ${betterWord}`,
      });
      taken.push({ x0, y0: 8, x1: x0 + betterW, y1: 8 + nameH });
    }
  } else {
    prims.push(
      {
        p: "line",
        x1: plot.x,
        y1: lineY,
        x2: plot.x + plot.w,
        y2: lineY,
        role: "rule",
        width: 4,
        arrow: true,
        cam: true,
      },
      {
        p: "text",
        x: plot.x + plot.w,
        y: 8,
        size: TYPE.label,
        role: "muted",
        anchor: "end",
        text: ax0.name,
      },
    );
    taken.push({ x0: plot.x + plot.w - nameW(0), y0: 8, x1: plot.x + plot.w, y1: 8 + nameH });
    if (xBetter) {
      const x1 = plot.x + plot.w - nameW(0) - 32;
      prims.push({
        p: "text",
        x: x1,
        y: 8,
        size: TYPE.label,
        role: "accent",
        anchor: "end",
        text: `← ${betterWord}`,
      });
      taken.push({ x0: x1 - betterW, y0: 8, x1, y1: 8 + nameH });
    }
  }
  strokes.push(...segBoxes([plot.x, lineY, plot.x + plot.w, lineY], 3));
  if (two) strokes.push(...segBoxes([plot.x, lineY, plot.x, plot.y], 3));
  // Every tick the range has, each with its value: never dropped for a name.
  const unX = (v: number) => (ax0.log ? 10 ** v : v);
  for (const t of xTicks) {
    const x = X(unX(t.v));
    const w = c.measure(t.text, TYPE.label);
    // Inside the region, which clips: r1's last tick printed as "3.!".
    if (x - w / 2 < 0 || x + w / 2 > W) continue;
    taken.push({ x0: x - w / 2, y0: lineY + TICK_Y, x1: x + w / 2, y1: lineY + TICK_Y + nameH });
    prims.push(
      { p: "line", x1: x, y1: lineY - 8, x2: x, y2: lineY + 8, role: "rule", width: 3, cam: true },
      {
        p: "text",
        x,
        y: lineY + TICK_Y,
        size: TYPE.label,
        role: "muted",
        anchor: "middle",
        text: t.text,
        cam: true,
      },
    );
  }
  if (two) {
    const unY = (v: number) => (ax1?.log ? 10 ** v : v);
    for (const t of yTicks) {
      const y = Y(unY(t.v));
      if (y < plot.y + nameH / 2 || y > plot.y + plot.h - 4) continue;
      const w = c.measure(t.text, TYPE.label);
      taken.push({ x0: plot.x - 12 - w, y0: y - nameH / 2, x1: plot.x - 12, y1: y + nameH / 2 });
      prims.push(
        {
          p: "line",
          x1: plot.x - 8,
          y1: y,
          x2: plot.x + 8,
          y2: y,
          role: "rule",
          width: 3,
          cam: true,
        },
        {
          p: "text",
          x: plot.x - 12,
          y: y - TYPE.label * 0.6,
          size: TYPE.label,
          role: "muted",
          anchor: "end",
          text: t.text,
          cam: true,
        },
      );
    }
  }
  if (d.diagonal) {
    const lo = Math.max(rx[0], ry[0]);
    const hi = Math.min(rx[1], ry[1]);
    const un = (v: number) => (ax0.log ? 10 ** v : v);
    const seg = [X(un(lo)), Y(un(lo)), X(un(hi)), Y(un(hi))];
    prims.push({
      p: "line",
      x1: seg[0] as number,
      y1: seg[1] as number,
      x2: seg[2] as number,
      y2: seg[3] as number,
      role: "muted",
      width: 3,
      dash: true,
      cam: true,
    });
    strokes.push(...segBoxes(seg, 3));
  }
  // One-number methods: a dashed line across the plot at the value they have, named
  // at its far end under the line (over it when that is taken).
  for (const it of refs) {
    const k = unstated(it.values[0] as string) ? 1 : 0;
    const raw = it.values[k] as string;
    const v = numberIn(raw, `item "${it.label}"`);
    const seg =
      k === 1 ? [plot.x, Y(v), plot.x + plot.w, Y(v)] : [X(v), plot.y, X(v), plot.y + plot.h];
    prims.push({
      p: "line",
      x1: seg[0] as number,
      y1: seg[1] as number,
      x2: seg[2] as number,
      y2: seg[3] as number,
      role: "dim",
      width: 2,
      dash: true,
      cam: true,
    });
    strokes.push(...segBoxes(seg, 2));
    const t = `${it.label} ${raw}`;
    const w = c.measure(t, TYPE.label);
    const h = TYPE.label * 1.2;
    const x0 = k === 1 ? plot.x + plot.w - w - 8 : (seg[0] as number) + 12;
    const below = k === 1 ? (seg[1] as number) + 6 : plot.y + 8;
    const above = k === 1 ? (seg[1] as number) - 6 - h : plot.y + plot.h - 8 - h;
    const box = (y0: number) => ({ x0, y0, x1: x0 + w, y1: y0 + h });
    const free = (b: Box) =>
      b.y0 >= plot.y && b.y1 <= plot.y + plot.h && !taken.some((q) => area(b, q) > 0);
    const b = free(box(below)) ? box(below) : box(above);
    taken.push(b);
    prims.push({
      p: "text",
      x: b.x0,
      y: b.y0,
      size: TYPE.label,
      role: "dim",
      anchor: "start",
      text: t,
      cam: true,
    });
  }
  const byGroup = d.reveal === "groups";
  // THE SUBJECT: the items (or a group) the headline names stand out from the first
  // frame — the accent, a larger dot, their label first and in the accent — and the
  // rest are revealed in spoken order around them. r3 left the method the same pink as
  // every rival and dimmed (unspoken yet) at every hold of three planes.
  const subj = subjectOf(
    c.headline,
    d.items.map((it) => nameOf(it)),
  );
  for (const [i, it] of d.items.entries())
    if (it.group && namedIn(c.headline, it.group) && groups.length > 1) subj.add(i);
  if (subj.size === d.items.length) subj.clear();
  const subjGroups = new Set(
    groups.filter((g) => g && d.items.every((it, i) => (it.group ?? "") !== g || subj.has(i))),
  );
  // Steps: the subject is there from the start, so the others count without it.
  const groupStep = (g: number) => groups.slice(0, g).filter((q) => !subjGroups.has(q)).length + 1;
  const itemStep = (i: number) => d.items.slice(0, i).filter((_, k) => !subj.has(k)).length + 1;
  // A curve named as a group is that group's: drawn on the group's step, with its points,
  // so the curve comes when its points are spoken. Other curves come first, one step each.
  const curveGroup = (label: string) => (byGroup ? groups.indexOf(label) : -1);
  const own = curves.filter((cv) => curveGroup(cv.label) < 0).length;
  let at = 0;
  curves.forEach((cv, k) => {
    const g = curveGroup(cv.label);
    if (g < 0) at = Math.min(12, at + 1);
    const step =
      g < 0 ? at : subjGroups.has(groups[g] as string) ? 0 : Math.min(12, own + groupStep(g));
    const pts = cv.pts
      .flatMap(([x, y]) => [X(x), Y(y)])
      .map((v, i) => (i % 2 ? Math.max(plot.y, Math.min(plot.y + plot.h, v)) : v));
    prims.push({
      p: "path",
      pts,
      role: curveRole(cv.label, k),
      width: 5,
      cam: true,
      at: step,
      wipe: true,
    });
    strokes.push(...segBoxes(pts, 5));
  });
  const at0 = at;
  const pos = vals.map((v) => ({
    x: X(v[0] as number),
    y: two ? Y(v[1] as number) : lineY,
  }));
  const R = 14;
  taken.push(
    ...pos.map((q) => ({ x0: q.x - R - 4, y0: q.y - R - 4, x1: q.x + R + 4, y1: q.y + R + 4 })),
  );
  // The comparison the source draws: a dashed link from the rival to ours, an
  // obstacle to every label; its deltas are placed once the labels are.
  const cmp = d.compare
    ? {
        a: d.items.findIndex((it) => it.label === d.compare?.ours),
        b: d.items.findIndex((it) => it.label === d.compare?.rival),
      }
    : undefined;
  const link = cmp
    ? (() => {
        const p = pos[cmp.a] as { x: number; y: number };
        const q = pos[cmp.b] as { x: number; y: number };
        const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
        const u = (R + 8) / len;
        return [
          q.x + (p.x - q.x) * u,
          q.y + (p.y - q.y) * u,
          p.x - (p.x - q.x) * u,
          p.y - (p.y - q.y) * u,
        ];
      })()
    : undefined;
  // The link is a line like any other: no word is drawn over it.
  if (link) strokes.push(...segBoxes(link, 3));
  // A series: the source's rows over steps, joined. Its line is an obstacle to every label.
  const series: Prim[] = [];
  const seriesGroups = new Set<string>();
  if (d.connect)
    groups.forEach((g, k) => {
      const pts = d.items
        .map((it, i) => ({ it, q: pos[i] as { x: number; y: number }, v: vals[i] as number[] }))
        .filter((e) => (e.it.group ?? "") === g)
        .sort((p, q) => (p.v[0] as number) - (q.v[0] as number))
        .flatMap((e) => [e.q.x, e.q.y]);
      if (pts.length >= 4) {
        seriesGroups.add(g);
        series.push({
          p: "path",
          pts,
          role: roleOf(g),
          width: 4,
          cam: true,
          at: subjGroups.has(g) ? 0 : Math.min(12, at + (byGroup ? groupStep(k) : 1)),
          wipe: true,
        });
        strokes.push(...segBoxes(pts, 4));
      }
    });
  prims.push(...series);
  const marks: Prim[] = [];
  const words: Prim[] = [];
  const tinted = groups.length > 1 && groups.every(Boolean);
  // The subject's labels are placed first: they get the nearest free place.
  const order = [...d.items.keys()].sort((p, q) => Number(subj.has(q)) - Number(subj.has(p)));
  const stepOf = (i: number) => {
    if (subj.has(i)) return 0;
    const g = groups.indexOf((d.items[i] as PlaceLit["items"][number]).group ?? "");
    return Math.min(12, at0 + (byGroup ? groupStep(g) : itemStep(i)));
  };
  // With a subject and no group colours, the others recede to the muted tone.
  const quiet = subj.size > 0 && !tinted;
  for (const i of order) {
    const it = d.items[i] as PlaceLit["items"][number];
    const { x: px, y: py } = pos[i] as { x: number; y: number };
    const a = stepOf(i);
    const lead = subj.has(i);
    const fill: Role = lead && !tinted ? "accent" : quiet ? "muted" : roleOf(it.group ?? "");
    const r = lead ? R + 4 : R;
    if (mode === "crossed") marks.push(...markerPrims(shapeOf(it.label), px, py, r, fill, a));
    else marks.push({ p: "circle", cx: px, cy: py, r, fill, cam: true, at: a });
    if (lead && tinted)
      marks.push({ p: "circle", cx: px, cy: py, r: R + 10, role: "accent", width: 5, cam: true });
    if (mode === "crossed") continue;
    // One line when name and values fit on it; else the name on its own
    // line(s) and the values on one more, never broken: r1 wrapped "6.58 ·\n88.29".
    const maxW = Math.min(520, plot.w / 2);
    // A point on a joined series says only its height: the legend names the
    // series in its colour and the x axis's ticks give the step, so two close
    // series' labels fit beside their points (r2 b13's eight "name x·y" labels did not).
    const onSeries = !!d.connect && two && tinted && seriesGroups.has(it.group ?? "");
    // `short`: the name and its height only — the x is read off the ticks (the approved
    // look's "name 88.84"), for points too close to name with both values.
    const tuple = onSeries || short ? (it.values[1] as string) : valueText(it);
    // A numbered key's point carries only its number, placed as any label is.
    const one =
      mode === "numbered"
        ? String(i + 1)
        : onSeries
          ? tuple
          : tuple
            ? `${nameOf(it)}: ${tuple}`
            : nameOf(it);
    const lines =
      mode === "numbered" || !tuple || (!stacked && c.measure(one, TYPE.label) <= maxW)
        ? [one]
        : onSeries
          ? [tuple]
          : [...wrapBy(nameOf(it), TYPE.label, maxW, c.measure), tuple];
    const w = Math.max(...lines.map((l) => c.measure(l, TYPE.label)));
    const h = (lines.length - 1) * LH + TYPE.label * 1.2;
    const spot = placeLabel(
      px,
      py,
      w,
      h,
      two ? "beside" : i % 2 ? "below" : "above",
      plot,
      taken,
      strokes,
      two ? 0 : i,
      // A name must read as its own point's, its leader crossing no line; a key's number
      // may sit in a cluster, its leader crossing a curve but never another leader.
      mode === "labels" ? pos.filter((_, k) => k !== i) : [],
      mode === "labels" ? strokes : leaderBoxes,
    );
    if (!spot) {
      if (mode === "labels") return null;
      throw new Error(
        `place: the points are too close to number on this plane (no free place beside point ${i + 1}); give fewer items, or split the beat`,
      );
    }
    taken.push(spot.box);
    strokes.push(...spot.leader.flatMap((s) => segBoxes(s, 2)));
    leaderBoxes.push(...spot.leader.flatMap((s) => segBoxes(s, 2)));
    for (const s of spot.leader)
      words.push({
        p: "line",
        x1: s[0] as number,
        y1: s[1] as number,
        x2: s[2] as number,
        y2: s[3] as number,
        role: "muted",
        width: 2,
        cam: true,
        at: a,
      });
    // The name in its dot's colour when the colours tell groups apart.
    for (const [j, t] of lines.entries())
      words.push({
        p: "text",
        x: spot.box.x0,
        y: spot.box.y0 + j * LH,
        size: TYPE.label,
        role:
          lead && !tinted
            ? "accent"
            : tinted && (lines.length === 1 || j < lines.length - 1)
              ? fill
              : quiet
                ? "muted"
                : "fg",
        anchor: "start",
        ...(lead ? { weight: 700 } : {}),
        text: t,
        cam: true,
        at: a,
      });
  }
  // Leaders under the dots, dots under the words.
  prims.push(
    ...words.filter((p) => p.p === "line"),
    ...marks,
    ...words.filter((p) => p.p !== "line"),
  );
  if (cmp && link) {
    // Once every point is out: the link, then the gaps it spans, computed from the
    // two rows as printed, to the decimals they are printed with.
    const a = Math.min(12, Math.max(0, ...[...d.items.keys()].map(stepOf)) + 1);
    const ia = d.items[cmp.a] as PlaceLit["items"][number];
    const ib = d.items[cmp.b] as PlaceLit["items"][number];
    const gap = (k: number) => {
      const dec = (s: string) => /\.(\d+)/.exec(s)?.[1]?.length ?? 0;
      const sa = ia.values[k] as string;
      const sb = ib.values[k] as string;
      return Math.abs((vals[cmp.a]?.[k] as number) - (vals[cmp.b]?.[k] as number)).toFixed(
        Math.max(dec(sa), dec(sb)),
      );
    };
    const vars = { dx: gap(0), dy: two ? gap(1) : "" };
    const t = fillTemplate(c.labels.delta as string, vars);
    const w = c.measure(t, TYPE.label);
    const h = TYPE.label * 1.2;
    const q = pos[cmp.b] as { x: number; y: number };
    const spot =
      placeLabel(q.x, q.y, w, h, "beside", plot, taken, strokes) ??
      placeLabel(
        (pos[cmp.a] as { x: number }).x,
        (pos[cmp.a] as { y: number }).y,
        w,
        h,
        "beside",
        plot,
        taken,
        strokes,
      );
    if (!spot) {
      // As a label that finds no place: the next naming mode may leave room for it.
      if (mode === "labels") return null;
      throw new Error(
        `place: the \`delta\` "${t}" finds no free place by its two points; shorten it`,
      );
    }
    taken.push(spot.box);
    prims.push(
      {
        p: "line",
        x1: link[0] as number,
        y1: link[1] as number,
        x2: link[2] as number,
        y2: link[3] as number,
        role: "d",
        width: 4,
        dash: true,
        cam: true,
        at: a,
        wipe: true,
      },
      {
        p: "text",
        x: spot.box.x0,
        y: spot.box.y0,
        size: TYPE.label,
        role: "d",
        anchor: "start",
        text: t,
        cam: true,
        at: a,
      },
    );
  }
  if (mode === "numbered") {
    const x0 = below ? 24 : plot.x + plot.w + 32;
    const y0 = below ? H - keyH + 16 : top + Math.max(0, (H - top - keyLines.length * KEY_LH) / 2);
    keyLines.forEach((t, i) => {
      const it = d.items[i] as PlaceLit["items"][number];
      const a = stepOf(i);
      prims.push({
        p: "text",
        x: x0,
        y: y0 + i * KEY_LH,
        size: TYPE.label,
        role: tinted ? roleOf(it.group ?? "") : subj.has(i) ? "accent" : quiet ? "muted" : "fg",
        anchor: "start",
        ...(subj.has(i) ? { weight: 700 } : {}),
        text: t,
        at: a,
      });
    });
  }
  prims.push(...legend.prims);
  return {
    rasters: {},
    frames: [{ id: "place", prims, vars: {}, preview: true }],
    data: { mode },
    vars: {},
  };

  /** An item's values as printed: the ones its name does not already state ("α=0.9" is not printed "α=0.9 0.9 · 2.71"). */
  function valueText(it: PlaceLit["items"][number]): string {
    const name = nameOf(it);
    return it.values
      .filter((v) => {
        const t = v.trim();
        return !new RegExp(`(?:^|[=:\\s])${escapeRe(t)}$`).test(name.trim());
      })
      .join(" · ");
  }
}

/** `s` as a literal pattern. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A key mark: the label's shape in its group's colour. */
function markerPrims(
  shape: Shape,
  x: number,
  y: number,
  r: number,
  fill: Role,
  at: number,
): Prim[] {
  const s = r * 1.1;
  if (shape === "circle") return [{ p: "circle", cx: x, cy: y, r, fill, cam: true, at }];
  if (shape === "square")
    return [
      { p: "rect", x: x - s * 0.9, y: y - s * 0.9, w: 1.8 * s, h: 1.8 * s, fill, cam: true, at },
    ];
  const pts =
    shape === "triangle"
      ? [x, y - s * 1.15, x + s * 1.1, y + s * 0.8, x - s * 1.1, y + s * 0.8]
      : [x, y - s * 1.2, x + s * 1.2, y, x, y + s * 1.2, x - s * 1.2, y];
  return [{ p: "path", pts, closed: true, fill, role: fill, width: 1, cam: true, at }];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const area = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** A polyline (x0, y0, x1, y1, …) as small boxes every 10px along it, `w` px thick: an obstacle to a label. */
export function segBoxes(pts: readonly number[], w: number): Box[] {
  const out: Box[] = [];
  const h = w / 2 + 3;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [x0, y0, x1, y1] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]] as number[];
    const n = Math.max(
      1,
      Math.ceil(Math.hypot((x1 as number) - (x0 as number), (y1 as number) - (y0 as number)) / 10),
    );
    for (let k = 0; k <= n; k++) {
      const x = (x0 as number) + (((x1 as number) - (x0 as number)) * k) / n;
      const y = (y0 as number) + (((y1 as number) - (y0 as number)) * k) / n;
      out.push({ x0: x - h, y0: y - h, x1: x + h, y1: y + h });
    }
  }
  return out;
}

/** A tick's value sits this far under its axis: clear of a point on the axis (radius 14). */
const TICK_Y = 22;

/** Text lines are this far apart, px. */
const LH = 47;

/**
 * Where a point's label goes, and the leader that ties it to its dot when it
 * sits more than `LEADER_PX` away: the first box, nearest first, inside the
 * plot, that covers no word, point or line (`taken`, `strokes`) AND whose
 * leader crosses no word or point.
 * Null when there is none: the caller names the points by a key instead of
 * drawing a word over a point, a line or another word.
 *
 * A plane tries beside the point, right then left, stepping 48px up and down.
 * A strip tries its own side of the line first (`side`), then the other, at
 * every level from the line out to the plot's edge — starting from level
 * `spreadFrom` (the item's index), so a short strip's labels use the height
 * rather than all hugging the axis.
 */
export function placeLabel(
  px: number,
  py: number,
  w: number,
  h: number,
  side: "beside" | "above" | "below",
  plot: { x: number; y: number; w: number; h: number },
  taken: readonly Box[],
  strokes: readonly Box[],
  spreadFrom = 0,
  others: ReadonlyArray<{ x: number; y: number }> = [],
  crossNot: readonly Box[] = strokes,
): { box: Box; leader: number[][] } | null {
  // On a strip a label is centred over (or under) its own dot first: set
  // beside it, it sat over the gap between two dots and read as the other one's.
  // Beside, a label may also sit centred over or under its dot (clamped into the plot).
  const mid = Math.max(plot.x, Math.min(px - w / 2, plot.x + plot.w - w));
  // Further out to either side as well, for a point in a cluster or on a line.
  const xs =
    side === "beside"
      ? [px + 24, px - 24 - w, mid, px + 72, px - 72 - w, px + 132, px - 132 - w]
      : [px - w / 2, px + 24, px - 24 - w];
  const ys: number[] = [];
  if (side === "beside") {
    // Clamped into the plot, as `mid` is: a point at the plot's top edge (the best score)
    // has its label flush with the top rather than a step over it and lost.
    const fit = (y: number) => Math.max(plot.y, Math.min(y, plot.y + plot.h - h));
    const steps: number[] = [];
    for (let k = 0; k <= 12; k++)
      steps.push(...(k ? [py - h / 2 - 48 * k, py - h / 2 + 48 * k] : [py - h / 2]));
    // Sliding labels (van Kreveld, Strijk & Wolff 1999): while the box still spans its dot's
    // height it may slide up or down to sit flush against a word or line — the place a fixed
    // 48px step misses by a few px (a dot 14px over a dashed reference line).
    const x0 = px - 132 - w;
    const x1 = px + 132 + w;
    for (const t of [...taken, ...strokes])
      if (t.x1 > x0 && t.x0 < x1)
        for (const y of [t.y1, t.y0 - h]) if (y >= py - h && y <= py) steps.push(y);
    const mid0 = py - h / 2;
    ys.push(
      ...[...new Set(steps)]
        .sort((a, b) => Math.abs(a - mid0) - Math.abs(b - mid0) || a - b)
        .map(fit),
    );
  } else {
    const levels = Math.max(1, Math.floor((plot.h / 2 - 28 - h) / 48));
    const order = [
      ...Array.from({ length: levels + 1 }, (_, k) => (k + spreadFrom) % (levels + 1)),
    ];
    const near = (k: number) => (side === "above" ? py - 28 - h - 48 * k : py + 80 + 48 * k);
    const far = (k: number) => (side === "above" ? py + 80 + 48 * k : py - 28 - h - 48 * k);
    for (const k of order) ys.push(near(k));
    for (const k of order) ys.push(far(k));
  }
  for (const y0 of ys)
    for (const x0 of xs) {
      const box = { x0, y0, x1: x0 + w, y1: y0 + h };
      if (
        box.x0 < plot.x ||
        box.x1 > plot.x + plot.w ||
        box.y0 < plot.y ||
        box.y1 > plot.y + plot.h
      )
        continue;
      if (taken.some((t) => area(box, t) > 0) || strokes.some((t) => area(box, t) > 0)) continue;
      const nx = Math.max(box.x0, Math.min(px, box.x1));
      const ny = Math.max(box.y0, Math.min(py, box.y1));
      // A leader stops 12px short of its label: a glyph's box is taller than its line,
      // and a leader run into it reads as a stroke through the word.
      const far = Math.hypot(nx - px, ny - py);
      // A label reads as the nearest point's: never nearer another point than its own
      // (r3 C s10 put one model's label 400px from its dot, beside another point), and never
      // so far that the leader is the only thing tying it there.
      if (far > LEADER_MAX) continue;
      const toBox = (q: { x: number; y: number }) =>
        Math.hypot(
          q.x - Math.max(box.x0, Math.min(q.x, box.x1)),
          q.y - Math.max(box.y0, Math.min(q.y, box.y1)),
        );
      if (others.some((q) => toBox(q) < far)) continue;
      // Nor across a line from it: the gap from dot to word crosses no line (a word
      // sat under a dashed reference line and read as that line's).
      if (far > 18) {
        const u = 18 / far;
        const gap = [px + (nx - px) * u, py + (ny - py) * u, nx, ny];
        if (segBoxes(gap, 2).some((b) => crossNot.some((t) => area(b, t) > 0))) continue;
      }
      const stop = far > 0 ? Math.max(0, far - 12) / far : 0;
      const leader =
        far > LEADER_PX ? [[px, py, px + (nx - px) * stop, py + (ny - py) * stop]] : [];
      // The leader leaves the dot from its rim and must not cross anything but its own dot.
      const rim = leader.map(([ax, ay, bx, by]) => {
        const len =
          Math.hypot((bx as number) - (ax as number), (by as number) - (ay as number)) || 1;
        const u = 30 / len;
        return [
          (ax as number) + ((bx as number) - (ax as number)) * u,
          (ay as number) + ((by as number) - (ay as number)) * u,
          bx as number,
          by as number,
        ];
      });
      // The leader crosses no word, point, curve, series or other leader (r3: crossed leaders
      // in a cluster of four, leaders across two curves).
      if (
        rim.some((s) =>
          segBoxes(s, 2).some(
            (b) => taken.some((t) => area(b, t) > 0) || crossNot.some((t) => area(b, t) > 0),
          ),
        )
      )
        continue;
      return { box, leader };
    }
  return null;
}

const LEGEND_ROW = 56;

/** Past this many px from its dot, a label is joined to it by a leader line. */
export const LEADER_PX = 60;

/** A label never sits further than this from its dot; past it the points are keyed. */
export const LEADER_MAX = 150;

/**
 * 3–6 round tick values inside `[lo, hi]` (an axis's drawn range, in log10 on a
 * log axis, where only powers of ten are ticked), each with its text.
 */
export function ticksOf(
  r: readonly [number, number],
  log: boolean,
): Array<{ v: number; text: string }> {
  const [lo, hi] = r;
  if (!(hi > lo)) return [];
  if (log) {
    const out: Array<{ v: number; text: string }> = [];
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k++)
      out.push({ v: k, text: String(Number((10 ** k).toPrecision(6))) });
    return out.length >= 2 ? out : [];
  }
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const dp = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const out: Array<{ v: number; text: string }> = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
    const x = Number(v.toFixed(dp));
    out.push({ v: x, text: x.toFixed(dp) });
  }
  return out;
}

/** One legend entry: a group's colour, a curve's line, or a key's shape. */
interface LegendEntry {
  name: string;
  role: "a" | "b" | "c" | "d" | "muted";
  shape: Shape | "line";
}

/**
 * The legend: one swatch and name per entry, laid right to left by measured
 * width from `right`, the first row stopping at `left`; an entry that does not
 * fit starts the next row down, across `full`. Four groups beside a strip's axis
 * name ran 110px off the left of the frame on one row, clipped by the scene's
 * own box where no gate saw it.
 */
function legendOf(
  entries: readonly LegendEntry[],
  left: number,
  right: number,
  full: { left: number; right: number },
  measure: Ctx["measure"],
): { prims: Prim[]; boxes: Box[]; rows: number } {
  const prims: Prim[] = [];
  const boxes: Box[] = [];
  let row = 0;
  let x1 = right;
  let lo = left;
  let kind: string | undefined;
  for (const e of [...entries].reverse()) {
    const w = measure(e.name, TYPE.label) + 34;
    // A key's shapes and the groups' colours are two legends: each starts its own row.
    const k = e.role === "muted" ? "shape" : "colour";
    const change = kind !== undefined && k !== kind;
    kind = k;
    if ((change || x1 - w < lo) && x1 !== (row ? full.right : right)) {
      row++;
      x1 = full.right;
      lo = full.left;
    }
    const x0 = x1 - w;
    const y = 8 + row * LEGEND_ROW;
    const fill = e.role === "muted" ? "muted" : e.role;
    if (e.shape === "line")
      prims.push({ p: "line", x1: x0, y1: y + 24, x2: x0 + 24, y2: y + 24, role: fill, width: 5 });
    else
      prims.push(
        ...markerPrims(e.shape, x0 + 12, y + 24, 11, fill, 0).map((p) => ({
          ...p,
          at: undefined,
          cam: undefined,
        })),
      );
    prims.push({
      p: "text",
      x: x0 + 34,
      y,
      size: TYPE.label,
      role: "fg",
      anchor: "start",
      text: e.name,
    });
    boxes.push({ x0, y0: y, x1, y1: y + TYPE.label * 1.2 });
    x1 = x0 - 48;
  }
  return { prims, boxes, rows: entries.length ? row + 1 : 0 };
}

const pointsKind = verbKind("place", points, { pictureSide: 0 });

export const placeKind: KindImpl = {
  picture: false,
  async layers(input) {
    const lit = input.spec.data as PlaceLit;
    if (placeForm(lit) === "points") return pointsKind.layers(input);
    return { files: {}, data: {} };
  },
  fragment(L: Layers, region: Region, cues: readonly Cue[], spec: KindSpec, theme: Theme, href) {
    const lit = spec.data as PlaceLit;
    const form = placeForm(lit);
    if (form === "points") return stagedFragment("place", L, region, cues, spec, theme, href);
    for (const slot of NEEDS[form] ?? [])
      if (!lab("place", spec, slot))
        throw new Error(`literal: place ${form} needs the slot "${slot}"`);
    if (form === "combos" && lit.combos?.settings.length && !lab("place", spec, "tested"))
      throw new Error('literal: place combos with settings needs the slot "tested"');
    const impl = { margins: marginsForm, lengths: lengthsForm, combos: combosForm, sets: setsForm }[
      form
    ];
    return impl.fragment(L, region, cues, spec, theme, href);
  },
};

export type { Frame };
