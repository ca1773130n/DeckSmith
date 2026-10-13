/**
 * The literal VERBS (src/literal/kinds/{operate,evolve,flow,place,region}.ts)
 * on fixtures from many unrelated domains: every op, variant, rule and form is
 * run for real on the stage, and held to the deck's invariants (fromTo only,
 * scoped, no clock, type ≥ 40px), to motion (never more than STILL_MAX seconds
 * without a tween while narrated), and to a fill floor per form. The registry
 * also holds the generality rule: every op variant, rule and form has fixtures
 * from at least two unrelated domains, or it does not belong in the library.
 * And src/literal names no paper. Synthetic material; no ffmpeg, no browser.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import { drawProblems } from "../src/literal/check.js";
import { namedIn, subjectOf, widthOf } from "../src/literal/kind.js";
import type { Prim } from "../src/literal/kinds/common.js";
import { evolve } from "../src/literal/kinds/evolve.js";
import { flow, tokenChips } from "../src/literal/kinds/flow.js";
import { operate } from "../src/literal/kinds/operate.js";
import { placeForm, placeLabel, points, segBoxes, ticksOf } from "../src/literal/kinds/place.js";
import { findPanels, region } from "../src/literal/kinds/region.js";
import {
  boxOf,
  type Earlier,
  frameFill,
  placeholderPicture,
  runVerb,
  stagedFragment,
  type VerbRun,
} from "../src/literal/kinds/stage.js";
import { tableKind } from "../src/literal/kinds/table.js";
import { type Cue, stillSpans } from "../src/literal/kit.js";
import { tensor } from "../src/literal/ops.js";
import {
  LITERAL_KIND_DOCS,
  LITERAL_OPS,
  type Literal,
  type LiteralOpDoc,
  literalSchema,
} from "../src/types.js";
import { CONTENT_AREA_MIN } from "../src/verify/fill.js";

const theme: Theme = {
  bg: "#14110d",
  fg: "#f2eadc",
  muted: "#a89f90",
  dim: "#6b6458",
  rule: "#3a342b",
  panel: "#1d1913",
  accent: "#e8a33d",
  tones: { a: "#e8a33d", b: "#8fc1e8", c: "#e88fa3", d: "#a3e88f" },
  fontStack: "Inter, sans-serif",
};
const region_ = { width: 1700, height: 747 };
const STILL_MAX = 4;
const measure = (t: string, s: number) => widthOf(t, s, theme);

/* ------------------------------------------------------------- fixtures */

type P = Record<string, string>;
const params = (p: P = {}) => Object.entries(p).map(([name, value]) => ({ name, value }));
const op = (o: string, how?: string, p: P = {}, extra: Record<string, unknown> = {}) => ({
  op: o,
  ...(how ? { how } : {}),
  params: params(p),
  label: `${o}${how ? ` ${how}` : ""}`,
  ...extra,
});
const L = (slots: P) => Object.entries(slots).map(([slot, text]) => ({ slot, text }));
const pic = {
  input: "the picture",
  output: "the result",
  example: "example",
  caption: "the stated operations on an example image",
};
const vec = (n: number, f: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => Math.round(f(i) * 1000) / 1000);
const mat = (h: number, w: number, f: (r: number, c: number) => number) =>
  Array.from({ length: h }, (_, r) => vec(w, (c) => f(r, c)));

interface Fixture {
  name: string;
  domain: string;
  lit: Record<string, unknown>;
}

