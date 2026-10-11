/**
 * THE OP LIBRARY the `operate` and `evolve` verbs compose: a small set of
 * general operations on arrays, pure and deterministic. What each op is, its
 * variants and the words that ground them are one table, `LITERAL_OPS` in
 * src/types.ts, read by the planner's prompt and the truth gate; this file is
 * only the arithmetic, so the three cannot drift.
 *
 * An array is a `Tensor`: h rows × w columns × c channels, row-major with the
 * channels interleaved. A picture is c = 3, a map c = 1, a vector h = 1, a
 * matrix c = 1. Every op takes the list of earlier outputs (the input first)
 * and returns one new array; none of them knows what a paper is. Kernels are
 * applied as correlation (as image libraries do), edges replicated.
 *
 * Nothing here is learned and nothing has a default a paper would have to
 * state: every parameter comes from the plan, grounded by the gate.
 */
import type { LiteralOpName } from "../types.js";
import { evaluate, parseFormula } from "./formula.js";

export interface Tensor {
  h: number;
  w: number;
  c: number;
  d: Float32Array;
}

export const tensor = (h: number, w: number, c: number, d?: ArrayLike<number>): Tensor => {
  const out = new Float32Array(h * w * c);
  if (d) {
    if (d.length !== out.length)
      throw new Error(`op: ${d.length} values do not fill a ${h}×${w}×${c} array`);
    out.set(d);
  }
  return { h, w, c, d: out };
};

/** A matrix (rows of equal length) as a tensor. */
export function fromRows(rows: readonly (readonly number[])[]): Tensor {
  const w = rows[0]?.length ?? 0;
  if (!rows.length || !w || rows.some((r) => r.length !== w))
    throw new Error("op: a matrix needs rows of one length");
  return tensor(rows.length, w, 1, rows.flat());
}

export const fromVector = (v: readonly number[]): Tensor => fromRows([v]);

/** One step of a chain, its parameters already read as numbers. */
export interface OpStep {
  op: LiteralOpName;
  how?: string;
  stat?: "mean" | "var" | "std";
  over?: "all" | "channel" | "row";
  params: Readonly<Record<string, number>>;
  weights?: readonly (readonly number[])[];
  /** Indexes into the list of outputs (0 = the input). */
  of?: readonly number[];
  expr?: string;
}

/** The kernels a NAME fixes: their numbers are the name (definitional). */
export const NAMED_KERNELS: Readonly<Record<string, readonly (readonly number[])[]>> = {
  "sobel-x": [
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1],
  ],
  "sobel-y": [
    [-1, -2, -1],
    [0, 0, 0],
    [1, 2, 1],
  ],
  laplacian: [
    [0, 1, 0],
    [1, -4, 1],
    [0, 1, 0],
  ],
  "prewitt-x": [
    [-1, 0, 1],
    [-1, 0, 1],
    [-1, 0, 1],
  ],
  "prewitt-y": [
    [-1, -1, -1],
    [0, 0, 0],
    [1, 1, 1],
  ],
};

const need = (step: OpStep, name: string): number => {
  const v = step.params[name];
  if (v === undefined || !Number.isFinite(v))
    throw new Error(`op: ${step.op} needs the parameter \`${name}\``);
  return v;
};

const sameShape = (a: Tensor, b: Tensor) => a.h === b.h && a.w === b.w && a.c === b.c;

/* ------------------------------------------------------------- statistics */

export function statOf(v: ArrayLike<number>, stat: "mean" | "var" | "std" | "min" | "max" | "sum") {
  const n = v.length;
  if (!n) return 0;
  if (stat === "min" || stat === "max") {
    let m = v[0] as number;
    for (let i = 1; i < n; i++)
      m = stat === "min" ? Math.min(m, v[i] as number) : Math.max(m, v[i] as number);
    return m;
  }
  let s = 0;
  for (let i = 0; i < n; i++) s += v[i] as number;
  if (stat === "sum") return s;
  const mean = s / n;
  if (stat === "mean") return mean;
  let q = 0;
  for (let i = 0; i < n; i++) q += ((v[i] as number) - mean) ** 2;
  return stat === "var" ? q / n : Math.sqrt(q / n);
}

