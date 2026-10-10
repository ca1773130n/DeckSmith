/**
 * The mechanism kinds as `KindImpl`s: thin adapters between the literal pass
 * (src/literal/kind.ts) and the pure computations beside this file
 * (attention.ts … retrieval.ts), which know nothing of files, slots or themes.
 *
 * ONE MAPPING per kind (`run`), from the plan's `literal` to the pure kind's
 * input, used three ways, so they cannot drift apart:
 * - `layers` runs it on the beat's picture and writes the rasters under
 *   `assets/literal/` (`writeLayers`): pictures as JPEG or PNG, heat layers as
 *   white alpha masks the theme colours at draw time;
 * - `fragment` draws every frame as one SVG (`frameSvgs`) in the pack's tokens
 *   with words from the plan's slots, and steps through them on the narration's
 *   sentences: one frame per step, cross-faded, `fromTo` only;
 * - `mechanismProblems` runs it at PLAN time (src/plan/coverage.ts), without
 *   the picture, so a plan the kind cannot draw is sent back for repair instead
 *   of failing `build --literal`.
 *
 * Words are measured in the deck's own face (`widthOf` with the theme the pass
 * hands `layers`, or the plan gate's deck theme). There is no fallback face.
 *
 * An EXAMPLE TAG: when the plan gives the `example` slot, every frame carries
 * it in a band under the scene, and the kind is laid out above the band.
 */
import { join } from "node:path";
import type { Theme } from "../../emit/kit.js";
import type { Literal, LiteralKind } from "../../types.js";
import { type KindImpl, type KindSpec, lab, stepStarts, widthOf } from "../kind.js";
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
import type { Frame, Measure, MechanismResult, Prim, Raster, Region, Rgb } from "./common.js";
import { clamp01, TYPE } from "./common.js";
import { diffusion } from "./diffusion.js";
import { messagePassing } from "./message-passing.js";
import { optimization } from "./optimization.js";
import { retrieval } from "./retrieval.js";
import { rlRollout } from "./rl-rollout.js";
import { splatting } from "./splatting.js";
import { frameSvg, type LayerPaint } from "./svg.js";

/** The kinds this file adapts. */
export const MECHANISMS = [
  "attention",
  "diffusion",
  "optimization",
  "splatting",
  "message-passing",
  "rl-rollout",
  "retrieval",
] as const satisfies readonly LiteralKind[];
export type Mechanism = (typeof MECHANISMS)[number];
export const isMechanism = (k: string): k is Mechanism =>
  (MECHANISMS as readonly string[]).includes(k);

/** The deck's face when the theme is known, else the Latin one. */
const measureOf = (theme?: Theme): Measure => {
  const t = needTheme(theme);
  return (text, size) => widthOf(text, size, t);
};

/** The band an example tag takes under the scene. */
const TAG_H = TYPE.label + 28;

type Lit<K extends LiteralKind> = Extract<Literal, { kind: K }>;

/** What a kind's run is given: the plan's literal, its labels, the picture (absent at plan time), the theme. */
interface Ctx<K extends LiteralKind> {
  lit: Lit<K>;
  labels: Readonly<Record<string, string>>;
  image?: Rgb;
  /** Plan time: there is no picture yet; a kind that needs one validates its fields only. */
  dry: boolean;
  theme?: Theme;
  region: Region;
}

const number = (kind: LiteralKind, labels: Readonly<Record<string, string>>, slot: string) =>
  slotNumber(kind, labels, slot);