const FIXTURES: Fixture[] = [
  /* operate on pictures */
  {
    name: "edge-enhanced lesion map",
    domain: "medical-imaging",
    lit: {
      kind: "operate",
      picture: "b1",
      chain: [
        op("channels", "luma"),
        op("conv", "gaussian", { sigma: "1.5" }),
        op("conv", "laplacian"),
        op("threshold", "keep", { theta: "0.02" }),
        op("normalise", "range"),
      ],
      compare: "params",
      alt: { step: 4, how: "binary", params: params({ theta: "0.02" }) },
      labels: L({ ...pic, alt: "binary instead" }),
    },
  },
  {
    name: "star detection",
    domain: "astronomy",
    lit: {
      kind: "operate",
      picture: "b1",
      condition: { how: "noise", amount: 0.03 },
      chain: [
        op("channels", "max"),
        op("reduce", "max", { window: "3" }),
        op("conv", "box", { size: "3" }),
        op("threshold", "binary", { scale: "2" }, { stat: "std" }),
        op("combine", "product", {}, { of: [3, 4] }),
        op("normalise", "max"),
      ],
      labels: L({ ...pic, condition: "with sensor noise" }),
    },
  },
  {
    name: "structure map under a degradation",
    domain: "remote-sensing",
    lit: {
      kind: "operate",
      picture: "b1",
      condition: { how: "contrast", amount: 0.6 },
      compare: "condition",
      chain: [
        op("channels", "mean"),
        op("conv", "sobel-x"),
        op("conv", "sobel-y", {}, { of: [1] }),
        op("combine", "abs-sum", {}, { of: [2, 3] }),
        op("normalise", "mean"),
      ],
      labels: L({ ...pic, condition: "lower contrast" }),
    },
  },
  {
    name: "page binarisation",
    domain: "document-ocr",
    lit: {
      kind: "operate",
      picture: "b1",
      chain: [
        op("channels", "min"),
        op("reduce", "min", { window: "5" }),
        op("conv", "prewitt-x"),
        op("conv", "prewitt-y", {}, { of: [2] }),
        op("combine", "magnitude", {}, { of: [3, 4] }),
        op("quantize", "floor", { levels: "4", step: "0.25" }),
      ],
      compare: "params",
      alt: { step: 6, how: "round", params: params({ levels: "4", step: "0.25" }) },
      labels: L({ ...pic, alt: "rounded" }),
    },
  },
  {
    name: "background subtraction",
    domain: "microscopy",
    lit: {
      kind: "operate",
      picture: "b1",
      condition: { how: "noise", amount: 0.05 },
      chain: [
        op("channels", "luma"),
        op("reduce", "mean", { window: "3" }),
        op("combine", "diff", {}, { of: [1, 2] }),
        op("formula", undefined, {}, { expr: "x * x" }),
        op("normalise", "std"),
      ],
      labels: L({ ...pic, condition: "with noise" }),
    },
  },
  {
    name: "crop vigour",
    domain: "agriculture",
    lit: {
      kind: "operate",
      picture: "b1",
      condition: { how: "blur", amount: 2 },
      chain: [
        op("channels", "mean"),
        op("conv", "gaussian", { sigma: "1" }),
        op("conv", "laplacian"),
        op("combine", "min", {}, { of: [2, 3] }),
        op("combine", "max", {}, { of: [2, 3] }),
        op("normalise", "sum"),
      ],
      labels: L({ ...pic, condition: "blurred" }),
    },
  },
  {
    name: "hot spots",
    domain: "thermal-imaging",
    lit: {
      kind: "operate",
      picture: "b1",
      condition: { how: "contrast", amount: 0.4 },
      chain: [op("channels", "max"), op("normalise", "range")],
      labels: L({ ...pic, condition: "low contrast" }),
    },
  },
  {
    name: "shadow floor",
    domain: "underwater-imaging",
    lit: {
      kind: "operate",
      picture: "b1",
      condition: { how: "blur", amount: 2 },
      compare: "condition",
      chain: [op("channels", "min"), op("reduce", "min", { window: "3" }), op("normalise", "max")],
      labels: L({ ...pic, condition: "blurred" }),
    },
  },
  /* operate on matrices */
  {
    name: "onsets on a spectrogram",
    domain: "audio",
    lit: {
      kind: "operate",
      matrix: mat(6, 10, (r, c) => (c > 4 ? 1 : 0) * (r + 1)),
      chain: [
        op("conv", "sobel-x"),
        op("conv", "sobel-y", {}, { of: [0] }),
        op("combine", "sum", {}, { of: [1, 2] }),
        op("threshold", "binary", { theta: "2" }),
        op("select", "cumsum", {}, { over: "row" }),
      ],
      labels: L({ input: "spectrogram", output: "onsets", example: "example" }),
    },
  },
  {
    name: "attention weights",
    domain: "language-models",
    lit: {
      kind: "operate",
      matrix: mat(4, 3, (r, c) => ((r + c) % 3) / 2),
      chain: [
        op("matmul", undefined, {}, { weights: mat(3, 4, (r, c) => (r === c % 3 ? 1 : 0)) }),
        op("normalise", "softmax", {}, { over: "row" }),
        op("select", "topk", { k: "2" }, { over: "row" }),
        op("select", "argmax", {}, { over: "row" }),
      ],
      labels: L({ input: "queries", output: "weights", example: "example" }),
    },
  },
  {
    name: "latency heat",
    domain: "distributed-systems",
    lit: {
      kind: "operate",
      matrix: mat(5, 6, (r, c) => r * c),
      chain: [
        op("conv", "prewitt-x"),
        op("conv", "prewitt-y", {}, { of: [0] }),
        op("combine", "magnitude", {}, { of: [1, 2] }),
        op("normalise", "range"),
        op("quantize", "round", { levels: "4", step: "0.25" }),
        op("select", "sort", {}, { over: "row" }),
      ],
      labels: L({ input: "latencies", output: "levels", example: "example" }),
    },
  },
  {
    name: "correlation pruning",
    domain: "finance",
    lit: {
      kind: "operate",
      matrix: mat(4, 4, (r, c) => (r === c ? 1 : 0.3)),
      chain: [
        op("matmul", undefined, {}, { weights: mat(4, 4, (r, c) => (r === c ? 1 : 0.1)) }),
        op("normalise", "max"),
        op("threshold", "keep", { theta: "0.5" }),
        op("select", "argmax", {}, { over: "all" }),
        op("formula", undefined, {}, { expr: "1 - x" }),
      ],
      labels: L({ input: "correlations", output: "kept", example: "example" }),
    },
  },
  {
    name: "weight quantisation",
    domain: "language-models",
    lit: {
      kind: "operate",
      matrix: mat(4, 4, (r, c) => (r + c) / 6),
      chain: [op("quantize", "floor", { levels: "8", step: "0.125" })],
      labels: L({ input: "weights", output: "quantised", example: "example" }),
    },
  },
  /* operate on vectors */
  {
    name: "accepted mass",
    domain: "language-models",
    lit: {
      kind: "operate",
      vectors: [
        { label: "p", values: [0.1, 0.4, 0.3, 0.2] },
        { label: "q", values: [0.3, 0.3, 0.1, 0.3] },
      ],
      bins: ["a", "b", "c", "d"],
      chain: [
        op("combine", "min", {}, { of: [0, 1] }),
        op("combine", "posdiff", {}, { of: [0, 1] }),
        op("normalise", "sum"),
      ],
      labels: L({ input: "two distributions", output: "the residual", example: "example" }),
    },
  },
  {
    name: "momentum signal",
    domain: "finance",
    lit: {
      kind: "operate",
      vectors: [{ label: "price", values: vec(12, (i) => 10 + Math.sin(i / 2) * 2 + i * 0.2) }],
      bins: vec(12, (i) => i + 1).map(String),
      chain: [
        op("conv", "weights", {}, { weights: [[0.25, 0.5, 0.25]] }),
        op("combine", "diff", {}, { of: [0, 1] }),
        op("combine", "posdiff", {}, { of: [0, 1] }),
        op("combine", "product", {}, { of: [3, 3] }),
        op("combine", "sum", {}, { of: [3, 4] }),
        op("select", "cumsum"),
      ],
      labels: L({ input: "prices", output: "gains", example: "example" }),
    },
  },
  {
    name: "coverage peaks",
    domain: "genomics",
    lit: {
      kind: "operate",
      vectors: [{ label: "reads", values: vec(16, (i) => 5 + 4 * Math.exp(-((i - 7) ** 2) / 4)) }],
      bins: vec(16, (i) => i).map(String),
      chain: [
        op("conv", "box", { size: "3" }),
        op("normalise", "std"),
        op("combine", "abs-sum", {}, { of: [0, 1] }),
        op("combine", "max", {}, { of: [0, 1] }),
        op("reduce", "max", { window: "3" }),
        op("select", "topk", { k: "3" }),
      ],
      labels: L({ input: "coverage", output: "peaks", example: "example" }),
    },
  },
  {
    name: "tremor spectrum",
    domain: "seismology",
    lit: {
      kind: "operate",
      vectors: [
        { label: "ground motion", values: vec(16, (i) => Math.sin((2 * Math.PI * 3 * i) / 16)) },
      ],
      bins: vec(16, (i) => i).map(String),
      chain: [
        op("transform", "fft"),
        op("normalise", "mean"),
        op("reduce", "mean", { window: "3" }),
        op("conv", "weights", {}, { weights: [[1, -1]] }),
        op("normalise", "softmax"),
      ],
      labels: L({ input: "signal", output: "spectrum", example: "example" }),
    },
  },
  {
    name: "pitch floor",
    domain: "audio",
    lit: {
      kind: "operate",
      vectors: [{ label: "frame", values: vec(16, (i) => Math.cos((2 * Math.PI * 2 * i) / 16)) }],
      bins: vec(16, (i) => i).map(String),
      chain: [op("transform", "fft"), op("reduce", "min", { window: "3" }), op("select", "sort")],
      labels: L({ input: "a frame", output: "floor", example: "example" }),
    },
  },
  {
    name: "tokens one verification yields",
    domain: "language-models",
    lit: {
      kind: "operate",
      equation: String.raw`E(\#\ tokens)=\frac{1-\alpha^{\gamma+1}}{1-\alpha}`,
      given: [
        { name: "alpha", symbol: "α", value: "0.8", what: "acceptance rate" },
        { name: "gamma", symbol: "γ", value: "5", what: "drafts per call" },
      ],
      terms: { term: "α^k", from: 0, to: "gamma", between: "×α", combine: "sum", reported: "3.69" },
      labels: L({
        cell: "token {n}",
        cells: "a cell: the chance that token appears",
        match: "Table 1: 3.69×",
      }),
    },
  },
  {
    name: "an annuity's present value",
    domain: "finance",
    lit: {
      kind: "operate",
      equation: String.raw`PV=\sum_{k=1}^{n}\frac{1}{(1+r)^k}`,
      given: [
        { name: "r", value: "0.05", what: "rate a year" },
        { name: "n", value: "5", what: "years" },
      ],
      terms: {
        term: "1/(1+r)^k",
        from: 1,
        to: "n",
        between: "÷1.05",
        combine: "sum",
        reported: "4.33",
      },
      labels: L({ cell: "year {n}", match: "the table's 4.33" }),
    },
  },
  /* evolve */
  {
    name: "calibrated threshold, frozen",
    domain: "neuromorphic",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "ema",
      params: params({ a: "0.9", scale: "0.6" }),
      input: { from: "b2", stat: "var" },
      phases: [
        { from: 0, label: "train", freeze: false },
        { from: 5, label: "test", freeze: true },
      ],
      labels: L({
        state: "crops",
        trace: "running variance",
        threshold: "threshold",
        example: "example",
      }),
    },
  },
  {
    name: "price average",
    domain: "finance",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "ema",
      params: params({ a: "0.8" }),
      input: { values: ["10", "12", "11", "15", "14", "13", "16"].map((value) => ({ value })) },
      labels: L({ state: "prices", trace: "average" }),
    },
  },
  {
    name: "integrate and fire",
    domain: "neuroscience",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "leaky",
      params: params({ a: "0.5", theta: "1" }),
      reset: "soft",
      input: { values: ["0.6", "0.6", "0.6", "0.6", "0.6", "0.6"].map((value) => ({ value })) },
      labels: L({ state: "input", trace: "potential", threshold: "threshold" }),
    },
  },
  {
    name: "integrator wind-up",
    domain: "control",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "leaky",
      params: params({ a: "0.95", theta: "2" }),
      reset: "hard",
      input: {
        values: ["0.5", "0.7", "0.4", "0.9", "0.3", "0.8", "0.6"].map((value) => ({ value })),
      },
      labels: L({ state: "error", trace: "integral", threshold: "limit" }),
    },
  },
  {
    name: "sigma-delta modulator",
    domain: "electronics",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "leaky",
      params: params({ a: "1", theta: "1" }),
      reset: "soft",
      input: {
        values: ["0.3", "0.3", "0.3", "0.3", "0.3", "0.3", "0.3", "0.3"].map((value) => ({
          value,
        })),
      },
      labels: L({ state: "input", trace: "accumulator", threshold: "one bit" }),
    },
  },
  {
    name: "reorder point",
    domain: "operations-research",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "leaky",
      params: params({ a: "1", theta: "10" }),
      reset: "hard",
      input: { values: ["3", "4", "2", "5", "3", "4"].map((value) => ({ value })) },
      labels: L({ state: "demand", trace: "since last order", threshold: "reorder" }),
    },
  },
  {
    name: "autoregression",
    domain: "economics",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "linear",
      params: params({ a: "0.7", b: "0.3" }),
      input: { values: ["1", "0", "2", "1", "3"].map((value) => ({ value })) },
      labels: L({ state: "shocks", trace: "output" }),
    },
  },
  {
    name: "value trace",
    domain: "reinforcement-learning",
    lit: {
      kind: "evolve",
      rule: "recur",
      how: "linear",
      params: params({ a: "0.9", b: "0.1" }),
      input: { values: ["0", "1", "0", "0", "1", "1"].map((value) => ({ value })) },
      labels: L({ state: "rewards", trace: "trace" }),
    },
  },
  {
    name: "forward noising",
    domain: "image-generation",
    lit: {
      kind: "evolve",
      rule: "noise",
      picture: "b1",
      schedule: "linear",
      params: params({ T: "1000", betaStart: "0.0001", betaEnd: "0.02" }),
      labels: L({ trace: "signal", noise: "noise", example: "example" }),
    },
  },
  {
    name: "cosine noising",
    domain: "medical-imaging",
    lit: {
      kind: "evolve",
      rule: "noise",
      picture: "b1",
      schedule: "cosine",
      params: params({ T: "200" }),
      labels: L({ trace: "signal", noise: "noise", example: "example" }),
    },
  },
  {
    name: "logistic growth",
    domain: "epidemiology",
    lit: {
      kind: "evolve",
      rule: "formula",
      expr: "s + r * s * (1 - s) + x",
      params: params({ r: "0.5" }),
      input: { values: ["0.01", "0", "0", "0", "0", "0", "0"].map((value) => ({ value })) },
      labels: L({ state: "imports", trace: "share infected" }),
    },
  },
  {
    name: "heavy-ball",
    domain: "optimisation",
    lit: {
      kind: "evolve",
      rule: "formula",
      expr: "β * s + x",
      params: params({ β: "0.9" }),
      input: { values: ["1", "0.5", "0.25", "0.125"].map((value) => ({ value })) },
      labels: L({ state: "gradients", trace: "velocity" }),
    },
  },
  {
    name: "a draft model's tokens, checked by the target",
    domain: "language-models",
    lit: {
      kind: "evolve",
      rule: "trace",
      tags: [
        { tag: "ok", label: "accepted draft", tone: "d" },
        { tag: "no", label: "rejected draft", tone: "c", strike: true },
        { tag: "fix", label: "target's correction", tone: "a" },
      ],
      steps: [
        {
          lead: "[START]",
          parts: [
            { text: "the market", tag: "ok" },
            { text: "fell", tag: "no" },
            { text: "rose", tag: "fix" },
          ],
        },
        {
          lead: "… market rose",
          parts: [
            { text: "2 . 5", tag: "ok" },
            { text: "points", tag: "fix" },
          ],
        },
        {
          lead: "… 2 . 5 points",
          parts: [
            { text: "in", tag: "ok" },
            { text: "the", tag: "no" },
            { text: "late", tag: "fix" },
          ],
        },
      ],
      note: ["draft: a small model", "check: the large model"],
      labels: [],
    },
  },
  {
    name: "a proof's steps, each justified",
    domain: "mathematics",
    lit: {
      kind: "evolve",
      rule: "trace",
      tags: [
        { tag: "e", label: "the expression", tone: "b" },
        { tag: "why", label: "by", tone: "a" },
      ],
      steps: [
        {
          parts: [
            { text: "(a + b)²", tag: "e" },
            { text: "definition", tag: "why" },
          ],
        },
        {
          parts: [
            { text: "a² + 2ab + b²", tag: "e" },
            { text: "distributivity", tag: "why" },
          ],
        },
        {
          parts: [
            { text: "≥ 4ab", tag: "e" },
            { text: "(a − b)² ≥ 0", tag: "why" },
          ],
        },
      ],
      labels: [],
    },
  },
  /* flow */
  {
    name: "encoder–decoder",
    domain: "computer-vision",
    lit: {
      kind: "flow",
      form: "chain",
      stages: [
        { id: "in", label: "input", learned: false, figure: "fig2" },
        { id: "enc", label: "encoder", learned: true, shape: "256×256" },
        { id: "dec", label: "decoder", learned: true },
        { id: "out", label: "output", learned: false, show: "b1" },
      ],
      edges: [
        { from: "in", to: "enc" },
        { from: "enc", to: "dec" },
        { from: "dec", to: "out" },
        { from: "in", to: "out" },
      ],
      labels: L({ example: "example" }),
    },
  },
  {
    name: "retrieval pipeline",
    domain: "language-models",
    lit: {
      kind: "flow",
      form: "chain",
      phases: true,
      stages: [
        { id: "q", label: "query", learned: false },
        { id: "p", label: "retrieved passages", learned: false },
        {
          id: "gen",
          label: "generator",
          learned: true,
          tokens: [
            { label: "q", count: { value: "1" } },
            { label: "p", count: { value: "4" }, name: "passages" },
            { label: "a" },
          ],
        },
        {
          id: "aux",
          label: "auxiliary decoder",
          learned: true,
          phase: "train",
          quote: "the passage that holds the answer",
        },
        { id: "ans", label: "answer", learned: false },
      ],
      edges: [
        { from: "q", to: "gen" },
        { from: "p", to: "gen" },
        { from: "gen", to: "aux", via: "p" },
        { from: "gen", to: "ans", via: "a" },
      ],
      labels: L({ train: "training only" }),
    },
  },
  {
    name: "latent planner",
    domain: "autonomous-driving",
    lit: {
      kind: "flow",
      form: "chain",
      stages: [
        { id: "cam", label: "current frame", learned: false, figure: "fig3" },
        { id: "nav", label: "route command", learned: false },
        { id: "ego", label: "speed · acceleration", learned: false },
        { id: "hist", label: "past trajectory", learned: false },
        {
          id: "vlm",
          label: "VLM",
          learned: true,
          shape: "4B",
          tokens: [
            { label: "img" },
            { label: "txt" },
            { label: "Zv", count: { value: "4" }, name: "visual latents" },
            { label: "Zl", count: { value: "2" }, name: "language latents" },
            { label: "ŷ" },
          ],
        },
        {
          id: "vis",
          label: "visual decoder",
          learned: true,
          phase: "train",
          figure: "fig4",
        },
        {
          id: "lang",
          label: "language decoder",
          learned: true,
          phase: "train",
          quote: "cones narrow the right lane; keep left",
        },
        { id: "traj", label: "trajectory", learned: false, figure: "fig5" },
      ],
      edges: [
        { from: "cam", to: "vlm" },
        { from: "nav", to: "vlm" },
        { from: "ego", to: "vlm" },
        { from: "hist", to: "vlm" },
        { from: "vlm", to: "vis", via: "Zv" },
        { from: "vlm", to: "lang", via: "Zl" },
        { from: "vlm", to: "traj", via: "ŷ" },
      ],
      labels: L({ train: "training only" }),
    },
  },
  {
    name: "draft then verify",
    domain: "language-models",
    lit: {
      kind: "evolve",
      rule: "lanes",
      lanes: [
        {
          label: "one model",
          runs: [{ label: "decode", count: { value: "8" }, dur: { value: "1" }, parallel: false }],
        },
        {
          label: "draft + verify",
          runs: [
            { label: "draft", count: { value: "7" }, dur: { value: "0.05" }, parallel: false },
            { label: "verify", count: { value: "8" }, dur: { value: "1" }, parallel: true },
          ],
        },
      ],
      labels: L({ unit: "one model call" }),
    },
  },
  {
    name: "pipeline stages",
    domain: "distributed-systems",
    lit: {
      kind: "evolve",
      rule: "lanes",
      lanes: [
        {
          label: "sequential",
          total: { value: "6.5" },
          runs: [
            { label: "fetch", parallel: false },
            { label: "compute", parallel: false },
          ],
        },
        {
          label: "pipelined",
          total: { value: "4.4" },
          runs: [
            { label: "fetch", count: { value: "4" }, parallel: true },
            { label: "compute", parallel: false },
          ],
        },
      ],
      labels: L({ unit: "one batch", example: "example" }),
    },
  },
  /* place */
  {
    name: "quality against latency",
    domain: "autonomous-driving",
    lit: {
      kind: "place",
      form: "plane",
      axes: [
        { name: "latency (s)", lowerIsBetter: true },
        { name: "score", lowerIsBetter: false },
      ],
      items: [
        { label: "A", values: ["4.46", "88.84"] },
        { label: "B", values: ["6.58", "88.29"] },
        { label: "C", values: ["4.49", "87.47"] },
      ],
      labels: [],
    },
  },
  {
    // OneVL's NAVSIM plane: three points within 2.1s and 1.4 points of each other,
    // one label wrapping to two lines, and group names that crowd the legend.
    name: "quality against latency, crowded",
    domain: "autonomous-driving",
    lit: {
      kind: "place",
      form: "plane",
      axes: [
        { name: "延迟（秒）", lowerIsBetter: true },
        { name: "PDM-score", lowerIsBetter: false },
      ],
      items: [
        { label: "AR CoT+Answer", values: ["6.58", "88.29"], group: "AR CoT+Answer" },
        { label: "AR Answer", values: ["4.49", "87.47"], group: "AR CoT+Answer" },
        { label: "COCONUT", values: ["5.93", "84.84"], group: "AR CoT+Answer" },
        { label: "CODI", values: ["8.62", "83.92"], group: "AR CoT+Answer" },
        { label: "SIM-CoT", values: ["10.86", "84.21"], group: "AR CoT+Answer" },
        { label: "OneVL", values: ["4.46", "88.84"], group: "OneVL" },
      ],
      labels: [],
    },
  },
  {
    // Speculative decoding's T5 speedups: four groups beside a long axis name.
    name: "speedup by task and temperature, four groups",
    domain: "language-models",
    lit: {
      kind: "place",
      form: "strip",
      axes: [{ name: "T5X 대비 속도 향상 배수", lowerIsBetter: false }],
      items: [
        { label: "T5-small", values: ["3.4"], group: "EnDe · temp=0" },
        { label: "T5-small", values: ["2.6"], group: "EnDe · temp=1" },
        { label: "T5-small", values: ["3.1"], group: "CNNDM · temp=0" },
        { label: "T5-small", values: ["2.3"], group: "CNNDM · temp=1" },
      ],
      labels: [],
    },
  },
  {
    name: "text quality on one axis, with a legend",
    domain: "language-models",
    lit: {
      kind: "place",
      form: "strip",
      axes: [{ name: "文本质量 Avg.", lowerIsBetter: false }],
      items: [
        { label: "AR CoT+Answer", values: ["78.27"], group: "显式 CoT" },
        { label: "SIM-CoT", values: ["74.10"], group: "潜在 CoT" },
        { label: "OneVL", values: ["76.13"], group: "潜在 CoT" },
      ],
      labels: [],
    },
  },
  {
    name: "expected tokens per call",
    domain: "language-models",
    lit: {
      kind: "place",
      form: "plane",
      axes: [
        { name: "α", lowerIsBetter: false },
        { name: "speed", lowerIsBetter: false },
      ],
      items: [
        { label: "γ=2", values: ["0.6", "1.96"], group: "2" },
        { label: "γ=2", values: ["0.8", "2.44"], group: "2" },
        { label: "γ=5", values: ["0.8", "3.69"], group: "5" },
      ],
      curves: [
        { label: "γ=2", expr: "(1 - α^(γ+1)) / (1 - α)", x: "α", fixed: params({ γ: "2" }) },
        { label: "γ=5", expr: "(1 - α^(γ+1)) / (1 - α)", x: "α", fixed: params({ γ: "5" }) },
      ],
      reveal: "groups",
      labels: [],
    },
  },
  {
    name: "loss over epochs",
    domain: "optimisation",
    lit: {
      kind: "place",
      form: "plane",
      connect: true,
      reveal: "groups",
      axes: [
        { name: "epoch", lowerIsBetter: false },
        { name: "loss", lowerIsBetter: true },
      ],
      items: ["2.1", "1.4", "1.1", "0.9"]
        .map((y, i) => ({ label: `e${i + 1}`, values: [String(i + 1), y], group: "train" }))
        .concat(
          ["2.3", "1.7", "1.5", "1.4"].map((y, i) => ({
            label: `v${i + 1}`,
            values: [String(i + 1), y],
            group: "val",
          })),
        ),
      labels: [],
    },
  },
  {
    name: "ablation ranking",
    domain: "reinforcement-learning",
    lit: {
      kind: "place",
      form: "strip",
      axes: [{ name: "return", lowerIsBetter: false }],
      items: [
        { label: "full", values: ["88.84"] },
        { label: "no aux", values: ["87.97"] },
        { label: "no curriculum", values: ["67.13"] },
      ],
      labels: [],
    },
  },
  {
    name: "ablation ranking",
    domain: "computer-vision",
    lit: {
      kind: "place",
      form: "strip",
      axes: [{ name: "mAP", lowerIsBetter: false }],
      items: [
        { label: "full", values: ["41.2"] },
        { label: "no FPN", values: ["38.0"] },
      ],
      labels: [],
    },
  },
  /* region */
  {
    name: "what a driving model weighed at the intersection",
    domain: "autonomous-driving",
    lit: {
      kind: "region",
      picture: "b1",
      panel: 2,
      marks: [
        {
          thing: "the stop sign",
          text: "Stop sign: slow down, prepare to stop",
          box: { x: 0.82, y: 0.61, w: 0.04, h: 0.12 },
        },
        {
          thing: "the orange barrel",
          text: "Barrels narrow the lane: keep left",
          box: { x: 0.79, y: 0.7, w: 0.04, h: 0.08 },
        },
        {
          thing: "the parked cars",
          text: "Parked cars: less room to the side",
          box: { x: 0.72, y: 0.63, w: 0.1, h: 0.06 },
        },
      ],
      outcome: { title: "Decision", lines: ["Stop at the line", "Then turn right"] },
      labels: L({ legend: "ROADWork example · green GT · red prediction" }),
    },
  },
  {
    name: "the lesions a reader flagged",
    domain: "medical-imaging",
    lit: {
      kind: "region",
      picture: "b1",
      marks: [
        { thing: "the bright mass in the upper left lobe", text: "Mass: 14 mm, irregular edge" },
        { thing: "the small nodule near the hilum", text: "Nodule: stable since last scan" },
      ],
      labels: L({ legend: "CT, axial slice" }),
    },
  },
  {
    name: "defects on a wafer",
    domain: "manufacturing",
    lit: {
      kind: "region",
      picture: "b1",
      marks: [
        { thing: "the scratch across the centre", text: "Scratch: handling damage" },
        { thing: "the ring at the edge", text: "Edge ring: uneven etch" },
        { thing: "the cluster of dots, lower right", text: "Particles: a dirty chamber" },
        { thing: "the bright spot, top", text: "Hot spot: a short" },
      ],
      outcome: { title: "Verdict", lines: ["Scrap the lot"] },
    },
  },
  {
    name: "a worked decoding example, read off its figure",
    domain: "language-models",
    lit: {
      kind: "evolve",
      rule: "trace",
      picture: "b1",
      panel: 1,
      read: "the trace of drafts accepted, rejected and corrected, one row per call",
      tags: [
        { tag: "ok", label: "accepted", tone: "d" },
        { tag: "no", label: "rejected", tone: "c", strike: true },
        { tag: "fix", label: "corrected", tone: "a" },
      ],
      labels: [],
    },
  },
  {
    name: "a chemical mechanism's steps, read off its scheme",
    domain: "chemistry",
    lit: {
      kind: "evolve",
      rule: "trace",
      picture: "b1",
      read: "each step of the mechanism: the species, then the arrow's reagent",
      tags: [
        { tag: "s", label: "species", tone: "b" },
        { tag: "r", label: "reagent", tone: "a" },
      ],
      note: ["Scheme 2"],
      labels: [],
    },
  },
];

