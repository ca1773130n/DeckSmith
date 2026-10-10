/**
 * optimization — how training moves: either the source's own loss curves
 * drawn progressively, or real optimizers run on a small analytic landscape.
 *
 * WHAT IS EXACT. "curves": the numbers are the source's result rows, as given;
 * between two given points the line is straight, never smoothed or fitted.
 * "landscape": the function and its gradient are analytic (a conditioned
 * quadratic, Rosenbrock a = 1, b = 100, or Himmelblau) and every optimizer is
 * its textbook update — SGD; heavy-ball momentum v ← βv + g, θ ← θ − ηv;
 * RMSProp; Adam with bias correction (Kingma & Ba 2015) — run for real from
 * one start. The landscape is illustrative of the optimizer, not the paper's
 * loss surface, and the slots must say so.
 *
 * Frames draw progressively: the first k/F of every path or curve, a marker
 * at its head, and (landscape) the head's current velocity as an arrow — the
 * momentum trail — plus loss against step for every optimizer on the right.
 */
import {
  type Frame,
  fillTemplate,
  flat,
  type Gray,
  type Measure,
  type MechanismResult,
  niceTicks,
  type Prim,
  type Raster,
  type Region,
  type Role,
  roughMeasure,
  TYPE,
} from "./common.js";

/* -------------------------------------------------------------------- maths */

export type LandscapeName = "quadratic" | "rosenbrock" | "himmelblau";

export interface Landscape {
  f(x: number, y: number): number;
  grad(x: number, y: number): [number, number];
  /** The plotted domain [x0, x1] × [y0, y1]. */
  domain: [number, number, number, number];
  minima: Array<[number, number]>;
}