/** One mapping per kind: the plan's literal → the pure kind's result (or undefined at plan time when it needs the picture). */
const RUNS: { [K in Mechanism]: (c: Ctx<K>) => MechanismResult | undefined } = {
  attention({ lit: d, image, dry, theme, region }) {
    // With tokens, the scene runs on the tokens (a picture is then unused). Without them, a
    // picture is cut into patches, and per-token heads or embeddings have nothing to fit.
    if (d.picture && !d.tokens.length && (d.heads.length || d.embeddings.length))
      throw new Error(
        "attention: `heads` and `embeddings` are rows per token, and this scene has no `tokens`, only a `picture` (whose patches it compares by pixels); give the `tokens` those rows belong to, or drop `heads` and `embeddings`",
      );
    if (d.picture && !d.tokens.length) {
      if (dry) return undefined;
      if (!image) throw new Error("attention: the `picture` did not resolve to an image");
      return patchAttention({ image, grid: 12 }, region);
    }
    if (!d.tokens.length)
      throw new Error("attention: needs `tokens`, or a `picture` to cut into patches");
    return tokenAttention(
      {
        tokens: d.tokens,
        ...(d.path.length ? { path: d.path } : {}),
        ...(d.heads.length ? { heads: d.heads } : {}),
        ...(d.embeddings.length ? { embeddings: d.embeddings } : {}),
        causal: d.causal,
        measure: measureOf(theme),
      },
      region,
    );
  },
  diffusion({ lit: d, labels, image, dry, region }) {
    const T = number("diffusion", labels, "steps");
    const b0 = number("diffusion", labels, "betaStart");
    const b1 = number("diffusion", labels, "betaEnd");
    if (T !== undefined && (!Number.isInteger(T) || T < 2 || T > 10000))
      throw new Error(`diffusion: \`steps\` must be a whole number of steps, 2..10000, got ${T}`);
    for (const [n, v] of [
      ["betaStart", b0],
      ["betaEnd", b1],
    ] as const)
      if (v !== undefined && !(v > 0 && v < 1))
        throw new Error(`diffusion: \`${n}\` must be a noise level between 0 and 1, got ${v}`);
    if (b0 !== undefined && b1 !== undefined && !(b0 < b1))
      throw new Error("diffusion: `betaStart` must be below `betaEnd`");
    if (dry) return undefined;
    if (!image) throw new Error("diffusion: needs the beat's picture");
    return diffusion(
      {
        image,
        schedule: d.schedule,
        ...(T !== undefined ? { T } : {}),
        ...(b0 !== undefined ? { betaStart: b0 } : {}),
        ...(b1 !== undefined ? { betaEnd: b1 } : {}),
      },
      region,
    );
  },
  optimization({ lit: d, theme, region }) {
    const measure = measureOf(theme);
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
        region,
      );
    if (!d.optimizers.length)
      throw new Error("optimization: needs the source's `series`, or `optimizers` to run");
    return optimization(
      {
        mode: "landscape",
        landscape: d.landscape,
        start: [d.start.x, d.start.y],
        steps: d.steps,
        optimizers: d.optimizers,
        measure,
      },
      region,
    );
  },
  splatting({ lit: d, image, dry, region }) {
    if (dry) {
      // Plan time: the scene's inputs, without rendering it (rendering cannot fail on them).
      const n = d.gaussians.length || d.points.length;
      if (!n && !d.picture)
        throw new Error("splatting: needs `points`, `gaussians` or a `picture`");
      if (d.points.length && d.points.length < 4)
        throw new Error("splatting: needs at least four points");
      if (n > 2000) throw new Error(`splatting: ${n} is over the 2000 the cost bound allows`);
      const bad = [...d.points, ...d.gaussians].some((p) =>
        Object.values(p).some((v) => typeof v === "number" && !Number.isFinite(v)),
      );
      if (bad) throw new Error("splatting: every coordinate, scale and colour must be a number");
      return undefined;
    }
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
        region,
      );
    if (d.points.length)
      return splatting(
        { points: d.points.map((p) => ({ p: [p.x, p.y, p.z], color: [p.r, p.g, p.b] })) },
        region,
      );
    if (!d.picture) throw new Error("splatting: needs `points`, `gaussians` or a `picture`");
    if (dry) return undefined;
    if (!image) throw new Error("splatting: the `picture` did not resolve to an image");
    return splatting({ points: planeOf(image) }, region);
  },
  "message-passing"({ lit: d, theme, region }) {
    return messagePassing(
      {
        nodes: d.nodes,
        edges: d.edges.map((e) => [e.from, e.to] as [string, string]),
        directed: d.directed,
        layers: d.layers,
        aggregate: d.aggregate,
        ...(d.weights.length ? { weights: d.weights } : {}),
        relu: d.activation === "relu",
        ...(d.focus ? { focus: d.focus } : {}),
        measure: measureOf(theme),
      },
      region,
    );
  },
  "rl-rollout"({ lit: d, region }) {
    return rlRollout(
      {
        width: d.width,
        height: d.height,
        walls: d.walls.map((c) => [c.x, c.y] as [number, number]),
        terminals: d.terminals.map((t) => ({
          at: [t.x, t.y] as [number, number],
          reward: t.reward,
        })),
        stepReward: d.stepReward,
        gamma: d.gamma,
        slip: d.slip,
        start: [d.start.x, d.start.y],
        algorithm: d.algorithm,
      },
      region,
    );
  },
  retrieval({ lit: d, theme, region }) {
    const vectors = d.vectors.length > 0;
    if (vectors && (d.vectors.length !== d.items.length || !d.queryVector.length))
      throw new Error("retrieval: `vectors` need one per item, and a `queryVector`");
    return retrieval(
      {
        query: vectors ? { text: d.query, vector: d.queryVector } : { text: d.query },
        items: d.items.map((it, i) => ({
          ...it,
          ...(vectors ? { vector: d.vectors[i] as number[] } : {}),
        })),
        method: vectors ? "cosine" : "bm25",
        k: d.k,
        theme: needTheme(theme),
      },
      region,
    );
  },
};

