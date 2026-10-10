/**
 * The mechanism kinds (src/literal/kinds/): the maths each one computes, that
 * the same input gives the same bytes, the cost bound per beat, the type
 * floor, AA contrast in the dark and the light theme, and that the judge
 * fixtures (parameters only) regenerate their frames and takeaway. Pure: synthetic pictures, no ffmpeg, no browser.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import { textWidth } from "../src/emit/svg.js";
import { deckLook } from "../src/emit/theme.js";
import { THEMES } from "../src/emit/themes/index.js";
import { literalPlanOf } from "../src/literal/index.js";
import { widthOf } from "../src/literal/kind.js";
import {
  type Frame,
  type Measure,
  type MechanismResult,
  mulberry32,
  niceTicks,
  normals,
  type Region,
  type Rgb,
  resultBytes,
} from "../src/literal/kinds/common.js";
import {
  attention,
  diffusion,
  MECHANISM_KIND_NAMES,
  MECHANISM_TAKEAWAYS,
  messagePassing,
  optimization,
  retrieval,
  rlRollout,
  splatting,
} from "../src/literal/kinds/index.js";
import {
  backdropOf,
  contrastRatio,
  fillRgb,
  hex,
  type Rgb8,
  roleRgb,
  textHalo,
  textRgb,
} from "../src/literal/kinds/svg.js";
import { KINDS } from "../src/literal/registry.js";
import { literalFindings, literalTruthProblems, numberSequence } from "../src/plan/coverage.js";
import {
  ATTENTION_RULES,
  DIFFUSION_RULES,
  LITERAL_KIND_DOCS,
  literalSchema,
  literalSlotProblems,
  literalSlotsOf,
  sourceSchema,
} from "../src/types.js";
import { loadJudgeCases, runJudgeCase } from "./fixtures/literal-judge.js";
import { testPng } from "./fixtures/png.js";

const REGION: Region = { width: 1760, height: 920 };

/** The style packs the frames are held to: every dark one and every light one. */
const PACKS = ["signal", "blueprint", "atlas", "folio", "chalk", "journal"] as const;
const pack = (name: string): Theme => {
  const t = THEMES[name];
  if (!t) throw new Error(`no style pack ${name}`);
  return t;
};

/** A 320×200 picture: a diagonal gradient with three flat discs. */
function picture(w = 320, h = 200): Rgb {
  const d = new Float32Array(w * h * 3);
  const discs = [
    [0.25, 0.5, 0.15, [0.9, 0.3, 0.1]],
    [0.6, 0.4, 0.12, [0.1, 0.5, 0.9]],
    [0.85, 0.7, 0.1, [0.2, 0.8, 0.3]],
  ] as const;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c: readonly number[] = [x / w, y / h, 0.5];
      for (const [cx, cy, r, col] of discs)
        if (Math.hypot(x / w - cx, (y - cy * h) / w) < r) c = col;
      d.set(c, (y * w + x) * 3);
    }
  return { w, h, d };
}

/* --------------------------------------------------------------- common */

/** The picture kinds write their layers through ffmpeg; a runner without it skips those tests (as test/literal-kinds.test.ts does). */
const ffmpeg = await new Promise<boolean>((done) =>
  execFile("ffmpeg", ["-version"], (err) => done(!err)),
);

describe("the shared helpers", () => {
  it("mulberry32 is seeded, uniform on [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 10000 }, () => a());
    expect(Array.from({ length: 10000 }, () => b())).toEqual(xs);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.5, 1);
  });
  it("normals have mean 0 and variance 1", () => {
    const g = normals(mulberry32(7));
    const xs = Array.from({ length: 40000 }, g);
    const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length;
    expect(Math.abs(mu)).toBeLessThan(0.02);
    expect(Math.abs(v - 1)).toBeLessThan(0.03);
  });
  it("niceTicks steps by 1, 2 or 5 × 10^k and covers the range", () => {
    expect(niceTicks(0, 1000, 4)).toEqual([0, 500, 1000]);
    expect(niceTicks(0, 400, 4)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(0.1, 0.9, 4)).toEqual([0.2, 0.4, 0.6, 0.8]);
  });
});

/* ------------------------------------------------------------ attention */

