/**
 * The frames-only judge fixtures for the mechanism kinds, as GENERATION
 * PARAMETERS, not pictures: each `literal-judge/<case>.json` holds a kind's
 * input (and seed), the slot texts, which three frames to show, and the
 * takeaway those frames must convey. The frames are regenerated from the kind,
 * deterministically — by test/literal-mechanism-kinds.test.ts, and as PNGs by
 * `scripts/literal-kinds-preview.ts --judge` into the gitignored
 * `.cache/literal-judge/` for the judge to read.
 *
 * Inputs are JSON with three stand-ins for what JSON cannot hold:
 *   "picture": { "synthetic": "discs", "w", "h" } → `syntheticPicture(w, h)`
 *   "points":  { "scene": "sphere-box-floor" }   → `scenePoints()`
 *   "seriesFrom": { landscape, start, steps, optimizers, every }
 *              → the curves of those optimizer runs, every `every`-th step.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "../../src/emit/kit.js";
import {
  fillTemplate,
  type MechanismResult,
  type Region,
  type Rgb,
} from "../../src/literal/kinds/common.js";
import {
  attention,
  diffusion,
  messagePassing,
  optimization,
  retrieval,
  rlRollout,
  splatting,
} from "../../src/literal/kinds/index.js";
import { frameSvg } from "../../src/literal/kinds/svg.js";

/** Where the cases live. A bundled script passes its own path (bundling moves `import.meta.url`). */
export const JUDGE_DIR = fileURLToPath(new URL("literal-judge/", import.meta.url));
export const JUDGE_REGION: Region = { width: 1760, height: 920 };

export interface JudgeCase {
  /** The file's name without `.json`. */
  name: string;
  kind: string;
  /** The kind's function: tokenAttention, patchAttention, diffusion, … */
  run: string;
  /** Merged into the input as `seed` when the kind takes one; null when it is not random. */
  seed: number | null;
  input: Record<string, unknown>;
  /** Slot → text, as the planner would write them. */
  labels: Record<string, string>;
  /** The three frames the judge sees, by index. */
  frames: number[];
  takeaway: string;
}

export function loadJudgeCases(dir = JUDGE_DIR): JudgeCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f.slice(0, -5), ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

/** A deterministic picture: a sky-to-ground gradient and three shaded discs. */
export function syntheticPicture(w: number, h: number): Rgb {
  const d = new Float32Array(w * h * 3);
  const discs = [
    [0.24, 0.58, 0.17, [0.86, 0.36, 0.16]],
    [0.55, 0.42, 0.13, [0.16, 0.46, 0.86]],
    [0.8, 0.64, 0.15, [0.3, 0.72, 0.36]],
  ] as const;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = y / h;
      let c: number[] =
        v < 0.55 ? [0.62 + 0.3 * v, 0.74 + 0.2 * v, 0.92] : [0.55, 0.5 - 0.1 * v, 0.38];
      for (const [cx, cy, r, col] of discs) {
        const dx = (x - cx * w) / (r * w);
        const dy = (y - cy * h) / (r * w);
        const q = dx * dx + dy * dy;
        if (q < 1) {
          const lit = 0.55 + 0.45 * Math.max(0, 1 - Math.hypot(dx + 0.35, dy + 0.35));
          c = col.map((k) => Math.min(1, k * lit + 0.25 * (1 - q) * lit));
        }
      }
      d.set(c, (y * w + x) * 3);
    }
  return { w, h, d };
}

/** Points on a sphere, a box and a floor, coloured by where they are. */
export function scenePoints(): Array<{
  p: [number, number, number];
  color: [number, number, number];
}> {
  const pts: Array<{ p: [number, number, number]; color: [number, number, number] }> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 260; i++) {
    const y = 1 - (2 * (i + 0.5)) / 260;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    pts.push({
      p: [-0.9 + 0.7 * r * Math.cos(a), 0.7 + 0.7 * y, 0.7 * r * Math.sin(a)],
      color: [0.75 + 0.2 * r * Math.cos(a), 0.35 + 0.25 * y, 0.25],
    });
  }
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        const q: [number, number, number] = [0, 0, 0];
        const ax = Math.floor(f / 2);
        q[ax] = f % 2 ? 0.5 : -0.5;
        q[(ax + 1) % 3] = -0.5 + (i + 0.5) / 6;
        q[(ax + 2) % 3] = -0.5 + (j + 0.5) / 6;
        pts.push({
          p: [0.9 + q[0] * 0.9, 0.45 + q[1] * 0.9, q[2] * 0.9],
          color: [0.2, 0.35 + 0.1 * f, 0.7],
        });
      }
  for (let i = 0; i < 14; i++)
    for (let j = 0; j < 14; j++)
      pts.push({
        p: [-2 + (4 * (i + 0.5)) / 14, 0, -2 + (4 * (j + 0.5)) / 14],
        color: (i + j) % 2 ? [0.82, 0.8, 0.74] : [0.55, 0.53, 0.48],
      });
  return pts;
}