export const LANDSCAPES: Readonly<Record<LandscapeName, Landscape>> = {
  // ½(x² + κy²), κ = 10: the ill-conditioned bowl where momentum earns its keep.
  quadratic: {
    f: (x, y) => 0.5 * (x * x + 10 * y * y),
    grad: (x, y) => [x, 10 * y],
    domain: [-3, 3, -2, 2],
    minima: [[0, 0]],
  },
  rosenbrock: {
    f: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
    grad: (x, y) => [-2 * (1 - x) - 400 * x * (y - x * x), 200 * (y - x * x)],
    domain: [-2, 2, -1, 3],
    minima: [[1, 1]],
  },
  himmelblau: {
    f: (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2,
    grad: (x, y) => [
      4 * x * (x * x + y - 11) + 2 * (x + y * y - 7),
      2 * (x * x + y - 11) + 4 * y * (x + y * y - 7),
    ],
    domain: [-5, 5, -5, 5],
    minima: [
      [3, 2],
      [-2.805118, 3.131312],
      [-3.77931, -3.283186],
      [3.584428, -1.848126],
    ],
  },
};

export interface OptimizerSpec {
  /** Drawn as the run's name: the source's own word for it. */
  label: string;
  rule: "sgd" | "momentum" | "rmsprop" | "adam";
  lr: number;
  /** Momentum β (default 0.9). */
  beta?: number;
  /** Adam β1, β2 (defaults 0.9, 0.999); RMSProp ρ (default 0.9). */
  beta1?: number;
  beta2?: number;
  rho?: number;
  eps?: number;
}

export interface Run {
  /** θ_0..θ_n. */
  path: Array<[number, number]>;
  loss: number[];
  /** The step taken at each update (θ_{k+1} − θ_k), the head's velocity. */
  steps: Array<[number, number]>;
}

/** One optimizer, run for real on a landscape's analytic gradient. */
export function runOptimizer(
  L: Landscape,
  o: OptimizerSpec,
  start: [number, number],
  n: number,
): Run {
  if (!(o.lr > 0)) throw new Error(`optimization: ${o.label}'s learning rate must be positive`);
  let [x, y] = start;
  const path: Array<[number, number]> = [[x, y]];
  const loss = [L.f(x, y)];
  const steps: Array<[number, number]> = [];
  let v: [number, number] = [0, 0];
  let m: [number, number] = [0, 0];
  let s: [number, number] = [0, 0];
  const eps = o.eps ?? 1e-8;
  for (let k = 1; k <= n; k++) {
    const g = L.grad(x, y);
    let d: [number, number];
    switch (o.rule) {
      case "sgd":
        d = [-o.lr * g[0], -o.lr * g[1]];
        break;
      case "momentum": {
        const b = o.beta ?? 0.9;
        v = [b * v[0] + g[0], b * v[1] + g[1]];
        d = [-o.lr * v[0], -o.lr * v[1]];
        break;
      }
      case "rmsprop": {
        const r = o.rho ?? 0.9;
        s = [r * s[0] + (1 - r) * g[0] ** 2, r * s[1] + (1 - r) * g[1] ** 2];
        d = [(-o.lr * g[0]) / (Math.sqrt(s[0]) + eps), (-o.lr * g[1]) / (Math.sqrt(s[1]) + eps)];
        break;
      }
      case "adam": {
        const b1 = o.beta1 ?? 0.9;
        const b2 = o.beta2 ?? 0.999;
        m = [b1 * m[0] + (1 - b1) * g[0], b1 * m[1] + (1 - b1) * g[1]];
        s = [b2 * s[0] + (1 - b2) * g[0] ** 2, b2 * s[1] + (1 - b2) * g[1] ** 2];
        const mh: [number, number] = [m[0] / (1 - b1 ** k), m[1] / (1 - b1 ** k)];
        const sh: [number, number] = [s[0] / (1 - b2 ** k), s[1] / (1 - b2 ** k)];
        d = [
          (-o.lr * mh[0]) / (Math.sqrt(sh[0]) + eps),
          (-o.lr * mh[1]) / (Math.sqrt(sh[1]) + eps),
        ];
        break;
      }
    }
    x += d[0];
    y += d[1];
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error(`optimization: ${o.label} diverged at step ${k}; lower its learning rate`);
    path.push([x, y]);
    loss.push(L.f(x, y));
    steps.push(d);
  }
  return { path, loss, steps };
}

/** log(1 + f) over the domain at w×h, scaled to 0..1; and its iso-lines at `levels` bands. */
export function landscapeMaps(
  L: Landscape,
  w: number,
  h: number,
  levels: number,
): { loss: Gray; contours: Gray } {
  const [x0, x1, y0, y1] = L.domain;
  const v = new Float32Array(w * h);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = x0 + ((i + 0.5) / w) * (x1 - x0);
      const y = y1 - ((j + 0.5) / h) * (y1 - y0); // up is +y
      const f = Math.log1p(L.f(x, y));
      v[j * w + i] = f;
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
  for (let i = 0; i < v.length; i++) v[i] = ((v[i] as number) - lo) / (hi - lo || 1);
  const band = (i: number) => Math.floor((v[i] as number) * levels);
  const c = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const b = band(j * w + i);
      if ((i + 1 < w && band(j * w + i + 1) !== b) || (j + 1 < h && band((j + 1) * w + i) !== b))
        c[j * w + i] = 1;
    }
  return { loss: { w, h, d: v }, contours: { w, h, d: c } };
}

/* ------------------------------------------------------------------ inputs */

export interface LandscapeInput {
  mode: "landscape";
  landscape: LandscapeName;
  start: [number, number];
  steps: number;
  optimizers: OptimizerSpec[];
  /** Frames to draw the runs over (default 6). */
  frames?: number;
  measure?: Measure;
}

export interface CurvesInput {
  mode: "curves";
  /** The source's own rows: x (step, epoch) and value, per run. */
  series: Array<{ label: string; points: Array<[number, number]> }>;
  /** Which end is better (default "lower", a loss). */
  better?: "lower" | "higher";
  logY?: boolean;
  frames?: number;
  measure?: Measure;
}

