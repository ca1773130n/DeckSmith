/**
 * The mechanism kinds as `KindImpl`s: thin adapters between the literal pass
 * (src/literal/kind.ts) and the pure computations beside this file
 * (attention.ts … retrieval.ts), which know nothing of files, slots or themes.
 *
 * - `layers` maps the beat's `literal` (and picture) to the kind's input, runs
 *   it, and writes its rasters under `assets/literal/`: pictures as JPEG or
 *   PNG, heat layers as white alpha masks the theme colours at draw time, so a
 *   dark pack and a light one share the same files.
 * - `fragment` draws every computed frame as one SVG in the pack's tokens
 *   (svg.ts) with words from the plan's slots, and steps through them on the
 *   narration's sentences: one frame per step, cross-faded, `fromTo` only.
 *
 * Text is laid out at build time with the Latin face's measure (`textWidth`):
 * `layers` is not told the theme, and the layouts keep a margin for it.
 */
import { join } from "node:path";
import type { Theme } from "../../emit/kit.js";
import { textWidth } from "../../emit/svg.js";
import type { Literal, LiteralKind } from "../../types.js";
import { type KindImpl, type KindInput, type KindSpec, lab, stepStarts } from "../kind.js";
import { nativeSize } from "../kinds-shared.js";
import {
  baseCss,
  type Layers,
  mapRgba,
  readRgb,
  slotNumber,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";
import { patchAttention, tokenAttention } from "./attention.js";
import type { Frame, Measure, MechanismResult, Raster, Rgb } from "./common.js";
import { clamp01 } from "./common.js";
import { diffusion } from "./diffusion.js";
import { messagePassing } from "./message-passing.js";
import { optimization } from "./optimization.js";
import { retrieval } from "./retrieval.js";
import { rlRollout } from "./rl-rollout.js";
import { splatting } from "./splatting.js";
import { frameSvg, type LayerPaint } from "./svg.js";

const measure: Measure = (t, size) => textWidth(t, size, 600);

type Lit<K extends LiteralKind> = Extract<Literal, { kind: K }>;
const lit = <K extends LiteralKind>(kind: K, spec: KindSpec): Lit<K> => {
  const d = spec.data as Lit<K> | undefined;
  if (!d || d.kind !== kind) throw new Error(`literal: the ${kind} scene has no \`literal\` data`);
  return d;
};

/** The picture at its own aspect, at most `maxSide` on its longer side. */
async function picture(image: string, maxSide: number): Promise<Rgb> {
  const { w, h } = await nativeSize(image);
  const k = Math.min(1, maxSide / Math.max(w, h));
  return readRgb(image, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
}

/** Pixelated layers are upscaled (nearest) to the size they are drawn at: CSS cannot be asked to. */
function upscales(frames: readonly Frame[], rasters: Readonly<Record<string, Raster>>) {
  const k: Record<string, number> = {};
  for (const f of frames)
    for (const p of f.prims)
      if (p.p === "image" && p.pixelated) {
        const L = rasters[p.layer] as Raster;
        const w = "rgb" in L ? L.rgb.w : "rgba" in L ? L.rgba.w : L.heat.w;
        k[p.layer] = Math.max(k[p.layer] ?? 1, Math.min(64, Math.ceil(p.w / w)));
      }
  return k;
}

function nearest(rgba: Uint8Array, w: number, h: number, k: number) {
  if (k <= 1) return { w, h, rgba };
  const W = w * k;
  const H = h * k;
  const o = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = (Math.floor(y / k) * w + Math.floor(x / k)) * 4;
      o.set(rgba.subarray(s, s + 4), (y * W + x) * 4);
    }
  return { w: W, h: H, rgba: o };
}

/** Write a result's rasters; return the files and how each is painted. */
async function writeLayers(r: MechanismResult, beatId: string, dir: string): Promise<Layers> {
  const files: Record<string, string> = {};
  const paints: Record<string, LayerPaint> = {};
  const k = upscales(r.frames, r.rasters);
  for (const [key, L] of Object.entries(r.rasters)) {
    let out: { w: number; h: number; rgba: Uint8Array };
    let ext = "png";
    if ("rgb" in L) {
      out = { w: L.rgb.w, h: L.rgb.h, rgba: toRgba(L.rgb) };
      ext = "jpg"; // photographs and their noised versions
    } else if ("rgba" in L) {
      const rgba = new Uint8Array(L.rgba.d.length);
      for (let i = 0; i < rgba.length; i++)
        rgba[i] = Math.round(clamp01(L.rgba.d[i] as number) * 255);
      out = { w: L.rgba.w, h: L.rgba.h, rgba };
    } else {
      out = { w: L.heat.w, h: L.heat.h, rgba: mapRgba(L.heat.d, [255, 255, 255]) };
      paints[key] = { mask: L.role, alpha: L.alpha };
    }
    const up = nearest(out.rgba, out.w, out.h, k[key] ?? 1);
    const file = `${beatId}-${key}.${ext}`;
    await writeRaster(join(dir, file), up.w, up.h, up.rgba);
    files[key] = file;
  }
  return { files, data: { frames: r.frames, paints, vars: r.vars } };
}

/** A mechanism kind: `compute` turns the beat into the pure kind's result. */
function mechanismKind(
  kind: LiteralKind,
  picture: boolean,
  compute: (input: KindInput) => Promise<MechanismResult> | MechanismResult,
): KindImpl {
  return {
    picture,
    async layers(input) {
      return writeLayers(await compute(input), input.beatId, input.dir);
    },
    fragment(L, region, cues, spec, theme: Theme, href) {
      const frames = L.data.frames as Frame[];
      const paints = L.data.paints as Record<string, LayerPaint>;
      const text = (slot: string, vars: Readonly<Record<string, string | number>>) =>
        lab(kind, spec, slot, vars);
      const svgs = frames.map((f, i) =>
        frameSvg(f, region, (layer) => href(L.files[layer] as string), text, {
          theme,
          paint: (layer) => paints[layer],
          ids: `SCENEID-f${i}-`,
          attrs: ` id="SCENEID-f${i}" style="left:0;top:0"`,
        }),
      );
      const at = stepStarts(cues, frames.length);
      const tl = new Tl();
      frames.forEach((_, i) => {
        const t = i === 0 ? 0.1 : (at[i] as number);
        tl.show(`f${i}`, t, 0.5);
        if (i > 0) tl.hide(`f${i - 1}`, t + 0.5, 0.3);
      });
      return {
        markup: `<div id="SCENEID-lit">\n${svgs.join("\n")}\n</div>`,
        css: baseCss(theme),
        script: tl.script,
      };
    },
  };
}

const optionalNumber = (kind: LiteralKind, spec: KindSpec, slot: string) =>
  slotNumber(kind, spec.labels, slot);

export const attentionKind = mechanismKind("attention", false, async (input) => {
  const d = lit("attention", input.spec);
  if (input.image && !d.tokens.length)
    return patchAttention({ image: await picture(input.image, 1228), grid: 12 }, input.region);
  if (!d.tokens.length)
    throw new Error("literal: attention needs `tokens`, or a `picture` to cut into patches");
  return tokenAttention(
    {
      tokens: d.tokens,
      ...(d.path.length ? { path: d.path } : {}),
      ...(d.heads.length ? { heads: d.heads } : {}),
      ...(d.embeddings.length ? { embeddings: d.embeddings } : {}),
      causal: d.causal,
      measure,
    },
    input.region,
  );
});

export const diffusionKind = mechanismKind("diffusion", true, async (input) => {
  const T = optionalNumber("diffusion", input.spec, "steps");
  const b0 = optionalNumber("diffusion", input.spec, "betaStart");
  const b1 = optionalNumber("diffusion", input.spec, "betaEnd");
  return diffusion(
    {
      image: await picture(input.image as string, 1024),
      ...(T !== undefined ? { T } : {}),
      ...(b0 !== undefined ? { betaStart: b0 } : {}),
      ...(b1 !== undefined ? { betaEnd: b1 } : {}),
    },
    input.region,
  );
});

export const optimizationKind = mechanismKind("optimization", false, (input) => {
  const d = lit("optimization", input.spec);
  if (d.series.length)
    return optimization(
      {
        mode: "curves",
        series: d.series.map((s) => ({
          label: s.label,
          points: s.points.map((p) => [p.x, p.y] as [number, number]),
        })),
        logY: d.logY,
        measure,
      },
      input.region,
    );
  if (!d.optimizers.length) throw new Error("literal: optimization needs `series` or `optimizers`");
  return optimization(
    {
      mode: "landscape",
      landscape: d.landscape,
      start: [d.start.x, d.start.y],
      steps: d.steps,
      optimizers: d.optimizers,
      measure,
    },
    input.region,
  );
});

export const splattingKind = mechanismKind("splatting", false, async (input) => {
  const d = lit("splatting", input.spec);
  if (d.gaussians.length)
    return splatting(
      {
        gaussians: d.gaussians.map((g) => ({
          mean: [g.x, g.y, g.z],
          scale: [g.sx, g.sy, g.sz],
          rotation: [g.qw, g.qx, g.qy, g.qz],
          color: [g.r, g.g, g.b],
          opacity: g.opacity,
        })),
      },
      input.region,
    );
  if (d.points.length)
    return splatting(
      { points: d.points.map((p) => ({ p: [p.x, p.y, p.z], color: [p.r, p.g, p.b] })) },
      input.region,
    );
  if (!input.image)
    throw new Error("literal: splatting needs `points`, `gaussians` or a `picture`");
  return splatting({ points: planeOf(await picture(input.image, 40)) }, input.region);
});

/** A picture as points on a plane facing the camera: one per pixel, its colour. */
export function planeOf(
  img: Rgb,
): Array<{ p: [number, number, number]; color: [number, number, number] }> {
  const a = img.w / img.h;
  const out: Array<{ p: [number, number, number]; color: [number, number, number] }> = [];
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 3;
      out.push({
        p: [((x + 0.5) / img.w - 0.5) * 2 * a, -((y + 0.5) / img.h - 0.5) * 2, 0],
        color: [img.d[i] as number, img.d[i + 1] as number, img.d[i + 2] as number],
      });
    }
  return out;
}