/** The case's input with its stand-ins resolved; `picture` replaces the synthetic one (a preview's photograph). */
export function resolveInput(c: JudgeCase, picture?: Rgb): Record<string, unknown> {
  const input: Record<string, unknown> = {
    ...c.input,
    ...(c.seed === null ? {} : { seed: c.seed }),
  };
  const pic = input.picture as { synthetic?: string; w?: number; h?: number } | undefined;
  if (pic) {
    if (pic.synthetic !== "discs")
      throw new Error(`judge ${c.name}: unknown picture ${JSON.stringify(pic)}`);
    input.image = picture ?? syntheticPicture(pic.w as number, pic.h as number);
    delete input.picture;
  }
  const pts = input.points as { scene?: string } | undefined;
  if (pts && !Array.isArray(pts)) {
    if (pts.scene !== "sphere-box-floor")
      throw new Error(`judge ${c.name}: unknown scene ${pts.scene}`);
    input.points = scenePoints();
  }
  const from = input.seriesFrom as
    | {
        landscape: optimization.LandscapeName;
        start: [number, number];
        steps: number;
        optimizers: optimization.OptimizerSpec[];
        every: number;
      }
    | undefined;
  if (from) {
    const L = optimization.LANDSCAPES[from.landscape];
    input.series = from.optimizers.map((o) => ({
      label: o.label,
      points: optimization
        .runOptimizer(L, o, from.start, from.steps)
        .loss.map((v, i) => [i, v] as [number, number])
        .filter((_, i) => i % from.every === 0),
    }));
    delete input.seriesFrom;
  }
  return input;
}

type Run = (input: never, region: Region) => MechanismResult;
const RUNS: Record<string, Run> = {
  tokenAttention: attention.tokenAttention as Run,
  patchAttention: attention.patchAttention as Run,
  diffusion: diffusion.diffusion as Run,
  optimization: optimization.optimization as Run,
  splatting: splatting.splatting as Run,
  messagePassing: messagePassing.messagePassing as Run,
  rlRollout: rlRollout.rlRollout as Run,
  retrieval: retrieval.retrieval as Run,
};

export function runJudgeCase(c: JudgeCase, picture?: Rgb): MechanismResult {
  const run = RUNS[c.run];
  if (!run) throw new Error(`judge ${c.name}: no kind function "${c.run}"`);
  return run(resolveInput(c, picture) as never, JUDGE_REGION);
}

/** The sentence the kind itself says its frames convey. */
export function takeawayOf(c: JudgeCase, r: MechanismResult): string {
  if (c.run === "patchAttention") return attention.TAKEAWAY_PATCHES;
  const mod = {
    attention,
    diffusion,
    optimization,
    splatting,
    "message-passing": messagePassing,
    "rl-rollout": rlRollout,
    retrieval,
  }[c.kind];
  if (!mod) throw new Error(`judge ${c.name}: no kind "${c.kind}"`);
  return mod.takeaway(r);
}

/** A slot's text from the case's labels, filled with the frame's values. */
export function slotTextOf(c: JudgeCase) {
  return (slot: string, vars: Readonly<Record<string, string | number>>) => {
    const t = c.labels[slot];
    if (t === undefined) throw new Error(`judge ${c.name}: no label for slot "${slot}"`);
    return fillTemplate(t, vars);
  };
}

/** The judge's frames as SVG, rasters by `href(layer)`. */
export function judgeFramesSvg(
  c: JudgeCase,
  r: MechanismResult,
  theme: Theme,
  href: (layer: string) => string,
  pad = 80,
): string[] {
  return c.frames.map((i) => {
    const f = r.frames[i];
    if (!f) throw new Error(`judge ${c.name}: frame ${i} of ${r.frames.length}`);
    return frameSvg(f, JUDGE_REGION, href, slotTextOf(c), { theme, pad });
  });
}
