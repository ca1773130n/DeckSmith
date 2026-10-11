/**
 * The op library (src/literal/ops.ts) and the formula grammar
 * (src/literal/formula.ts), each op against a hand-computed array, on data from
 * several domains (a picture, a pair of distributions, a score matrix, a
 * signal): none of them knows what a paper is.
 */
import { describe, expect, it } from "vitest";
import {
  checkPasses,
  evaluate,
  evaluateIv,
  normalizeExpr,
  parseFormula,
  printed,
  variablesOf,
} from "../src/literal/formula.js";
import {
  alphaBars,
  degrade,
  fromRows,
  fromVector,
  type OpStep,
  runChain,
  runOp,
  type Tensor,
  tensor,
} from "../src/literal/ops.js";

const step = (op: OpStep["op"], rest: Partial<OpStep> = {}): OpStep => ({
  op,
  params: {},
  ...rest,
});
const rows = (t: Tensor) =>
  Array.from({ length: t.h }, (_, y) => Array.from(t.d.slice(y * t.w * t.c, (y + 1) * t.w * t.c)));
const close = (a: ArrayLike<number>, b: ArrayLike<number>, d = 6) => {
  Array.from(a).forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] as number, d);
  });
};

describe("ops on pictures and maps", () => {
  it("channels: mean, min, max and Rec. 709 luma of an RGB pixel", () => {
    const px = tensor(1, 1, 3, [0.2, 0.6, 1]);
    expect(runOp(step("channels", { how: "mean" }), [px]).d[0]).toBeCloseTo(0.6);
    expect(runOp(step("channels", { how: "min" }), [px]).d[0]).toBeCloseTo(0.2);
    expect(runOp(step("channels", { how: "max" }), [px]).d[0]).toBeCloseTo(1);
    expect(runOp(step("channels", { how: "luma" }), [px]).d[0]).toBeCloseTo(
      0.2126 * 0.2 + 0.7152 * 0.6 + 0.0722,
    );
  });

  it("conv sobel-x on a horizontal ramp is 8 per column step inside, 4 at a replicated edge", () => {
    const ramp = fromRows(Array.from({ length: 5 }, () => [0, 1, 2, 3, 4]));
    const gx = runOp(step("conv", { how: "sobel-x" }), [ramp]);
    expect(rows(gx)[2]).toEqual([4, 8, 8, 8, 4]);
    const gy = runOp(step("conv", { how: "sobel-y" }), [ramp]);
    expect(Array.from(gy.d).every((v) => v === 0)).toBe(true);
  });

  it("conv box keeps a flat field flat; gaussian sums to one; stated weights are applied as written", () => {
    const flat = fromRows([
      [3, 3, 3],
      [3, 3, 3],
    ]);
    close(runOp(step("conv", { how: "box", params: { size: 3 } }), [flat]).d, [3, 3, 3, 3, 3, 3]);
    const impulse = fromVector([0, 0, 0, 1, 0, 0, 0]);
    const g = runOp(step("conv", { how: "gaussian", params: { sigma: 1 } }), [impulse]);
    expect(Array.from(g.d).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    const w = runOp(step("conv", { how: "weights", weights: [[1, -1]] }), [fromVector([1, 4, 9])]);
    expect(Array.from(w.d)).toEqual([0, -3, -5]);
  });

  it("conv refuses a 2-D named kernel on a vector, and a kernel it is not told", () => {
    expect(() => runOp(step("conv", { how: "sobel-x" }), [fromVector([1, 2, 3])])).toThrow(/2-D/);
    expect(() => runOp(step("conv"), [fromVector([1, 2, 3])])).toThrow(/how/);
  });

  it("reduce: a 3×3 sliding minimum, and a 2×2 pooled maximum", () => {
    const m = fromRows([
      [5, 1, 7, 8],
      [4, 6, 2, 9],
      [3, 8, 6, 0],
      [7, 5, 4, 2],
    ]);
    expect(rows(runOp(step("reduce", { how: "min", params: { window: 3 } }), [m]))[1]).toEqual([
      1, 1, 0, 0,
    ]);
    expect(
      rows(runOp(step("reduce", { how: "max", params: { window: 2, stride: 2 } }), [m])),
    ).toEqual([
      [6, 9],
      [8, 6],
    ]);
    expect(() =>
      runOp(step("reduce", { how: "max", params: { window: 2, stride: 3 } }), [m]),
    ).toThrow(/stride/);
  });

  it("combine |gx| + |gy|, the structure-map shape, over two earlier outputs by index", () => {
    const pic = fromRows(Array.from({ length: 4 }, (_, y) => [0, y, 2 * y, 3 * y]));
    const list = runChain(
      [pic],
      [
        step("conv", { how: "sobel-x" }),
        step("conv", { how: "sobel-y", of: [0] }),
        step("combine", { how: "abs-sum", of: [1, 2] }),
      ],
    );
    // sobel-y read the input, not the previous output: `of` names it.
    expect(list).toHaveLength(4);
    const want = Array.from(list[1]?.d ?? []).map(
      (v, i) => Math.abs(v) + Math.abs((list[2] as Tensor).d[i] as number),
    );
    close(list[3]?.d ?? [], want);
  });

  it("normalise by the spatial mean makes the mean one; by range spans [0, 1]", () => {
    const m = fromRows([
      [1, 2],
      [3, 6],
    ]);
    const byMean = runOp(step("normalise", { how: "mean" }), [m]);
    expect(Array.from(byMean.d).reduce((a, b) => a + b, 0) / 4).toBeCloseTo(1);
    close(runOp(step("normalise", { how: "range" }), [m]).d, [0, 0.2, 0.4, 1]);
    expect(() => runOp(step("normalise", { how: "mean" }), [fromVector([0, 0])])).toThrow(/zero/);
  });

  it("threshold: a stated θ, and θ = scale × each channel's variance", () => {
    const v = fromVector([0.1, 0.5, 0.9]);
    expect(Array.from(runOp(step("threshold", { params: { theta: 0.5 } }), [v]).d)).toEqual([
      0, 1, 1,
    ]);
    close(runOp(step("threshold", { how: "keep", params: { theta: 0.5 } }), [v]).d, [0, 0.5, 0.9]);
    // Two channels, very different spread: each gets its own θ.
    const two = tensor(1, 4, 2, [0, 0, 1, 10, 0, 0, 1, 10]);
    const out = runOp(step("threshold", { params: { scale: 2 }, stat: "var", over: "channel" }), [
      two,
    ]);
    // channel 0 values 0,1,0,1: var 0.25, θ 0.5 → fires at 1. channel 1: 0,10,0,10: var 25, θ 50 → never.
    expect(Array.from(out.d)).toEqual([0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("quantize: clip(floor(x/step), 0, D)/D, and refuses an unstated rounding", () => {
    const v = fromVector([0.1, 0.6, 1.3, 2.7, 9]);
    close(
      runOp(step("quantize", { how: "floor", params: { levels: 4, step: 0.5 } }), [v]).d,
      [0, 0.25, 0.5, 1, 1],
    );
    close(
      runOp(step("quantize", { how: "round", params: { levels: 4, step: 0.5 } }), [v]).d,
      [0, 0.25, 0.75, 1, 1],
    );
    expect(() => runOp(step("quantize", { params: { levels: 4, step: 0.5 } }), [v])).toThrow(
      /floor or round/,
    );
  });
});

describe("ops on distributions, matrices and signals", () => {
  const p = fromVector([0.1, 0.4, 0.3, 0.2]);
  const q = fromVector([0.3, 0.3, 0.1, 0.3]);

  it("min(p, q), then max(0, p − q) normalised: the residual sums to one", () => {
    const list = runChain(
      [p, q],
      [
        step("combine", { how: "min", of: [0, 1] }),
        step("combine", { how: "posdiff", of: [0, 1] }),
        step("normalise", { how: "sum" }),
      ],
    );
    close(list[2]?.d ?? [], [0.1, 0.3, 0.1, 0.2]);
    expect(Array.from(list[4]?.d ?? []).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // min(p,q) + (p − q)⁺ = p, exactly.
    close(
      Array.from(list[2]?.d ?? []).map((v, i) => v + ((list[3] as Tensor).d[i] as number)),
      p.d,
    );
  });

  it("matmul of a score matrix, softmax per row: attention weights sum to one per query", () => {
    const Q = fromRows([
      [1, 0],
      [0, 1],
    ]);
    const Kt = fromRows([
      [1, 0, 1],
      [0, 1, 1],
    ]);
    const list = runChain(
      [Q, Kt],
      [step("matmul", { of: [0, 1] }), step("normalise", { how: "softmax", over: "row" })],
    );
    expect(rows(list[2] as Tensor)).toEqual([
      [1, 0, 1],
      [0, 1, 1],
    ]);
    for (const r of rows(list[3] as Tensor)) expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("matmul by stated weights: a low-rank product W + BA has the base's shape", () => {
    const B = fromRows([[1], [2]]);
    const out = runOp(step("matmul", { weights: [[3, 4]] }), [B]);
    expect(rows(out)).toEqual([
      [3, 4],
      [6, 8],
    ]);
    expect(() => runOp(step("matmul", { weights: [[1, 2, 3]] }), [fromRows([[1, 2]])])).toThrow(
      /does not fit/,
    );
  });

  it("select: a router's top-2, argmax, sort and a running sum (nucleus mass)", () => {
    const logits = fromVector([0.2, 0.9, 0.1, 0.7]);
    expect(
      Array.from(runOp(step("select", { how: "topk", params: { k: 2 } }), [logits]).d),
    ).toEqual(Array.from(fromVector([0, 0.9, 0, 0.7]).d));
    expect(Array.from(runOp(step("select", { how: "argmax" }), [logits]).d)).toEqual([0, 1, 0, 0]);
    close(runOp(step("select", { how: "sort" }), [logits]).d, [0.9, 0.7, 0.2, 0.1]);
    close(runOp(step("select", { how: "cumsum" }), [fromVector([0.5, 0.3, 0.2])]).d, [0.5, 0.8, 1]);
  });

  it("transform fft: a sampled sine has its peak at its own frequency", () => {
    const n = 32;
    const sine = fromVector(
      Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 4 * i) / n)),
    );
    const spec = runOp(step("transform", { how: "fft" }), [sine]);
    expect(spec.w).toBe(n / 2 + 1);
    const peak = Array.from(spec.d).indexOf(Math.max(...spec.d));
    expect(peak).toBe(4);
    expect(spec.d[4]).toBeCloseTo(n / 2, 3);
  });

  it("formula: an elementwise expression over the previous output and named params", () => {
    const out = runOp(step("formula", { expr: "clip(a*x + b, 0, 1)", params: { a: 2, b: -0.5 } }), [
      fromVector([0, 0.5, 1]),
    ]);
    close(out.d, [0, 0.5, 1]);
  });

  it("degrade is an example and deterministic: contrast keeps the mean, noise repeats itself", () => {
    const v = fromVector([0, 1, 2, 3]);
    const c = degrade(v, "contrast", 0.5);
    close(c.d, [0.75, 1.25, 1.75, 2.25]);
    expect(Array.from(degrade(v, "noise", 0.1).d)).toEqual(Array.from(degrade(v, "noise", 0.1).d));
  });

  it("alphaBars: linear β from the stated endpoints, cosine from T alone; refuses an unstated linear", () => {
    const a = alphaBars("linear", 3, 0.1, 0.3);
    close(a, [0.9, 0.9 * 0.8, 0.9 * 0.8 * 0.7]);
    expect(alphaBars("cosine", 10)[9]).toBeLessThan(0.01);
    expect(() => alphaBars("linear", 10)).toThrow(/stated/);
  });
});

describe("the formula grammar", () => {
  it("parses precedence, unary minus, Greek names and functions", () => {
    const ast = parseFormula("(1 − α^(γ+1)) / (1 − α)");
    expect(variablesOf(ast).sort()).toEqual(["α", "γ"]);
    expect(evaluate(ast, { α: 0.6, γ: 2 })).toBeCloseTo(1.96);
    expect(evaluate(parseFormula("-x^2"), { x: 3 })).toBe(-9);
    expect(evaluate(parseFormula("max(0, p - q)"), { p: 0.2, q: 0.5 })).toBe(0);
    expect(() => parseFormula("foo(1)")).toThrow(/not a function/);
    expect(() => parseFormula("1 +")).toThrow();
    expect(normalizeExpr("\\alpha \\cdot x")).toBe("α*x");
  });

  it("a printed number is an interval: decimals carry half a unit, input integers are exact", () => {
    close(printed("0.6") ?? [], [0.55, 0.65], 12);
    expect(printed("2", true)).toEqual([2, 2]);
    expect(printed("2")).toEqual([1.5, 2.5]);
    expect(printed("1.96X")).toBeUndefined();
  });

  it("interval evaluation holds every value over the box", () => {
    const iv = evaluateIv(parseFormula("(1 - a^3) / (1 - a)"), { a: [0.55, 0.65] });
    expect(iv[0]).toBeLessThanOrEqual(1 + 0.55 + 0.55 ** 2);
    expect(iv[1]).toBeGreaterThanOrEqual(1 + 0.65 + 0.65 ** 2);
  });

  it("a check passes for the right formula at printed precision, and fails for a wrong exponent", () => {
    const right = parseFormula("(1 - α^(γ+1)) / (1 - α)");
    const wrong = parseFormula("(1 - α^γ) / (1 - α)");
    const row = {
      inputs: [
        { name: "α", value: "0.8" },
        { name: "γ", value: "5" },
      ],
      output: "3.69",
    };
    expect(checkPasses(right, row)).toEqual({ ok: true });
    // One row at printed precision cannot always tell them apart (α is 0.75…0.85 here),
    // which is why the gate holds a curve to every row of its table; this row can.
    expect(checkPasses(wrong, row).ok).toBe(true);
    const tight = {
      inputs: [
        { name: "α", value: "0.6" },
        { name: "γ", value: "2" },
      ],
      output: "1.96",
    };
    expect(checkPasses(right, tight).ok).toBe(true);
    expect(checkPasses(wrong, tight).ok).toBe(false);
    expect(
      checkPasses(right, { inputs: [{ name: "α", value: "0.8" }], output: "3.69" }),
    ).toMatchObject({ ok: false, why: /no value for γ/ });
  });

  it("an enclosure that cannot be bounded never reaches an output", () => {
    // α − 0.6 crosses zero over α's printed box [0.55, 0.65]: unbounded pieces would
    // "reach" any number. A piece far from zero still gives a bound, and it misses.
    const wrong = parseFormula("x / (α - 0.6)");
    const row = (out: string) => ({
      inputs: [
        { name: "α", value: "0.6" },
        { name: "x", value: "3" },
      ],
      output: out,
    });
    expect(checkPasses(wrong, row("0.001")).ok).toBe(false);
    // Nothing bounded at all: refused with the reason.
    expect(
      checkPasses(parseFormula("1 / (x - x)"), {
        inputs: [{ name: "x", value: "3" }],
        output: "7",
      }),
    ).toMatchObject({ ok: false, why: /cannot be bounded/ });
  });

  it("a rounded input does not fail a correct formula (the walltime rows that miss at printed precision)", () => {
    const thm = parseFormula("(1 - α^(γ+1)) / ((1 - α) * (γ*c + 1))");
    for (const [g, a, c, out] of [
      ["5", "0.68", "0.04", "2.4"],
      ["3", "0.71", "0.11", "2.0"],
      ["3", "0.56", "0.11", "1.6"],
    ] as const)
      expect(
        checkPasses(thm, {
          inputs: [
            { name: "γ", value: g },
            { name: "α", value: a },
            { name: "c", value: c },
          ],
          output: out,
        }).ok,
      ).toBe(true);
  });
});
