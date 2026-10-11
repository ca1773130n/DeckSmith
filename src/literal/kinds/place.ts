/**
 * place — items positioned by the source's numbers.
 *
 * POINTS (`form` plane or strip, `measure` value): each item at its values on
 * one or two axes, every axis turned so that better is up and to the right
 * (`lowerIsBetter` flips it), its label and its values written beside it as
 * the source writes them. Items are revealed in spoken order, or group by
 * group (`reveal` groups); a group with `connect` is a series drawn as a line,
 * which is how the source's rows over steps (a loss curve) are shown. A
 * `curve` is a stated formula evaluated across the x axis and drawn under the
 * points, revealed left to right; the gate grounds it by checks the source
 * prints (src/plan/coverage.ts). No tick is drawn and no number is printed
 * that the source does not state.
 *
 * The word forms keep their own renderers (./place-*.ts): `measure` margin
 * (results against the best other method), `measure` length (quantities to
 * scale), `form` combos (experiments not run) and `form` sets (what was and
 * was not evaluated).
 */
import type { Theme } from "../../emit/kit.js";
import type { Literal } from "../../types.js";
import { evaluate, parseFormula } from "../formula.js";
import { type KindImpl, type KindSpec, lab } from "../kind.js";
import type { Cue, Layers } from "../kit.js";
import type { Frame, MechanismResult, Prim, Region } from "./common.js";
import { TYPE, wrapBy } from "./common.js";
import { combosForm } from "./place-combos.js";
import { lengthsForm } from "./place-lengths.js";
import { marginsForm } from "./place-margins.js";
import { setsForm } from "./place-sets.js";
import { paramRecord } from "./read.js";
import { stagedFragment, type VerbCtx, verbKind } from "./stage.js";

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

