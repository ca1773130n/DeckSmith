/**
 * diffusion — a real picture noised on a real DDPM schedule, then returned
 * along the reverse process.
 *
 * WHAT IS EXACT. The forward marginal q(x_t | x_0) = N(√ᾱ_t x_0, (1−ᾱ_t) I),
 * with β linear 1e-4 → 0.02 over T = 1000 (Ho et al. 2020) or the cosine
 * schedule (Nichol & Dhariwal 2021), and one seeded ε for the whole run.
 * The reverse trajectory needs a denoiser; a trained one is not available
 * at build time, so the scene uses the ORACLE that knows x_0 — which is
 * exactly true about the schedule and says nothing about a network:
 *   - "ddpm": ancestral sampling from the true posterior
 *     q(x_{t'} | x_t, x_0) on a respaced subsequence of steps (the respacing
 *     of Nichol & Dhariwal: β' = 1 − ᾱ_t / ᾱ_{t'}), fresh seeded noise per
 *     step. It lands on x_0 exactly, because the last posterior has zero
 *     variance.
 *   - "ddim": η = 0 with the oracle's ε, x_{t'} = √ᾱ_{t'} x_0 + √(1−ᾱ_{t'}) ε.
 * Pixels live in [−1, 1] as in the paper; drawn, they are clipped to [0, 1].
 *
 * Frames: the forward steps (x_0 → pure noise), then the reverse steps
 * (noise → x_0). Each shows the current x_t large, the phase's steps as a
 * filmstrip, and √ᾱ_t (signal) and √(1−ᾱ_t) (noise) against t with a marker.
 */
import {
  type Frame,
  fillTemplate,
  fitBox,
  flat,
  fmt,
  type MechanismResult,
  mulberry32,
  niceTicks,
  normals,
  type Prim,
  type Raster,
  type Region,
  type Rgb,
  resample,
  TYPE,
} from "./common.js";

/* -------------------------------------------------------------------- maths */

export type Schedule = "linear" | "cosine";

/** β_1..β_T (index t−1). Linear: Ho et al. 2020. Cosine: Nichol & Dhariwal 2021, s = 0.008, β ≤ 0.999. */
export function betaSchedule(
  T: number,
  schedule: Schedule = "linear",
  start = 1e-4,
  end = 0.02,
): Float64Array {
  if (!Number.isInteger(T) || T < 1)
    throw new Error(`diffusion: T must be a positive integer, got ${T}`);
  const b = new Float64Array(T);
  if (schedule === "linear") {
    for (let i = 0; i < T; i++) b[i] = T === 1 ? start : start + ((end - start) * i) / (T - 1);
    return b;
  }
  const s = 0.008;
  const f = (t: number) => Math.cos(((t / T + s) / (1 + s)) * (Math.PI / 2)) ** 2;
  for (let t = 1; t <= T; t++) b[t - 1] = Math.min(0.999, 1 - f(t) / f(t - 1));
  return b;
}

/** ᾱ_0..ᾱ_T: ᾱ_0 = 1, ᾱ_t = ∏_{s≤t} (1 − β_s). */
export function alphaBars(betas: Float64Array): Float64Array {
  const a = new Float64Array(betas.length + 1);
  a[0] = 1;
  for (let t = 1; t <= betas.length; t++)
    a[t] = (a[t - 1] as number) * (1 - (betas[t - 1] as number));
  return a;
}

/** x_t = √ᾱ x_0 + √(1−ᾱ) ε. */
export function noised(x0: Float32Array, eps: Float32Array, abar: number): Float32Array {
  const a = Math.sqrt(abar);
  const s = Math.sqrt(1 - abar);
  const o = new Float32Array(x0.length);
  for (let i = 0; i < o.length; i++) o[i] = a * (x0[i] as number) + s * (eps[i] as number);
  return o;
}

/**
 * The true posterior q(x_prev | x_t, x_0) between two steps with ᾱ_t < ᾱ_prev
 * (adjacent, or respaced): mean coefficients on x_0 and x_t, and the variance.
 */
export function posterior(
  abarT: number,
  abarPrev: number,
): { c0: number; ct: number; variance: number } {
  const alpha = abarT / abarPrev; // 1 − β' for the (possibly respaced) step
  const beta = 1 - alpha;
  return {
    c0: (Math.sqrt(abarPrev) * beta) / (1 - abarT),
    ct: (Math.sqrt(alpha) * (1 - abarPrev)) / (1 - abarT),
    variance: (beta * (1 - abarPrev)) / (1 - abarT),
  };
}