/** A fixture as the plan would carry it, defaults filled. */
const parse = (f: Fixture) => literalSchema.parse(f.lit) as Literal;

const RUNS: Record<string, VerbRun<never>> = {
  operate: operate as unknown as VerbRun<never>,
  evolve: evolve as unknown as VerbRun<never>,
  flow: flow as unknown as VerbRun<never>,
  place: points as unknown as VerbRun<never>,
  region: region as unknown as VerbRun<never>,
};

/** One cue per sentence, ~7s each, as narration gives them. */
const cuesFor = (n: number): Cue[] =>
  Array.from({ length: n }, (_, i) => ({ t0: 0.95 + i * 7.2, t1: 0.95 + i * 7.2 + 7 }));

/** An earlier operate scene's tiles, for a stream `from` it. */
function earlierFor(): Map<string, Earlier> {
  const p = placeholderPicture(32, 32);
  const tiles = Array.from({ length: 8 }, () => tensor(32, 32, 3, p.d));
  return new Map([
    [
      "b2",
      {
        kind: "operate",
        layers: { files: { thumb: "t.jpg" }, data: {}, material: { tiles } },
        labels: {},
      },
    ],
  ]);
}

function draw(f: Fixture) {
  const lit = parse(f);
  const labels = Object.fromEntries(lit.labels.map((l) => [l.slot, l.text]));
  const r = runVerb(RUNS[lit.kind] as VerbRun<never>, {
    lit: lit as never,
    labels,
    region: region_,
    theme,
    measure,
    dry: true,
    image: placeholderPicture(192, 128),
    earlier: earlierFor(),
    assets: {},
  });
  const files: Record<string, string> = Object.fromEntries(
    Object.keys(r.rasters).map((k) => [k, `${k}.png`]),
  );
  for (const fr of r.frames)
    for (const p of fr.prims)
      if (p.p === "image") files[p.layer] ??= `${p.layer.replace(/:/g, "-")}.png`;
  const cues = cuesFor(Math.max(2, r.frames.length));
  const frag = stagedFragment(
    lit.kind,
    { files, data: { frames: r.frames, paints: {}, vars: r.vars } },
    region_,
    cues,
    { labels, data: lit },
    theme,
    (x) => x,
  );
  return { lit, r, frag, cues };
}