describe("attention: softmax(QKᵀ/√d)", () => {
  it("softmax rows are non-negative, sum to 1, and survive large scores", () => {
    const s = new Float32Array([1000, 1001, 999, -5, 0, 5]);
    const w = attention.softmaxRows(s, 2, 3);
    for (let i = 0; i < 2; i++) {
      const row = Array.from(w.subarray(i * 3, i * 3 + 3));
      expect(row.every((v) => v >= 0 && Number.isFinite(v))).toBe(true);
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(w[1]).toBeCloseTo(Math.exp(1) / (Math.exp(-1) + 1 + Math.exp(1)), 6);
  });
  it("matches the formula by hand, including the 1/√d scale", () => {
    const q = new Float32Array([1, 0]);
    const k = new Float32Array([1, 0, 0, 1]);
    const w = attention.attentionWeights(q, k, 1, 2, 2);
    const a = Math.exp(1 / Math.SQRT2);
    expect(w[0]).toBeCloseTo(a / (a + 1), 6);
    expect(w[1]).toBeCloseTo(1 / (a + 1), 6);
  });
  it("a causal mask zeroes every later key", () => {
    const x = new Float32Array(Array.from({ length: 12 }, (_, i) => Math.sin(i)));
    const w = attention.attentionWeights(x, x, 4, 4, 3, { causal: true });
    expect(w[0]).toBeCloseTo(1, 6);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(w[i * 4 + j]).toBe(0);
  });
  it("the sinusoidal encoding is sin/cos at 10000^(2i/d)", () => {
    const pe = attention.sinusoidal(5, 8);
    expect(pe[3 * 8 + 0]).toBeCloseTo(Math.sin(3), 6);
    expect(pe[3 * 8 + 1]).toBeCloseTo(Math.cos(3), 6);
    expect(pe[3 * 8 + 2]).toBeCloseTo(Math.sin(3 / 10000 ** (2 / 8)), 6);
  });
  it("token scenes: every head's rows sum to 1, the frame names its true argmax", () => {
    const tokens = "the cat sat on the mat".split(" ");
    const r = attention.tokenAttention({ tokens, path: [4, 1] }, REGION);
    const weights = r.data.weights as Float32Array[];
    for (const w of weights)
      for (let i = 0; i < tokens.length; i++)
        expect(Array.from(w.subarray(i * 6, i * 6 + 6)).reduce((a, b) => a + b, 0)).toBeCloseTo(
          1,
          5,
        );
    const row = Array.from((weights[0] as Float32Array).subarray(4 * 6, 5 * 6));
    expect(r.frames[0]?.vars.top).toBe(tokens[row.indexOf(Math.max(...row))]);
    expect(r.frames).toHaveLength(2);
  });
  it("uses the source's own Q and K when given", () => {
    const q = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const k = [
      [5, 0],
      [0, 5],
      [0, 0],
    ];
    const r = attention.tokenAttention({ tokens: ["a", "b", "c"], heads: [{ q, k }] }, REGION);
    const w = (r.data.weights as Float32Array[])[0] as Float32Array;
    expect(w[0]).toBeGreaterThan(0.9); // query a matches key a
    expect(w[4]).toBeGreaterThan(0.9); // query b matches key b
  });
  it("refuses a sentence wider than the region instead of shrinking the type", () => {
    const tokens = Array.from({ length: 40 }, () => "token");
    expect(() => attention.tokenAttention({ tokens }, REGION)).toThrow(/pass fewer tokens/);
  });
  it("patch scenes: rows sum to 1 over the grid, the spotlight stays in 0..1", () => {
    const r = attention.patchAttention({ image: picture(), grid: 8 }, REGION);
    const n = (r.data.cols as number) * (r.data.rows as number);
    for (const w of r.data.weights as Float32Array[])
      for (let i = 0; i < n; i += 7)
        expect(Array.from(w.subarray(i * n, i * n + n)).reduce((a, b) => a + b, 0)).toBeCloseTo(
          1,
          5,
        );
    for (const [key, L] of Object.entries(r.rasters))
      if (key.startsWith("map-") && "heat" in L)
        expect(L.heat.d.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

/* ------------------------------------------------------------ diffusion */

describe("diffusion: the DDPM schedule and its posterior", () => {
  const betas = diffusion.betaSchedule(1000);
  const abar = diffusion.alphaBars(betas);
  it("linear β runs 1e-4 → 0.02 and ᾱ is the running product", () => {
    expect(betas[0]).toBeCloseTo(1e-4, 12);
    expect(betas[999]).toBeCloseTo(0.02, 12);
    let p = 1;
    for (let t = 1; t <= 1000; t++) p *= 1 - (betas[t - 1] as number);
    expect(abar[1000]).toBeCloseTo(p, 12);
    expect(abar[1000] as number).toBeLessThan(1e-4); // x_T is noise
  });
  it("the cosine schedule follows f(t)/f(0) (Nichol & Dhariwal)", () => {
    const a = diffusion.alphaBars(diffusion.betaSchedule(1000, "cosine"));
    const f = (t: number) => Math.cos(((t / 1000 + 0.008) / 1.008) * (Math.PI / 2)) ** 2;
    for (const t of [1, 100, 500, 900]) expect(a[t]).toBeCloseTo(f(t) / f(0), 6);
  });
  it("iterating q(x_t | x_{t−1}) matches the closed form in mean and variance", () => {
    const g = normals(mulberry32(3));
    const t = 300;
    const x0 = 0.7;
    const N = 20000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < N; i++) {
      let x = x0;
      for (let k = 1; k <= t; k += 1)
        x = Math.sqrt(1 - (betas[k - 1] as number)) * x + Math.sqrt(betas[k - 1] as number) * g();
      s += x;
      s2 += x * x;
    }
    const mean = s / N;
    const v = s2 / N - mean * mean;
    expect(mean).toBeCloseTo(Math.sqrt(abar[t] as number) * x0, 1);
    expect(Math.abs(v - (1 - (abar[t] as number))) / (1 - (abar[t] as number))).toBeLessThan(0.03);
  });
  it("the posterior is DDPM's eq. 7 and agrees with its ε form (eq. 11)", () => {
    const t = 400;
    const { c0, ct, variance } = diffusion.posterior(abar[t] as number, abar[t - 1] as number);
    const bt = betas[t - 1] as number;
    expect(variance).toBeCloseTo(
      ((1 - (abar[t - 1] as number)) / (1 - (abar[t] as number))) * bt,
      12,
    );
    const x0 = 0.3;
    const eps = -1.2;
    const xt = Math.sqrt(abar[t] as number) * x0 + Math.sqrt(1 - (abar[t] as number)) * eps;
    const viaEps = (xt - (bt / Math.sqrt(1 - (abar[t] as number))) * eps) / Math.sqrt(1 - bt);
    expect(c0 * x0 + ct * xt).toBeCloseTo(viaEps, 10);
  });
  it("both reverse processes land exactly on the picture", () => {
    for (const reverse of ["ddpm", "ddim"] as const) {
      const r = diffusion.diffusion({ image: picture(96, 64), reverse }, REGION);
      const err = r.data.reverseMaxError as number[];
      expect(err[err.length - 1]).toBeLessThan(1e-5);
      const a = r.rasters.f0 as { rgb: Rgb };
      const b = r.rasters.r0 as { rgb: Rgb };
      let m = 0;
      for (let i = 0; i < a.rgb.d.length; i++)
        m = Math.max(m, Math.abs((a.rgb.d[i] as number) - (b.rgb.d[i] as number)));
      expect(m).toBeLessThan(1e-5);
    }
  });
});

/* --------------------------------------------------------- optimization */

describe("optimization: textbook updates on analytic landscapes", () => {
  it("every landscape's gradient matches finite differences, and its minima are stationary", () => {
    for (const L of Object.values(optimization.LANDSCAPES)) {
      for (const [x, y] of [
        [0.3, -0.7],
        [-1.1, 1.4],
        [2, 0.5],
      ] as const) {
        const h = 1e-6;
        const [gx, gy] = L.grad(x, y);
        expect(gx).toBeCloseTo((L.f(x + h, y) - L.f(x - h, y)) / (2 * h), 3);
        expect(gy).toBeCloseTo((L.f(x, y + h) - L.f(x, y - h)) / (2 * h), 3);
      }
      for (const [x, y] of L.minima)
        for (const g of L.grad(x, y)) expect(Math.abs(g)).toBeLessThan(1e-4);
    }
  });
  it("Adam's first step is lr per coordinate (bias correction)", () => {
    const L = optimization.LANDSCAPES.rosenbrock;
    const r = optimization.runOptimizer(L, { label: "a", rule: "adam", lr: 0.01 }, [-1, 2], 1);
    for (const d of r.steps[0] as [number, number]) expect(Math.abs(d)).toBeCloseTo(0.01, 6);
  });
  it("heavy-ball momentum: v ← βv + g, θ ← θ − ηv", () => {
    const L = optimization.LANDSCAPES.quadratic;
    const r = optimization.runOptimizer(
      L,
      { label: "m", rule: "momentum", lr: 0.05, beta: 0.9 },
      [2, 1],
      2,
    );
    const g1 = L.grad(2, 1);
    const p1 = r.path[1] as [number, number];
    const g2 = L.grad(p1[0], p1[1]);
    expect(r.steps[1]?.[0]).toBeCloseTo(-0.05 * (0.9 * g1[0] + g2[0]), 12);
    expect(r.steps[1]?.[1]).toBeCloseTo(-0.05 * (0.9 * g1[1] + g2[1]), 12);
  });
  it("gradient descent on the quadratic converges to its minimum", () => {
    const r = optimization.runOptimizer(
      optimization.LANDSCAPES.quadratic,
      { label: "s", rule: "sgd", lr: 0.1 },
      [2.5, 1.5],
      300,
    );
    expect(r.loss[300]).toBeLessThan(1e-10);
  });
  it("fails loudly when a run diverges", () => {
    expect(() =>
      optimization.runOptimizer(
        optimization.LANDSCAPES.rosenbrock,
        { label: "s", rule: "sgd", lr: 1 },
        [-1.5, 2],
        50,
      ),
    ).toThrow(/diverged/);
  });
  it("curves draw only the given rows, never between them, each value as the plan wrote it", () => {
    expect(
      optimization.pointsUpTo(
        [
          [0, 10],
          [10, 0],
          [20, 5],
        ],
        15,
      ),
    ).toEqual([
      [0, 10],
      [10, 0],
    ]);
    const r = optimization.optimization(
      {
        mode: "curves",
        series: [
          {
            label: "A",
            points: [
              [0, 2],
              [50, 0.71],
              [100, 0.5],
            ],
          },
          {
            label: "B",
            points: [
              [0, 2],
              [100, 0.9],
            ],
          },
        ],
        frames: 4,
      },
      REGION,
    );
    expect(r.vars).toMatchObject({
      best: "A",
      bestValue: "0.5",
      worst: "B",
      worstValue: "0.9",
      steps: "100",
    });
    // Every end label is a given value, never an interpolated one.
    const drawn = r.frames.flatMap((f) =>
      f.prims
        .filter((p) => p.p === "text" && p.id?.startsWith("e"))
        .map((p) => (p as { text: string }).text),
    );
    for (const t of drawn) expect(["A 2", "A 0.71", "A 0.5", "B 2", "B 0.9"]).toContain(t);
  });
});

/* ------------------------------------------------------------ splatting */

describe("splatting: EWA projection and front-to-back compositing", () => {
  it("Σ = R S Sᵀ Rᵀ: identity keeps the axes, a quarter turn about z swaps x and y", () => {
    expect(splatting.covFromScaleRotation([1, 2, 3])).toEqual([1, 0, 0, 4, 0, 9]);
    const q: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const c = splatting.covFromScaleRotation([1, 2, 3], q);
    expect(c[0]).toBeCloseTo(4, 10);
    expect(c[3]).toBeCloseTo(1, 10);
    expect(c[5]).toBeCloseTo(9, 10);
  });
  it("J W Σ Wᵀ Jᵀ matches the projected samples' covariance (Monte Carlo)", () => {
    const cam = splatting.lookAt([0.4, 0.3, 4], [0, 0, 0], 640, 480, 50);
    const cov = splatting.covFromScaleRotation([0.02, 0.01, 0.015], [0.9, 0.2, 0.3, 0.1]);
    const g = {
      mean: [0.2, -0.1, 0.1] as [number, number, number],
      cov,
      color: [1, 1, 1] as const,
      opacity: 1,
    };
    const s = splatting.project(g, cam, 0) as splatting.Splat2D;
    // Sample X ~ N(μ, Σ) via Cholesky, project each exactly.
    const L = cholesky3(cov);
    const rnd = normals(mulberry32(11));
    const N = 40000;
    let su = 0,
      sv = 0,
      suu = 0,
      suv = 0,
      svv = 0;
    for (let i = 0; i < N; i++) {
      const z = [rnd(), rnd(), rnd()];
      const x = [0, 1, 2].map(
        (r) =>
          (g.mean[r] as number) +
          [0, 1, 2].reduce((a, c) => a + (L[r]?.[c] as number) * (z[c] as number), 0),
      ) as [number, number, number];
      const p = splatting.project(
        { ...g, mean: x, cov: [1e-9, 0, 0, 1e-9, 0, 1e-9] },
        cam,
        0,
      ) as splatting.Splat2D;
      su += p.u;
      sv += p.v;
      suu += p.u * p.u;
      suv += p.u * p.v;
      svv += p.v * p.v;
    }
    const mu = su / N;
    const mv = sv / N;
    const [a, b, c] = s.cov;
    expect(Math.abs(suu / N - mu * mu - a) / a).toBeLessThan(0.03);
    expect(Math.abs(svv / N - mv * mv - c) / c).toBeLessThan(0.03);
    expect(Math.abs(suv / N - mu * mv - b)).toBeLessThan(0.05 * Math.sqrt(a * c));
  });
  it("a lone splat's centre pixel is o·c + (1 − o)·background", () => {
    const sp: splatting.Splat2D = {
      u: 10.5,
      v: 10.5,
      depth: 1,
      cov: [4, 0, 4],
      conic: [0.25, 0, 0.25],
      radius: 6,
      color: [1, 0, 0],
      opacity: 0.6,
    };
    const { img } = splatting.rasterize([sp], 21, 21, [0, 0, 1]);
    const i = (10 * 21 + 10) * 3;
    expect(img.d[i]).toBeCloseTo(0.6, 6);
    expect(img.d[i + 2]).toBeCloseTo(0.4, 6);
  });
  it("front-to-back equals back-to-front 'over', and the nearer splat wins", () => {
    const near: splatting.Splat2D = {
      u: 5.5,
      v: 5.5,
      depth: 1,
      cov: [9, 0, 9],
      conic: [1 / 9, 0, 1 / 9],
      radius: 9,
      color: [1, 0, 0],
      opacity: 0.7,
    };
    const far: splatting.Splat2D = { ...near, depth: 2, color: [0, 1, 0], opacity: 0.9 };
    const bg = [0.2, 0.2, 0.2] as const;
    const { img } = splatting.rasterize([far, near], 11, 11, bg);
    const i = (5 * 11 + 5) * 3;
    // Back to front by hand: bg, then far over it, then near over that.
    const over = (src: readonly number[], a: number, dst: readonly number[]) =>
      dst.map((d, k) => (src[k] as number) * a + d * (1 - a));
    const ref = over(near.color, 0.7, over(far.color, 0.9, bg));
    for (let c = 0; c < 3; c++) expect(img.d[i + c]).toBeCloseTo(ref[c] as number, 6);
    expect(img.d[i] as number).toBeGreaterThan(img.d[i + 1] as number);
  });
  it("points become anisotropic Gaussians along their neighbourhood", () => {
    const pts: Array<[number, number, number]> = Array.from({ length: 30 }, (_, i) => [
      i * 0.1,
      0,
      0,
    ]);
    const c = splatting.covFromNeighbours(pts, 4, 1e-6)[15] as number[];
    expect(c[0] as number).toBeGreaterThan(1000 * (c[3] as number)); // a line → a needle
  });
});

function cholesky3(c: readonly number[]): number[][] {
  const A = [
    [c[0], c[1], c[2]],
    [c[1], c[3], c[4]],
    [c[2], c[4], c[5]],
  ] as number[][];
  const L = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ] as number[][];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i]?.[j] as number;
      for (let k = 0; k < j; k++) s -= (L[i]?.[k] as number) * (L[j]?.[k] as number);
      (L[i] as number[])[j] = i === j ? Math.sqrt(s) : s / (L[j]?.[j] as number);
    }
  return L;
}

/* ------------------------------------------------------- message passing */

describe("message passing: aggregation, receptive field, layout", () => {
  // A path 0-1-2-3 plus a pendant 1-4.
  const edges: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [1, 4],
  ];
  const N = messagePassing.neighbourLists(5, edges, false);
  it("sum is (A + I) h; mean keeps a constant field constant", () => {
    const h = [[1], [2], [3], [4], [5]];
    const s = messagePassing.mpLayer(h, N, "sum", true).h.map((v) => v[0]);
    expect(s).toEqual([3, 11, 9, 7, 7]);
    const c = messagePassing.mpLayer(
      h.map(() => [0.4, 2]),
      N,
      "mean",
      true,
    ).h;
    for (const v of c) {
      expect(v[0]).toBeCloseTo(0.4, 12);
      expect(v[1]).toBeCloseTo(2, 12);
    }
  });
  it("gcn is D̃^−½ (A + I) D̃^−½ h", () => {
    const h = [[1], [0], [0], [0], [0]];
    const r = messagePassing.mpLayer(h, N, "gcn", true).h.map((v) => v[0] as number);
    const deg = [2, 4, 3, 2, 2] as const;
    expect(r[0]).toBeCloseTo(1 / 2, 12);
    expect(r[1]).toBeCloseTo(1 / Math.sqrt(deg[0] * deg[1]), 12);
    expect(r[2]).toBe(0);
  });
  it("after l layers a one-hot reaches exactly the l-hop field", () => {
    let h = [[0], [0], [0], [1], [0]];
    const dist = messagePassing.hops(N, 3);
    for (let l = 1; l <= 3; l++) {
      h = messagePassing.mpLayer(h, N, "mean", true).h;
      h.forEach((v, i) => {
        expect((v[0] as number) > 0).toBe((dist[i] as number) <= l);
      });
    }
  });
  it("the layout is deterministic, finite and inside the unit square", () => {
    const a = messagePassing.forceLayout(5, edges, 9);
    expect(messagePassing.forceLayout(5, edges, 9)).toEqual(a);
    expect(messagePassing.forceLayout(5, edges, 10)).not.toEqual(a);
    for (const [x, y] of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

/* ----------------------------------------------------------- rl rollout */

describe("rl-rollout: value iteration, Q-learning, the greedy walk", () => {
  it("on a chain V(s) = γ^(steps to the goal − 1) · R", () => {
    const m = rlRollout.buildMdp({
      width: 5,
      height: 1,
      terminals: [{ at: [4, 0], reward: 1 }],
      gamma: 0.9,
    });
    const Vs = rlRollout.valueIteration(m);
    const V = Vs[Vs.length - 1] as Float64Array;
    for (let x = 0; x < 4; x++) expect(V[x]).toBeCloseTo(0.9 ** (3 - x), 6);
  });
  it("converges to the Bellman fixed point, with slip", () => {
    const m = rlRollout.buildMdp({
      width: 5,
      height: 4,
      walls: [
        [1, 1],
        [2, 2],
      ],
      terminals: [
        { at: [4, 0], reward: 1 },
        { at: [4, 1], reward: -1 },
      ],
      stepReward: -0.04,
      gamma: 0.95,
      slip: 0.2,
    });
    const Vs = rlRollout.valueIteration(m, 1e-9);
    expect(rlRollout.bellmanResidual(m, Vs[Vs.length - 1] as Float64Array)).toBeLessThan(1e-8);
  });
  it("Q-learning finds value iteration's policy on a deterministic grid", () => {
    const g = {
      width: 4,
      height: 3,
      walls: [[1, 1]] as Array<[number, number]>,
      terminals: [{ at: [3, 0] as [number, number], reward: 1 }],
      stepReward: -0.04,
      gamma: 0.9,
    };
    const m = rlRollout.buildMdp(g);
    const vi = rlRollout.greedy(m, rlRollout.valueIteration(m).at(-1) as Float64Array);
    const ql = rlRollout.qLearning(m, 8, {
      episodes: 3000,
      alpha: 0.5,
      epsilon: 0.3,
      seed: 5,
      maxSteps: 100,
      checkpoints: [],
    });
    const V = rlRollout.vFromQ(m, ql.Q);
    const Vvi = rlRollout.valueIteration(m).at(-1) as Float64Array;
    for (let s = 0; s < m.n; s++) if (vi[s] !== -1) expect(V[s]).toBeCloseTo(Vvi[s] as number, 2);
  });
  it("the walk reaches the goal and its return is the discounted sum shown", () => {
    const r = rlRollout.rlRollout(
      {
        width: 4,
        height: 3,
        terminals: [{ at: [3, 0], reward: 1 }],
        stepReward: -0.04,
        gamma: 0.9,
        start: [0, 2],
        algorithm: "value-iteration",
      },
      REGION,
    );
    const cells = r.data.cells as number[];
    expect(cells[cells.length - 1]).toBe(3);
    const rewards = r.data.rewards as number[];
    expect(rewards).toHaveLength(5);
    const G = rewards.reduce((s, x, t) => s + 0.9 ** t * x, 0);
    expect(r.vars.G).toBe(G.toFixed(2));
  });
});

/* ------------------------------------------------------------ retrieval */

describe("retrieval: cosine and BM25", () => {
  it("cosine is 1, 0 and −1 where it must be", () => {
    expect(retrieval.cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(retrieval.cosine([1, 0], [0, 3])).toBe(0);
    expect(retrieval.cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 12);
  });
  it("BM25 matches the formula by hand", () => {
    const r = retrieval.bm25("c", ["a b", "a c c", "d"]);
    const idf = Math.log(1 + 2.5 / 1.5);
    expect(r.scores[1]).toBeCloseTo((idf * 2 * 2.2) / (2 + 1.2 * (0.25 + (0.75 * 3) / 2)), 12);
    expect(r.scores[0]).toBe(0);
    expect(r.scores[2]).toBe(0);
  });
  it("ranks by score, ties in the input's order, and keeps the top k", () => {
    const r = retrieval.retrieval(
      {
        query: { vector: [1, 0] },
        items: [
          { label: "x", vector: [0, 1] },
          { label: "y", vector: [1, 1] },
          { label: "z", vector: [2, 2] },
          { label: "w", vector: [1, 0] },
        ],
        k: 2,
        theme: pack("signal"),
      },
      REGION,
    );
    expect(r.data.rank).toEqual([3, 1, 2, 0]);
    expect(r.vars).toMatchObject({ method: "cosine", top: "w", score: "1.000", k: 2 });
  });
  it("TF-IDF vectors give a cosine of 1 to an identical text", () => {
    const t = retrieval.tfidf(
      ["gaussian splats", "gaussian splats", "radiance fields"],
      ["gaussian splats", "radiance fields"],
    );
    expect(retrieval.cosine(t.vecs[0] as number[], t.vecs[1] as number[])).toBeCloseTo(1, 12);
    expect(retrieval.cosine(t.vecs[0] as number[], t.vecs[2] as number[])).toBe(0);
  });
});

/* ---------------------------------------- every kind: bytes, cost, type */

const CASES: Array<[string, () => MechanismResult]> = [
  ["attention", () => attention.patchAttention({ image: picture(1228, 818), grid: 12 }, REGION)],
  ["diffusion", () => diffusion.diffusion({ image: picture(1228, 818) }, REGION)],
  [
    "optimization",
    () =>
      optimization.optimization(
        {
          mode: "landscape",
          landscape: "rosenbrock",
          start: [-1.6, 2.4],
          steps: 400,
          optimizers: [
            { label: "SGD", rule: "sgd", lr: 0.0012 },
            { label: "Adam", rule: "adam", lr: 0.05 },
          ],
        },
        REGION,
      ),
  ],
  [
    "splatting",
    () => {
      const pts = Array.from({ length: 700 }, (_, i) => {
        const a = i * 2.399963;
        const y = 1 - (2 * (i + 0.5)) / 700;
        const r = Math.sqrt(1 - y * y);
        return {
          p: [r * Math.cos(a), y, r * Math.sin(a)] as [number, number, number],
          color: [0.8, 0.4 + 0.3 * y, 0.2] as const,
        };
      });
      return splatting.splatting({ points: pts }, REGION);
    },
  ],
  [
    "message-passing",
    () =>
      messagePassing.messagePassing(
        {
          nodes: Array.from({ length: 20 }, (_, i) => ({
            id: `n${i}`,
            features: [i === 0 ? 1 : 0, i === 19 ? 1 : 0, 0],
          })),
          edges: Array.from({ length: 19 }, (_, i) => [`n${i}`, `n${i + 1}`] as [string, string]),
          layers: 5,
          aggregate: "gcn",
        },
        REGION,
      ),
  ],
  [
    "rl-rollout",
    () =>
      rlRollout.rlRollout(
        {
          width: 8,
          height: 6,
          walls: [
            [2, 2],
            [3, 2],
            [4, 2],
          ],
          terminals: [{ at: [7, 0], reward: 1 }],
          stepReward: -0.02,
          gamma: 0.95,
          slip: 0.1,
          start: [0, 5],
          algorithm: "q-learning",
          episodes: 800,
          seed: 4,
        },
        REGION,
      ),
  ],
  [
    "retrieval",
    () =>
      retrieval.retrieval(
        {
          query: { text: "gaussian splatting rendering" },
          theme: pack("signal"),
          items: [
            "3D Gaussian Splatting",
            "NeRF",
            "Mip-Splatting",
            "EWA Splatting",
            "Attention Is All You Need",
          ].map((t) => ({ label: t, text: t })),
        },
        REGION,
      ),
  ],
];

describe("every mechanism kind", () => {
  it("lists all seven, each with slots and a takeaway", () => {
    expect([...MECHANISM_KIND_NAMES].sort()).toEqual(CASES.map(([k]) => k).sort());
    for (const k of MECHANISM_KIND_NAMES) expect(MECHANISM_TAKEAWAYS[k].length).toBeGreaterThan(20);
  });
  for (const [kind, make] of CASES) {
    it(`${kind}: same input, same bytes; under 2 s; result bytes under 200 MB; no text under 40 px; only declared slots`, () => {
      const first = resultBytes(make());
      // Timed warm, as a build that has already run one beat is.
      const t0 = performance.now();
      const r = make();
      const ms = performance.now() - t0;
      const bytes = resultBytes(r);
      expect(Buffer.compare(bytes, first)).toBe(0);
      expect(ms).toBeLessThan(2000);
      expect(bytes.length).toBeLessThan(200 * 2 ** 20);
      expect(r.frames.length).toBeGreaterThan(1);
      const slots = literalSlotsOf(kind as (typeof MECHANISM_KIND_NAMES)[number]);
      for (const f of r.frames)
        for (const p of f.prims) {
          if (p.p !== "text") continue;
          expect(p.size).toBeGreaterThanOrEqual(40);
          if (p.slot) {
            const decl = slots[p.slot];
            expect(decl, `${kind} slot ${p.slot}`).toBeDefined();
            for (const v of decl?.vars ?? [])
              expect(p.vars?.[v], `${kind}.${p.slot} {${v}}`).toBeDefined();
          } else expect(p.text).toBeDefined();
        }
      // Every image primitive names a raster the result carries.
      for (const f of r.frames)
        for (const p of f.prims) if (p.p === "image") expect(r.rasters[p.layer]).toBeDefined();
    });
  }
});

/* ------------------------------------------------- contrast, dark and light */

/** Roles that carry meaning; `rule`, `panel` and `bg` are containers and dividers, exempt as decoration. */
const MEANING = new Set(["fg", "muted", "dim", "accent", "a", "b", "c", "d"]);

/**
 * Every text at 4.5:1 (WCAG 1.4.3) against what it sits on, and every mark
 * drawn in a meaning role at full opacity at 3:1 (WCAG 1.4.11). Marks whose
 * opacity, heat or mix ENCODES a value (an attention weight, a message's size)
 * are data, not chrome, and are exempt; so is anything over a picture.
 */
function contrastFailures(r: MechanismResult, themeName: string): string[] {
  const theme = pack(themeName);
  const bad: string[] = [];
  for (const f of r.frames)
    for (const [i, p] of f.prims.entries()) {
      const under = backdropOf(f.prims, i, theme, p.p !== "text");
      if (!under) continue;
      const check = (what: string, c: Rgb8, min: number) => {
        const k = contrastRatio(c, under);
        if (k < min)
          bad.push(`${themeName} ${f.id} ${p.id ?? p.p} ${what} ${k.toFixed(2)} < ${min}`);
      };
      if (p.opacity !== undefined && p.opacity < 1) continue;
      if (p.p === "text") {
        // An outlined ("auto") text is read against its own outline.
        const halo = textHalo(f.prims, i, theme);
        const c = textRgb(f.prims, i, theme);
        if (halo) {
          const k = contrastRatio(c, halo);
          if (k < 4.5) bad.push(`${themeName} ${f.id} ${p.id ?? p.p} halo ${k.toFixed(2)} < 4.5`);
        } else check("text", c, 4.5);
        continue;
      }
      if ((p.p === "line" || p.p === "path") && !("mix" in p && p.mix) && MEANING.has(p.role)) {
        check("stroke", roleRgb(theme, p.role), 3);
        continue;
      }
      if (
        (p.p === "rect" || p.p === "circle") &&
        p.fill &&
        MEANING.has(p.fill) &&
        p.heat === undefined &&
        !p.mix &&
        !p.rgb
      )
        check("fill", fillRgb(theme, p) as Rgb8, 3);
      if (
        (p.p === "rect" || p.p === "circle") &&
        p.role &&
        MEANING.has(p.role) &&
        !fillRgb(theme, p)
      )
        check("outline", roleRgb(theme, p.role), 3);
    }
  return bad;
}

describe("contrast on every style pack, dark and light", () => {
  it("covers dark packs and light packs, and measures WCAG contrast", () => {
    const grounds = PACKS.map((p) => (pack(p) as { ground?: string }).ground);
    expect(grounds).toContain("dark");
    expect(grounds).toContain("light");
    expect(contrastRatio(hex("#000000"), hex("#ffffff"))).toBeCloseTo(21, 6);
  });
  for (const [kind, make] of CASES) {
    const r = make();
    it(`${kind} keeps text at 4.5:1 and marks at 3:1 on ${PACKS.join(", ")}`, () => {
      expect(PACKS.flatMap((p) => contrastFailures(r, p))).toEqual([]);
    });
  }
});

/* --------------------------------------------------- the judge's parameters */

describe("the judge fixtures regenerate through the deck's own path", () => {
  const cases = loadJudgeCases();
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-judge-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("covers all seven kinds", () => {
    expect(new Set(cases.map((c) => c.kind))).toEqual(new Set(MECHANISM_KIND_NAMES));
  });
  for (const c of cases)
    it.skipIf(!ffmpeg)(
      `${c.name}: the kind's own layers still say the recorded takeaway, and its frames are the same twice`,
      async () => {
        const theme = pack("signal");
        const a = await runJudgeCase(c, dir, theme);
        expect(a.takeaway).toBe(c.takeaway);
        expect(c.frames).toHaveLength(3);
        for (const i of c.frames) expect(a.svgs[i]).toBeDefined();
        // The frames are the production layers': every picture they show is a file `layers` wrote.
        const files = new Set(Object.values(a.layers.files));
        for (const svg of a.svgs)
          for (const m of svg.matchAll(/href="([^"]+)"/g)) expect(files).toContain(m[1]);
        const b = await runJudgeCase(c, dir, theme);
        expect(b.svgs).toEqual(a.svgs);
      },
      30000,
    );
});

/* ------------------------------------------------- the adapters, end to end */

describe("the mechanism kinds in the literal pass (src/literal/kinds/mechanisms.ts)", () => {
  const region = { width: 1760, height: 860 };
  const cues = [
    { t0: 0.5, t1: 3 },
    { t0: 3, t1: 6 },
    { t0: 6, t1: 9.5 },
  ];
  /** A plan's literal for each kind, parsed by the planner's own schema (defaults filled). */
  const PLANS: Record<
    (typeof MECHANISM_KIND_NAMES)[number],
    { literal: unknown; labels: Record<string, string>; picture?: boolean }
  > = {
    attention: {
      literal: {
        kind: "attention",
        tokens: ["the", "cat", "sat", "on", "the", "mat"],
        path: [4, 1],
      },
      labels: { content: "letters", position: "positions", example: "example" },
    },
    diffusion: {
      literal: { kind: "diffusion", picture: "b01" },
      labels: {
        forward: "t = {t} / {T}",
        reverse: "t = {t} / {T}",
        signal: "signal",
        noise: "noise",
        oracle: "oracle",
        steps: "1000",
      },
      picture: true,
    },
    optimization: {
      literal: {
        kind: "optimization",
        optimizers: [
          { label: "SGD", rule: "sgd", lr: 0.001 },
          { label: "Adam", rule: "adam", lr: 0.05 },
        ],
      },
      labels: { xAxis: "step", yAxis: "loss", landscape: "illustrative", example: "example" },
    },
    splatting: {
      literal: {
        kind: "splatting",
        points: Array.from({ length: 60 }, (_, i) => ({
          x: Math.cos(i),
          y: (i % 7) / 7,
          z: Math.sin(i),
          r: 0.8,
          g: 0.4,
          b: 0.2,
        })),
      },
      labels: { points: "{n}", splats: "{n}", render: "{pose}/{poses}", path: "path" },
    },
    "message-passing": {
      literal: {
        kind: "message-passing",
        nodes: ["a", "b", "c", "d"].map((id, i) => ({
          id,
          label: id,
          features: [i === 0 ? 1 : 0],
        })),
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "d" },
        ],
        layers: 2,
      },
      labels: { layer: "{l}/{L}", field: "{count}" },
    },
    "rl-rollout": {
      literal: {
        kind: "rl-rollout",
        width: 4,
        height: 3,
        terminals: [{ x: 3, y: 0, reward: 1 }],
        start: { x: 0, y: 2 },
      },
      labels: { sweep: "{k}", step: "{t} {G}", reward: "reward", example: "example" },
    },
    retrieval: {
      literal: {
        kind: "retrieval",
        query: "gaussian splatting",
        items: [
          { label: "A", text: "gaussian splatting" },
          { label: "B", text: "radiance fields" },
        ],
      },
      labels: { query: "query", score: "{method}", topk: "top {k}", example: "example" },
    },
  };
  let dir = "";
  let pic = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-mechanism-"));
    pic = join(dir, "pic.png");
    await writeFile(pic, testPng(320, 200, { shade: true }));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const theme = pack("signal");

  for (const kind of MECHANISM_KIND_NAMES) {
    it.skipIf(!ffmpeg)(
      `${kind}: registered, its plan parses, and its fragment keeps the deck's invariants`,
      async () => {
        const p = PLANS[kind];
        const data = literalSchema.parse({
          ...(p.literal as object),
          labels: Object.entries(p.labels).map(([slot, text]) => ({ slot, text })),
        });
        expect(literalSlotProblems(kind, data.labels)).toEqual([]);
        const spec = { labels: p.labels, data };
        const impl = KINDS[kind];
        expect(impl.picture).toBe(!!p.picture);
        const L = await impl.layers({
          beatId: "b07",
          ...(p.picture ? { image: pic } : {}),
          dir,
          region,
          spec,
          earlier: new Map(),
          theme: pack("signal"),
        });
        for (const f of Object.values(L.files))
          expect((await stat(join(dir, f))).size).toBeGreaterThan(0);
        const f = impl.fragment(L, region, cues, spec, theme, (x) => `assets/literal/${x}`);
        // Invariants 2, 3: every tween is fromTo on a scoped id that exists.
        const calls = f.script.match(/tl\.\w+\(/g) ?? [];
        expect(calls.length).toBeGreaterThan(1);
        expect(new Set(calls)).toEqual(new Set(["tl.fromTo("]));
        for (const m of f.script.matchAll(/tl\.fromTo\("#(SCENEID-[\w-]+)"/g))
          expect(f.markup).toContain(`id="${m[1]}"`);
        // Invariants 4, 11: no callbacks, no clock, no randomness.
        expect(f.script).not.toMatch(
          /on(Update|Start|Complete|Repeat)|Date\.now|Math\.random|fetch/,
        );
        // Invariant 5: no text under 40px; every layer under assets/literal; every colour a token.
        const sizes = [...f.markup.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
        expect(sizes.length).toBeGreaterThan(0);
        for (const s of sizes) expect(s).toBeGreaterThanOrEqual(40);
        for (const m of f.markup.matchAll(/href="([^"]+)"/g))
          expect(m[1]).toMatch(/^assets\/literal\/b07-/);
        // Invariant 10: times and durations at 3 decimals.
        for (const m of f.script.matchAll(/, (\d+\.\d+)\);$/gm))
          expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
        // A required slot left out is refused, with no default in any language.
        const required = Object.entries(literalSlotsOf(kind)).find(
          ([, d]) => !d.optional && !d.number,
        );
        if (required) {
          const labels = { ...p.labels };
          delete labels[required[0]];
          expect(() =>
            impl.fragment(L, region, cues, { ...spec, labels }, theme, (x) => x),
          ).toThrow(new RegExp(`needs the label slot "${required[0]}"`));
        }
      },
      30000,
    ); // diffusion writes 22 rasters: ~2 s alone, more under a parallel run
  }

  it("the truth rules are the kinds' own, and the planner is shown them", () => {
    expect(LITERAL_KIND_DOCS.attention.requires).toEqual(ATTENTION_RULES.requires);
    expect(LITERAL_KIND_DOCS.diffusion.mustNotClaim).toEqual(DIFFUSION_RULES.mustNotClaim);
    for (const k of MECHANISM_KIND_NAMES) {
      expect(LITERAL_KIND_DOCS[k].mustNotClaim?.length ?? 0).toBeGreaterThan(0);
      // Every kind's own takeaway template keeps its own rules.
      const said = MECHANISM_TAKEAWAYS[k].replace(/\{\w+\}/g, "x");
      expect(
        literalTruthProblems({ mustNotClaim: LITERAL_KIND_DOCS[k].mustNotClaim }, {}, [said], ""),
      ).toEqual([]);
    }
    // A claim the scene cannot back is refused; the source's own material lifts it.
    const ban = { mustNotClaim: LITERAL_KIND_DOCS.retrieval.mustNotClaim };
    expect(literalTruthProblems(ban, {}, ["the dense retriever ranks it first"], "")).toHaveLength(
      1,
    );
    expect(
      literalTruthProblems(
        ban,
        { vectors: [[1, 0]] },
        ["the dense retriever ranks it first"],
        "vectors (1, 0)",
      ),
    ).toEqual([]);
  });
});

/* ------------------------------------------- the PR #115 review, one by one */

describe("the PR #115 review's findings stay fixed", () => {
  const sourceOf = (text: string) =>
    sourceSchema.parse({
      id: "s",
      title: "t",
      sections: [{ id: "sec1", depth: 1, heading: "Method", text }],
      figures: [],
      equations: [],
      tables: [],
    });
  /** The repair round's findings for one beat drawn with `literal`. */
  const findings = (literal: object, text: string, takeaway = "the scene") =>
    literalFindings(
      {
        beats: [
          {
            id: "b02",
            archetype: "statement",
            params: {},
            intent: "x",
            takeaway,
            literal: literalSchema.parse(literal),
          },
        ],
      } as never,
      sourceOf(text),
    );
  const lbl = (o: Record<string, string>) =>
    Object.entries(o).map(([slot, text]) => ({ slot, text }));
  const latin: Measure = (t, size) => textWidth(t, size, 600);
  /** Every literal text a frame draws, outside the region (slot texts are the plan's, measured elsewhere). */
  const overflow = (r: MechanismResult, region: Region, measure: Measure) =>
    r.frames.flatMap((f) =>
      f.prims.flatMap((p) => {
        if (p.p !== "text" || p.text === undefined) return [];
        const w = measure(p.text, p.size);
        const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
        const bad =
          x0 < -0.5 ||
          x0 + w > region.width + 0.5 ||
          p.y < -0.5 ||
          p.y + p.size > region.height + 0.5;
        return bad
          ? [
              `${f.id} ${p.id} "${p.text}" x ${x0.toFixed(0)}..${(x0 + w).toFixed(0)} y ${p.y.toFixed(0)}`,
            ]
          : [];
      }),
    );

  it("1. the judge's frames are the production layers' (asserted in the judge suite: every href is a file `layers` wrote)", () => {
    expect(loadJudgeCases().length).toBe(9);
  });

  it("2. attention on a picture refuses the source's heads and embeddings: it would draw pixels under their claim", () => {
    const lit = {
      kind: "attention",
      picture: "b01",
      heads: [{ q: [[1]], k: [[1]] }],
      labels: lbl({ example: "example" }),
    };
    const found = findings(
      lit,
      "image patches with queries and keys 1",
      "The trained ViT attends to the dog's head",
    );
    expect(found).toContainEqual(
      expect.stringMatching(
        /cannot be drawn in [^:]+: `heads` and `embeddings` are rows per token, and this scene has no `tokens`/,
      ),
    );
  });

  it("3. invented 'source' numbers neither draw nor lift a ban; the source's own do", () => {
    const text = "A graph neural network passes messages between nodes A and B.";
    const gcn = (weights: number[][][], dim = 2) => ({
      kind: "message-passing",
      nodes: [
        { id: "A", label: "A", features: dim === 2 ? [1, 0] : [1] },
        { id: "B", label: "B", features: dim === 2 ? [0, 1] : [0] },
      ],
      edges: [{ from: "A", to: "B" }],
      layers: 1,
      weights,
      labels: lbl({ layer: "{l}", field: "{count}", example: "example" }),
    });
    const claim = "The trained GCN predicts each node's class";
    const invented = findings(
      gcn([
        [
          [0.37, 0.1],
          [0.2, 0.4],
        ],
      ]),
      text,
      claim,
    );
    expect(invented).toContainEqual(
      expect.stringMatching(/gives `weights` the source does not print/),
    );
    expect(invented).toContainEqual(expect.stringMatching(/claims what a trained network learns/));
    const own = findings(
      gcn([
        [
          [2, 3],
          [4, 5],
        ],
      ]),
      `${text} W = [[2, 3], [4, 5]].`,
      claim,
    );
    expect(own.filter((f) => /weights|claims/.test(f))).toEqual([]);
    // A lone number is no evidence (PR #115 round 3): "Its weight is 2" does not ground a 1×1 W.
    const lone = findings(gcn([[[2]]], 1), `${text} Its weight is 2.`, claim);
    expect(lone).toContainEqual(expect.stringMatching(/claims what a trained network learns/));
    // A loss curve the source never states is refused.
    const series = {
      kind: "optimization",
      series: [
        {
          label: "ours",
          points: [
            { x: 0, y: 2.5 },
            { x: 10, y: 0.31 },
          ],
        },
      ],
      labels: lbl({ xAxis: "step", yAxis: "loss" }),
    };
    expect(
      findings(series, "SGD lowers the training loss from 2.5 at step 0 to 10."),
    ).toContainEqual(expect.stringMatching(/gives `series` the source does not print/));
  });

  it("4. message passing applies the source's σ and refuses a short or misshapen weight list", () => {
    const base = {
      nodes: [
        { id: "a", features: [1] },
        { id: "b", features: [1] },
      ],
      edges: [["a", "b"]] as Array<[string, string]>,
      layers: 2,
      aggregate: "sum" as const,
    };
    expect(() => messagePassing.messagePassing({ ...base, weights: [[[1]]] }, REGION)).toThrow(
      /2 layers; give one per layer/,
    );
    expect(() =>
      messagePassing.messagePassing({ ...base, weights: [[[1, 1]], [[1]]] }, REGION),
    ).toThrow(/1\.\.4 × 1 matrix/);
    const neg = { ...base, layers: 1, weights: [[[-1]]] };
    const lin = (
      messagePassing.messagePassing(neg, REGION).data.features as number[][][]
    )[1] as number[][];
    const relu = (
      messagePassing.messagePassing({ ...neg, relu: true }, REGION).data.features as number[][][]
    )[1] as number[][];
    expect(lin[0]?.[0]).toBe(-2);
    expect(relu[0]?.[0]).toBe(0);
  });

  it.skipIf(!ffmpeg)(
    "5. diffusion needs a diffusion source, marks DDPM's defaults as an example, takes a cosine schedule, and says the reverse path is an oracle",
    async () => {
      const d = {
        kind: "diffusion",
        picture: "b01",
        labels: lbl({ forward: "{t}", reverse: "{t}", signal: "s", noise: "n", oracle: "oracle" }),
      };
      expect(findings(d, "A paper about sorting algorithms.")).toContainEqual(
        expect.stringMatching(/needs the source to give a diffusion or denoising process/),
      );
      expect(findings(d, "a diffusion model")).toContainEqual(
        expect.stringMatching(/needs the `example` slot/),
      );
      const dir = await mkdtemp(join(tmpdir(), "decksmith-diffusion-"));
      try {
        const pic = join(dir, "p.png");
        await writeFile(pic, testPng(64, 40));
        const sig = async (schedule: string) => {
          const lit = literalSchema.parse({ ...d, schedule });
          const L = await KINDS.diffusion.layers({
            beatId: schedule,
            image: pic,
            dir,
            region: REGION,
            spec: {
              labels: Object.fromEntries(lit.labels.map((l) => [l.slot, l.text])),
              data: lit,
            },
            earlier: new Map(),
            theme: pack("signal"),
          });
          const frames = L.data.frames as Array<{
            id: string;
            prims: Array<{ id?: string; pts?: number[]; slot?: string }>;
          }>;
          expect(
            frames
              .filter((f) => f.id.startsWith("r"))
              .every((f) => f.prims.some((p) => p.slot === "oracle")),
          ).toBe(true);
          return frames[0]?.prims.find((p) => p.id === "sig")?.pts;
        };
        expect(await sig("cosine")).not.toEqual(await sig("linear"));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30000,
  );

  it.skipIf(!ffmpeg)(
    "6. material that is the plan's own is drawn under an 'example' tag in the deck's language",
    async () => {
      const rl = (labels: Record<string, string>) => ({
        kind: "rl-rollout",
        width: 3,
        height: 1,
        terminals: [{ x: 2, y: 0, reward: 1 }],
        start: { x: 0, y: 0 },
        labels: lbl({ sweep: "{k}", step: "{t}", reward: "r", ...labels }),
      });
      const text = "reinforcement learning with a reward and a policy";
      expect(findings(rl({}), text)).toContainEqual(expect.stringMatching(/needs slot "example"/));
      expect(findings(rl({ example: "예시" }), text)).toEqual([]);
      expect(findings(rl({ example: "a fun grid" }), text)).toContainEqual(
        expect.stringMatching(/does not say "example"/),
      );
      const land = {
        kind: "optimization",
        optimizers: [{ label: "SGD", rule: "sgd", lr: 0.001 }],
        labels: lbl({ xAxis: "step", yAxis: "loss" }),
      };
      expect(findings(land, "SGD with a learning rate")).toContainEqual(
        expect.stringMatching(/needs the `example` slot/),
      );
      // And the tag is in every frame, under the scene.
      const lit = literalSchema.parse({
        ...land,
        labels: lbl({ xAxis: "step", yAxis: "loss", example: "example" }),
      });
      const dir = await mkdtemp(join(tmpdir(), "decksmith-tag-"));
      try {
        const L = await KINDS.optimization.layers({
          beatId: "t",
          dir,
          region: REGION,
          spec: { labels: { example: "example" }, data: lit },
          earlier: new Map(),
          theme: pack("signal"),
        });
        for (const f of L.data.frames as Array<{ prims: Array<{ slot?: string; y?: number }> }>)
          expect(f.prims.find((p) => p.slot === "example")?.y).toBeGreaterThan(REGION.height - 80);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it("7. the score header names the method computed, and a plan cannot rename BM25 as cosine", () => {
    const lit = (score: string) => ({
      kind: "retrieval",
      query: "splatting",
      items: [
        { label: "Gaussian splatting", text: "Gaussian splatting" },
        { label: "Radiance fields", text: "Radiance fields" },
      ],
      labels: lbl({ query: "q", score, topk: "{k}", example: "example" }),
    });
    const found = findings(lit("Cosine similarity"), "we retrieve and rank papers");
    expect(found).toContainEqual(expect.stringMatching(/names its method in its own words/));
    expect(found).toContainEqual(expect.stringMatching(/claims dense, neural, learned or vector/));
    expect(findings(lit("score ({method})"), "we retrieve and rank papers")).toEqual([]);
    const r = retrieval.retrieval(
      {
        query: { text: "splatting" },
        items: [
          { label: "a", text: "splatting" },
          { label: "b", text: "x" },
        ],
        theme: pack("signal"),
      },
      REGION,
    );
    const head = r.frames[1]?.prims.find((p) => p.id === "sh") as { vars?: Record<string, string> };
    expect(head.vars?.method).toBe("BM25");
  });

  it("8. Chinese and Japanese are scored by character bigrams, not as one unspaced token", () => {
    const r = retrieval.bm25("注意力机制 翻译", [
      "卷积网络的图像分类",
      "注意力机制用于机器翻译",
      "基于注意力机制的翻译模型",
    ]);
    expect(r.scores[0]).toBe(0);
    expect(r.scores[1] as number).toBeGreaterThan(0);
    expect(r.scores[2] as number).toBeGreaterThan(0);
    expect(retrieval.tokenize("注意力")).toEqual(["注意", "意力", "注", "意", "力"]);
    expect(retrieval.tokenize("Gaussian 스플래팅")).toEqual(["gaussian", "스플래팅"]);
  });

  it("9. a plan the kind cannot draw comes back from the gate, not from build --literal", () => {
    const text =
      "attention over tokens, an optimizer with a learning rate and loss, gaussian splatting points, a graph with nodes, reinforcement learning rewards, retrieval and ranking";
    const cannot = (lit: object) =>
      findings(lit, text).filter((f) => f.includes("cannot be drawn"));
    expect(cannot({ kind: "optimization" })).toHaveLength(1);
    expect(cannot({ kind: "attention" })).toHaveLength(1);
    expect(cannot({ kind: "splatting" })).toHaveLength(1);
    expect(cannot({ kind: "attention", tokens: ["a", "b"], path: [9] })).toHaveLength(1);
    expect(
      cannot({
        kind: "message-passing",
        nodes: [
          { id: "a", label: "a", features: [1] },
          { id: "b", label: "b", features: [1] },
        ],
        edges: [{ from: "a", to: "z" }],
      }),
    ).toHaveLength(1);
    expect(
      cannot({
        kind: "rl-rollout",
        width: 3,
        height: 2,
        walls: [{ x: 0, y: 0 }],
        terminals: [{ x: 2, y: 0, reward: 1 }],
        start: { x: 0, y: 0 },
      }),
    ).toHaveLength(1);
    expect(
      cannot({ kind: "retrieval", query: "q", items: [{ label: "a", text: "a" }] }),
    ).toHaveLength(1);
    expect(
      cannot({ kind: "optimization", optimizers: [{ label: "SGD", rule: "sgd", lr: 1 }] }),
    ).toEqual([expect.stringMatching(/diverged at step \d+; lower its learning rate/)]);
  });

  it("10. legends and end labels fit the region, sized from the strings they print", () => {
    const region = { width: 1760, height: 860 };
    const r = optimization.optimization(
      {
        mode: "landscape",
        landscape: "quadratic",
        start: [-2.5, 1.5],
        steps: 300,
        optimizers: [
          { label: "Gradient descent", rule: "sgd", lr: 0.05 },
          { label: "Momentum", rule: "momentum", lr: 0.05 },
        ],
        measure: latin,
      },
      region,
    );
    expect(overflow(r, region, latin)).toEqual([]);
    expect(
      r.frames.some((f) => f.prims.some((p) => p.p === "text" && /e-\d+$/.test(p.text ?? ""))),
    ).toBe(true);
  });

  it("11. words are measured in the deck's own face: a Korean deck on a serif pack still fits", () => {
    const region = { width: 1760, height: 860 };
    for (const [pk, lang] of [
      ["folio", "ko"],
      ["journal", "ja"],
      ["signal", "en"],
    ] as const) {
      const theme = deckLook({ theme: pk, lang } as never).theme;
      const measure: Measure = (t, size) => widthOf(t, size, theme);
      const titles = [
        "3D Gaussian Splatting for Real-Time Radiance Field Rendering",
        "Mip-NeRF 360: Unbounded Anti-Aliased Neural Radiance Fields",
        "Instant Neural Graphics Primitives with a Multiresolution Hash Encoding",
      ];
      const rr = retrieval.retrieval(
        {
          query: { text: "radiance fields rendering" },
          items: titles.map((t) => ({ label: t, text: t })),
          theme,
        },
        region,
      );
      expect(overflow(rr, region, measure)).toEqual([]);
      // No label runs into its score: the label's right edge stays left of the score's left edge.
      const last = rr.frames[rr.frames.length - 1] as Frame;
      for (let i = 0; i < titles.length; i++) {
        const label = last.prims.find((p) => p.id === `lb${i}`) as {
          x: number;
          text: string;
          size: number;
        };
        const score = last.prims.find((p) => p.id === `sc${i}`) as {
          x: number;
          text: string;
          size: number;
        };
        expect(label.x + measure(label.text, label.size)).toBeLessThan(
          score.x - measure(score.text, score.size),
        );
      }
      const op = optimization.optimization(
        {
          mode: "landscape",
          landscape: "rosenbrock",
          start: [-1.6, 2.4],
          steps: 400,
          optimizers: [
            { label: "SGD", rule: "sgd", lr: 0.0012 },
            { label: "Momentum", rule: "momentum", lr: 0.0012 },
          ],
          measure,
        },
        region,
      );
      expect(overflow(op, region, measure)).toEqual([]);
    }
  });

  it("low: a ban's word under negation states the scene's limit, and is not refused", () => {
    const r = { mustNotClaim: LITERAL_KIND_DOCS.retrieval.mustNotClaim };
    expect(literalTruthProblems(r, {}, ["word overlap, not semantic similarity"], "")).toEqual([]);
    const s = { mustNotClaim: LITERAL_KIND_DOCS.splatting.mustNotClaim };
    expect(
      literalTruthProblems(s, {}, ["nothing is learned here", "학습 없이 그린다"], ""),
    ).toEqual([]);
    expect(literalTruthProblems(s, {}, ["the learned Gaussians"], "")).toHaveLength(1);
  });
});

/* ------------------------------------------ the PR #115 re-review, one by one */

describe("the PR #115 re-review's findings stay fixed", () => {
  const sourceOf = (text: string) =>
    sourceSchema.parse({
      id: "s",
      title: "t",
      sections: [{ id: "sec1", depth: 1, heading: "Method", text }],
      figures: [],
      equations: [],
      tables: [],
    });
  const lbl = (o: Record<string, string>) =>
    Object.entries(o).map(([slot, text]) => ({ slot, text }));
  const findings = (
    literal: object,
    text: string,
    opts: { takeaway?: string; headline?: string; theme?: string; lang?: string } = {},
  ) =>
    literalFindings(
      {
        theme: opts.theme ?? "signal",
        lang: opts.lang ?? "en",
        beats: [
          {
            id: "b02",
            archetype: "statement",
            params: { headline: opts.headline ?? "A scene" },
            intent: "x",
            takeaway: opts.takeaway ?? "the scene",
            literal: literalSchema.parse(literal),
          },
        ],
      } as never,
      sourceOf(text),
    );

  it("round 3 HIGH: one-number rows never ground, in heads, embeddings or any matrix", () => {
    // The reviewer's probe: q/k and embeddings of 1-dim rows off "1 model with 0 dropout".
    const src =
      "The model applies self-attention over tokens with queries and keys. We train 1 model with 0 dropout.";
    const take = { takeaway: "The trained model attends to cat from sat" };
    const col = [[1], [0], [1]];
    const attn = {
      kind: "attention",
      tokens: ["the", "cat", "sat"],
      heads: [{ q: col, k: col }],
      labels: lbl({ content: "c", position: "p" }),
    };
    expect(findings(attn, src, take)).toContainEqual(
      expect.stringMatching(/claims what a trained model attends to/),
    );
    const emb = { ...attn, heads: undefined, embeddings: col };
    expect(findings(emb, src, take)).toContainEqual(
      expect.stringMatching(/claims what a trained model attends to/),
    );
    // The column printed whole, in order, does ground.
    const printed = `${src} The query column is [1, 0, 1] and the key column is [1, 0, 1].`;
    expect(findings(attn, printed, take)).toEqual([]);
  });

  it("HIGH 1. a row counts as the source's only when printed whole, in order, with its sign", () => {
    // The reviewer's probe: small integers from "2 heads (Figure 1)" and "Section 3 … 0 failures".
    const src =
      "We use 2 heads (Figure 1). Section 3 reports 0 failures. The transformer attends with self-attention over tokens.";
    const heads = [
      {
        q: [
          [1, 0],
          [0, 1],
          [1, 1],
        ],
        k: [
          [2, 0],
          [0, 3],
          [1, 2],
        ],
      },
    ];
    const lit = {
      kind: "attention",
      tokens: ["the", "cat", "sat"],
      heads,
      labels: lbl({ content: "c", position: "p" }),
    };
    const found = findings(lit, src, { takeaway: "The trained model attends to cat from sat" });
    expect(found).toContainEqual(expect.stringMatching(/claims what a trained model attends to/));
    expect(found).toContainEqual(expect.stringMatching(/gives `heads` the source does not print/));
    expect(found).toContainEqual(expect.stringMatching(/needs the `example` slot/));
    // Printed whole: grounded, the ban lifts, no tag needed.
    const printed = `${src} Q = [[1, 0], [0, 1], [1, 1]] and K = [[2, 0], [0, 3], [1, 2]].`;
    expect(
      findings(lit, printed, { takeaway: "The trained model attends to cat from sat" }),
    ).toEqual([]);
    // A sign is part of the row.
    expect(
      findings(
        {
          ...lit,
          heads: [
            {
              q: [
                [-1, 0],
                [0, 1],
                [1, 1],
              ],
              k: heads[0]?.k,
            },
          ],
        },
        printed,
      ),
    ).toContainEqual(expect.stringMatching(/gives `heads` the source does not print/));
    // The message-passing probe: weights [[1]], [[-2]] off "Section 1" and "2 layers", relu never named.
    const gcn = {
      kind: "message-passing",
      nodes: [
        { id: "a", label: "a", features: [1] },
        { id: "n", label: "n", features: [0] },
        { id: "x", label: "", features: [0] },
      ],
      edges: [
        { from: "a", to: "n" },
        { from: "n", to: "x" },
      ],
      layers: 2,
      weights: [[[1]], [[-2]]],
      activation: "relu",
      labels: lbl({ layer: "{l}", field: "{count}" }),
    };
    const g = findings(
      gcn,
      "Section 1 introduces a graph neural network with 2 layers. We train a GCN on a citation graph.",
      {
        takeaway: "The trained GCN predicts each node's class",
      },
    );
    expect(g).toContainEqual(expect.stringMatching(/claims what a trained network learns/));
    expect(g).toContainEqual(expect.stringMatching(/needs the `example` slot/));
    expect(g).toContainEqual(
      expect.stringMatching(/`activation` relu, which the source never names/),
    );
  });

  it("MEDIUM 2/8. the gate lays the scene out where and as the build does: the beat's region, the deck's face, every format", () => {
    const text = "We retrieve and rank papers; attention over tokens; queries and keys.";
    const items = Array.from({ length: 7 }, (_, i) => ({
      label: `Paper ${i + 1}`,
      text: "rank papers",
    }));
    const retr = {
      kind: "retrieval",
      query: "rank papers",
      items,
      labels: lbl({ query: "q", score: "{method}", topk: "{k}", example: "example" }),
    };
    const two =
      "A headline long enough to wrap onto a second line at the deck's headline size, as the review's probe had";
    expect(findings(retr, text, { headline: two })).toContainEqual(
      expect.stringMatching(/cannot be drawn in [^:]*deck-16x9[^:]*: 7 items need/),
    );
    const ten = "one two three four five six seven eight nine ten".split(" ");
    const att = {
      kind: "attention",
      tokens: ten,
      labels: lbl({ content: "c", position: "p", example: "example" }),
    };
    const a = findings(att, text);
    expect(a).toContainEqual(
      expect.stringMatching(/cannot be drawn in [^:]*short-9x16[^:]*: 10 tokens need/),
    );
    expect(a.join(" ")).not.toMatch(/deck-16x9/);
    // The same eight words fit a Latin deck's 1700 px and not the folio pack's Korean face (1788 px).
    const words = "Transformer attention takes weighted averages across every token".split(" ");
    const w8 = {
      kind: "attention",
      tokens: words,
      labels: lbl({ content: "c", position: "p", example: "example" }),
    };
    expect(findings(w8, text).join(" ")).not.toMatch(/deck-16x9/);
    expect(findings(w8, text, { theme: "folio", lang: "ko" })).toContainEqual(
      expect.stringMatching(/cannot be drawn in [^:]*deck-16x9[^:]*: 8 tokens need/),
    );
  });

  it("MEDIUM 3. a negator nearby does not negate the claim: it must govern the banned word", () => {
    const rules = { mustNotClaim: LITERAL_KIND_DOCS["message-passing"].mustNotClaim };
    expect(
      literalTruthProblems(
        rules,
        { weights: [] },
        ["Given no labels GCN predicts each node's class"],
        "",
      ),
    ).toHaveLength(1);
    expect(
      literalTruthProblems(
        rules,
        { weights: [] },
        ["nothing is learned", "without trained weights"],
        "",
      ),
    ).toEqual([]);
  });

  it("MEDIUM 4. a bracketed list of numbers is read number by number", () => {
    expect(
      numberSequence("e1=[0.5,0.25] and e2=[0.75,0.125]; 1,000 steps; Table 3 shows -0.5"),
    ).toEqual([0.5, 0.25, 0.75, 0.125, 1000, -0.5]);
    const src =
      "The learned embeddings are e1=[0.5,0.25] and e2=[0.75,0.125] and e3=[0.5,0.75]. Attention over tokens.";
    const lit = {
      kind: "attention",
      tokens: ["a", "b", "c"],
      embeddings: [
        [0.5, 0.25],
        [0.75, 0.125],
        [0.5, 0.75],
      ],
      labels: lbl({ head: "{h}" }),
    };
    expect(findings(lit, src, { takeaway: "the trained model attends to a" })).toEqual([]);
  });

  it("MEDIUM 5. a layer that widens (d_out > d_in) still colours every node", () => {
    const r = messagePassing.messagePassing(
      {
        nodes: [
          { id: "a", features: [1] },
          { id: "b", features: [0] },
        ],
        edges: [["a", "b"]],
        layers: 2,
        aggregate: "mean",
        weights: [
          [[1], [2], [1]],
          [
            [1, 0, 1],
            [0, 1, 0],
          ],
        ],
      },
      REGION,
    );
    for (const f of r.frames)
      for (const p of f.prims)
        for (const v of (p as { mix?: number[] }).mix ?? []) expect(Number.isFinite(v)).toBe(true);
  });

  it("MEDIUM 6. a corpus is the source's only when every title and passage is printed in it", () => {
    const tags = (items: Array<{ label: string; text: string }>, text: string) =>
      findings(
        {
          kind: "retrieval",
          query: "rank papers",
          items,
          labels: lbl({ query: "q", score: "{method}", topk: "{k}" }),
        },
        text,
      ).filter((f) => /needs the `example` slot/.test(f));
    // A/B/C over invented passages.
    const abc = ["A", "B", "C"].map((l) => ({ label: l, text: `rank papers about ${l}` }));
    expect(
      tags(abc, "We retrieve and rank papers for a query; Table B and Figure C compare them."),
    ).toHaveLength(1);
    // Real titles over invented passages.
    const titles = [
      { label: "Attention Is All You Need", text: "rank papers by self-attention alone" },
      { label: "Deep Residual Learning", text: "rank papers with residual blocks" },
    ];
    const both =
      "We retrieve and rank papers: Attention Is All You Need and Deep Residual Learning.";
    expect(tags(titles, both)).toHaveLength(1);
    // Every title and passage printed: no tag needed.
    const printed = `${both} Abstracts: "rank papers by self-attention alone"; "rank papers with residual blocks".`;
    expect(tags(titles, printed)).toEqual([]);
  });

  it("MEDIUM 7. the build gets a diffusion beat's data from the kind, not from a schema default", () => {
    const source = sourceSchema.parse({
      id: "s",
      title: "t",
      sections: [{ id: "sec1", depth: 1, heading: "h", text: "x" }],
      figures: [{ id: "fig1", src: "fig1.png", caption: "c", width: 8, height: 8 }],
      equations: [],
      tables: [],
    });
    // A literal WITHOUT the defaulted `schedule` key (as an older plan file has it).
    const literal = { kind: "diffusion", picture: "b01", labels: [] };
    const board = {
      beats: [
        {
          id: "b01",
          archetype: "statement",
          intent: "i",
          params: { headline: "h", figureId: "fig1" },
          literal,
        },
      ],
    };
    const plan = literalPlanOf(board as never, source, "/deck/assets");
    expect(plan.beats.b01?.data).toEqual(literal);
    expect(plan.beats.b01?.image).toBe("/deck/assets/fig1.png");
  });

  it("LOW. picture + tokens + heads runs the tokens; picture + heads alone is refused with advice that works", () => {
    const text = "queries and keys over tokens: 1 0 1";
    const heads = [{ q: [[1], [0], [1]], k: [[1], [0], [1]] }];
    const withTokens = {
      kind: "attention",
      picture: "b01",
      tokens: ["the", "cat", "sat"],
      heads,
      labels: lbl({ head: "{h}", example: "example" }),
    };
    expect(findings(withTokens, text).filter((f) => /cannot be drawn/.test(f))).toEqual([]);
    const alone = { kind: "attention", picture: "b01", heads, labels: lbl({ example: "example" }) };
    expect(findings(alone, text)).toContainEqual(
      expect.stringMatching(/give the `tokens` those rows belong to, or drop `heads`/),
    );
  });

  it("LOW. node ids are never drawn, so numeric ids are not checked as numbers", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      label: "ABCDEFGHIJKL"[i] as string,
      features: [i === 0 ? 1 : 0],
    }));
    const edges = nodes.slice(1).map((n, i) => ({ from: String(i + 1), to: n.id }));
    const lit = {
      kind: "message-passing",
      nodes,
      edges,
      layers: 2,
      labels: lbl({ layer: "{l}", field: "{count}", example: "example" }),
    };
    expect(
      findings(lit, "A graph neural network over nodes 1 and 2.").filter((f) => /says/.test(f)),
    ).toEqual([]);
  });

  it("LOW. a cosine schedule states only its steps; its betas are not asked for", () => {
    const d = (labels: Record<string, string>) => ({
      kind: "diffusion",
      picture: "b01",
      schedule: "cosine",
      labels: lbl({
        forward: "{t}",
        reverse: "{t}",
        signal: "s",
        noise: "n",
        oracle: "o",
        ...labels,
      }),
    });
    const src =
      "A diffusion model with a cosine noise schedule and T = 4000 steps, offset s = 0.008.";
    const tag = (f: string[]) => f.filter((x) => /needs the `example` slot/.test(x));
    expect(tag(findings(d({ steps: "4000" }), src))).toEqual([]);
    expect(tag(findings(d({}), src))).toHaveLength(1);
    // Linear still needs all three.
    const lin = { ...d({ steps: "4000" }), schedule: "linear" };
    expect(tag(findings(lin, src))).toHaveLength(1);
  });

  it("LOW. a one-character CJK word matches, and a ranking with nothing to rank is refused", () => {
    const r = retrieval.bm25("猫", ["犬の写真", "猫の写真", "黒い猫"]);
    expect(r.scores[0]).toBe(0);
    expect(r.scores[1] as number).toBeGreaterThan(0);
    expect(r.scores[2] as number).toBeGreaterThan(0);
    expect(() =>
      retrieval.retrieval(
        {
          query: { text: "zebra" },
          items: [
            { label: "a", text: "cat" },
            { label: "b", text: "dog" },
          ],
          theme: pack("signal"),
        },
        REGION,
      ),
    ).toThrow(/every score is 0/);
  });

  it("LOW. σ reaches the kind from the plan: `activation: relu` zeroes what a linear layer keeps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "decksmith-relu-"));
    try {
      const heat = async (activation: string) => {
        const lit = literalSchema.parse({
          kind: "message-passing",
          nodes: [
            { id: "a", label: "a", features: [1] },
            { id: "b", label: "b", features: [1] },
          ],
          edges: [{ from: "a", to: "b" }],
          layers: 1,
          aggregate: "sum",
          weights: [[[-1]]],
          activation,
          labels: lbl({ layer: "{l}", field: "{count}" }),
        });
        const L = await KINDS["message-passing"].layers({
          beatId: activation,
          dir,
          region: REGION,
          spec: { labels: { layer: "{l}", field: "{count}" }, data: lit },
          earlier: new Map(),
          theme: pack("signal"),
        });
        const f = (L.data.frames as Frame[])[1] as Frame;
        return (f.prims.find((p) => p.id === "n0") as { heat?: number }).heat;
      };
      expect(await heat("none")).toBe(1);
      expect(await heat("relu")).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("LOW. the theme reaches the layout through `layers`: a Korean deck on folio does not overprint scores", async () => {
    const dir = await mkdtemp(join(tmpdir(), "decksmith-face-"));
    try {
      const theme = deckLook({ theme: "folio", lang: "ko" } as never).theme;
      const titles = [
        "3D Gaussian Splatting for Real-Time Radiance Field Rendering",
        "Mip-NeRF 360: Unbounded Anti-Aliased Neural Radiance Fields",
        "Instant Neural Graphics Primitives with a Multiresolution Hash Encoding",
      ];
      const lit = literalSchema.parse({
        kind: "retrieval",
        query: "radiance fields rendering",
        items: titles.map((t) => ({ label: t, text: t })),
        labels: lbl({ query: "q", score: "{method}", topk: "{k}", example: "예시" }),
      });
      const L = await KINDS.retrieval.layers({
        beatId: "face",
        dir,
        region: { width: 1700, height: 656 },
        spec: {
          labels: { query: "q", score: "{method}", topk: "{k}", example: "예시" },
          data: lit,
        },
        earlier: new Map(),
        theme,
      });
      const last = (L.data.frames as Frame[]).at(-1) as Frame;
      const w = (t: string, size: number) => widthOf(t, size, theme);
      for (let i = 0; i < titles.length; i++) {
        const label = last.prims.find((p) => p.id === `lb${i}`) as {
          x: number;
          text: string;
          size: number;
        };
        const score = last.prims.find((p) => p.id === `sc${i}`) as {
          x: number;
          text: string;
          size: number;
        };
        expect(label.x + w(label.text, label.size)).toBeLessThan(
          score.x - w(score.text, score.size),
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("LOW. curves-mode end labels are as wide as the values they print", () => {
    const region = { width: 1760, height: 860 };
    const latin: Measure = (t, size) => textWidth(t, size, 600);
    const r = optimization.optimization(
      {
        mode: "curves",
        series: [
          {
            label: "Ours",
            points: [
              [0, 123456.789],
              [10, 0.30000000000000004],
            ],
          },
          {
            label: "Baseline",
            points: [
              [0, -1.23456789],
              [10, 1.5e-7],
            ],
          },
        ],
        measure: latin,
      },
      region,
    );
    for (const f of r.frames)
      for (const p of f.prims)
        if (p.p === "text" && p.text && p.anchor === "start")
          expect(p.x + latin(p.text, p.size)).toBeLessThanOrEqual(region.width + 0.5);
  });

  it("LOW. the preview script draws through production code, with no raster path of its own", async () => {
    const { readFile } = await import("node:fs/promises");
    const script = await readFile(
      new URL("../scripts/literal-kinds-preview.ts", import.meta.url),
      "utf8",
    );
    expect(script).toMatch(/runJudgeCase/);
    expect(script).not.toMatch(/writeRaster|mapRgba|toRgba|nearest|upscale/);
  });
});
