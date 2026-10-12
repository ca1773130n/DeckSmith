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
import { evolve } from "../src/literal/kinds/evolve.js";
import { flow, tokenChips } from "../src/literal/kinds/flow.js";
import { operate } from "../src/literal/kinds/operate.js";
import { placeForm, points, ticksOf } from "../src/literal/kinds/place.js";
import { findBands, findPanels, region } from "../src/literal/kinds/region.js";
import {
  type Earlier,
  frameFill,
  placeholderPicture,
  runVerb,
  stagedFragment,
  type VerbRun,
} from "../src/literal/kinds/stage.js";
import { tableKind } from "../src/literal/kinds/table.js";
import { type Cue, stillSpans } from "../src/literal/kit.js";
import {
  LITERAL_KIND_DOCS,
  LITERAL_OPS,
  type Literal,
  type LiteralOpDoc,
  literalSchema,
} from "../src/types.js";

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
      labels: L({ state: "x_t", trace: "signal and noise", example: "example" }),
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
      labels: L({ state: "x_t", trace: "signal and noise", example: "example" }),
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
  /* flow */
  {
    name: "encoder–decoder",
    domain: "computer-vision",
    lit: {
      kind: "flow",
      form: "chain",
      stages: [
        { id: "in", label: "input", learned: false, shape: "256×256" },
        { id: "enc", label: "encoder", learned: true },
        { id: "dec", label: "decoder", learned: true },
        { id: "out", label: "output", learned: false, show: "b1" },
      ],
      edges: [
        { from: "in", to: "enc" },
        { from: "enc", to: "dec" },
        { from: "dec", to: "out" },
        { from: "in", to: "out", skip: true },
      ],
      labels: L({ learned: "learned", example: "example" }),
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
        { id: "r", label: "retriever", learned: true, phase: "train" },
        { id: "rank", label: "reranker", learned: true },
        { id: "gen", label: "generator", learned: true },
        { id: "aux", label: "auxiliary decoder", learned: true, phase: "train" },
        { id: "ans", label: "answer", learned: false },
      ],
      labels: L({ learned: "learned", train: "training", infer: "inference" }),
    },
  },
  {
    name: "molecule messages",
    domain: "chemistry",
    lit: {
      kind: "flow",
      form: "graph",
      nodes: [
        { id: "a", label: "C1", features: [1, 0] },
        { id: "b", label: "C2", features: [0, 1] },
        { id: "c", label: "O", features: [1, 1] },
        { id: "d", label: "N", features: [0, 0] },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
      ],
      labels: L({ layer: "layer {l} of {L}", field: "{count} atoms", example: "example" }),
    },
  },
  {
    name: "friend features",
    domain: "social-networks",
    lit: {
      kind: "flow",
      form: "graph",
      aggregate: "sum",
      layers: 3,
      nodes: [
        { id: "a", label: "Ann", features: [1] },
        { id: "b", label: "Bo", features: [0] },
        { id: "c", label: "Cy", features: [0] },
        { id: "d", label: "Di", features: [0] },
        { id: "e", label: "Ed", features: [0] },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "d", to: "e" },
      ],
      labels: L({ layer: "layer {l} of {L}", field: "{count} people", example: "example" }),
    },
  },
  {
    name: "draft then verify",
    domain: "language-models",
    lit: {
      kind: "flow",
      form: "timeline",
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
      kind: "flow",
      form: "timeline",
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
    name: "training crops",
    domain: "image-restoration",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "crops",
      size: { value: "64" },
      count: { value: "4" },
      gather: true,
      labels: L({ picture: "training picture", batch: "one batch", example: "example" }),
    },
  },
  {
    name: "tissue patches",
    domain: "pathology",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "crops",
      size: { value: "96" },
      count: { value: "6" },
      labels: L({ picture: "slide", example: "example" }),
    },
  },
  {
    name: "patch grid",
    domain: "image-classification",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "grid",
      size: { value: "32" },
      labels: L({ picture: "image as patches", example: "example" }),
    },
  },
  {
    name: "map tiles",
    domain: "cartography",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "grid",
      size: { value: "48" },
      labels: L({ picture: "tiles", example: "example" }),
    },
  },
  {
    name: "robot architecture, panel by panel",
    domain: "robotics",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "panels",
      labels: L({ picture: "the controller" }),
    },
  },
  {
    name: "micrograph series",
    domain: "materials-science",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "panels",
      count: { value: "2" },
      labels: L({ picture: "grain growth" }),
    },
  },
  {
    name: "a worked decoding example, line by line",
    domain: "language-models",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "rows",
      count: { value: "3" },
      labels: L({ picture: "accepted, rejected, corrected" }),
    },
  },
  {
    name: "a proof's steps, line by line",
    domain: "mathematics",
    lit: {
      kind: "region",
      picture: "b1",
      cut: "rows",
      labels: L({ picture: "the derivation" }),
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

/** An earlier region scene, for a stream `from` it. */
function earlierFor(): Map<string, Earlier> {
  const r = runVerb(region as VerbRun<"region">, {
    lit: literalSchema.parse({
      kind: "region",
      picture: "b1",
      cut: "crops",
      size: { value: "32" },
      count: { value: "8" },
      labels: L({ picture: "p", example: "example" }),
    }) as Extract<Literal, { kind: "region" }>,
    labels: { picture: "p", example: "example" },
    region: region_,
    theme,
    measure,
    dry: true,
    earlier: new Map(),
    assets: {},
  });
  return new Map([
    [
      "b2",
      {
        kind: "region",
        layers: {
          files: { thumb: "t.jpg" },
          data: {},
          ...(r.material ? { material: r.material } : {}),
        },
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
    return `operate:${lit.picture ? "map" : lit.vectors.length ? "profile" : "grid"}`;
  if (lit.kind === "evolve") return `evolve:${lit.rule}${lit.how ? `:${lit.how}` : ""}`;
  if (lit.kind === "flow") return `flow:${lit.form}`;
  if (lit.kind === "place") return `place:${placeForm(lit)}:${lit.form}`;
  if (lit.kind === "region") return `region:${lit.cut}`;
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
  "operate:profile": 0.5,
  "operate:grid": 0.3,
  evolve: 0.45,
  "flow:chain": 0.35,
  // Nodes and edges only, spread over the region by the layout: the least of any form.
  "flow:graph": 0.05,
  "flow:timeline": 0.35,
  place: 0.5,
  region: 0.4,
  // A panel is drawn at its own aspect, full height: a tall one in a wide
  // region cannot cover more, and stretching it would change the figure.
  "region:panels": 0.3,
  // A band of a figure is wide and short: it fills the height it is given and pans.
  "region:rows": 0.25,
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
      "evolve:reset:soft",
      "evolve:reset:hard",
      "flow:chain",
      "flow:graph",
      "flow:timeline",
      "place:points:plane",
      "place:points:strip",
      "region:crops",
      "region:grid",
      "region:panels",
      "region:rows",
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
        labels: L({ learned: "learned" }),
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
        labels: L({ learned: "model" }),
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

  it("region panels: a figure splits along its blank gutters, in reading order", () => {
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
    // One block, no gutter: no panels to walk.
    const solid = new Float32Array(W * H * 3).fill(1);
    for (let i = 0; i < 100 * 100 * 3; i++) solid[i] = 0.2;
    expect(findPanels({ w: W, h: H, d: solid })).toHaveLength(1);
  });

  it("region rows: a box's thin edges crossing the gaps (a legend) do not join the bands", () => {
    const W = 600;
    const H = 120;
    const d = new Float32Array(W * H * 3).fill(1);
    const block = (x0: number, y0: number, w: number, h: number) => {
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) for (let k = 0; k < 3; k++) d[(y * W + x) * 3 + k] = 0.3;
    };
    block(10, 10, 300, 25);
    block(10, 45, 400, 25);
    block(10, 80, 580, 25);
    // A legend box over the first two rows: 2px edges either side, running through the gap.
    block(480, 8, 2, 64);
    block(560, 8, 2, 64);
    const ys = findBands({ w: W, h: H, d }).map((b) => [b.y, b.h]);
    expect(ys).toEqual([
      [10, 25],
      [45, 25],
      [80, 25],
    ]);
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

  it("flow timeline: totals on some lanes and not others", () => {
    expect(
      problems({
        kind: "flow",
        form: "timeline",
        lanes: [
          { label: "x", total: { value: "2" }, runs: [{ label: "r", parallel: false }] },
          { label: "y", runs: [{ label: "r", parallel: false }] },
        ],
        labels: L({ unit: "u" }),
      })[0],
    ).toMatch(/every lane a `total`/);
  });

  it("region: a crop larger than the training picture", () => {
    expect(
      problems({
        kind: "region",
        picture: "b1",
        cut: "crops",
        size: { value: "512" },
        count: { value: "2" },
        resize: { value: "256" },
        labels: L({ picture: "p", example: "example" }),
      })[0],
    ).toMatch(/resize|does not fit/);
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
    // Two phases, two frames; the frozen phase reveals its inputs one by one.
    expect(d.r.frames.map((f) => f.id)).toEqual(["p0", "p1"]);
    expect(d.r.frames[1]?.prims.filter((p) => p.p === "circle" && p.at).length).toBeGreaterThan(0);
  });

  it("flow timeline: lane lengths are Σ count·dur when every duration is stated", () => {
    const d = draw(FIXTURES.find((f) => f.name === "draft then verify") as Fixture);
    const track = d.r.frames[0]?.prims.filter((p) => p.p === "rect" && p.h === 4) as Array<{
      w: number;
    }>;
    // 8·1 against 7·0.05 + 1·1 = 1.35.
    expect((track[1]?.w ?? 0) / (track[0]?.w ?? 1)).toBeCloseTo(1.35 / 8, 3);
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

  it("flow timeline: with no time stated, a parallel run is one step, so its lane is shorter", () => {
    const d = draw(FIXTURES.find((f) => f.name === "draft then verify") as Fixture);
    expect(d.r.data.scale).toBe("dur");
    const lit = literalSchema.parse({
      kind: "flow",
      form: "timeline",
      lanes: [
        { label: "serial", runs: [{ label: "K runs", parallel: false }] },
        { label: "at once", runs: [{ label: "K+1 checks", parallel: true }] },
      ],
      labels: L({ unit: "one call", example: "example" }),
    }) as Extract<Literal, { kind: "flow" }>;
    const r = runVerb(flow as VerbRun<"flow">, {
      lit,
      labels: { unit: "one call", example: "example" },
      region: region_,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
    });
    const track = r.frames[0]?.prims.filter((p) => p.p === "rect" && p.h === 4) as Array<{
      w: number;
    }>;
    // Four example serial steps against one parallel step.
    expect((track[1]?.w ?? 0) / (track[0]?.w ?? 1)).toBeCloseTo(1 / 4, 3);
    // Every run's words are on a plate.
    const plates = r.frames[0]?.prims.filter((p) => p.p === "rect" && p.opacity === 0.92) ?? [];
    expect(plates.length).toBe(2);
  });

  it("flow chain: a stage whose shape is one blank chip is refused", () => {
    const lit = literalSchema.parse({
      kind: "flow",
      form: "chain",
      stages: [
        { id: "a", label: "draft", learned: true, shape: "γ" },
        { id: "b", label: "one more", learned: false, shape: "1" },
      ],
      labels: L({ learned: "model call" }),
    }) as Literal;
    expect(drawProblems(lit, region_, theme)[0]).toMatch(/one blank chip/);
  });

  it("flow timeline: lanes of equal serial steps on example material are refused", () => {
    const lit = literalSchema.parse({
      kind: "flow",
      form: "timeline",
      lanes: [
        { label: "x", runs: [{ label: "r", parallel: false }] },
        { label: "y", runs: [{ label: "s", parallel: false }] },
      ],
      labels: L({ unit: "u", example: "example" }),
    }) as Literal;
    expect(drawProblems(lit, region_, theme)[0]).toMatch(/same number of serial steps/);
  });

  it("flow timeline: a stated duration is one block, and a stated total is printed at its lane's end", () => {
    const lit = literalSchema.parse({
      kind: "flow",
      form: "timeline",
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
    }) as Extract<Literal, { kind: "flow" }>;
    const r = runVerb(flow as VerbRun<"flow">, {
      lit,
      labels: { unit: "s" },
      region: region_,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
    });
    const prims = r.frames[0]?.prims ?? [];
    const blocks = prims.filter((p) => p.p === "rect" && p.wipe);
    expect(blocks).toHaveLength(2);
    const ends = prims
      .filter((p) => p.p === "text" && p.role === "accent")
      .map((p) => (p as { text: string }).text);
    expect(ends).toEqual(["4.46 s", "0.24 s"]);
  });

  it("flow timeline: words too wide for a late run wrap under its lane, in the region, clear of the next lane", () => {
    const lit = literalSchema.parse({
      kind: "flow",
      form: "timeline",
      lanes: [
        {
          label: "full",
          total: { value: "4" },
          runs: [
            { label: "read", parallel: false },
            { label: "attend to only part of the input or stop early", parallel: false },
          ],
        },
        { label: "short", total: { value: "1" }, runs: [{ label: "read", parallel: false }] },
      ],
      labels: L({ unit: "one call", example: "example" }),
    }) as Extract<Literal, { kind: "flow" }>;
    const narrow = { width: 860, height: 1100 };
    const r = runVerb(flow as VerbRun<"flow">, {
      lit,
      labels: { unit: "one call", example: "example" },
      region: narrow,
      theme,
      measure,
      dry: true,
      earlier: new Map(),
      assets: {},
    });
    const prims = r.frames[0]?.prims ?? [];
    const lanes = prims.filter((p) => p.p === "rect" && p.opacity === 0.5) as Array<{
      y: number;
      h: number;
    }>;
    const under = prims.filter((p) => p.p === "text" && p.role === "muted" && !p.slot) as Array<{
      x: number;
      y: number;
      text: string;
    }>;
    expect(under.length).toBe(2);
    for (const t of under) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + measure(t.text, 40)).toBeLessThanOrEqual(narrow.width);
      expect(t.y + 40).toBeLessThanOrEqual(lanes[1]?.y ?? 0);
    }
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

  it("region crops leave their pieces for a later stream", () => {
    const d = draw(FIXTURES.find((f) => f.name === "training crops") as Fixture);
    expect(d.r.material?.tiles).toHaveLength(4);
  });
});