export function points(c: Ctx): MechanismResult {
  const d = c.lit;
  const two = d.form === "plane";
  const nAxes = two ? 2 : 1;
  if (d.axes.length !== nAxes)
    throw new Error(`place ${d.form} needs ${nAxes} axis(es), got ${d.axes.length}`);
  if (d.items.length < 2 || d.items.length > 16)
    throw new Error(`place draws 2–16 items, got ${d.items.length}`);
  if (d.curves.length && !two) throw new Error("place draws curves on a plane only");
  if (d.curves.length > 6) throw new Error("place draws at most 6 curves");
  const vals = d.items.map((it) => {
    if (it.values.length !== nAxes)
      throw new Error(`item "${it.label}" gives ${it.values.length} values for ${nAxes} axis(es)`);
    return it.values.map((v) => numberIn(v, `item "${it.label}"`));
  });
  const { width: W, height: H } = c.region;
  const top = 64;
  const plot = two
    ? { x: 24, y: top, w: W - 48, h: H - top - 64 }
    : { x: 24, y: top, w: W - 48, h: H - top - 24 };
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
    const lo = Math.min(
      xlo,
      ...cv.checks.flatMap((ck) =>
        ck.inputs.filter((i) => i.name === cv.x).map((i) => Number(i.value)),
      ),
    );
    const hi = Math.max(
      xhi,
      ...cv.checks.flatMap((ck) =>
        ck.inputs.filter((i) => i.name === cv.x).map((i) => Number(i.value)),
      ),
    );
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
    ];
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
    return [lo - pad, hi + pad] as const;
  };
  const rx = range(0);
  const ry = two ? range(1) : ([0, 1] as const);
  const better = (k: number) => !(d.axes[k] as PlaceLit["axes"][number]).lowerIsBetter;
  const X = (v: number) => {
    const t = (tr(0)(v) - rx[0]) / (rx[1] - rx[0]);
    return plot.x + plot.w * (better(0) ? t : 1 - t);
  };
  const Y = (v: number) => {
    const t = (tr(1)(v) - ry[0]) / (ry[1] - ry[0]);
    return plot.y + plot.h * (better(1) ? 1 - t : t);
  };
  const groups = [...new Set(d.items.map((it) => it.group ?? ""))];
  if (groups.length > 4) throw new Error(`place colours at most 4 groups, got ${groups.length}`);
  const roles = ["a", "b", "c", "d"] as const;
  const roleOf = (g: string) => roles[groups.indexOf(g)] ?? "a";
  const prims: Prim[] = [];
  // The axes: lines and their names, no ticks.
  const ax0 = d.axes[0] as PlaceLit["axes"][number];
  if (two) {
    const ax1 = d.axes[1] as PlaceLit["axes"][number];
    prims.push(
      {
        p: "rect",
        x: plot.x,
        y: plot.y,
        w: plot.w,
        h: plot.h,
        fill: "panel",
        opacity: 0.5,
        cam: true,
      },
      {
        p: "line",
        x1: plot.x,
        y1: plot.y + plot.h,
        x2: plot.x + plot.w,
        y2: plot.y + plot.h,
        role: "rule",
        width: 3,
        arrow: true,
        cam: true,
      },
      {
        p: "line",
        x1: plot.x,
        y1: plot.y + plot.h,
        x2: plot.x,
        y2: plot.y,
        role: "rule",
        width: 3,
        arrow: true,
        cam: true,
      },
      {
        p: "text",
        x: plot.x + plot.w,
        y: plot.y + plot.h + 12,
        size: TYPE.label,
        role: "muted",
        anchor: "end",
        text: ax0.name,
      },
      {
        p: "text",
        x: plot.x,
        y: 8,
        size: TYPE.label,
        role: "muted",
        anchor: "start",
        text: ax1.name,
      },
    );
  } else {
    const y = plot.y + plot.h / 2;
    prims.push(
      {
        p: "rect",
        x: plot.x,
        y: plot.y,
        w: plot.w,
        h: plot.h,
        fill: "panel",
        opacity: 0.5,
        cam: true,
      },
      {
        p: "line",
        x1: plot.x,
        y1: y,
        x2: plot.x + plot.w,
        y2: y,
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
  }
  // The axis names' boxes, and the legend laid right to left by its measured
  // words, ending where the strip's axis name begins (src/literal/kinds/stage.ts
  // draws a text's top at its y).
  const nameH = TYPE.label * 1.2;
  const axisBoxes: Box[] = two
    ? [
        {
          x0: plot.x + plot.w - c.measure(ax0.name, TYPE.label),
          y0: plot.y + plot.h + 12,
          x1: plot.x + plot.w,
          y1: plot.y + plot.h + 12 + nameH,
        },
        {
          x0: plot.x,
          y0: 8,
          x1: plot.x + c.measure((d.axes[1] as PlaceLit["axes"][number]).name, TYPE.label),
          y1: 8 + nameH,
        },
      ]
    : [
        {
          x0: plot.x + plot.w - c.measure(ax0.name, TYPE.label),
          y0: 8,
          x1: plot.x + plot.w,
          y1: 8 + nameH,
        },
      ];
  const legend = legendOf(
    groups.length > 1 && groups.every(Boolean) ? groups : [],
    two ? plot.x + plot.w : (axisBoxes[0] as Box).x0 - 48,
    roleOf,
    c.measure,
  );
  const curveNames: Box[] = [];
  let at = 0;
  // A curve takes the colour of the group it is named after, so its points and its line agree.
  const curveRole = (label: string, k: number) =>
    groups.includes(label) ? roleOf(label) : (roles[(groups.length + k) % 4] ?? "a");
  curves.forEach((cv, k) => {
    at = Math.min(12, at + 1);
    const pts = cv.pts
      .flatMap(([x, y]) => [X(x), Y(y)])
      .map((v, i) => (i % 2 ? Math.max(plot.y, Math.min(plot.y + plot.h, v)) : v));
    prims.push({
      p: "path",
      pts,
      role: curveRole(cv.label, k),
      width: 5,
      cam: true,
      at,
      wipe: true,
    });
    // Named at its left end, unless a group of that name already says it in the legend.
    if (!groups.includes(cv.label)) {
      const x0 = (pts[0] as number) + 8;
      const y0 = (pts[1] as number) - 52;
      curveNames.push({ x0, y0, x1: x0 + c.measure(cv.label, TYPE.label), y1: y0 + nameH });
      prims.push({
        p: "text",
        x: x0,
        y: y0,
        size: TYPE.label,
        role: curveRole(cv.label, k),
        anchor: "start",
        text: cv.label,
        at,
        cam: true,
      });
    }
  });
  // The points, with their words beside them. Every label is a box that may not
  // cover another label, any point, the legend or an axis name, and stays inside
  // the plot: tried right then left of its point, then stepped away from it.
  const LH = 47;
  const at0 = at;
  const pos = vals.map((v) => ({
    x: X(v[0] as number),
    y: two ? Y(v[1] as number) : plot.y + plot.h / 2,
  }));
  const taken: Box[] = [
    ...pos.map((q) => ({ x0: q.x - 18, y0: q.y - 18, x1: q.x + 18, y1: q.y + 18 })),
    ...legend.boxes,
    ...axisBoxes,
    ...curveNames,
  ];
  const byGroup = d.reveal === "groups";
  d.items.forEach((it, i) => {
    const { x: px, y: py } = pos[i] as { x: number; y: number };
    const g = groups.indexOf(it.group ?? "");
    const a = Math.min(12, byGroup ? at0 + g + 1 : at0 + i + 1);
    const words = `${it.label} ${it.values.join(" · ")}`;
    const lines = wrapBy(words, TYPE.label, Math.min(520, plot.w / 2), c.measure);
    const w = Math.max(...lines.map((l) => c.measure(l, TYPE.label)));
    const h = (lines.length - 1) * LH + TYPE.label * 1.2;
    const box = labelBox(px, py, w, h, two ? "beside" : i % 2 ? "below" : "above", plot, taken);
    taken.push(box);
    prims.push({
      p: "circle",
      cx: px,
      cy: py,
      r: 14,
      fill: roleOf(it.group ?? ""),
      cam: true,
      at: a,
    });
    for (const [j, t] of lines.entries())
      prims.push({
        p: "text",
        x: box.x0,
        y: box.y0 + j * LH,
        size: TYPE.label,
        role: "fg",
        anchor: "start",
        text: t,
        cam: true,
        at: a,
      });
  });
  if (d.connect)
    groups.forEach((g, k) => {
      const pts = d.items
        .map((it, i) => ({ it, v: vals[i] as number[] }))
        .filter((e) => (e.it.group ?? "") === g)
        .sort((p, q) => (p.v[0] as number) - (q.v[0] as number))
        .flatMap((e) => [X(e.v[0] as number), two ? Y(e.v[1] as number) : plot.y + plot.h / 2]);
      if (pts.length >= 4)
        prims.splice(two ? 5 : 3, 0, {
          p: "path",
          pts,
          role: roleOf(g),
          width: 4,
          cam: true,
          at: Math.min(12, at + (byGroup ? k + 1 : 1)),
          wipe: true,
        });
    });
  prims.push(...legend.prims);
  return { rasters: {}, frames: [{ id: "place", prims, vars: {} }], data: {}, vars: {} };
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

/**
 * Where a point's label goes: the first box, nearest first, that covers nothing
 * taken and stays inside the plot — beside the point (a plane) or on its side
 * of the line (a strip), right of it then left, stepping 48px away each try.
 * When none is free the least-covering box is used, and the overprint gate
 * (src/verify) names it: a crowded plot fails loudly rather than vanishing.
 */
export function labelBox(
  px: number,
  py: number,
  w: number,
  h: number,
  side: "beside" | "above" | "below",
  plot: { x: number; y: number; w: number; h: number },
  taken: readonly Box[],
): Box {
  const xs = [px + 24, px - 24 - w];
  const ys: number[] = [];
  for (let k = 0; k <= 12; k++) {
    if (side === "beside")
      ys.push(...(k ? [py - h / 2 - 48 * k, py - h / 2 + 48 * k] : [py - h / 2]));
    else {
      const near = side === "above" ? py - 28 - h - 48 * k : py + 28 + 48 * k;
      const far = side === "above" ? py + 28 + 48 * k : py - 28 - h - 48 * k;
      ys.push(near, far);
    }
  }
  let best: { box: Box; cost: number } | undefined;
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
      const cost = taken.reduce((s, t) => s + area(box, t), 0);
      if (!cost) return box;
      if (!best || cost < best.cost) best = { box, cost };
    }
  if (best) return best.box;
  const x0 = Math.min(Math.max(plot.x, px + 24), plot.x + plot.w - w);
  const y0 = Math.min(Math.max(plot.y, py - h / 2), plot.y + plot.h - h);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** The legend: one dot and name per group, laid right to left from `right` by their measured widths. */
function legendOf(
  groups: readonly string[],
  right: number,
  roleOf: (g: string) => Extract<Prim, { p: "circle" }>["fill"],
  measure: Ctx["measure"],
): { prims: Prim[]; boxes: Box[] } {
  const prims: Prim[] = [];
  const boxes: Box[] = [];
  let x1 = right;
  for (const g of [...groups].reverse()) {
    const x0 = x1 - measure(g, TYPE.label) - 34;
    prims.push(
      { p: "circle", cx: x0 + 12, cy: 30, r: 12, fill: roleOf(g) },
      { p: "text", x: x0 + 34, y: 8, size: TYPE.label, role: "fg", anchor: "start", text: g },
    );
    boxes.push({ x0, y0: 8, x1, y1: 8 + TYPE.label * 1.2 });
    x1 = x0 - 48;
  }
  return { prims, boxes };
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