/** Every run is told the deck's theme (the build's, or the plan gate's): words are laid out in its face. */
function needTheme(theme: Theme | undefined): Theme {
  if (!theme)
    throw new Error(
      "literal: a mechanism kind is laid out in the deck's theme, and none was given",
    );
  return theme;
}

/** Run a kind's mapping, with the example band reserved and drawn when the plan gives the tag. */
function runKind(
  kind: Mechanism,
  lit: Literal,
  labels: Readonly<Record<string, string>>,
  region: Region,
  opts: { image?: Rgb; dry: boolean; theme?: Theme },
): MechanismResult | undefined {
  const tag = labels.example?.trim();
  const inner = tag ? { width: region.width, height: region.height - TAG_H } : region;
  const run = RUNS[kind] as (c: Ctx<LiteralKind>) => MechanismResult | undefined;
  const r = run({ lit: lit as Lit<LiteralKind>, labels, region: inner, ...opts });
  if (!r || !tag) return r;
  const w = measureOf(opts.theme)(tag, TYPE.label) + 32;
  const band: Prim[] = [
    {
      p: "rect",
      id: "exbox",
      x: 0,
      y: inner.height + 8,
      w,
      h: TAG_H - 8,
      fill: "panel",
      role: "accent",
      width: 3,
      radius: 8,
    },
    {
      p: "text",
      id: "ex",
      x: 16,
      y: inner.height + 8 + (TAG_H - 8 - TYPE.label) / 2 - 2,
      size: TYPE.label,
      role: "accent",
      anchor: "start",
      slot: "example",
    },
  ];
  return { ...r, frames: r.frames.map((f) => ({ ...f, prims: [...f.prims, ...band] })) };
}

/**
 * Why a plan's literal cannot be drawn, at plan time: the kind's own checks,
 * run on the plan's data without its picture. Empty when it can be.
 */
export function mechanismProblems(lit: Literal, region: Region, theme: Theme): string[] {
  if (!isMechanism(lit.kind)) return [];
  const labels = Object.fromEntries(lit.labels.map((l) => [l.slot, l.text]));
  try {
    runKind(lit.kind, lit, labels, region, { dry: true, theme });
    return [];
  } catch (e) {
    return [(e as Error).message.replace(/^[\w-]+: /, "")];
  }
}