/** The form a fixture exercises, for the fill floors and the registry. */
function formOf(lit: Literal): string {
  if (lit.kind === "operate")
    return `operate:${lit.terms ? "terms" : lit.picture ? "map" : lit.vectors.length ? "profile" : "grid"}`;
  if (lit.kind === "evolve") return `evolve:${lit.rule}${lit.how ? `:${lit.how}` : ""}`;
  if (lit.kind === "flow") return `flow:${lit.form}`;
  if (lit.kind === "place") return `place:${placeForm(lit)}:${lit.form}`;
  if (lit.kind === "region") return "region:marks";
  return lit.kind;
}

/** Everything a fixture exercises: its form, and each op and variant of a chain (an `alt` too). */
function covers(lit: Literal): string[] {
  const out = [formOf(lit)];
  if (lit.kind === "operate") {
    for (const s of lit.chain) {
      const doc = LITERAL_OPS[s.op] as LiteralOpDoc;
      out.push(`op:${s.op}${doc.how ? `:${s.how ?? doc.defaultHow}` : ""}`);
    }
    if (lit.alt?.how) out.push(`op:${lit.chain[lit.alt.step - 1]?.op}:${lit.alt.how}`);
    if (lit.condition) out.push(`condition:${lit.condition.how}`);
    if (lit.compare !== "none") out.push(`compare:${lit.compare}`);
  }
  if (lit.kind === "evolve" && lit.input?.from) out.push("evolve:input:from");
  if (lit.kind === "evolve" && lit.reset !== "none") out.push(`evolve:reset:${lit.reset}`);
  return out;
}

/** The least share of the region a form's frames cover once revealed (`frameFill`). */
const FILL: Record<string, number> = {
  "operate:map": 0.45,
  // Cells, chips and a line of words: what they must do is span the region (held below).
  "operate:terms": 0.12,
  "operate:profile": 0.5,
  "operate:grid": 0.3,
  // Rows paint little: the lit row's panel, the bars, the legend's swatches.
  // What they must do is span the region, the deck's own gate, held below.
  evolve: 0.05,
  // Pills, a token box and wires at their own size, as the approved look draws
  // them: a sparse chain paints little. What it must do is span the region,
  // which the deck's own gate measures, and the test below holds it to.
  "flow:chain": 0.25,
  place: 0.5,
  region: 0.4,
};
const floorOf = (form: string) =>
  FILL[form.split(":").slice(0, 2).join(":")] ?? FILL[form.split(":")[0] as string] ?? 0;

/* ----------------------------------------------------------------- tests */