export type OptimizationInput = LandscapeInput | CurvesInput;

export const TAKEAWAY =
  "After {steps} steps, {best} reaches {bestValue} while {worst} is at {worstValue}.";

const ROLES: Role[] = ["accent", "b", "c", "d", "a"];

/* -------------------------------------------------------------- the kind */

export function optimization(input: OptimizationInput, region: Region): MechanismResult {
  return input.mode === "landscape" ? landscape(input, region) : curves(input, region);
}

interface Axes {
  x0: number;
  y0: number;
  w: number;
  h: number;
  X: (v: number) => number;
  Y: (v: number) => number;
  prims: Prim[];
}

/** A plotting box with ticks as plain numbers, and the two axis slots. */
function axes(
  box: { x: number; y: number; w: number; h: number },
  xr: [number, number],
  yr: [number, number],
  logY: boolean,
  measure: Measure,
): Axes {
  const size = TYPE.label;
  const yt = logY
    ? Array.from(
        { length: Math.floor(Math.log10(yr[1])) - Math.ceil(Math.log10(yr[0])) + 1 },
        (_, i) => 10 ** (Math.ceil(Math.log10(yr[0])) + i),
      )
    : niceTicks(yr[0], yr[1], 4);
  const label = (v: number) =>
    logY
      ? v >= 1
        ? String(v)
        : `1e${Math.round(Math.log10(v))}`
      : String(Number(v.toPrecision(4)));
  const left = Math.max(...yt.map((v) => measure(label(v), size))) + 24;
  const x0 = box.x + left;
  const w = box.w - left;
  const y0 = box.y;
  const h = box.h - (size + 16) - (size + 20);
  const ty = (v: number) => (logY ? Math.log10(v) : v);
  const [a, b] = [ty(yr[0]), ty(yr[1])];
  const X = (v: number) => x0 + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * w;
  const Y = (v: number) => y0 + (1 - (ty(Math.max(v, logY ? 1e-300 : v)) - a) / (b - a || 1)) * h;
  const prims: Prim[] = [
    { p: "line", id: "ax", x1: x0, y1: y0 + h, x2: x0 + w, y2: y0 + h, role: "rule", width: 2 },
    { p: "line", id: "ay", x1: x0, y1: y0, x2: x0, y2: y0 + h, role: "rule", width: 2 },
  ];
  for (const v of yt)
    if (v >= yr[0] && v <= yr[1])
      prims.push({
        p: "text",
        id: `yt${v}`,
        x: x0 - 12,
        // Inside the box: the top tick's label must not rise into the shell's headline.
        y: Math.min(y0 + h - size, Math.max(y0, Y(v) - size / 2)),
        size,
        role: "muted",
        anchor: "end",
        text: label(v),
      });
  // As many ticks as the axis has room for: one per ~180 px, so numbers never touch.
  for (const v of niceTicks(xr[0], xr[1], Math.max(1, Math.min(4, Math.floor(w / 180)))))
    if (v >= xr[0] && v <= xr[1])
      prims.push({
        p: "text",
        id: `xt${v}`,
        x: X(v),
        y: y0 + h + 8,
        size,
        role: "muted",
        anchor: v === xr[1] ? "end" : "middle", // the last tick ends at the axis
        text: String(Number(v.toPrecision(6))),
      });
  prims.push({
    p: "text",
    id: "xl",
    x: x0 + w,
    y: y0 + h + size + 20,
    size,
    role: "muted",
    anchor: "end",
    slot: "xAxis",
  });
  prims.push({
    p: "text",
    id: "yl",
    x: x0 + 12,
    y: y0,
    size,
    role: "muted",
    anchor: "start",
    slot: "yAxis",
  });
  return { x0, y0, w, h, X, Y, prims };
}

/** The given points with x ≤ cut: a curve is drawn only through the rows it was given, never between them. */
export function pointsUpTo(
  points: ReadonlyArray<readonly [number, number]>,
  cut: number,
): Array<[number, number]> {
  return points.filter((p) => p[0] <= cut + 1e-9).map((p) => [p[0], p[1]]);
}