/** The groups a statistic is taken over: all values, each channel, or each row. */
function groups(t: Tensor, over: "all" | "channel" | "row"): number[][] {
  const out: number[][] = [];
  if (over === "all") out.push(Array.from({ length: t.d.length }, (_, i) => i));
  else if (over === "channel")
    for (let k = 0; k < t.c; k++)
      out.push(Array.from({ length: t.h * t.w }, (_, i) => i * t.c + k));
  else
    for (let y = 0; y < t.h; y++)
      out.push(Array.from({ length: t.w * t.c }, (_, i) => y * t.w * t.c + i));
  return out;
}

/* -------------------------------------------------------------------- ops */

function channels(t: Tensor, how: string): Tensor {
  const o = tensor(t.h, t.w, 1);
  for (let i = 0; i < t.h * t.w; i++) {
    const px = Array.from({ length: t.c }, (_, k) => t.d[i * t.c + k] as number);
    if (how === "luma") {
      if (t.c !== 3) throw new Error("op: channels luma needs a 3-channel picture");
      o.d[i] = 0.2126 * (px[0] as number) + 0.7152 * (px[1] as number) + 0.0722 * (px[2] as number);
    } else if (how === "mean") o.d[i] = statOf(px, "mean");
    else if (how === "min") o.d[i] = statOf(px, "min");
    else if (how === "max") o.d[i] = statOf(px, "max");
    else throw new Error(`op: channels has no variant "${how}"`);
  }
  return o;
}

/** The kernel a conv step applies. */
export function kernelOf(step: OpStep, oneD: boolean): number[][] {
  const how = step.how ?? (step.weights?.length ? "weights" : "");
  const named = NAMED_KERNELS[how];
  if (named) {
    if (oneD)
      throw new Error(`op: the ${how} kernel is 2-D; a vector takes box, gaussian or weights`);
    return named.map((r) => [...r]);
  }
  if (how === "weights") {
    const k = step.weights ?? [];
    if (!k.length || k.some((r) => r.length !== (k[0] as readonly number[]).length))
      throw new Error("op: conv weights need rows of one length");
    if (oneD && k.length !== 1) throw new Error("op: a vector takes a one-row kernel");
    return k.map((r) => [...r]);
  }
  if (how === "box") {
    const s = need(step, "size");
    if (!Number.isInteger(s) || s < 1 || s > 101)
      throw new Error("op: box size must be a whole 1..101");
    const row = Array.from({ length: s }, () => 1 / (oneD ? s : s * s));
    return oneD ? [row] : Array.from({ length: s }, () => [...row]);
  }
  if (how === "gaussian") {
    const sigma = need(step, "sigma");
    if (!(sigma > 0)) throw new Error("op: gaussian sigma must be positive");
    // Truncated at 3σ unless the source states the size.
    const s = step.params.size ?? 2 * Math.ceil(3 * sigma) + 1;
    if (!Number.isInteger(s) || s % 2 !== 1 || s > 101)
      throw new Error("op: gaussian size must be odd, at most 101");
    const r = (s - 1) / 2;
    const g = Array.from({ length: s }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
    const tot = g.reduce((a, b) => a + b, 0);
    const g1 = g.map((v) => v / tot);
    return oneD ? [g1] : g1.map((a) => g1.map((b) => a * b));
  }
  throw new Error(`op: conv needs \`how\` (a named kernel, weights, box or gaussian)`);
}

function conv(t: Tensor, k: number[][]): Tensor {
  const kh = k.length;
  const kw = (k[0] as number[]).length;
  const oy = Math.floor(kh / 2);
  const ox = Math.floor(kw / 2);
  const o = tensor(t.h, t.w, t.c);
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++)
      for (let ch = 0; ch < t.c; ch++) {
        let s = 0;
        for (let j = 0; j < kh; j++) {
          const yy = Math.min(t.h - 1, Math.max(0, y + j - oy));
          const row = k[j] as number[];
          for (let i = 0; i < kw; i++) {
            const xx = Math.min(t.w - 1, Math.max(0, x + i - ox));
            s += (row[i] as number) * (t.d[(yy * t.w + xx) * t.c + ch] as number);
          }
        }
        o.d[(y * t.w + x) * t.c + ch] = s;
      }
  return o;
}