describe("every verb fixture runs, and keeps the deck's invariants", () => {
  for (const f of FIXTURES) {
    describe(`${f.domain}: ${f.name}`, () => {
      let memo: ReturnType<typeof draw> | undefined;
      const d = new Proxy({} as ReturnType<typeof draw>, {
        get: (_, k) => {
          memo ??= draw(f);
          return memo[k as keyof typeof memo];
        },
      });
      it("every tween is fromTo, scoped, rounded; no callbacks, clock or randomness", () => {
        const lines = d.frag.script.split("\n").filter(Boolean);
        expect(lines.length).toBeGreaterThan(0);
        for (const l of lines)
          expect(l).toMatch(
            /^tl\.fromTo\("#SCENEID-[\w-]+", \{.*\}, \{.*\}, -?\d+(?:\.\d{1,3})?\);$/,
          );
        expect(d.frag.script).not.toMatch(
          /onUpdate|onStart|onComplete|Date\.now|Math\.random|fetch\(/,
        );
        for (const m of d.frag.script.matchAll(/"duration":(\d+(?:\.\d+)?)/g))
          expect((m[1] as string).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
      });
      it("every element a tween names exists in the markup", () => {
        for (const m of d.frag.script.matchAll(/"#SCENEID-([\w-]+)"/g))
          expect(d.frag.markup, m[1]).toContain(`id="SCENEID-${m[1]}"`);
      });
      it("no text under 40px (invariant 5)", () => {
        for (const fr of d.r.frames)
          for (const p of fr.prims)
            if (p.p === "text") expect(p.size, fr.id).toBeGreaterThanOrEqual(40);
      });
      it(`never more than ${STILL_MAX}s without a tween while it is narrated`, () => {
        const from = (d.cues[0] as Cue).t0 + 1;
        const to = (d.cues.at(-1) as Cue).t1 - 0.5;
        const long = stillSpans(d.frag.script, from, to).filter(([a, b]) => b - a > STILL_MAX);
        expect(long, JSON.stringify(long)).toEqual([]);
      });
      it("fills its region: the form's floor at every step", () => {
        // A plane named by a key gives the key's column of words part of its width.
        const floor = d.r.data.mode === "numbered" ? 0.3 : floorOf(formOf(d.lit));
        for (const fr of d.r.frames)
          expect(frameFill(fr, region_), `${fr.id}`).toBeGreaterThanOrEqual(floor);
      });
      it("pictures and shapes stay inside the region", () => {
        for (const fr of d.r.frames)
          for (const p of fr.prims)
            if (p.p === "image" || p.p === "rect") {
              expect(p.x, fr.id).toBeGreaterThanOrEqual(-1);
              expect(p.y, fr.id).toBeGreaterThanOrEqual(-1);
              // A panned picture runs past the right edge by exactly its pan, clipped there.
              expect(p.x + p.w, fr.id).toBeLessThanOrEqual(
                region_.width + 1 + (p.cam ? (fr.pan ?? 0) : 0),
              );
              expect(p.y + p.h, fr.id).toBeLessThanOrEqual(region_.height + 1);
            }
      });
      it("no label covers another", () => {
        for (const fr of d.r.frames) {
          const boxes = fr.prims.flatMap((p) => {
            if (p.p !== "text" || !p.text) return [];
            const w = measure(p.text, p.size);
            const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
            return [{ t: p.text, x0, y0: p.y, x1: x0 + w, y1: p.y + p.size * 1.15 }];
          });
          for (const [i, a] of boxes.entries())
            for (const b of boxes.slice(i + 1))
              expect(
                a.x0 < b.x1 - 2 && b.x0 < a.x1 - 2 && a.y0 < b.y1 - 2 && b.y0 < a.y1 - 2,
                `${fr.id}: "${a.t}" over "${b.t}"`,
              ).toBe(false);
        }
      });
      it("no label lies on a point or a line (a place's words)", () => {
        if (d.lit.kind !== "place") return;
        for (const fr of d.r.frames) {
          const words = fr.prims.flatMap((p) => {
            if (p.p !== "text" || !p.text) return [];
            const w = measure(p.text, p.size);
            const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
            return [{ t: p.text, x0: x0 + 2, y0: p.y + 4, x1: x0 + w - 2, y1: p.y + p.size * 1.1 }];
          });
          const hits = (x: number, y: number) =>
            words.filter((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1).map((b) => b.t);
          for (const p of fr.prims) {
            if (p.p === "circle")
              for (const [dx, dy] of [
                [0, 0],
                [p.r, 0],
                [-p.r, 0],
                [0, p.r],
                [0, -p.r],
              ] as const)
                expect(hits(p.cx + dx, p.cy + dy), `${fr.id}: a point under a word`).toEqual(
                  // A key's number sits inside its own dot.
                  hits(p.cx + dx, p.cy + dy).filter((t) => /^\d+$/.test(t)),
                );
            const pts =
              p.p === "line" ? [p.x1, p.y1, p.x2, p.y2] : p.p === "path" && !p.closed ? p.pts : [];
            for (let i = 0; i + 3 < pts.length; i += 2) {
              const [ax, ay, bx, by] = pts.slice(i, i + 4) as [number, number, number, number];
              const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
              for (let k = 1; k < n; k++)
                expect(
                  hits(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n),
                  `${fr.id}: a line through a word`,
                ).toEqual([]);
            }
          }
        }
      });
      it("every word stays inside the region", () => {
        for (const fr of d.r.frames)
          for (const p of fr.prims) {
            if (p.p !== "text" || !p.text) continue;
            const w = measure(p.text, p.size);
            const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
            expect(x0, `${fr.id}: "${p.text}"`).toBeGreaterThanOrEqual(-1);
            expect(x0 + w, `${fr.id}: "${p.text}"`).toBeLessThanOrEqual(region_.width + 1);
          }
      });
      it("a flow chain's or marked picture's content spans the region the deck's gate measures", () => {
        if (
          !(
            ["flow:chain", "region:marks", "operate:terms"].includes(formOf(d.lit)) ||
            d.lit.kind === "evolve"
          )
        )
          return;
        for (const fr of d.r.frames) {
          const bs = fr.prims.map(boxOf);
          const w = Math.max(...bs.map((b) => b.x + b.w)) - Math.min(...bs.map((b) => b.x));
          const h = Math.max(...bs.map((b) => b.y + b.h)) - Math.min(...bs.map((b) => b.y));
          expect((w * h) / (region_.width * region_.height), fr.id).toBeGreaterThanOrEqual(
            CONTENT_AREA_MIN,
          );
        }
      });
      it("is drawable at plan time, by the same run", () => {
        expect(drawProblems(d.lit, region_, theme)).toEqual([]);
      });
    });
  }
});

describe("the library holds only what is general", () => {
  it("every op variant, rule and form has fixtures from at least two unrelated domains", () => {
    const universe = [
      ...Object.entries(LITERAL_OPS as Record<string, LiteralOpDoc>).flatMap(([name, d]) =>
        d.how ? Object.keys(d.how).map((h) => `op:${name}:${h}`) : [`op:${name}`],
      ),
      "operate:map",
      "operate:terms",
      "operate:profile",
      "operate:grid",
      "condition:contrast",
      "condition:noise",
      "condition:blur",
      "compare:condition",
      "compare:params",
      "evolve:recur:ema",
      "evolve:recur:leaky",
      "evolve:recur:linear",
      "evolve:noise",
      "evolve:formula",
      "evolve:trace",
      "evolve:reset:soft",
      "evolve:reset:hard",
      "flow:chain",
      "evolve:lanes",
      "place:points:plane",
      "place:points:strip",
      "region:marks",
    ];
    const domains = new Map<string, Set<string>>();
    for (const f of FIXTURES)
      for (const c of covers(parse(f))) domains.set(c, (domains.get(c) ?? new Set()).add(f.domain));
    const thin = universe
      .filter((u) => (domains.get(u)?.size ?? 0) < 2)
      .map((u) => `${u} (${[...(domains.get(u) ?? [])].join(", ") || "none"})`);
    expect(
      thin,
      "options with fewer than two unrelated domains: cut them or add a fixture",
    ).toEqual([]);
  });

  it("src/literal and the planner's verb docs name no paper", () => {
    const DENY =
      /EM-SNN|TM-LIF|\bSSM\b|[Hh]az(?:e|y)|[Dd]ehaz|[Aa]irlight|[Dd]ark[ -]?[Cc]hannel|\bDCP\b|[Ss]pik(?:e|ing)|OneVL|NAVSIM|[Ss]peculative|\bT5\b|\bRICE\d?\b|LHID|DHID|SFRDP|SFSNiD|DehazeFormer|COCONUT|ROADWork/;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk("src/literal");
    const hits = files.flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .map((l, i) => [i, l] as const)
        .filter(([, l]) => DENY.test(l))
        .map(([i, l]) => `${p}:${i + 1}: ${l.trim()}`),
    );
    const docs = Object.entries(LITERAL_KIND_DOCS).flatMap(([k, d]) =>
      [d.doc, ...Object.values(d.slots).map((s) => s.what)]
        .filter((t) => DENY.test(t))
        .map((t) => `${k}: ${t}`),
    );
    const ops = Object.entries(LITERAL_OPS as Record<string, LiteralOpDoc>).flatMap(([k, d]) =>
      [d.doc].filter((t) => DENY.test(t)).map((t) => `${k}: ${t}`),
    );
    expect([...hits, ...docs, ...ops]).toEqual([]);
  });
});

describe("what each verb refuses", () => {
  const problems = (lit: Record<string, unknown>) =>
    drawProblems(literalSchema.parse(lit) as Literal, region_, theme);

  it("place: a curve with no points says to give its checks' rows as items", () => {
    const lit = {
      kind: "place",
      form: "plane",
      axes: [
        { name: "α", lowerIsBetter: false },
        { name: "speed", lowerIsBetter: false },
      ],
      items: [],
      curves: [
        { label: "γ=2", expr: "(1 - α^(γ+1)) / (1 - α)", x: "α", fixed: params({ γ: "2" }) },
      ],
      labels: [],
    };
    expect(problems(lit).join("\n")).toMatch(/draws a curve under its points: give the rows/);
  });

  it("operate: a parameter the op does not take, a variant it does not have, two inputs", () => {
    expect(
      problems({
        kind: "operate",
        picture: "b1",
        chain: [op("conv", "sobel-x", { theta: "1" })],
        labels: L(pic),
      })[0],
    ).toMatch(/takes no parameter "theta"/);
    expect(() =>
      literalSchema.parse({
        kind: "operate",
        picture: "b1",
        chain: [op("reduce", "median", { window: "3" })],
        labels: L(pic),
      }),
    ).toThrow();
    expect(
      problems({
        kind: "operate",
        picture: "b1",
        chain: [op("reduce", "sobel-x", { window: "3" })],
        labels: L(pic),
      })[0],
    ).toMatch(/no variant "sobel-x"/);
    expect(
      problems({
        kind: "operate",
        picture: "b1",
        vectors: [{ label: "p", values: [1, 2] }],
        bins: ["a", "b"],
        chain: [op("normalise", "sum")],
        labels: L(pic),
      })[0],
    ).toMatch(/exactly one input/);
  });

  it("operate: a quantiser without its rounding, and a compare without what it compares", () => {
    expect(
      problems({
        kind: "operate",
        picture: "b1",
        chain: [op("quantize", undefined, { levels: "4", step: "0.25" })],
        labels: L(pic),
      })[0],
    ).toMatch(/how/);
    expect(
      problems({
        kind: "operate",
        picture: "b1",
        compare: "condition",
        chain: [op("channels", "mean")],
        labels: L(pic),
      })[0],
    ).toMatch(/needs a `condition`/);
  });

  it("evolve: a reset with no threshold, and too few inputs", () => {
    expect(
      problems({
        kind: "evolve",
        rule: "recur",
        how: "leaky",
        params: params({ a: "0.5" }),
        reset: "soft",
        input: { values: ["1", "2", "3"].map((value) => ({ value })) },
        labels: L({ state: "s", trace: "t" }),
      })[0],
    ).toMatch(/reset/);
    expect(
      problems({
        kind: "evolve",
        rule: "recur",
        how: "ema",
        params: params({ a: "0.5" }),
        input: { values: [{ value: "1" }] },
        labels: L({ state: "s", trace: "t" }),
      })[0],
    ).toMatch(/3–24 inputs/);
  });

  it("flow: a learned stage that shows a computed layer is a box, never an output", () => {
    expect(
      problems({
        kind: "flow",
        form: "chain",
        stages: [
          { id: "a", label: "a", learned: false },
          { id: "b", label: "net", learned: true, show: "b1" },
        ],
        labels: L({}),
      })[0],
    ).toMatch(/learned/);
  });

  it("flow: a shape that is a stated count is tokens, anything else stays words", () => {
    expect(tokenChips("4")).toEqual(["", "", "", ""]);
    expect(tokenChips("γ")).toEqual(["1", "2", "…", "γ"]);
    expect(tokenChips("γ+1")).toEqual(["1", "2", "…", "γ+1"]);
    expect(tokenChips("1…γ+1")).toEqual(["1", "2", "…", "γ+1"]);
    expect(tokenChips("256×256")).toBeUndefined();
    // A count too many to draw one by one is elided as a symbol's is: "10K tokens" was words,
    // and the chain was refused as empty boxes.
    expect(tokenChips("40")).toEqual(["1", "2", "…", "40"]);
    expect(tokenChips("10000")).toEqual(["1", "2", "…", "10000"]);
    expect(tokenChips("0")).toBeUndefined();
  });

  it("flow chain: a card is as tall as what it holds, and its label starts inside it", () => {
    const r = draw({
      name: "chips",
      domain: "llm",
      lit: {
        kind: "flow",
        form: "chain",
        stages: [
          { id: "a", label: "draft", learned: true, shape: "γ" },
          { id: "b", label: "verify", learned: true, shape: "γ+1" },
        ],
        labels: L({}),
      },
    } as never).r;
    const prims = r.frames[0]?.prims ?? [];
    const card = prims.find((p) => p.p === "rect" && p.fill === "panel") as {
      y: number;
      h: number;
    };
    expect(card.h).toBeLessThan(region_.height * 0.8);
    const label = prims.find((p) => p.p === "text" && p.text === "draft") as { y: number };
    expect(label.y - card.y).toBeGreaterThanOrEqual(16);
    expect(prims.filter((p) => p.p === "text" && p.text === "γ+1")).toHaveLength(1);
  });

  it("region: a figure's panels split along its blank gutters, in reading order", () => {
    const W = 300;
    const H = 200;
    const d = new Float32Array(W * H * 3).fill(1);
    const block = (x0: number, y0: number, w: number, h: number) => {
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) for (let k = 0; k < 3; k++) d[(y * W + x) * 3 + k] = 0.2;
    };
    block(160, 10, 130, 80); // top right
    block(10, 10, 130, 80); // top left
    block(10, 110, 280, 80); // bottom, full width
    const found = findPanels({ w: W, h: H, d });
    expect(found).toEqual([
      { x: 10, y: 10, w: 130, h: 80 },
      { x: 160, y: 10, w: 130, h: 80 },
      { x: 10, y: 110, w: 280, h: 80 },
    ]);
    // Title bars running edge to edge across the gutter (OneVL's Fig 18): split off and dropped.
    const titled = new Float32Array(W * H * 3).fill(1);
    const paint = (x0: number, y0: number, w: number, h: number) => {
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++)
          for (let k = 0; k < 3; k++) titled[(y * W + x) * 3 + k] = 0.2;
    };
    paint(10, 10, 280, 12); // one band of titles over both panels
    paint(10, 40, 130, 150);
    paint(160, 40, 130, 150);
    expect(findPanels({ w: W, h: H, d: titled })).toEqual([
      { x: 10, y: 40, w: 130, h: 150 },
      { x: 160, y: 40, w: 130, h: 150 },
    ]);
    // A text figure — lines of words on white, a third ink, gaps not lined up — is
    // one panel: no line of it is dropped.
    const text = new Float32Array(W * H * 3).fill(1);
    for (let line = 0; line < 8; line++)
      for (let y = 10 + line * 23; y < 22 + line * 23; y++)
        for (let x = 10; x < 290; x++)
          if ((x + line * 4) % 9 < 3) for (let k = 0; k < 3; k++) text[(y * W + x) * 3 + k] = 0.1;
    const whole = findPanels({ w: W, h: H, d: text });
    expect(whole).toHaveLength(1);
    expect([whole[0]?.y, whole[0]?.h]).toEqual([10, 173]);
    // One block, no gutter: one panel.
    const solid = new Float32Array(W * H * 3).fill(1);
    for (let i = 0; i < 100 * 100 * 3; i++) solid[i] = 0.2;
    expect(findPanels({ w: W, h: H, d: solid })).toHaveLength(1);
  });

  it("place: ticks are round values inside the drawn range", () => {
    expect(ticksOf([84.1, 89.6], false).map((t) => t.text)).toEqual(["85", "86", "87", "88", "89"]);
    expect(ticksOf([0.52, 0.91], false).map((t) => t.text)).toEqual(["0.6", "0.7", "0.8", "0.9"]);
    expect(ticksOf([0.2, 2.3], true).map((t) => t.text)).toEqual(["10", "100"]);
  });

  it("place: items sharing a label are named by group, with no legend; values never break", () => {
    const prims =
      draw({
        name: "same label",
        domain: "llm",
        lit: {
          kind: "place",
          form: "strip",
          axes: [{ name: "speed", lowerIsBetter: false }],
          items: [
            { label: "small", values: ["3.4"], group: "task A · temp 0" },
            { label: "small", values: ["2.6"], group: "task A · temp 1" },
            { label: "small", values: ["3.1"], group: "task B · temp 0" },
          ],
          labels: L({}),
        },
      } as never).r.frames[0]?.prims ?? [];
    const texts = prims.flatMap((p) => (p.p === "text" && p.text ? [p.text] : []));
    expect(texts).toContain("task A · temp 0: 3.4");
    expect(texts.some((t) => t.includes("small"))).toBe(false);
    // No legend dot: every circle is a point.
    expect(prims.filter((p) => p.p === "circle")).toHaveLength(3);
  });

  it("place: a diagonal plane shares one scale and draws y = x", () => {
    const prims =
      draw({
        name: "diagonal",
        domain: "llm",
        lit: {
          kind: "place",
          form: "plane",
          diagonal: true,
          axes: [
            { name: "a at 0", lowerIsBetter: false },
            { name: "a at 1", lowerIsBetter: false },
          ],
          items: [
            { label: "p", values: ["0.88", "0.89"] },
            { label: "q", values: ["0.61", "0.57"] },
          ],
          labels: L({}),
        },
      } as never).r.frames[0]?.prims ?? [];
    const diag = prims.find((p) => p.p === "line" && p.dash) as
      | { x1: number; y1: number; x2: number; y2: number }
      | undefined;
    expect(diag).toBeDefined();
    const d = diag as { x1: number; y1: number; x2: number; y2: number };
    expect(d.x2).toBeGreaterThan(d.x1);
    expect(d.y2).toBeLessThan(d.y1);
  });

  /** Each lane's drawn length (its blocks' extent) and block count, in the last frame. */
  const lanesOf = (prims: Prim[]) => {
    const rows = new Map<number, Array<{ x: number; w: number }>>();
    for (const p of prims)
      if (p.p === "rect" && p.h === 34) rows.set(p.y, [...(rows.get(p.y) ?? []), p]);
    return [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, bs]) => ({
        len: Math.max(...bs.map((b) => b.x + b.w)) - Math.min(...bs.map((b) => b.x)),
        blocks: bs.length,
      }));
  };
  const lanesRun = (lit: Record<string, unknown>) => {
    const parsed = literalSchema.parse(lit) as Extract<Literal, { kind: "evolve" }>;
    return runVerb(evolve as VerbRun<"evolve">, {
      lit: parsed,
      labels: Object.fromEntries(parsed.labels.map((l) => [l.slot, l.text])),
      region: region_,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
    });
  };

  it("evolve lanes: totals on some lanes and not others", () => {
    expect(
      problems({
        kind: "evolve",
        rule: "lanes",
        lanes: [
          { label: "x", total: { value: "2" }, runs: [{ label: "r", parallel: false }] },
          { label: "y", runs: [{ label: "r", parallel: false }] },
        ],
        labels: L({ unit: "u" }),
      })[0],
    ).toMatch(/every lane a `total`/);
  });

  it("evolve lanes: lane lengths are Σ count·dur when every duration is stated", () => {
    const d = draw(FIXTURES.find((f) => f.name === "draft then verify") as Fixture);
    expect(d.r.data.scale).toBe("dur");
    const [one, two] = lanesOf(d.r.frames.at(-1)?.prims ?? []);
    // 8·1 against 7·0.05 + 1·1 = 1.35, give or take the blocks' 2px insets.
    expect((two?.len ?? 0) / (one?.len ?? 1)).toBeCloseTo(1.35 / 8, 2);
    // The serial draft is its count of blocks; the parallel verify one block.
    expect([one?.blocks, two?.blocks]).toEqual([8, 8]);
  });

  it("evolve lanes: with no time stated, a parallel run is one step, so its lane is shorter", () => {
    const r = lanesRun({
      kind: "evolve",
      rule: "lanes",
      lanes: [
        { label: "serial", runs: [{ label: "K runs", parallel: false }] },
        { label: "at once", runs: [{ label: "K+1 checks", parallel: true }] },
      ],
      labels: L({ unit: "one call", example: "example" }),
    });
    const [serial, once] = lanesOf(r.frames.at(-1)?.prims ?? []);
    // Four example serial steps against one parallel step.
    expect((once?.len ?? 0) / (serial?.len ?? 1)).toBeCloseTo(1 / 4, 1);
    expect([serial?.blocks, once?.blocks]).toEqual([4, 1]);
  });

  it("evolve lanes: lanes of equal serial steps on example material are refused", () => {
    expect(
      problems({
        kind: "evolve",
        rule: "lanes",
        lanes: [
          { label: "x", runs: [{ label: "r", parallel: false }] },
          { label: "y", runs: [{ label: "s", parallel: false }] },
        ],
        labels: L({ unit: "u", example: "example" }),
      })[0],
    ).toMatch(/same number of serial steps/);
  });

  it("evolve lanes: a stated duration is one block, and a stated total is printed in its lane", () => {
    const r = lanesRun({
      kind: "evolve",
      rule: "lanes",
      lanes: [
        {
          label: "long",
          total: { value: "4.46" },
          runs: [{ label: "a", dur: { value: "4.46" }, parallel: false }],
        },
        {
          label: "short",
          total: { value: "0.24" },
          runs: [{ label: "b", dur: { value: "0.24" }, parallel: false }],
        },
      ],
      labels: L({ unit: "s" }),
    });
    const prims = r.frames.at(-1)?.prims ?? [];
    expect(lanesOf(prims).map((l) => l.blocks)).toEqual([1, 1]);
    const words = prims.filter((p) => p.p === "text").map((p) => (p as { text?: string }).text);
    expect(words).toEqual(expect.arrayContaining(["4.46", "0.24", "s"]));
  });

  it("evolve lanes: more kinds of run than the legend tells apart are refused", () => {
    expect(
      problems({
        kind: "evolve",
        rule: "lanes",
        lanes: [
          { label: "x", runs: ["a", "b", "c"].map((label) => ({ label, parallel: false })) },
          { label: "y", runs: ["d", "e"].map((label) => ({ label, parallel: true })) },
        ],
        labels: L({ unit: "u", example: "example" }),
      })[0],
    ).toMatch(/at most 4 kinds of run/);
  });

  it("operate terms: a result that does not match the source's is refused", () => {
    const f = FIXTURES.find((x) => x.name === "tokens one verification yields") as Fixture;
    const lit = f.lit as { terms: Record<string, unknown> };
    expect(problems({ ...lit, terms: { ...lit.terms, reported: "3.70" } })[0]).toMatch(
      /come to 3\.6893, and the source reports 3\.70/,
    );
    expect(problems({ ...lit, terms: { ...lit.terms, to: "4" } })[0]).toMatch(/come to 3\.3616/);
  });

  it("region: more marks than a list holds, words too long for the scene, and no box at build", () => {
    const mark = (k: number, text = `thing ${k}`) => ({ thing: `thing ${k}`, text });
    expect(
      problems({ kind: "region", picture: "b1", marks: [1, 2, 3, 4, 5, 6].map((k) => mark(k)) })[0],
    ).toMatch(/region marks 1–5 things/);
    const long = "a long point about this thing that keeps going well past one line ".repeat(3);
    expect(
      problems({
        kind: "region",
        picture: "b1",
        marks: [1, 2, 3, 4, 5].map((k) => mark(k, long)),
      })[0],
    ).toMatch(/px tall .* give shorter `text` or fewer marks/);
    const lit = literalSchema.parse({ kind: "region", picture: "b1", marks: [mark(1)] });
    expect(() =>
      runVerb(region as VerbRun<"region">, {
        lit: lit as Extract<Literal, { kind: "region" }>,
        labels: {},
        region: region_,
        theme,
        measure,
        dry: false,
        image: placeholderPicture(640, 360),
        earlier: new Map(),
        assets: {},
      }),
    ).toThrow(/mark 1 \("thing 1"\) has no box. `decksmith plan` finds/);
  });

  it("region: each number sits outside every box, inside the picture", () => {
    const d = draw(FIXTURES.find((f) => f.name.startsWith("what a driving model")) as Fixture);
    const prims = d.r.frames[0]?.prims ?? [];
    const pic = boxOf(prims.find((p) => p.p === "image") as Prim);
    const boxes = prims.filter((p) => p.p === "rect" && p.role === "b").map(boxOf);
    const discs = prims.filter((p) => p.p === "circle" && p.cam).map(boxOf);
    expect(discs).toHaveLength(3);
    const hit = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const c of discs) {
      expect(boxes.some((b) => hit(c, b))).toBe(false);
      expect(
        c.x >= pic.x && c.y >= pic.y && c.x + c.w <= pic.x + pic.w && c.y + c.h <= pic.y + pic.h,
      ).toBe(true);
    }
  });

  it("place: a curve on a strip, and an item with the wrong number of values", () => {
    expect(
      problems({
        kind: "place",
        form: "strip",
        axes: [{ name: "x", lowerIsBetter: false }],
        items: [
          { label: "a", values: ["1"] },
          { label: "b", values: ["2"] },
        ],
        curves: [{ label: "c", expr: "x", x: "x" }],
        labels: [],
      })[0],
    ).toMatch(/curves on a plane/);
    expect(
      problems({
        kind: "place",
        form: "plane",
        axes: [
          { name: "x", lowerIsBetter: false },
          { name: "y", lowerIsBetter: false },
        ],
        items: [
          { label: "a", values: ["1"] },
          { label: "b", values: ["2", "3"] },
        ],
        labels: [],
      })[0],
    ).toMatch(/gives 1 values/);
  });
});