/** A computed value for a label: 3 significant digits, or an exponent below 1e-3 (never "0" for 5e-14). */
export function fmtValue(v: number): string {
  return Math.abs(v) >= 1e-3 || v === 0 ? String(Number(v.toPrecision(3))) : v.toExponential(1);
}

/** End labels pushed apart vertically so none overlaps another. */
function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array<number>(ys.length);
  let prev = Number.NEGATIVE_INFINITY;
  for (const [y, i] of order) {
    const v = Math.max(y, prev + gap);
    out[i] = v;
    prev = v;
  }
  const over = Math.max(0, prev - hi);
  return out.map((v) => Math.max(lo, v - over));
}

function verdict(
  items: Array<{ label: string; value: number }>,
  better: "lower" | "higher",
  fmt: (v: number) => string,
): { best: string; bestValue: string; worst: string; worstValue: string } {
  const sorted = [...items].sort((a, b) =>
    better === "lower" ? a.value - b.value : b.value - a.value,
  );
  const best = sorted[0] as { label: string; value: number };
  const worst = sorted[sorted.length - 1] as { label: string; value: number };
  return {
    best: best.label,
    bestValue: fmt(best.value),
    worst: worst.label,
    worstValue: fmt(worst.value),
  };
}

function curves(input: CurvesInput, region: Region): MechanismResult {
  const { series } = input;
  if (!series.length) throw new Error("optimization: curves needs at least one series");
  for (const s of series) {
    if (s.points.length < 2) throw new Error(`optimization: series "${s.label}" needs two points`);
    for (let i = 1; i < s.points.length; i++)
      if ((s.points[i] as [number, number])[0] <= (s.points[i - 1] as [number, number])[0])
        throw new Error(`optimization: series "${s.label}" x values must increase`);
    if (input.logY && s.points.some((p) => !(p[1] > 0)))
      throw new Error(`optimization: series "${s.label}" has a value ≤ 0 on a log axis`);
  }
  const measure = input.measure ?? roughMeasure;
  const all = series.flatMap((s) => s.points);
  const xr: [number, number] = [
    Math.min(...all.map((p) => p[0])),
    Math.max(...all.map((p) => p[0])),
  ];
  let yr: [number, number] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  if (input.logY) yr = [10 ** Math.floor(Math.log10(yr[0])), 10 ** Math.ceil(Math.log10(yr[1]))];
  else {
    const t = niceTicks(yr[0], yr[1], 4);
    yr = [Math.min(yr[0], t[0] as number), Math.max(yr[1], t[t.length - 1] as number)];
  }
  const size = TYPE.label;
  // A given value is drawn as the plan wrote it; the column is as wide as the widest it will hold.
  const given = (v: number) => String(v);
  const labelW =
    Math.max(
      ...series.flatMap((s) => s.points.map((p) => measure(`${s.label} ${given(p[1])}`, size))),
    ) +
    18 +
    12;
  const ax = axes(
    { x: 0, y: 0, w: region.width - labelW, h: region.height },
    xr,
    yr,
    !!input.logY,
    measure,
  );
  const F = input.frames ?? 6;
  const frames: Frame[] = [];
  for (let k = 1; k <= F; k++) {
    const cut = xr[0] + ((xr[1] - xr[0]) * k) / F;
    const prims: Prim[] = [...ax.prims];
    const heads = series.map((s) => pointsUpTo(s.points, cut));
    const ends = spread(
      heads.map((h) => (h.length ? ax.Y((h[h.length - 1] as [number, number])[1]) - size / 2 : 0)),
      size + 6,
      0,
      ax.y0 + ax.h - size,
    );
    series.forEach((s, i) => {
      const h = heads[i] as Array<[number, number]>;
      if (!h.length) return; // this series starts later
      const role = ROLES[i % ROLES.length] as Role;
      const end = h[h.length - 1] as [number, number];
      prims.push({
        p: "path",
        id: `s${i}`,
        pts: flat(h.map(([x, y]) => [ax.X(x), ax.Y(y)] as const)),
        role,
        width: 5,
      });
      prims.push({
        p: "circle",
        id: `h${i}`,
        cx: ax.X(end[0]),
        cy: ax.Y(end[1]),
        r: 9,
        fill: role,
      });
      prims.push({
        p: "text",
        id: `e${i}`,
        x: ax.X(end[0]) + 18,
        y: ends[i] as number,
        size,
        role,
        anchor: "start",
        text: `${s.label} ${given(end[1])}`,
      });
    });
    const shown = heads.map((h, i) => [h, i] as const).filter(([h]) => h.length);
    const v = verdict(
      shown.map(([h, i]) => ({
        label: (series[i] as { label: string }).label,
        value: (h[h.length - 1] as [number, number])[1],
      })),
      input.better ?? "lower",
      given,
    );
    const last = Math.max(...shown.map(([h]) => (h[h.length - 1] as [number, number])[0]));
    frames.push({ id: `k${k}`, prims, vars: { steps: given(last), ...v } });
  }
  return { rasters: {}, frames, data: { xr, yr }, vars: (frames[frames.length - 1] as Frame).vars };
}