function reduce(t: Tensor, how: string, k: number, stride: number): Tensor {
  if (!Number.isInteger(k) || k < 1)
    throw new Error("op: reduce window must be a whole number ≥ 1");
  if (!["min", "max", "mean"].includes(how)) throw new Error(`op: reduce has no variant "${how}"`);
  const kh = t.h === 1 ? 1 : k;
  const pool = stride > 1;
  if (pool && stride !== k) throw new Error("op: a pooled reduce has stride = window");
  const H = pool ? Math.floor(t.h / kh) || 1 : t.h;
  const Wd = pool ? Math.floor(t.w / k) : t.w;
  if (!Wd) throw new Error(`op: a ${k} window does not fit ${t.w} columns`);
  const o = tensor(H, Wd, t.c);
  const r = Math.floor(k / 2);
  const rh = Math.floor(kh / 2);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < Wd; x++)
      for (let ch = 0; ch < t.c; ch++) {
        const vals: number[] = [];
        for (let j = 0; j < kh; j++)
          for (let i = 0; i < k; i++) {
            const yy = pool ? y * kh + j : Math.min(t.h - 1, Math.max(0, y + j - rh));
            const xx = pool ? x * k + i : Math.min(t.w - 1, Math.max(0, x + i - r));
            vals.push(t.d[(yy * t.w + xx) * t.c + ch] as number);
          }
        o.d[(y * Wd + x) * t.c + ch] = statOf(vals, how as "min" | "max" | "mean");
      }
  return o;
}

function combine(a: Tensor, b: Tensor, how: string): Tensor {
  if (!sameShape(a, b)) throw new Error("op: combine needs two outputs of one shape");
  const f: Record<string, (x: number, y: number) => number> = {
    "abs-sum": (x, y) => Math.abs(x) + Math.abs(y),
    magnitude: (x, y) => Math.hypot(x, y),
    min: Math.min,
    max: Math.max,
    sum: (x, y) => x + y,
    product: (x, y) => x * y,
    diff: (x, y) => x - y,
    posdiff: (x, y) => Math.max(0, x - y),
  };
  const fn = f[how];
  if (!fn) throw new Error(`op: combine has no variant "${how}"`);
  const o = tensor(a.h, a.w, a.c);
  for (let i = 0; i < o.d.length; i++) o.d[i] = fn(a.d[i] as number, b.d[i] as number);
  return o;
}

function normalise(t: Tensor, how: string, over: "all" | "channel" | "row"): Tensor {
  const o = tensor(t.h, t.w, t.c, t.d);
  for (const g of groups(t, over)) {
    const v = g.map((i) => t.d[i] as number);
    if (how === "softmax") {
      const m = statOf(v, "max");
      const e = v.map((x) => Math.exp(x - m));
      const s = e.reduce((a, b) => a + b, 0);
      g.forEach((i, j) => {
        o.d[i] = (e[j] as number) / s;
      });
      continue;
    }
    if (how === "range") {
      const lo = statOf(v, "min");
      const hi = statOf(v, "max");
      g.forEach((i, j) => {
        o.d[i] = hi > lo ? ((v[j] as number) - lo) / (hi - lo) : 0;
      });
      continue;
    }
    const by = { mean: "mean", max: "max", sum: "sum", std: "std" }[how] as
      | "mean"
      | "max"
      | "sum"
      | "std"
      | undefined;
    if (!by) throw new Error(`op: normalise has no variant "${how}"`);
    const k = statOf(v, by);
    if (!(Math.abs(k) > 1e-12)) throw new Error(`op: normalise by ${how} divides by zero`);
    g.forEach((i, j) => {
      o.d[i] = (v[j] as number) / k;
    });
  }
  return o;
}

/** θ per group: the stated one, or scale × the group's statistic. */
export function thresholds(t: Tensor, step: OpStep): number[] {
  const over = step.over ?? "all";
  const gs = groups(t, over === "row" ? "row" : over);
  if (step.params.theta !== undefined) return gs.map(() => step.params.theta as number);
  const scale = need(step, "scale");
  if (!step.stat) throw new Error("op: a threshold rule needs `stat` (mean, var or std)");
  return gs.map(
    (g) =>
      scale *
      statOf(
        g.map((i) => t.d[i] as number),
        step.stat as "mean",
      ),
  );
}

function threshold(t: Tensor, step: OpStep): Tensor {
  const how = step.how ?? "binary";
  if (how !== "binary" && how !== "keep") throw new Error(`op: threshold has no variant "${how}"`);
  const over = step.over ?? "all";
  const gs = groups(t, over === "row" ? "row" : over);
  const th = thresholds(t, step);
  const o = tensor(t.h, t.w, t.c);
  gs.forEach((g, k) => {
    for (const i of g) {
      const x = t.d[i] as number;
      o.d[i] = x >= (th[k] as number) ? (how === "binary" ? 1 : x) : 0;
    }
  });
  return o;
}