export const messagePassingKind = mechanismKind("message-passing", false, (input) => {
  const d = lit("message-passing", input.spec);
  return messagePassing(
    {
      nodes: d.nodes,
      edges: d.edges.map((e) => [e.from, e.to] as [string, string]),
      directed: d.directed,
      layers: d.layers,
      aggregate: d.aggregate,
      ...(d.weights.length ? { weights: d.weights } : {}),
      ...(d.focus ? { focus: d.focus } : {}),
      measure,
    },
    input.region,
  );
});

export const rlRolloutKind = mechanismKind("rl-rollout", false, (input) => {
  const d = lit("rl-rollout", input.spec);
  return rlRollout(
    {
      width: d.width,
      height: d.height,
      walls: d.walls.map((c) => [c.x, c.y] as [number, number]),
      terminals: d.terminals.map((t) => ({ at: [t.x, t.y] as [number, number], reward: t.reward })),
      stepReward: d.stepReward,
      gamma: d.gamma,
      slip: d.slip,
      start: [d.start.x, d.start.y],
      algorithm: d.algorithm,
    },
    input.region,
  );
});

export const retrievalKind = mechanismKind("retrieval", false, (input) => {
  const d = lit("retrieval", input.spec);
  const vectors = d.vectors.length > 0;
  if (vectors && (d.vectors.length !== d.items.length || !d.queryVector.length))
    throw new Error("literal: retrieval's `vectors` need one per item, and a `queryVector`");
  return retrieval(
    {
      query: vectors ? { text: d.query, vector: d.queryVector } : { text: d.query },
      items: d.items.map((it, i) => ({
        ...it,
        ...(vectors ? { vector: d.vectors[i] as number[] } : {}),
      })),
      method: vectors ? "cosine" : "bm25",
      k: d.k,
      measure,
    },
    input.region,
  );
});