function landscape(input: LandscapeInput, region: Region): MechanismResult {
  const L = LANDSCAPES[input.landscape];
  if (!L) throw new Error(`optimization: no landscape "${input.landscape}"`);
  if (!input.optimizers.length) throw new Error("optimization: needs at least one optimizer");
  if (!Number.isInteger(input.steps) || input.steps < 1 || input.steps > 10000)
    throw new Error(`optimization: steps must be 1..10000, got ${input.steps}`);
  const runs = input.optimizers.map((o) => runOptimizer(L, o, input.start, input.steps));
  const measure = input.measure ?? roughMeasure;
  const size = TYPE.label;
  const { width: W, height: H } = region;
  const [dx0, dx1, dy0, dy1] = L.domain;
  // The landscape panel keeps the domain's aspect.
  const ph = H - (size + 16);
  const pw = Math.min(W * 0.45, (ph * (dx1 - dx0)) / (dy1 - dy0));
  const k = pw / (dx1 - dx0);
  const lw = Math.round(Math.min(pw, 480));
  const lh = Math.round((lw * (dy1 - dy0)) / (dx1 - dx0));
  const maps = landscapeMaps(L, lw, lh, 14);
  const rasters: Record<string, Raster> = {
    loss: { heat: maps.loss, role: "muted", alpha: 0.55 },
    contours: { heat: maps.contours, role: "dim", alpha: 0.8 },
  };
  const PX = (x: number) => (x - dx0) * k;
  const PY = (y: number) => (dy1 - y) * k;
  const clampPt = ([x, y]: [number, number]): [number, number] => [
    Math.max(dx0, Math.min(dx1, x)),
    Math.max(dy0, Math.min(dy1, y)),
  ];
  const allLoss = runs.flatMap((r) => r.loss);
  const lr: [number, number] = [Math.max(1e-12, Math.min(...allLoss)), Math.max(...allLoss)];
  const F = input.frames ?? 6;
  const uptos = Array.from({ length: F }, (_, f) => Math.round((input.steps * (f + 1)) / F));
  // The legend column is as wide as the widest label any frame prints (18 px offset + margin).
  const legendW =
    Math.max(
      ...runs.flatMap((r, i) =>
        uptos.map((u) =>
          measure(
            `${(input.optimizers[i] as OptimizerSpec).label} ${fmtValue(r.loss[u] as number)}`,
            size,
          ),
        ),
      ),
    ) + 30;
  const ax = axes(
    { x: pw + 80, y: 0, w: W - pw - 80 - legendW, h: H },
    [0, input.steps],
    [10 ** Math.floor(Math.log10(lr[0])), 10 ** Math.ceil(Math.log10(lr[1]))],
    true,
    measure,
  );
  const frames: Frame[] = [];
  for (let f = 1; f <= F; f++) {
    const upto = uptos[f - 1] as number;
    const prims: Prim[] = [
      { p: "image", id: "loss", x: 0, y: 0, w: pw, h: (dy1 - dy0) * k, layer: "loss" },
      { p: "image", id: "cont", x: 0, y: 0, w: pw, h: (dy1 - dy0) * k, layer: "contours" },
      { p: "rect", id: "frame", x: 0, y: 0, w: pw, h: (dy1 - dy0) * k, role: "rule", width: 2 },
    ];
    L.minima.forEach(([x, y], i) => {
      prims.push({ p: "circle", id: `min${i}`, cx: PX(x), cy: PY(y), r: 12, role: "fg", width: 4 });
    });
    prims.push({
      p: "circle",
      id: "start",
      cx: PX(input.start[0]),
      cy: PY(input.start[1]),
      r: 10,
      fill: "fg",
    });
    prims.push({
      p: "text",
      id: "land",
      x: 0,
      y: (dy1 - dy0) * k + 12,
      size,
      role: "muted",
      anchor: "start",
      slot: "landscape",
    });
    prims.push(...ax.prims);
    const ends = spread(
      runs.map((r) => ax.Y(Math.max(lr[0], r.loss[upto] as number)) - size / 2),
      size + 6,
      0,
      ax.y0 + ax.h - size,
    );
    runs.forEach((r, i) => {
      const role = ROLES[i % ROLES.length] as Role;
      const o = input.optimizers[i] as OptimizerSpec;
      const pts = r.path.slice(0, upto + 1).map(clampPt);
      prims.push({
        p: "path",
        id: `p${i}`,
        pts: flat(pts.map(([x, y]) => [PX(x), PY(y)] as const)),
        role,
        width: 4,
      });
      const [hx, hy] = pts[pts.length - 1] as [number, number];
      prims.push({ p: "circle", id: `ph${i}`, cx: PX(hx), cy: PY(hy), r: 10, fill: role });
      // The momentum trail: the head's last step, drawn at 3× so its direction reads, and only once it reaches past the head's marker.
      const d = r.steps[upto - 1];
      if (d && 3 * Math.hypot(d[0], d[1]) * k > 14) {
        const [tx, ty] = clampPt([hx + 3 * d[0], hy + 3 * d[1]]);
        prims.push({
          p: "line",
          id: `pv${i}`,
          x1: PX(hx),
          y1: PY(hy),
          x2: PX(tx),
          y2: PY(ty),
          role,
          width: 4,
          arrow: true,
        });
      }
      const ls = r.loss
        .slice(0, upto + 1)
        .map((v, s) => [ax.X(s), ax.Y(Math.max(lr[0], v))] as const);
      prims.push({ p: "path", id: `l${i}`, pts: flat(ls), role, width: 5 });
      prims.push({
        p: "text",
        id: `le${i}`,
        x: ax.X(upto) + 18,
        y: ends[i] as number,
        size,
        role,
        anchor: "start",
        text: `${o.label} ${fmtValue(r.loss[upto] as number)}`,
      });
    });
    const v = verdict(
      runs.map((r, i) => ({
        label: (input.optimizers[i] as OptimizerSpec).label,
        value: r.loss[upto] as number,
      })),
      "lower",
      fmtValue,
    );
    frames.push({ id: `k${f}`, prims, vars: { steps: upto, ...v } });
  }
  return {
    rasters,
    frames,
    data: { runs: runs.map((r) => ({ path: r.path, loss: r.loss })) },
    vars: (frames[frames.length - 1] as Frame).vars,
  };
}

export function takeaway(r: MechanismResult): string {
  return fillTemplate(TAKEAWAY, r.vars);
}