function quantize(t: Tensor, step: OpStep): Tensor {
  const D = need(step, "levels");
  const q = need(step, "step");
  if (!Number.isInteger(D) || D < 1)
    throw new Error("op: quantize levels must be a whole number ≥ 1");
  if (!(q > 0)) throw new Error("op: quantize step must be positive");
  const rnd = step.how === "floor" ? Math.floor : step.how === "round" ? Math.round : undefined;
  if (!rnd) throw new Error("op: quantize needs `how` floor or round, as the source states it");
  const o = tensor(t.h, t.w, t.c);
  for (let i = 0; i < o.d.length; i++)
    o.d[i] = Math.max(0, Math.min(D, rnd((t.d[i] as number) / q))) / D;
  return o;
}

function formula(list: readonly Tensor[], step: OpStep): Tensor {
  if (!step.expr) throw new Error("op: formula needs `expr`");
  const ast = parseFormula(step.expr);
  const x = list[list.length - 1] as Tensor;
  const o = tensor(x.h, x.w, x.c);
  const scalars: Record<string, number> = { ...step.params };
  for (let i = 0; i < o.d.length; i++) {
    const env: Record<string, number> = { ...scalars, x: x.d[i] as number };
    list.forEach((t, k) => {
      if (sameShape(t, x)) env[`x${k}`] = t.d[i] as number;
    });
    o.d[i] = evaluate(ast, env);
  }
  return o;
}

function matmul(a: Tensor, b: Tensor): Tensor {
  if (a.c !== 1 || b.c !== 1) throw new Error("op: matmul takes one-channel matrices");
  if (a.w !== b.h) throw new Error(`op: matmul of ${a.h}×${a.w} by ${b.h}×${b.w} does not fit`);
  const o = tensor(a.h, b.w, 1);
  for (let i = 0; i < a.h; i++)
    for (let j = 0; j < b.w; j++) {
      let s = 0;
      for (let k = 0; k < a.w; k++)
        s += (a.d[i * a.w + k] as number) * (b.d[k * b.w + j] as number);
      o.d[i * b.w + j] = s;
    }
  return o;
}

function select(t: Tensor, step: OpStep): Tensor {
  const how = step.how ?? "";
  const over = step.over === "all" ? "all" : "row";
  const o = tensor(t.h, t.w, t.c);
  for (const g of groups(t, over)) {
    const v = g.map((i) => t.d[i] as number);
    const order = v.map((_, j) => j).sort((p, q) => (v[q] as number) - (v[p] as number) || p - q);
    if (how === "topk") {
      const k = need(step, "k");
      if (!Number.isInteger(k) || k < 1) throw new Error("op: topk k must be a whole number ≥ 1");
      const keep = new Set(order.slice(0, k));
      g.forEach((i, j) => {
        o.d[i] = keep.has(j) ? (v[j] as number) : 0;
      });
    } else if (how === "argmax")
      g.forEach((i, j) => {
        o.d[i] = j === order[0] ? 1 : 0;
      });
    else if (how === "sort")
      g.forEach((i, j) => {
        o.d[i] = v[order[j] as number] as number;
      });
    else if (how === "cumsum") {
      let s = 0;
      g.forEach((i, j) => {
        s += v[j] as number;
        o.d[i] = s;
      });
    } else throw new Error(`op: select has no variant "${how}"`);
  }
  return o;
}

/** |DFT| of each row, bins 0..⌊n/2⌋ (a direct transform: rows here are short). */
function transform(t: Tensor): Tensor {
  if (t.c !== 1) throw new Error("op: transform takes one channel");
  if (t.w > 4096 || t.h > 64) throw new Error("op: transform takes at most 64 rows of 4096");
  const n = t.w;
  const bins = Math.floor(n / 2) + 1;
  const o = tensor(t.h, bins, 1);
  for (let y = 0; y < t.h; y++)
    for (let k = 0; k < bins; k++) {
      let re = 0;
      let im = 0;
      for (let j = 0; j < n; j++) {
        const a = (-2 * Math.PI * k * j) / n;
        const v = t.d[y * n + j] as number;
        re += v * Math.cos(a);
        im += v * Math.sin(a);
      }
      o.d[y * bins + k] = Math.hypot(re, im);
    }
  return o;
}