/** The picture at its own aspect, at most `maxSide` on its longer side. */
async function picture(image: string, maxSide: number): Promise<Rgb> {
  const { w, h } = await nativeSize(image);
  const k = Math.min(1, maxSide / Math.max(w, h));
  return readRgb(image, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
}

/** How large each kind reads its picture. */
const PICTURE_SIDE: Partial<Record<Mechanism, number>> = {
  attention: 1228,
  diffusion: 1024,
  splatting: 40,
};

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

/* ------------------------------------------------------------------ files */

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

/** Write a result's rasters under `dir`; the layers carry the frames and how each raster is painted. */
export async function writeLayers(
  r: MechanismResult,
  beatId: string,
  dir: string,
): Promise<Layers> {
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

/** Every frame of written layers as SVG: what the fragment shows, and what previews and the judge rasterise. */
export function frameSvgs(
  kind: Mechanism,
  L: Layers,
  region: Region,
  spec: KindSpec,
  theme: Theme,
  href: (file: string) => string,
  opts: { ground?: boolean; pad?: number; scene?: boolean } = {},
): string[] {
  const frames = L.data.frames as Frame[];
  const paints = L.data.paints as Record<string, LayerPaint>;
  const text = (slot: string, vars: Readonly<Record<string, string | number>>) =>
    lab(kind, spec, slot, vars);
  return frames.map((f, i) =>
    frameSvg(f, region, (layer) => href(L.files[layer] as string), text, {
      theme,
      paint: (layer) => paints[layer],
      ids: opts.scene ? `SCENEID-f${i}-` : `f${i}-`,
      ...(opts.scene ? { attrs: ` id="SCENEID-f${i}" style="left:0;top:0"` } : {}),
      ...(opts.ground ? { ground: true } : {}),
      ...(opts.pad ? { pad: opts.pad } : {}),
    }),
  );
}

/** Run a kind on a beat's input and write its layers: what `layers` does, for the pass and for the judge. */
export async function mechanismLayers(
  kind: Mechanism,
  input: {
    beatId: string;
    image?: string;
    dir: string;
    region: Region;
    spec: KindSpec;
    theme: Theme;
  },
): Promise<Layers> {
  const lit = input.spec.data as Literal | undefined;
  if (!lit || lit.kind !== kind)
    throw new Error(`literal: the ${kind} scene has no \`literal\` data`);
  const side = PICTURE_SIDE[kind];
  const image = input.image && side ? await picture(input.image, side) : undefined;
  const r = runKind(kind, lit, input.spec.labels, input.region, {
    dry: false,
    ...(image ? { image } : {}),
    theme: input.theme,
  });
  if (!r) throw new Error(`literal: the ${kind} scene needs its picture`);
  return writeLayers(r, input.beatId, input.dir);
}

function mechanismKind(kind: Mechanism, picture: boolean): KindImpl {
  return {
    picture,
    layers: (input) => mechanismLayers(kind, input),
    fragment(L, region, cues, spec, theme, href) {
      const svgs = frameSvgs(kind, L, region, spec, theme, href, { scene: true });
      const at = stepStarts(cues, svgs.length);
      const tl = new Tl();
      svgs.forEach((_, i) => {
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

export const attentionKind = mechanismKind("attention", false);
export const diffusionKind = mechanismKind("diffusion", true);
export const optimizationKind = mechanismKind("optimization", false);
export const splattingKind = mechanismKind("splatting", false);
export const messagePassingKind = mechanismKind("message-passing", false);
export const rlRolloutKind = mechanismKind("rl-rollout", false);
export const retrievalKind = mechanismKind("retrieval", false);

/** The spec a kind reads, from a literal: what `literalPlanOf` builds for the pass. */
export function specOf(lit: Literal): KindSpec {
  return { labels: Object.fromEntries(lit.labels.map((l) => [l.slot, l.text])), data: lit };
}
