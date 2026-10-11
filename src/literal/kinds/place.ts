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
import { TYPE } from "./common.js";
import { combosForm } from "./place-combos.js";
import { lengthsForm } from "./place-lengths.js";
import { marginsForm } from "./place-margins.js";
import { setsForm } from "./place-sets.js";
import { paramRecord } from "./read.js";
import { stagedFragment, type VerbCtx, verbKind, wrapBy } from "./stage.js";

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
    if (!groups.includes(cv.label))
      prims.push({
        p: "text",
        x: (pts[0] as number) + 8,
        y: (pts[1] as number) - 52,
        size: TYPE.label,
        role: curveRole(cv.label, k),
        anchor: "start",
        text: cv.label,
        at,
        cam: true,
      });
  });
  // The points, with their words beside them; labels nudged apart so none covers another.
  const placed: Array<{ x: number; y: number; w: number }> = [];
  const byGroup = d.reveal === "groups";
  d.items.forEach((it, i) => {
    const v = vals[i] as number[];
    const px = X(v[0] as number);
    const py = two ? Y(v[1] as number) : plot.y + plot.h / 2;
    const g = groups.indexOf(it.group ?? "");
    const step = byGroup ? at + g + 1 : at + i + 1;
    const a = Math.min(12, step);
    const words = `${it.label} ${it.values.join(" · ")}`;
    const lines = wrapBy(words, TYPE.label, Math.min(520, plot.w / 2), c.measure);
    const w = Math.max(...lines.map((l) => c.measure(l, TYPE.label)));
    let lx = px + 24;
    let anchor: "start" | "end" = "start";
    if (lx + w > plot.x + plot.w) {
      lx = px - 24;
      anchor = "end";
    }
    let ly = two ? py - 24 : i % 2 ? py + 28 : py - 28 - lines.length * 47;
    for (let tries = 0; tries < 20; tries++) {
      const x0 = anchor === "start" ? lx : lx - w;
      const hit = placed.find(
        (q) => Math.abs(q.y - ly) < lines.length * 47 && x0 < q.x + q.w && q.x < x0 + w,
      );
      if (!hit) break;
      ly += two ? 48 : i % 2 ? 48 : -48;
    }
    placed.push({ x: anchor === "start" ? lx : lx - w, y: ly, w });
    prims.push({
      p: "circle",
      cx: px,
      cy: py,
      r: 14,
      fill: roleOf(it.group ?? ""),
      cam: true,
      at: a,
    });
    lines.forEach((t, j) => {
      prims.push({
        p: "text",
        x: lx,
        y: ly + j * 47,
        size: TYPE.label,
        role: "fg",
        anchor,
        text: t,
        cam: true,
        at: a,
      });
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
  if (groups.length > 1 && groups.every(Boolean))
    groups.forEach((g, k) => {
      const x = plot.x + plot.w - (groups.length - k) * (W / 6);
      prims.push(
        { p: "circle", cx: x, cy: 30, r: 12, fill: roleOf(g) },
        { p: "text", x: x + 22, y: 8, size: TYPE.label, role: "fg", anchor: "start", text: g },
      );
    });
  return { rasters: {}, frames: [{ id: "place", prims, vars: {} }], data: {}, vars: {} };
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