/** Reverse steps from T to 0 that include every shown t: the shown ones and `steps` evenly spaced. */
export function respaced(T: number, steps: number, shown: readonly number[]): number[] {
  const set = new Set<number>([T, ...shown.filter((t) => t > 0 && t <= T)]);
  for (let i = 1; i <= steps; i++) set.add(Math.max(1, Math.round((T * i) / steps)));
  return [...set].sort((a, b) => b - a);
}

/* ------------------------------------------------------------------- input */

export interface DiffusionInput {
  image: Rgb;
  /** Diffusion steps (default 1000). */
  T?: number;
  schedule?: Schedule;
  /** β_1 and β_T of the linear schedule (default 1e-4, 0.02). */
  betaStart?: number;
  betaEnd?: number;
  /** The steps drawn, ascending; 0 is the picture itself. Default 0, T/10, T/4, T/2, 3T/4, T. */
  shown?: number[];
  reverse?: "ddpm" | "ddim";
  /** Reverse steps actually taken (respacing); default 25. */
  steps?: number;
  seed?: number;
  /** Working size: the longer side, in px (default 512). */
  maxSide?: number;
}

export const TAKEAWAY =
  "Noise is added on a fixed schedule until, at step {T}, nothing of the picture is left; the reverse steps remove it on the same schedule and the picture returns.";

/* ---------------------------------------------------------------- the kind */

