/**
 * The mechanism kinds (src/literal/kinds/): the maths each one computes, that
 * the same input gives the same bytes, the cost bound per beat, and the type
 * floor. Pure: synthetic pictures, no ffmpeg, no browser.
 */
import { describe, expect, it } from "vitest";
import {
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
  MECHANISM_KINDS,
  messagePassing,
  optimization,
  retrieval,
  rlRollout,
  splatting,
} from "../src/literal/kinds/index.js";

const REGION: Region = { width: 1760, height: 920 };

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
  it("curves draw the given rows exactly, cut by straight interpolation", () => {
    expect(
      optimization.prefixAt(
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
      [15, 2.5],
    ]);
    const r = optimization.optimization(
      {
        mode: "curves",
        series: [
          {
            label: "A",
            points: [
              [0, 2],
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
      },
      REGION,
    );
    expect(r.vars).toMatchObject({
      best: "A",
      bestValue: "0.5",
      worst: "B",
      worstValue: "0.9",
      steps: 100,
    });
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
    for (const k of MECHANISM_KIND_NAMES)
      expect(MECHANISM_KINDS[k].takeaway.length).toBeGreaterThan(20);
  });
  for (const [kind, make] of CASES) {
    it(`${kind}: same input, same bytes; under 2 s and 200 MB; no text under 40 px; only declared slots`, () => {
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
      const slots = MECHANISM_KINDS[kind as keyof typeof MECHANISM_KINDS].slots;
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