describe("what each verb computes", () => {
  it("operate on two distributions: min + residual is the first, exactly", () => {
    const d = draw(FIXTURES.find((f) => f.name === "accepted mass") as Fixture);
    expect(d.r.vars.sum).toBe("1");
    // Columns, not areas; the residual stacked on the overlap, its top at p's mark.
    const s2 = d.r.frames.find((f) => f.id === "s2")?.prims ?? [];
    expect(s2.some((p) => p.p === "path" && p.closed)).toBe(false);
    const base = s2.filter((p) => p.p === "rect" && p.opacity === 0.4) as Array<{ y: number }>;
    const top = s2.filter((p) => p.p === "rect" && p.wipe) as Array<{ y: number; h: number }>;
    expect(base.length).toBe(4);
    // Bin b: overlap 0.3 + residual 0.1 = p's 0.4; the residual sits right on the overlap.
    const pMarks = s2.filter((p) => p.p === "line" && p.role === "a") as Array<{ y1: number }>;
    expect(Math.abs((top[0]?.y ?? 0) - (pMarks[1]?.y1 ?? 1))).toBeLessThan(0.5);
    expect(Math.abs((top[0]?.y ?? 0) + (top[0]?.h ?? 0) - (base[1]?.y ?? 1))).toBeLessThan(0.5);
  });

  it("evolve: an EMA starts at its first input, and a frozen phase holds the state while inputs arrive", () => {
    const d = draw(FIXTURES.find((f) => f.name === "calibrated threshold, frozen") as Fixture);
    // One row a step, one frame a step; each phase names its first row.
    const last = d.r.frames.at(-1)?.prims ?? [];
    expect(d.r.frames).toHaveLength(8);
    expect(
      last.filter((p) => p.p === "text" && (p.text === "train" || p.text === "test")),
    ).toHaveLength(2);
    // The frozen phase's bars are dimmed: its state holds while its inputs arrive.
    const states = last.filter(
      (p) => p.p === "rect" && p.fill !== "rule" && p.fill !== "panel" && p.h === 18,
    );
    expect(states.filter((p) => p.opacity === 0.45).length).toBeGreaterThan(0);
    // An EMA starts at its first input: the state's first bar is not empty.
    expect((states[0] as { w: number }).w).toBeGreaterThan(3);
  });

  it("the subject: a headline names an item as a whole word, without its parenthetical", () => {
    expect(namedIn("Model X wins on the benchmark", "Model X (variant b)")).toBe(true);
    expect(namedIn("Res Net+Head is slower", "Net")).toBe(false);
    expect(namedIn("模型A 在基准上最高", "模型A")).toBe(true);
    expect(namedIn("ModelAB is best", "ModelA")).toBe(false);
    expect([...subjectOf("Aa beats Bb", ["Aa", "Bb", "Cc"])]).toEqual([0, 1]);
    // Naming every item names no subject.
    expect([...subjectOf("Aa and Bb", ["Aa", "Bb"])]).toEqual([]);
  });

  it("place: the item the headline names is there from the first frame, in the accent, the rest muted", () => {
    const lit = literalSchema.parse({
      kind: "place",
      form: "plane",
      axes: [
        { name: "latency", lowerIsBetter: true },
        { name: "score", lowerIsBetter: false },
      ],
      items: [
        { label: "Old", values: ["6.5", "88.3"] },
        { label: "Other", values: ["8.6", "83.9"] },
        { label: "Ours", values: ["4.4", "88.8"] },
      ],
      labels: [],
    }) as Extract<Literal, { kind: "place" }>;
    const r = runVerb(points as VerbRun<"place">, {
      lit,
      labels: {},
      region: region_,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
      headline: "Ours is the best score",
    });
    const dots = (r.frames[0]?.prims ?? []).filter((p) => p.p === "circle") as Array<{
      fill?: string;
      at?: number;
      r: number;
    }>;
    expect(dots.map((d) => d.fill)).toEqual(["accent", "muted", "muted"]);
    expect(dots[0]?.at ?? 0).toBe(0);
    expect(dots.slice(1).map((d) => d.at)).toEqual([1, 2]);
    expect(dots[0]?.r).toBeGreaterThan(dots[1]?.r ?? 0);
  });

  it("place: axes run low to high, and lower-is-better points its `better` word down the axis", () => {
    const lit = literalSchema.parse({
      kind: "place",
      form: "plane",
      axes: [
        { name: "latency", lowerIsBetter: true },
        { name: "score", lowerIsBetter: false },
      ],
      items: [
        { label: "Slow", values: ["8.6", "83.9"] },
        { label: "Fast", values: ["4.4", "88.8"] },
      ],
      labels: [{ slot: "better", text: "better" }],
    }) as Extract<Literal, { kind: "place" }>;
    const r = runVerb(points as VerbRun<"place">, {
      lit,
      labels: { better: "better" },
      region: region_,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
    });
    const prims = r.frames[0]?.prims ?? [];
    const dots = prims.filter((p) => p.p === "circle") as Array<{ cx: number; cy: number }>;
    expect(dots[1]?.cx ?? 0).toBeLessThan(dots[0]?.cx ?? 0);
    expect(dots[1]?.cy ?? 0).toBeLessThan(dots[0]?.cy ?? 0);
    expect(prims.some((p) => p.p === "text" && p.text === "← better")).toBe(true);
  });

  it("place: a label slides flush against a word to stay on its own dot's side of a line", () => {
    const plot = { x: 0, y: 0, w: 1000, h: 600 };
    const line = segBoxes([0, 213, 1000, 213], 2);
    // A 49px band between a word above (to 160) and a line under the dot: a 48px step
    // centred on the dot crosses the line; flush under the word, it fits.
    const spot = placeLabel(
      200,
      200,
      200,
      48,
      "beside",
      plot,
      [{ x0: 0, y0: 100, x1: 1000, y1: 160 }],
      line,
    );
    // Inside the band: under the word, over the line (its stroke box starts at 209).
    expect(spot?.box.y0).toBeGreaterThanOrEqual(160);
    expect(spot?.box.y1).toBeLessThanOrEqual(209);
    expect(spot?.box.x0).toBe(224);
    // With the band too narrow, the label is not put under the line, away from its dot.
    expect(
      placeLabel(200, 200, 200, 48, "beside", plot, [{ x0: 0, y0: 0, x1: 1000, y1: 176 }], line),
    ).toBeNull();
  });

  it("table: the row the headline names is lit from the start and never steps back", () => {
    const spec = {
      labels: {},
      headline: "Ours trails the strongest baseline",
      data: {
        columns: ["method", "score"],
        rows: [
          ["Base", "78.27"],
          ["Ours (aux)", "76.13"],
        ],
        highlight: [0, 1],
        marks: [],
      },
    };
    const f = tableKind.fragment(
      { files: {}, data: {} },
      { width: 1700, height: 700 },
      [
        { t0: 1, t1: 4, text: "a" },
        { t0: 5, t1: 9, text: "b" },
      ] as never,
      spec,
      theme,
      (x) => x,
    );
    expect(f.script).toContain('tl.fromTo("#SCENEID-row1", {"opacity":0}, {"opacity":1');
    expect(f.script).not.toMatch(/#SCENEID-row1", \{"opacity":0\.4\}/);
    expect(f.markup).toMatch(/SCENEID-c1-0"[^>]*><div[^>]*color:[^;]*;font-weight:700/);
  });

  it("flow chain: a stage whose shape is one blank chip is refused", () => {
    const lit = literalSchema.parse({
      kind: "flow",
      form: "chain",
      stages: [
        { id: "a", label: "draft", learned: true, shape: "γ" },
        { id: "b", label: "one more", learned: false, shape: "1" },
      ],
      labels: L({}),
    }) as Literal;
    expect(drawProblems(lit, region_, theme)[0]).toMatch(/one blank chip/);
  });

  it("place: a curve is the stated formula across the axis, drawn under the points", () => {
    const d = draw(FIXTURES.find((f) => f.name === "expected tokens per call") as Fixture);
    const curves = d.r.frames[0]?.prims.filter((p) => p.p === "path" && p.wipe) ?? [];
    expect(curves).toHaveLength(2);
  });

  it("place: a group's curve comes with its points, each group on its own sentence", () => {
    const lit = literalSchema.parse({
      kind: "place",
      form: "plane",
      axes: [
        { name: "α", lowerIsBetter: false },
        { name: "speed", lowerIsBetter: false },
      ],
      items: [
        { label: "0.6", values: ["0.6", "1.96"], group: "γ=2" },
        { label: "0.8", values: ["0.8", "2.44"], group: "γ=2" },
        { label: "0.8", values: ["0.8", "3.69"], group: "γ=5" },
      ],
      curves: [
        { label: "γ=2", expr: "(1 - α^(γ+1)) / (1 - α)", x: "α", fixed: params({ γ: "2" }) },
        { label: "γ=5", expr: "(1 - α^(γ+1)) / (1 - α)", x: "α", fixed: params({ γ: "5" }) },
      ],
      reveal: "groups",
      labels: [],
    }) as Extract<Literal, { kind: "place" }>;
    const r = runVerb(points as VerbRun<"place">, {
      lit,
      labels: {},
      region: region_,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
    });
    const prims = r.frames[0]?.prims ?? [];
    const curveAt = prims.filter((p) => p.p === "path" && p.wipe).map((p) => p.at);
    const dotAt = [...new Set(prims.filter((p) => p.p === "circle" && p.at).map((p) => p.at))];
    expect(curveAt).toEqual(dotAt);
    // Two sentences, 20s each: γ=5's curve is drawn on the second, not in the first seconds.
    const cues: Cue[] = [
      { t0: 0.95, t1: 20 },
      { t0: 20.1, t1: 40 },
    ];
    const frag = stagedFragment(
      "place",
      { files: {}, data: { frames: r.frames, paints: {}, vars: r.vars } },
      region_,
      cues,
      { labels: {}, data: lit },
      theme,
      (x) => x,
    );
    const k = prims.findIndex((p) => p.p === "path" && p.wipe && p.at === 2);
    const wipe = new RegExp(
      `"#SCENEID-f0-w${k}", \\{"attr":\\{"width":0\\}\\}, \\{"attr":\\{"width":[1-9][\\d.]*\\},.*, ([\\d.]+)\\);`,
    );
    expect(Number(wipe.exec(frag.script)?.[1])).toBeGreaterThanOrEqual(20.1);
    const still = stillSpans(frag.script, 1.95, 39.5).filter(([a, b]) => b - a > STILL_MAX);
    expect(still).toEqual([]);
  });

  it("stage: the last step lands in the sentence that opens the last stop; the camera tours after it", () => {
    const lit = literalSchema.parse({
      kind: "place",
      form: "plane",
      axes: [
        { name: "x", lowerIsBetter: false },
        { name: "y", lowerIsBetter: false },
      ],
      items: [
        { label: "Aa", values: ["1", "2"] },
        { label: "Bb", values: ["2", "3"] },
        { label: "Cc", values: ["3", "1"] },
        { label: "Dd", values: ["4", "4"] },
      ],
      labels: [],
    }) as Extract<Literal, { kind: "place" }>;
    const r = runVerb(points as VerbRun<"place">, {
      lit,
      labels: {},
      region: region_,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
    });
    // Two stops: one sentence, then three. The last hold is at 8.
    const cues: Cue[] = [
      { t0: 0.95, t1: 8, stop: true },
      { t0: 8, t1: 14, stop: true },
      { t0: 14, t1: 22 },
      { t0: 22, t1: 30 },
    ];
    const frag = stagedFragment(
      "place",
      { files: {}, data: { frames: r.frames, paints: {}, vars: r.vars } },
      region_,
      cues,
      { labels: {}, data: lit },
      theme,
      (x) => x,
    );
    // Each point comes from its preview to full on its step.
    const at = [
      ...frag.script.matchAll(/\{"opacity":0\.3\}, \{"opacity":1,[^}]*\}, ([\d.]+)\)/g),
    ].map((m) => Number(m[1]));
    expect(at.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...at)).toBeLessThan(14);
    // After it: pushes toward different points, so nothing stands still.
    const origins = [...frag.script.matchAll(/"scale":1\.07,"transformOrigin":"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(origins).size).toBeGreaterThan(1);
    const still = stillSpans(frag.script, 1.95, 29.5).filter(([a, b]) => b - a > STILL_MAX);
    expect(still).toEqual([]);
  });
});