export function diffusion(input: DiffusionInput, region: Region): MechanismResult {
  const T = input.T ?? 1000;
  const betas = betaSchedule(T, input.schedule ?? "linear", input.betaStart, input.betaEnd);
  const abar = alphaBars(betas);
  const shown = input.shown ?? [0, T / 10, T / 4, T / 2, (3 * T) / 4, T].map(Math.round);
  for (const t of shown)
    if (!Number.isInteger(t) || t < 0 || t > T)
      throw new Error(`diffusion: shown step ${t} is outside 0..${T}`);
  const maxSide = input.maxSide ?? 512;
  const k = Math.min(1, maxSide / Math.max(input.image.w, input.image.h));
  const img = resample(
    input.image,
    Math.max(1, Math.round(input.image.w * k)),
    Math.max(1, Math.round(input.image.h * k)),
  );
  const x0 = new Float32Array(img.d.length);
  for (let i = 0; i < x0.length; i++) x0[i] = 2 * (img.d[i] as number) - 1;
  const gauss = normals(mulberry32(input.seed ?? 1));
  const eps = new Float32Array(x0.length);
  for (let i = 0; i < eps.length; i++) eps[i] = gauss();

  const toRgb = (x: Float32Array): Rgb => {
    const d = new Float32Array(x.length);
    for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(1, ((x[i] as number) + 1) / 2));
    return { w: img.w, h: img.h, d };
  };
  const rasters: Record<string, Raster> = {};
  const fwd = [...shown].sort((a, b) => a - b);
  for (const t of fwd)
    rasters[`f${t}`] = { rgb: toRgb(t === 0 ? x0 : noised(x0, eps, abar[t] as number)) };

  // Reverse, from x_T (the forward run's own last sample) to x_0.
  const mode = input.reverse ?? "ddpm";
  const seq = respaced(T, input.steps ?? 25, shown);
  let x = noised(x0, eps, abar[T] as number);
  const rev = [...fwd].reverse();
  const wanted = new Set(rev);
  if (wanted.has(T)) rasters[`r${T}`] = { rgb: toRgb(x) };
  const noise = normals(mulberry32((input.seed ?? 1) + 7919));
  const reverseMax: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    const t = seq[i] as number;
    const prev = (seq[i + 1] as number | undefined) ?? 0;
    if (mode === "ddim") x = noised(x0, eps, abar[prev] as number);
    else {
      const { c0, ct, variance } = posterior(abar[t] as number, abar[prev] as number);
      const sd = Math.sqrt(variance);
      const nx = new Float32Array(x.length);
      for (let j = 0; j < nx.length; j++)
        nx[j] = c0 * (x0[j] as number) + ct * (x[j] as number) + sd * noise();
      x = nx;
    }
    if (wanted.has(prev)) rasters[`r${prev}`] = { rgb: toRgb(x) };
    let m = 0;
    for (let j = 0; j < x.length; j++)
      m = Math.max(m, Math.abs((x[j] as number) - (x0[j] as number)));
    reverseMax.push(m);
  }

  // Layout.
  const { width: W, height: H } = region;
  const size = TYPE.label;
  const leftW = W * 0.6;
  const main = fitBox(img.w, img.h, 0, size + 24, leftW, H * 0.66 - (size + 24));
  const stripTop = H * 0.7;
  const thumbs = fwd.map((_, i) => {
    const cw = (leftW - 16 * (fwd.length - 1)) / fwd.length;
    return fitBox(img.w, img.h, i * (cw + 16), stripTop, cw, H - stripTop - (size + 16));
  });
  const cx0 = leftW + 120;
  const cW = W - cx0 - 20;
  const cy0 = size + 24;
  const cH = H * 0.66 - cy0;
  const X = (t: number) => cx0 + (t / T) * cW;
  const Y = (v: number) => cy0 + (1 - v) * cH;
  const curve = (f: (t: number) => number) => {
    const pts: Array<[number, number]> = [];
    const step = Math.max(1, Math.floor(T / 200));
    for (let t = 0; t <= T; t += step) pts.push([X(t), Y(f(t))]);
    if ((pts[pts.length - 1] as [number, number])[0] !== X(T)) pts.push([X(T), Y(f(T))]);
    return flat(pts);
  };
  const sig = (t: number) => Math.sqrt(abar[t] as number);
  const noi = (t: number) => Math.sqrt(1 - (abar[t] as number));
  const chart = (t: number): Prim[] => {
    const out: Prim[] = [
      { p: "line", id: "ax", x1: cx0, y1: Y(0), x2: cx0 + cW, y2: Y(0), role: "rule", width: 2 },
      { p: "line", id: "ay", x1: cx0, y1: Y(0), x2: cx0, y2: Y(1), role: "rule", width: 2 },
      { p: "path", id: "sig", pts: curve(sig), role: "accent", width: 5 },
      { p: "path", id: "noi", pts: curve(noi), role: "muted", width: 5, dash: true },
      { p: "line", id: "mark", x1: X(t), y1: Y(0), x2: X(t), y2: Y(1), role: "fg", width: 3 },
      { p: "circle", id: "ms", cx: X(t), cy: Y(sig(t)), r: 11, fill: "accent" },
      { p: "circle", id: "mn", cx: X(t), cy: Y(noi(t)), r: 11, fill: "muted" },
      {
        p: "text",
        id: "ls",
        x: cx0 + 24,
        y: Y(1) - size - 8,
        size,
        role: "accent",
        anchor: "start",
        slot: "signal",
      },
      {
        p: "text",
        id: "ln",
        x: cx0 + cW,
        y: Y(1) - size - 8,
        size,
        role: "muted",
        anchor: "end",
        slot: "noise",
      },
    ];
    for (const v of [0, 0.5, 1])
      out.push({
        p: "text",
        id: `yt${v}`,
        x: cx0 - 14,
        y: Y(v) - size / 2,
        size,
        role: "muted",
        anchor: "end",
        text: fmt(v, 1),
      });
    for (const tk of niceTicks(0, T, 2))
      out.push({
        p: "text",
        id: `xt${tk}`,
        x: X(tk),
        y: Y(0) + 10,
        size,
        role: "muted",
        anchor: "middle",
        text: String(tk),
      });
    return out;
  };
  const frame = (phase: "forward" | "reverse", t: number, steps: number[]): Frame => {
    const key = `${phase === "forward" ? "f" : "r"}${t}`;
    const prims: Prim[] = [
      { p: "image", id: "main", ...main, layer: key },
      {
        p: "text",
        id: "phase",
        x: 0,
        y: 0,
        size,
        role: "fg",
        anchor: "start",
        slot: phase,
        vars: { t, T },
      },
    ];
    steps.forEach((s, i) => {
      const b = thumbs[i] as { x: number; y: number; w: number; h: number };
      prims.push({
        p: "image",
        id: `th${i}`,
        ...b,
        layer: `${phase === "forward" ? "f" : "r"}${s}`,
      });
      prims.push({
        p: "rect",
        id: `tf${i}`,
        ...b,
        role: s === t ? "accent" : "rule",
        width: s === t ? 6 : 2,
      });
      prims.push({
        p: "text",
        id: `tt${i}`,
        x: b.x + b.w / 2,
        y: b.y + b.h + 8,
        size,
        role: s === t ? "accent" : "muted",
        anchor: "middle",
        text: String(s),
      });
    });
    prims.push(...chart(t));
    return { id: key, prims, vars: { t, T, signal: fmt(sig(t), 3), noise: fmt(noi(t), 3) } };
  };
  const frames = [
    ...fwd.map((t) => frame("forward", t, fwd)),
    ...rev.filter((t) => t !== T).map((t) => frame("reverse", t, rev)),
  ];
  return {
    rasters,
    frames,
    data: {
      T,
      betas,
      alphaBar: abar,
      reverse: mode,
      reverseSteps: seq,
      reverseMaxError: reverseMax,
      size: [img.w, img.h],
    },
    vars: { T },
  };
}

export function takeaway(r: MechanismResult): string {
  return fillTemplate(TAKEAWAY, r.vars);
}