/** One op on the list of outputs so far (the input first); returns its output. */
export function runOp(step: OpStep, list: readonly Tensor[]): Tensor {
  const last = list[list.length - 1] as Tensor;
  const pick = (i: number) => {
    const t = list[i];
    if (!t)
      throw new Error(
        `op: ${step.op} names output ${i}, and there are ${list.length} (0 = the input)`,
      );
    return t;
  };
  switch (step.op) {
    case "channels":
      return channels(last, step.how ?? "");
    case "conv":
      return conv(last, kernelOf(step, last.h === 1));
    case "reduce":
      return reduce(last, step.how ?? "", need(step, "window"), step.params.stride ?? 1);
    case "combine": {
      const [i, j] = step.of?.length === 2 ? step.of : [list.length - 2, list.length - 1];
      return combine(pick(i as number), pick(j as number), step.how ?? "");
    }
    case "normalise":
      return normalise(last, step.how ?? "", step.over ?? "all");
    case "threshold":
      return threshold(last, step);
    case "quantize":
      return quantize(last, step);
    case "formula":
      return formula(list, step);
    case "matmul":
      if (step.weights?.length) return matmul(last, fromRows(step.weights));
      if (step.of?.length === 2)
        return matmul(pick(step.of[0] as number), pick(step.of[1] as number));
      throw new Error("op: matmul needs `weights` or two outputs in `of`");
    case "select":
      return select(last, step);
    case "transform":
      return transform(last);
  }
}

/** Every output of a chain, after the inputs: `[...inputs, out1, …, outN]`. */
export function runChain(inputs: readonly Tensor[], chain: readonly OpStep[]): Tensor[] {
  const list = [...inputs];
  for (const step of chain) list.push(runOp(step, list));
  return list;
}

/* ---------------------------------------------- example degradations */

/** Deterministic standard normals (mulberry32 + Box–Muller). */
export function seededNormals(seed: number): () => number {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/** An EXAMPLE degradation of an input: never the paper's, always tagged as an example. */
export function degrade(t: Tensor, how: "contrast" | "noise" | "blur", amount: number): Tensor {
  if (!(amount > 0)) throw new Error("op: a condition's amount must be positive");
  if (how === "contrast") {
    if (amount >= 1) throw new Error("op: a contrast condition takes an amount below 1");
    const o = tensor(t.h, t.w, t.c);
    for (let k = 0; k < t.c; k++) {
      const idx = Array.from({ length: t.h * t.w }, (_, i) => i * t.c + k);
      const m = statOf(
        idx.map((i) => t.d[i] as number),
        "mean",
      );
      for (const i of idx) o.d[i] = m + ((t.d[i] as number) - m) * (1 - amount);
    }
    return o;
  }
  if (how === "noise") {
    const n = seededNormals(7);
    const o = tensor(t.h, t.w, t.c);
    for (let i = 0; i < o.d.length; i++) o.d[i] = (t.d[i] as number) + amount * n();
    return o;
  }
  const r = Math.round(amount);
  if (r < 1) throw new Error("op: a blur condition takes a radius ≥ 1");
  return conv(t, kernelOf({ op: "conv", how: "box", params: { size: 2 * r + 1 } }, t.h === 1));
}

/* ------------------------------------------------- the noising schedule */

/** ᾱ_t for t = 1..T: linear β (Ho et al.) or the cosine ᾱ (Nichol & Dhariwal). */
export function alphaBars(
  schedule: "linear" | "cosine",
  T: number,
  betaStart?: number,
  betaEnd?: number,
): Float64Array {
  if (!Number.isInteger(T) || T < 2 || T > 100000)
    throw new Error("op: T must be a whole 2..100000");
  const out = new Float64Array(T);
  if (schedule === "cosine") {
    const f = (t: number) => Math.cos(((t / T + 0.008) / 1.008) * (Math.PI / 2)) ** 2;
    for (let t = 1; t <= T; t++) out[t - 1] = f(t) / f(0);
    return out;
  }
  if (betaStart === undefined || betaEnd === undefined)
    throw new Error("op: a linear schedule needs the stated betaStart and betaEnd");
  if (!(betaStart > 0 && betaEnd < 1 && betaStart < betaEnd))
    throw new Error("op: need 0 < betaStart < betaEnd < 1");
  let a = 1;
  for (let t = 1; t <= T; t++) {
    const b = betaStart + ((betaEnd - betaStart) * (t - 1)) / (T - 1);
    a *= 1 - b;
    out[t - 1] = a;
  }
  return out;
}
