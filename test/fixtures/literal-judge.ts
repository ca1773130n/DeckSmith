/**
 * The frames-only judge fixtures for the mechanism kinds, as PLANS, not
 * pictures: each `literal-judge/<case>.json` holds a beat's `literal` (as the
 * planner writes it), its slot texts, which three frames the judge sees, and
 * the takeaway they must convey. The frames are regenerated through the
 * production path — the kind's own `layers` (src/literal/kinds/mechanisms.ts)
 * and `frameSvgs` — by test/literal-mechanism-kinds.test.ts, and as PNGs by
 * `scripts/literal-kinds-preview.ts --judge` into the gitignored
 * `.cache/literal-judge/`.
 *
 * A case with `picture` ({ "synthetic": "discs", "w", "h" }) runs on
 * `syntheticPicture(w, h)`, written as a PNG beside the layers; a preview may
 * pass a photograph instead.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "../../src/emit/kit.js";
import { TAKEAWAY_PATCHES } from "../../src/literal/kinds/attention.js";
import type { Region, Rgb } from "../../src/literal/kinds/common.js";
import { fillTemplate } from "../../src/literal/kinds/common.js";
import { MECHANISM_TAKEAWAYS } from "../../src/literal/kinds/index.js";
import {
  frameSvgs,
  isMechanism,
  type Mechanism,
  mechanismLayers,
} from "../../src/literal/kinds/mechanisms.js";
import type { Layers } from "../../src/literal/kit.js";
import { toRgba, writeRaster } from "../../src/literal/kit.js";
import { type Literal, literalSchema } from "../../src/types.js";

/** Where the cases live. A bundled script passes its own path (bundling moves `import.meta.url`). */
export const JUDGE_DIR = fileURLToPath(new URL("literal-judge/", import.meta.url));
export const JUDGE_REGION: Region = { width: 1760, height: 920 };

export interface JudgeCase {
  /** The file's name without `.json`. */
  name: string;
  kind: Mechanism;
  /** The beat's `literal` as the planner writes it, without its labels. */
  literal: Record<string, unknown>;
  /** Slot → text, as the planner would write them. */
  labels: Record<string, string>;
  picture?: { synthetic: "discs"; w: number; h: number };
  /** The three frames the judge sees, by index. */
  frames: number[];
  takeaway: string;
}

export function loadJudgeCases(dir = JUDGE_DIR): JudgeCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const c = { name: f.slice(0, -5), ...JSON.parse(readFileSync(join(dir, f), "utf8")) };
      if (!isMechanism(c.kind))
        throw new Error(`judge ${c.name}: "${c.kind}" is no mechanism kind`);
      return c as JudgeCase;
    });
}

/** The case's literal, parsed by the planner's own schema (defaults filled), labels included. */
export function literalOf(c: JudgeCase): Literal {
  return literalSchema.parse({
    ...c.literal,
    kind: c.kind,
    labels: Object.entries(c.labels).map(([slot, text]) => ({ slot, text })),
  });
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

export interface JudgeRun {
  layers: Layers;
  /** Every frame as SVG on the theme's ground, rasters by file name in `dir`. */
  svgs: string[];
  takeaway: string;
}

/**
 * Regenerate a case through the deck's own path: the kind's `layers` writes its
 * files into `dir`, `frameSvgs` draws its frames. `photo` replaces the case's
 * synthetic picture (a preview's photograph).
 */
export async function runJudgeCase(
  c: JudgeCase,
  dir: string,
  theme: Theme,
  opts: { photo?: string; pad?: number } = {},
): Promise<JudgeRun> {
  const lit = literalOf(c);
  let image = opts.photo;
  if (c.picture && !image) {
    image = join(dir, `${c.name}-picture.png`);
    const pic = syntheticPicture(c.picture.w, c.picture.h);
    await writeRaster(image, pic.w, pic.h, toRgba(pic));
  }
  const spec = { labels: c.labels, data: lit };
  const layers = await mechanismLayers(c.kind, {
    beatId: c.name,
    ...(image ? { image } : {}),
    dir,
    region: JUDGE_REGION,
    spec,
    theme,
  });
  const svgs = frameSvgs(c.kind, layers, JUDGE_REGION, spec, theme, (f) => f, {
    ground: true,
    pad: opts.pad ?? 80,
  });
  const vars = layers.data.vars as Record<string, string | number>;
  const patches = c.kind === "attention" && lit.kind === "attention" && !lit.tokens.length;
  const takeaway = patches ? TAKEAWAY_PATCHES : fillTemplate(MECHANISM_TAKEAWAYS[c.kind], vars);
  return { layers, svgs, takeaway };
}
