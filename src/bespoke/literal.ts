/**
 * LITERAL SCENES (prototype): a beat drawn as the paper's own mechanism acting
 * on real material from its domain, instead of a metaphor device.
 *
 * WHY THIS EXISTS. The bespoke pass asks Codex for a unique *metaphor* per beat
 * (`devicePrompt`), so "weak features are suppressed" came back as a red gate
 * in a canyon. A viewer watching it learns nothing about spikes. Here the beat
 * names a mechanism (`kind`) and the one thing the viewer must be able to
 * explain afterwards (`takeaway`); the build computes the mechanism's real
 * intermediate layers from the deck's own picture, and the scene shows them
 * changing one causal step at a time, on the narration's cues.
 *
 * EVERY LAYER IS COMPUTED AT BUILD TIME, deterministically (invariant 4): the
 * picture is decoded through ffmpeg (already `render`'s dependency), the maths
 * is plain TypeScript, and the layers are written back as files under
 * `assets/literal/`. Nothing here runs in the page but tweens.
 *
 * WHAT IS EXACT AND WHAT IS ILLUSTRATIVE.
 * - haze: the atmospheric scattering model I = J·t + A·(1−t) with a uniform t.
 *   A crossfade from J to I at opacity α IS that model at t' = 1 − α(1 − t), so
 *   the fade is the physics, not an approximation of it. Sobel is linear and
 *   blind to a constant, so the edge map under haze is exactly t × the clear
 *   one, and the brightness profile is the clear one scaled by t about A.
 * - spikes: a leaky integrate-and-fire neuron (soft reset) per feature cell,
 *   simulated for `STEPS` steps. The features are the hazy picture's own edge
 *   energy. The input gain is chosen so that the weakest 40% of cells sit
 *   below threshold — an illustrative parameter, NOT the paper's measurement.
 * - sobel: the real 3×3 Sobel response of the hazy picture; the reweighting
 *   F·(1 + S) is a schematic of "the structure map gates and reweights the
 *   features", not the paper's exact SSM layer.
 *
 * The emitted fragment goes through the same shell as a Codex-written scene
 * (`bespokeScene`): the deck keeps its chrome, holds and handoffs.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  bespokeStaging,
  type DeckNarration,
  emitComposition,
  planCut,
} from "../emit/composition.js";
import type { EmitContext, Theme } from "../emit/kit.js";
import { deckLook } from "../emit/theme.js";
import { TYPE_SCALE } from "../emit/type.js";
import { planTiming } from "../render/timing.js";
import type { Beat, Format, Source, Storyboard } from "../types.js";
import { sceneWindows } from "../verify/scenes.js";
import type { Fragment } from "./contract.js";
import { type BespokeEntry, type BespokeMap, bespokeRegion } from "./scene.js";

const run = promisify(execFile);

/* ------------------------------------------------------------------ the plan */

export const LITERAL_KINDS = ["haze", "spikes", "sobel"] as const;
export type LiteralKind = (typeof LITERAL_KINDS)[number];

const specSchema = z.object({
  kind: z.enum(LITERAL_KINDS),
  /** The one thing the viewer can explain after this scene. Judged against. */
  takeaway: z.string().min(1),
  /** The scene's few words, in the deck's language, by slot. */
  labels: z.record(z.string(), z.string()).default({}),
});
export type LiteralSpec = z.infer<typeof specSchema>;

export const literalPlanSchema = z.object({
  /** The domain picture every layer is computed from, relative to the plan file. */
  image: z.string().min(1),
  beats: z.record(z.string(), specSchema),
});
export type LiteralPlan = z.infer<typeof literalPlanSchema>;

/** Where the computed layers live in a deck. */
export const LITERAL_DIR = "assets/literal";

/* ------------------------------------------------------------------- rasters */

/** An RGB picture, 0..1 per channel, row-major. */
export interface Rgb {
  w: number;
  h: number;
  d: Float32Array;
}

/** Decode any picture ffmpeg reads, resampled (area) to w×h. */
export async function readRgb(file: string, w: number, h: number): Promise<Rgb> {
  const { stdout } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      `scale=${w}:${h}:flags=area`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 256 << 20 },
  );
  const buf = stdout as unknown as Buffer;
  if (buf.length !== w * h * 3)
    throw new Error(
      `literal: ffmpeg decoded ${buf.length} bytes of ${file}, expected ${w * h * 3}`,
    );
  const d = new Float32Array(w * h * 3);
  for (let i = 0; i < d.length; i++) d[i] = (buf[i] as number) / 255;
  return { w, h, d };
}

/** Write RGBA bytes as a PNG (lossless) or a JPEG (`.jpg`, photographs only). */
export async function writeRaster(
  out: string,
  w: number,
  h: number,
  rgba: Uint8Array,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "decksmith-literal-"));
  try {
    const raw = join(dir, "in.rgba");
    await writeFile(raw, rgba);
    const jpg = out.endsWith(".jpg");
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${w}x${h}`,
      "-i",
      raw,
      ...(jpg ? ["-q:v", "2", "-pix_fmt", "yuvj444p"] : ["-pix_fmt", "rgba"]),
      "-frames:v",
      "1",
      out,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function toRgba(img: Rgb): Uint8Array {
  const o = new Uint8Array(img.w * img.h * 4);
  for (let i = 0, j = 0; i < img.w * img.h; i++, j += 3) {
    o[i * 4] = clamp255(img.d[j] as number);
    o[i * 4 + 1] = clamp255(img.d[j + 1] as number);
    o[i * 4 + 2] = clamp255(img.d[j + 2] as number);
    o[i * 4 + 3] = 255;
  }
  return o;
}

/** A grey map (0..1) as RGBA: `color` at `alpha` = value, or grey levels when no colour. */
function mapRgba(v: Float32Array, color?: [number, number, number]): Uint8Array {
  const o = new Uint8Array(v.length * 4);
  for (let i = 0; i < v.length; i++) {
    const a = Math.max(0, Math.min(1, v[i] as number));
    if (color) {
      o[i * 4] = color[0];
      o[i * 4 + 1] = color[1];
      o[i * 4 + 2] = color[2];
      o[i * 4 + 3] = clamp255(a);
    } else {
      const g = clamp255(a);
      o[i * 4] = g;
      o[i * 4 + 1] = g;
      o[i * 4 + 2] = g;
      o[i * 4 + 3] = 255;
    }
  }
  return o;
}

function clamp255(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x * 255)));
}

/* ------------------------------------------------------------------ the maths */

/** Rec. 709 luma. */
export function luma(img: Rgb): Float32Array {
  const l = new Float32Array(img.w * img.h);
  for (let i = 0, j = 0; i < l.length; i++, j += 3)
    l[i] =
      0.2126 * (img.d[j] as number) +
      0.7152 * (img.d[j + 1] as number) +
      0.0722 * (img.d[j + 2] as number);
  return l;
}

/** The atmospheric scattering model with a uniform transmission t and airlight A. */
export function haze(img: Rgb, t: number, A: readonly [number, number, number]): Rgb {
  const d = new Float32Array(img.d.length);
  for (let i = 0; i < d.length; i++)
    d[i] = (img.d[i] as number) * t + (A[i % 3] as number) * (1 - t);
  return { w: img.w, h: img.h, d };
}

/** 3×3 Sobel gradient magnitude, edges replicated. */
export function sobel(l: Float32Array, w: number, h: number): Float32Array {
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number;
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx =
        -at(x - 1, y - 1) +
        at(x + 1, y - 1) -
        2 * at(x - 1, y) +
        2 * at(x + 1, y) -
        at(x - 1, y + 1) +
        at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1) +
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1);
      m[y * w + x] = Math.hypot(gx, gy);
    }
  return m;
}

/** Separable box blur of radius r. */
export function boxBlur(l: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src[yy * w + xx] as number;
          n++;
        }
        out[y * w + x] = s / n;
      }
    return out;
  };
  return pass(pass(l, true), false);
}

/** The q-quantile (0..1) of a list, by sorting a copy. */
export function quantile(v: ArrayLike<number>, q: number): number {
  const s = Array.from(v).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] as number;
}

function scale(v: Float32Array, k: number): Float32Array {
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = (v[i] as number) * k;
  return o;
}

/** Mean of a map over a cols×rows grid of cells. */
export function cellMeans(
  v: Float32Array,
  w: number,
  h: number,
  cols: number,
  rows: number,
): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols);
      const x1 = Math.floor(((c + 1) * w) / cols);
      const y0 = Math.floor((r * h) / rows);
      const y1 = Math.floor(((r + 1) * h) / rows);
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += v[y * w + x] as number;
      out.push(s / Math.max(1, (x1 - x0) * (y1 - y0)));
    }
  return out;
}

/** One leaky integrate-and-fire neuron, constant input, soft reset. */
export interface LifRun {
  /** Membrane potential at each step BEFORE any reset — what the trace draws. */
  pre: number[];
  /** Potential after the step's reset. */
  post: number[];
  /** The steps it fired on. */
  spikes: number[];
}

export function lif(x: number, steps: number, leak: number, theta: number): LifRun {
  let v = 0;
  const pre: number[] = [];
  const post: number[] = [];
  const spikes: number[] = [];
  for (let k = 0; k < steps; k++) {
    v = leak * v + x;
    pre.push(v);
    if (v >= theta) {
      spikes.push(k);
      v -= theta;
    }
    post.push(v);
  }
  return { pre, post, spikes };
}

/** SNN time steps simulated, and the neuron's constants. */
export const STEPS = 8;
export const LEAK = 0.5;
export const THETA = 1;

/* -------------------------------------------------------------- the layers */

/** Haze constants: the picture keeps 35% of its own light; the rest is airlight. */
export const T_HAZE = 0.35;
export const AIRLIGHT: readonly [number, number, number] = [0.84, 0.86, 0.88];

export interface Layers {
  /** File names under `LITERAL_DIR`. */
  files: Record<string, string>;
  /** Numbers the fragment draws (profiles, grids, traces). */
  data: Record<string, unknown>;
}

/** Edge colour on a dimmed photograph: a warm white that reads on any pack. */
const EDGE: [number, number, number] = [255, 226, 120];

/** The haze scene: clear and hazy picture, their edge maps on ONE scale, one row's brightness. */
async function hazeLayers(image: string, dir: string, beatId: string, box: Box): Promise<Layers> {
  const { w, h } = box.img;
  const clear = await readRgb(image, w, h);
  const hazy = haze(clear, T_HAZE, AIRLIGHT);
  const files = {
    clear: `${beatId}-clear.jpg`,
    hazy: `${beatId}-hazy.jpg`,
    edgeClear: `${beatId}-edge-clear.png`,
    edgeHazy: `${beatId}-edge-hazy.png`,
  };
  await writeRaster(join(dir, files.clear), w, h, toRgba(clear));
  await writeRaster(join(dir, files.hazy), w, h, toRgba(hazy));
  // Edge maps at the panel's own size, both divided by the CLEAR map's p99, so
  // the hazy one is dimmer by exactly t and nothing renormalises it back up.
  const ew = box.edge.w;
  const eh = box.edge.h;
  const small = await readRgb(image, ew, eh);
  const eClear = sobel(luma(small), ew, eh);
  const eHazy = sobel(luma(haze(small, T_HAZE, AIRLIGHT)), ew, eh);
  const norm = 1 / Math.max(1e-6, quantile(eClear, 0.99));
  await writeRaster(join(dir, files.edgeClear), ew, eh, mapRgba(scale(eClear, norm)));
  await writeRaster(join(dir, files.edgeHazy), ew, eh, mapRgba(scale(eHazy, norm)));
  // The row with the most going on, in the picture's middle band: its brightness profile.
  const l = luma(clear);
  let best = Math.round(h / 2);
  let bestVar = -1;
  for (let y = Math.round(h * 0.3); y < Math.round(h * 0.7); y++) {
    let s = 0;
    let s2 = 0;
    for (let x = 0; x < w; x++) {
      const v = l[y * w + x] as number;
      s += v;
      s2 += v * v;
    }
    const varY = s2 / w - (s / w) ** 2;
    if (varY > bestVar) {
      bestVar = varY;
      best = y;
    }
  }
  const N = 120;
  const profile: number[] = [];
  for (let i = 0; i < N; i++) {
    const x0 = Math.floor((i * w) / N);
    const x1 = Math.floor(((i + 1) * w) / N);
    let s = 0;
    let n = 0;
    for (let y = best - 1; y <= best + 1; y++)
      for (let x = x0; x < x1; x++, n++) s += l[y * w + x] as number;
    profile.push(round3(s / n));
  }
  const airY = 0.2126 * AIRLIGHT[0] + 0.7152 * AIRLIGHT[1] + 0.0722 * AIRLIGHT[2];
  return { files, data: { row: best, profile, air: round3(airY), t: T_HAZE } };
}

/** The spike scene: the hazy picture's edge energy per cell, each cell an LIF neuron. */
async function spikeLayers(image: string, dir: string, beatId: string, box: Box): Promise<Layers> {
  const { w, h } = box.img;
  const hazy = haze(await readRgb(image, w, h), T_HAZE, AIRLIGHT);
  const files = { hazy: `${beatId}-hazy.jpg` };
  await writeRaster(join(dir, files.hazy), w, h, toRgba(hazy));
  const e = sobel(luma(hazy), w, h);
  const cols = GRID.cols;
  const rows = GRID.rows;
  const cells = cellMeans(e, w, h, cols, rows);
  const top = Math.max(1e-6, quantile(cells, 0.98));
  const x = cells.map((c) => Math.min(1, c / top));
  // Gain: the weakest 40% of cells settle below threshold (x·g/(1−λ) < θ).
  const gain = (THETA * (1 - LEAK)) / Math.max(1e-6, quantile(x, 0.4));
  const runs = x.map((xi) => lif(xi * gain * 0.999, STEPS, LEAK, THETA));
  const counts = runs.map((r) => r.spikes.length);
  // Three witnesses: a strong, a middling and a weak cell, each its own trace.
  // Interior cells only: a witness on the map's border is half hidden by the panel's edge.
  const inside = (i: number) =>
    i % cols > 0 &&
    i % cols < cols - 1 &&
    Math.floor(i / cols) > 0 &&
    Math.floor(i / cols) < rows - 1;
  const order = x
    .map((v, i) => [v, i] as const)
    .filter(([, i]) => inside(i))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pick = (q: number) =>
    (order[Math.round(q * (order.length - 1))] as readonly [number, number])[1];
  const witnesses = [pick(0.93), pick(0.62), pick(0.22)].map((i) => ({
    cell: i,
    x: round3(x[i] as number),
    input: round3((x[i] as number) * gain * 0.999),
    ...runs[i],
    pre: (runs[i] as LifRun).pre.map(round3),
    post: (runs[i] as LifRun).post.map(round3),
    // Without the leak the same input would cross: what the leak costs.
    noLeak: lif((x[i] as number) * gain * 0.999, STEPS, 1, THETA),
  }));
  return {
    files,
    data: {
      cols,
      rows,
      x: x.map(round3),
      counts,
      witnesses,
      steps: STEPS,
      leak: LEAK,
      theta: THETA,
    },
  };
}

/** The Sobel scene: the hazy picture, its Sobel structure map, a smoothed feature and its reweighting. */
async function sobelLayers(image: string, dir: string, beatId: string, box: Box): Promise<Layers> {
  const { w, h } = box.img;
  const hazy = haze(await readRgb(image, w, h), T_HAZE, AIRLIGHT);
  const files = {
    hazy: `${beatId}-hazy.jpg`,
    edges: `${beatId}-sobel.png`,
    feat: `${beatId}-feat.png`,
    featS: `${beatId}-feat-s.png`,
    featW: `${beatId}-feat-w.png`,
  };
  await writeRaster(join(dir, files.hazy), w, h, toRgba(hazy));
  const e = sobel(luma(hazy), w, h);
  const s = scale(e, 1 / Math.max(1e-6, quantile(e, 0.985)));
  await writeRaster(join(dir, files.edges), w, h, mapRgba(s, EDGE));
  // The feature panels at their own size.
  const fw = box.feat.w;
  const fh = box.feat.h;
  const hs = haze(await readRgb(image, fw, fh), T_HAZE, AIRLIGHT);
  const lf = luma(hs);
  // A smoothed feature (the membrane's low-pass), stretched for display.
  const f = boxBlur(lf, fw, fh, 5);
  const lo = quantile(f, 0.02);
  const hi = quantile(f, 0.98);
  const fn = f.map((v) => (v - lo) / Math.max(1e-6, hi - lo));
  const ef = sobel(lf, fw, fh);
  const sn = scale(ef, 1 / Math.max(1e-6, quantile(ef, 0.985)));
  // Gated and reweighted: F · (0.5 + 1.5·S), on the same display scale as F —
  // flat regions dim, edges and texture come forward.
  const fw2 = fn.map(
    (v, i) =>
      v * 0.55 * (0.5 + 1.5 * Math.min(1, sn[i] as number)) + 0.35 * Math.min(1, sn[i] as number),
  );
  await writeRaster(join(dir, files.feat), fw, fh, mapRgba(scale(fn, 0.55)));
  await writeRaster(join(dir, files.featS), fw, fh, mapRgba(sn, EDGE));
  await writeRaster(join(dir, files.featW), fw, fh, mapRgba(fw2));
  return { files, data: {} };
}

/* ------------------------------------------------------------------ layout */

/** Every literal scene's feature grid. 3:2 like the picture. */
export const GRID = { cols: 18, rows: 12 } as const;

interface Box {
  W: number;
  H: number;
  img: { w: number; h: number };
  edge: { w: number; h: number };
  feat: { w: number; h: number };
}

function layout(kind: LiteralKind, W: number, H: number): Box {
  const even = (n: number) => 2 * Math.round(n / 2);
  if (kind === "haze") {
    const ih = H;
    const iw = even(ih * 1.5);
    const cw = W - iw - 56;
    return {
      W,
      H,
      img: { w: iw, h: even(ih) },
      edge: { w: even(cw), h: even(cw / 1.5) },
      feat: { w: 0, h: 0 },
    };
  }
  if (kind === "spikes") {
    // Two maps stacked, each under its own label line.
    const ph = even((H - 2 * 56 - 28) / 2);
    return { W, H, img: { w: even(ph * 1.5), h: ph }, edge: { w: 0, h: 0 }, feat: { w: 0, h: 0 } };
  }
  const ih = H;
  const iw = even(ih * 1.5);
  const cw = W - iw - 56;
  const fh = even((H - 2 * 64 - 40) / 2);
  return {
    W,
    H,
    img: { w: iw, h: even(ih) },
    edge: { w: 0, h: 0 },
    feat: { w: even(Math.min(cw, fh * 1.5)), h: fh },
  };
}

/* ---------------------------------------------------------------- fragments */

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const round3 = r3;
const px = (n: number) => `${Math.round(n)}px`;
/** Escape a label for markup. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The scene's tween lines, every one `fromTo` (invariant 2), every selector `#SCENEID-…` (invariant 3). */
class Tl {
  lines: string[] = [];
  private seen = new Set<string>();
  /**
   * An element's FIRST tween renders its "from" state at once (GSAP's default),
   * so whatever enters later is hidden from the scene's first frame; every
   * later tween of it waits for its own start (`immediateRender: false`), so it
   * cannot overwrite the earlier one's state when the timeline is built.
   */
  fromTo(id: string, from: Record<string, unknown>, to: Record<string, unknown>, at: number): void {
    const first = !this.seen.has(id);
    this.seen.add(id);
    this.lines.push(
      `tl.fromTo("#SCENEID-${id}", ${JSON.stringify(from)}, ${JSON.stringify(first ? to : { ...to, immediateRender: false })}, ${r3(at)});`,
    );
  }
  /** Fade in (opacity 0→1) at `at`. */
  show(
    id: string,
    at: number,
    dur = 0.6,
    extra: { from?: Record<string, unknown>; to?: Record<string, unknown> } = {},
  ) {
    this.fromTo(
      id,
      { opacity: 0, ...extra.from },
      { opacity: 1, duration: dur, ease: "power2.out", ...extra.to },
      at,
    );
  }
  hide(id: string, at: number, dur = 0.5) {
    this.fromTo(id, { opacity: 1 }, { opacity: 0, duration: dur, ease: "power1.inOut" }, at);
  }
  get script(): string {
    return this.lines.join("\n");
  }
}

export interface Cue {
  t0: number;
  t1: number;
}

const LABEL = TYPE_SCALE.body; // 44
const SMALL = TYPE_SCALE.label; // 40

/** A label as positioned HTML. Never below 40px (invariant 5). */
function label(
  id: string,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  extra = "",
): string {
  return `<div id="SCENEID-${id}" class="lit-label" style="left:${px(x)};top:${px(y)};font-size:${size}px;color:${color};${extra}">${esc(text)}</div>`;
}

const ON_PHOTO =
  "color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.75),0 0 2px rgba(0,0,0,.9);font-weight:600";

function baseCss(theme: Theme): string {
  return [
    "#SCENEID-lit{position:absolute;left:0;top:0;width:100%;height:100%}",
    "#SCENEID-lit .lit-label{position:absolute;white-space:nowrap;line-height:1.15;font-weight:600}",
    "#SCENEID-lit img{position:absolute;display:block}",
    "#SCENEID-lit .lit-panel{position:absolute;overflow:hidden;border-radius:6px}",
    `#SCENEID-lit .lit-dark{background:#0d1014}`,
    `#SCENEID-lit svg{position:absolute;overflow:visible}`,
    `#SCENEID-lit .lit-muted{color:${theme.muted}}`,
  ].join("\n");
}

function hazeFragment(
  L: Layers,
  box: Box,
  cues: readonly Cue[],
  spec: LiteralSpec,
  theme: Theme,
  href: (f: string) => string,
): Fragment {
  const { W, H } = box;
  const iw = box.img.w;
  const ih = box.img.h;
  const cx = iw + 56;
  const cw = W - cx;
  const ew = box.edge.w;
  const eh = box.edge.h;
  const d = L.data as { row: number; profile: number[]; air: number; t: number };
  const lab = (k: string, dflt: string) => spec.labels[k] ?? dflt;
  // Profile plot: luma 0..1, 1 at the top.
  const py0 = 64 + eh + 110;
  const ph = H - py0 - 6;
  const pw = cw - 40;
  const yOf = (v: number) => r3(py0 + (1 - v) * ph);
  const pts = d.profile
    .map((v, i) => `${r3((i / (d.profile.length - 1)) * pw)},${yOf(v)}`)
    .join(" ");
  const hi = Math.max(...d.profile);
  const lo = Math.min(...d.profile);
  const airY = yOf(d.air);
  const bx = pw + 22;
  const markup = `<div id="SCENEID-lit">
<div id="SCENEID-photo" class="lit-panel" style="left:0;top:0;width:${px(iw)};height:${px(ih)}">
<img id="SCENEID-clear" src="${href(L.files.clear as string)}" style="left:0;top:0;width:${px(iw)};height:${px(ih)}" alt="">
<div id="SCENEID-front" style="position:absolute;left:0;bottom:0;width:${px(iw)};height:0;overflow:hidden"><img src="${href(L.files.hazy as string)}" style="left:0;top:auto;bottom:0;width:${px(iw)};height:${px(ih)}" alt=""></div>
<div id="SCENEID-scan" style="position:absolute;left:0;top:${px(d.row - 2)};width:${px(iw)};height:4px;background:${theme.accent};transform-origin:0 50%"></div>
${label("tag-clear", lab("clear", "맑은 날"), 28, 22, LABEL, "", ON_PHOTO)}
${label("tag-hazy", lab("hazy", "안개"), 28, ih - 76, LABEL, "", ON_PHOTO)}
</div>
${label("edge-label", lab("edges", "에지 지도 (Sobel)"), cx, 0, LABEL, theme.fg)}
<div id="SCENEID-edge" class="lit-panel lit-dark" style="left:${px(cx)};top:64px;width:${px(ew)};height:${px(eh)}">
<img src="${href(L.files.edgeClear as string)}" style="left:0;top:0;width:${px(ew)};height:${px(eh)}" alt="">
<div id="SCENEID-edge-front" style="position:absolute;left:0;bottom:0;width:${px(ew)};height:0;overflow:hidden;background:#0d1014"><img src="${href(L.files.edgeHazy as string)}" style="left:0;top:auto;bottom:0;width:${px(ew)};height:${px(eh)}" alt=""></div>
</div>
${label("prof-label", lab("profile", "선 위의 밝기"), cx, 64 + eh + 36, LABEL, theme.fg)}
<svg id="SCENEID-plot" width="${cw}" height="${H}" viewBox="0 0 ${cw} ${H}" style="left:${px(cx)};top:0">
<line x1="0" y1="${airY}" x2="${pw}" y2="${airY}" stroke="${theme.muted}" stroke-width="2" stroke-dasharray="6 8" opacity="0.7"/>
<g id="SCENEID-prof">
<polyline points="${pts}" fill="none" stroke="${theme.accent}" stroke-width="4" stroke-linejoin="round"/>
<path d="M${bx - 10} ${yOf(hi)}H${bx + 10}M${bx} ${yOf(hi)}V${yOf(lo)}M${bx - 10} ${yOf(lo)}H${bx + 10}" stroke="${theme.fg}" stroke-width="4" fill="none"/>
</g>
</svg>
</div>`;
  const c0 = cues[0] ?? { t0: 0.8, t1: 8 };
  const tl = new Tl();
  tl.show("clear", 0.05, 0.5);
  tl.show("tag-clear", 0.3, 0.5);
  tl.fromTo("scan", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.inOut" }, 0.5);
  tl.show("edge-label", 0.5);
  tl.show("edge", 0.6);
  tl.show("prof-label", 0.9);
  tl.show("plot", 1.0);
  // ONE causal step: the haze rises from the bottom; where it has arrived the
  // transmission is t, so a still mid-rise shows the picture, its edges and the
  // line's brightness both before and after.
  const h0 = Math.max(2.4, c0.t0 + 1.4);
  const dur = Math.max(3, Math.min(4.5, (c0.t1 - h0) * 0.7));
  tl.fromTo("front", { height: 0 }, { height: ih, duration: dur, ease: "none" }, h0);
  tl.fromTo("edge-front", { height: 0 }, { height: eh, duration: dur, ease: "none" }, h0);
  tl.fromTo(
    "tag-hazy",
    { opacity: 0 },
    { opacity: 1, duration: 0.6, ease: "power2.out" },
    h0 + 0.2,
  );
  // The brightness line flattens toward the airlight when the front crosses it.
  const atRow = h0 + (dur * (ih - d.row)) / ih;
  tl.fromTo(
    "prof",
    { scaleY: 1, svgOrigin: `0 ${airY}` },
    { scaleY: d.t, svgOrigin: `0 ${airY}`, duration: 0.7, ease: "sine.inOut" },
    atRow - 0.35,
  );
  tl.hide("tag-clear", h0 + dur - 0.6, 0.5);
  return { markup, css: baseCss(theme), script: tl.script };
}

function spikeFragment(
  L: Layers,
  box: Box,
  cues: readonly Cue[],
  spec: LiteralSpec,
  theme: Theme,
  href: (f: string) => string,
): Fragment {
  const { W, H } = box;
  const lab = (k: string, dflt: string) => spec.labels[k] ?? dflt;
  const d = L.data as {
    cols: number;
    rows: number;
    x: number[];
    counts: number[];
    steps: number;
    theta: number;
    witnesses: Array<{
      cell: number;
      pre: number[];
      post: number[];
      spikes: number[];
      noLeak: LifRun;
    }>;
  };
  // Input map above, output map below, on the left; the neurons' traces fill the right.
  const pw = box.img.w;
  const ph = box.img.h;
  const top = 56;
  const ax = 0; // map A
  const cyp = top + ph + 28 + 56; // map C's top
  const bx = pw + 64; // traces
  const bw = W - bx;
  const cw = pw / d.cols;
  const chh = ph / d.rows;
  const heat = "#f4f1ea"; // a neutral, so the witnesses' tones read against it
  const tones = [theme.tones.a, theme.tones.b, theme.tones.c];
  const cellRects = (prefix: string, alpha: (i: number) => number) =>
    d.x
      .map((_, i) => {
        const c = i % d.cols;
        const r = Math.floor(i / d.cols);
        return `<rect id="SCENEID-${prefix}${i}" x="${r3(c * cw + 1)}" y="${r3(r * chh + 1)}" width="${r3(cw - 2)}" height="${r3(chh - 2)}" fill="${heat}" opacity="${r3(alpha(i))}"/>`;
      })
      .join("");
  const outline = (i: number, k: number, pfx: string) => {
    const c = i % d.cols;
    const r = Math.floor(i / d.cols);
    return `<rect id="SCENEID-${pfx}${k}" x="${r3(c * cw - 3)}" y="${r3(r * chh - 3)}" width="${r3(cw + 6)}" height="${r3(chh + 6)}" fill="none" stroke="${tones[k]}" stroke-width="6"/>`;
  };
  // Traces: one row per witness.
  const rowH = (H - top) / 3;
  const plotW = bw - 190; // room for the threshold's word at the right
  const vmax = 1.6 * d.theta;
  const stepW = plotW / d.steps;
  const rowY = (k: number) => top + k * rowH;
  const vy = (k: number, v: number) =>
    r3(rowY(k) + rowH - 26 - (Math.min(v, vmax) / vmax) * (rowH - 70));
  const tracePath = (k: number, pre: number[], post: number[]) => {
    let p = `M0 ${vy(k, 0)}`;
    pre.forEach((v, s) => {
      const x0 = r3(s * stepW);
      const x1 = r3((s + 1) * stepW);
      // Between steps the potential holds; at a step it jumps to `pre`, then resets to `post`.
      p += ` L${x0} ${vy(k, s === 0 ? 0 : (post[s - 1] as number))} L${r3(x0 + stepW * 0.15)} ${vy(k, v)}`;
      if ((post[s] as number) !== v) p += ` L${r3(x0 + stepW * 0.15)} ${vy(k, post[s] as number)}`;
      p += ` L${x1} ${vy(k, post[s] as number)}`;
    });
    return p;
  };
  const dotY = (k: number) => r3(rowY(k) + 22);
  const traces = d.witnesses
    .map((wt, k) => {
      const ty = vy(k, d.theta);
      const dots = wt.spikes
        .map(
          (s) =>
            `<circle id="SCENEID-dot${k}-${s}" cx="${r3(s * stepW + stepW * 0.15)}" cy="${dotY(k)}" r="11" fill="${tones[k]}"/>`,
        )
        .join("");
      return `<g id="SCENEID-row${k}">
<line x1="0" y1="${r3(rowY(k) + rowH - 26)}" x2="${plotW}" y2="${r3(rowY(k) + rowH - 26)}" stroke="${theme.rule}" stroke-width="2"/>
<line x1="0" y1="${ty}" x2="${plotW}" y2="${ty}" stroke="${theme.fg}" stroke-width="3" stroke-dasharray="12 10"/>
<rect x="-14" y="${r3(rowY(k) + 14)}" width="8" height="${r3(rowH - 40)}" fill="${tones[k]}"/>
<g clip-path="url(#SCENEID-clip${k})"><path d="${tracePath(k, wt.pre, wt.post)}" fill="none" stroke="${tones[k]}" stroke-width="5" stroke-linejoin="round"/></g>
${dots}
</g>`;
    })
    .join("");
  const weak = d.witnesses[2];
  const ghost = weak
    ? (() => {
        const run = weak.noLeak;
        let p = `M0 ${vy(2, 0)}`;
        run.pre.forEach((v, s) => {
          const x0 = r3(s * stepW);
          p += ` L${x0} ${vy(2, s === 0 ? 0 : (run.post[s - 1] as number))} L${r3(x0 + stepW * 0.15)} ${vy(2, v)}`;
          if ((run.post[s] as number) !== v)
            p += ` L${r3(x0 + stepW * 0.15)} ${vy(2, run.post[s] as number)}`;
          p += ` L${r3((s + 1) * stepW)} ${vy(2, run.post[s] as number)}`;
        });
        const gd = run.spikes
          .map(
            (s) =>
              `<circle cx="${r3(s * stepW + stepW * 0.15)}" cy="${dotY(2)}" r="10" fill="none" stroke="${tones[2]}" stroke-width="4"/>`,
          )
          .join("");
        return `<g id="SCENEID-ghost"><g clip-path="url(#SCENEID-clipg)"><path d="${p}" fill="none" stroke="${tones[2]}" stroke-width="4" stroke-dasharray="10 9" opacity="0.85"/></g>${gd}</g>`;
      })()
    : "";
  const clips = [0, 1, 2]
    .map(
      (k) =>
        `<clipPath id="SCENEID-clip${k}"><rect id="SCENEID-cr${k}" x="-4" y="${r3(rowY(k))}" width="${r3(plotW + 8)}" height="${r3(rowH)}"/></clipPath>`,
    )
    .join("");
  const thetaY = vy(0, d.theta);
  const markup = `<div id="SCENEID-lit">
${label("a-label", lab("features", "특징 맵 (안개 영상)"), ax, 0, LABEL, theme.fg)}
<div class="lit-panel" style="left:${px(ax)};top:${px(top)};width:${px(pw)};height:${px(ph)}">
<img id="SCENEID-photo" src="${href(L.files.hazy as string)}" style="left:0;top:0;width:${px(pw)};height:${px(ph)}" alt="">
<svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}" style="left:0;top:0"><rect id="SCENEID-shade" width="${pw}" height="${ph}" fill="#0d1014"/><g id="SCENEID-heat">${cellRects("h", (i) => d.x[i] as number)}</g>${d.witnesses.map((wt, k) => outline(wt.cell, k, "oa")).join("")}</svg>
</div>
${label("b-label", lab("membrane", "막전위 → 스파이크"), bx, 0, LABEL, theme.fg)}
<svg id="SCENEID-traces" width="${bw}" height="${H}" viewBox="0 0 ${bw} ${H}" style="left:${px(bx)};top:0">
<defs>${clips}<clipPath id="SCENEID-clipg"><rect id="SCENEID-crg" x="-4" y="${r3(rowY(2))}" width="${r3(plotW + 8)}" height="${r3(rowH)}"/></clipPath></defs>
${traces}
${ghost}
<line id="SCENEID-head" x1="0" y1="${top}" x2="0" y2="${H - 10}" stroke="${theme.fg}" stroke-width="3" opacity="0.6"/>
</svg>
${label("theta", lab("threshold", "임계값"), bx + plotW + 18, thetaY - 26, SMALL, theme.fg)}
${label("ghost-label", lab("noLeak", "누설이 없다면"), bx + 16, rowY(2) + 38, SMALL, tones[2] as string)}
${label("c-label", lab("output", "스파이크로 전달된 맵"), ax, cyp - 56, LABEL, theme.fg)}
<div id="SCENEID-cpanel" class="lit-panel lit-dark" style="left:${px(ax)};top:${px(cyp)};width:${px(pw)};height:${px(ph)}">
<svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}" style="left:0;top:0">${cellRects("c", () => 0)}${d.witnesses.map((wt, k) => outline(wt.cell, k, "oc")).join("")}</svg>
</div>
</div>`;
  const [c0, c1, c2] = [
    cues[0] ?? { t0: 0.8, t1: 7 },
    cues[1] ?? { t0: 8, t1: 15 },
    cues[2] ?? { t0: 16, t1: 21 },
  ];
  const tl = new Tl();
  // Cue 1: the features the hazy picture gives, and three of its cells as neurons.
  tl.show("a-label", 0.1);
  tl.show("photo", 0.1, 0.5);
  tl.fromTo(
    "shade",
    { opacity: 0 },
    { opacity: 0.85, duration: 0.8, ease: "power2.out" },
    c0.t0 + 0.2,
  );
  tl.show("heat", c0.t0 + 0.4, 0.9);
  d.witnesses.forEach((_, k) => {
    tl.show(`oa${k}`, c0.t0 + 1.4 + k * 0.25, 0.4);
    tl.show(`row${k}`, c0.t0 + 1.6 + k * 0.25, 0.5);
    tl.fromTo(`cr${k}`, { attr: { width: 0 } }, { attr: { width: 0 }, duration: 0.01 }, 0);
  });
  tl.show("b-label", c0.t0 + 1.4);
  tl.show("theta", c0.t0 + 1.9);
  tl.show("c-label", c0.t0 + 2.2);
  tl.show("cpanel", c0.t0 + 2.2);
  for (let k = 0; k < d.witnesses.length; k++) tl.show(`oc${k}`, c0.t0 + 2.3, 0.4);
  // The time steps: the head sweeps, the potentials integrate, leak and fire.
  const s0 = c0.t0 + 2.6;
  const s1 = Math.max(s0 + d.steps * 0.75, Math.min(c1.t0 + 4.5, c1.t1 - 0.4));
  const span = s1 - s0;
  tl.fromTo("head", { x: 0, opacity: 0 }, { x: 0, opacity: 0.6, duration: 0.3 }, s0 - 0.3);
  tl.fromTo("head", { x: 0 }, { x: plotW, duration: span, ease: "none" }, s0);
  for (let k = 0; k < 3; k++)
    tl.fromTo(
      `cr${k}`,
      { attr: { width: 0 } },
      { attr: { width: plotW + 8 }, duration: span, ease: "none" },
      s0,
    );
  const stepAt = (s: number) => s0 + ((s + 0.15) / d.steps) * span;
  d.witnesses.forEach((wt, k) => {
    for (const s of wt.spikes) {
      tl.fromTo(
        `dot${k}-${s}`,
        { opacity: 0, scale: 0.3, transformOrigin: "50% 50%" },
        { opacity: 1, scale: 1, transformOrigin: "50% 50%", duration: 0.2, ease: "back.out(2)" },
        stepAt(s),
      );
    }
  });
  // The next layer receives only spikes: each output cell lights by its count, step by step.
  d.counts.forEach((n, i) => {
    if (n === 0) return;
    tl.fromTo(
      `c${i}`,
      { opacity: 0 },
      { opacity: r3(n / d.steps), duration: span, ease: `steps(${n})` },
      s0,
    );
  });
  tl.fromTo("head", { opacity: 0.6 }, { opacity: 0, duration: 0.4 }, s1 + 0.1);
  // Cue 3: the leak. The weak cell's input, kept without leaking, would have crossed.
  tl.fromTo("ghost", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  tl.fromTo("ghost-label", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  tl.fromTo("crg", { attr: { width: 0 } }, { attr: { width: 0 }, duration: 0.01 }, 0);
  const g0 = Math.max(s1 + 0.6, c2.t0 + 0.3);
  tl.fromTo("ghost", { opacity: 0 }, { opacity: 1, duration: 0.4 }, g0);
  tl.fromTo(
    "crg",
    { attr: { width: 0 } },
    { attr: { width: plotW + 8 }, duration: 2.6, ease: "none" },
    g0,
  );
  tl.show("ghost-label", g0 + 0.3);
  return { markup, css: baseCss(theme), script: tl.script };
}

function sobelFragment(
  L: Layers,
  box: Box,
  cues: readonly Cue[],
  spec: LiteralSpec,
  theme: Theme,
  href: (f: string) => string,
): Fragment {
  const lab = (k: string, dflt: string) => spec.labels[k] ?? dflt;
  const iw = box.img.w;
  const ih = box.img.h;
  const cx = iw + 56;
  const fw = box.feat.w;
  const fh = box.feat.h;
  const y1 = 64;
  const y2 = y1 + fh + 40 + 64;
  const k = 62; // kernel cell
  const kernel = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const kx = -k * 1.5;
  const ky = ih - 3 * k - 120;
  const kcells = kernel
    .map((v, i) => {
      const c = i % 3;
      const r = Math.floor(i / 3);
      return `<div style="position:absolute;left:${px(c * k)};top:${px(r * k)};width:${px(k - 4)};height:${px(k - 4)};background:rgba(13,16,20,.82);color:#fff;font-size:${SMALL}px;line-height:${px(k - 4)};text-align:center;border-radius:4px;font-weight:600">${v}</div>`;
    })
    .join("");
  const markup = `<div id="SCENEID-lit">
<div class="lit-panel" style="left:0;top:0;width:${px(iw)};height:${px(ih)}">
<img id="SCENEID-photo" src="${href(L.files.hazy as string)}" style="left:0;top:0;width:${px(iw)};height:${px(ih)}" alt="">
<div id="SCENEID-dim" style="position:absolute;left:0;top:0;width:${px(iw)};height:${px(ih)};background:#0d1014"></div>
<div id="SCENEID-reveal" style="position:absolute;left:0;top:0;width:${px(iw)};height:${px(ih)};overflow:hidden">
<img src="${href(L.files.edges as string)}" style="left:0;top:0;width:${px(iw)};height:${px(ih)}" alt="">
</div>
<div id="SCENEID-sweep" style="position:absolute;left:0;top:0;width:4px;height:${px(ih)};background:#fff;box-shadow:0 0 18px rgba(255,255,255,.9)"></div>
${label("tag-hazy", lab("hazy", "안개 영상"), 28, 22, LABEL, "", ON_PHOTO)}
${label("tag-sobel", lab("structure", "Sobel 구조 맵"), 28, 22, LABEL, "", ON_PHOTO)}
</div>
<div id="SCENEID-kernel" style="position:absolute;left:${px(kx)};top:${px(ky)};width:${px(3 * k)};height:${px(3 * k)}">${label("k-label", "Sobel 3×3", 0, -58, SMALL, "", ON_PHOTO)}${kcells}</div>
${label("f-label", lab("feature", "평활화된 특징"), cx, 0, LABEL, theme.fg)}
<div id="SCENEID-fpanel" class="lit-panel lit-dark" style="left:${px(cx)};top:${px(y1)};width:${px(fw)};height:${px(fh)}">
<img id="SCENEID-feat" src="${href(L.files.feat as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
</div>
${label("w-label", lab("reweighted", "구조 맵으로 재가중"), cx, y2 - 64, LABEL, theme.fg)}
<div id="SCENEID-wpanel" class="lit-panel lit-dark" style="left:${px(cx)};top:${px(y2)};width:${px(fw)};height:${px(fh)}">
<img id="SCENEID-feat2" src="${href(L.files.feat as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
<img id="SCENEID-featw" src="${href(L.files.featW as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
<img id="SCENEID-feats" src="${href(L.files.featS as string)}" style="left:0;top:0;width:${px(fw)};height:${px(fh)}" alt="">
</div>
</div>`;
  const c0 = cues[0] ?? { t0: 0.8, t1: 10 };
  const tl = new Tl();
  tl.show("photo", 0.05, 0.5);
  tl.show("tag-hazy", 0.3);
  tl.fromTo("dim", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  tl.fromTo("tag-sobel", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  // The kernel slides across the picture; behind it, the edges it measured light up.
  const s0 = Math.max(1.2, c0.t0 + 0.4);
  const span = 4.2;
  tl.show("kernel", s0 - 0.5, 0.4);
  tl.show("sweep", s0 - 0.3, 0.3);
  tl.fromTo("reveal", { width: 0 }, { width: iw, duration: span, ease: "none" }, s0);
  tl.fromTo("sweep", { x: 0 }, { x: iw - 4, duration: span, ease: "none" }, s0);
  tl.fromTo("kernel", { x: 0 }, { x: iw, duration: span, ease: "none" }, s0);
  tl.fromTo("dim", { opacity: 0 }, { opacity: 0.6, duration: span, ease: "none" }, s0);
  tl.hide("sweep", s0 + span, 0.3);
  tl.hide("kernel", s0 + span, 0.3);
  tl.hide("tag-hazy", s0 + span - 0.2, 0.4);
  tl.show("tag-sobel", s0 + span + 0.1);
  // Then the structure map gates the feature, and the reweighted feature keeps the edges.
  const f0 = s0 + span + 0.5;
  tl.show("f-label", f0);
  tl.show("fpanel", f0, 0.4);
  tl.show("wpanel", f0 + 0.6, 0.4);
  tl.show("feat", f0, 0.6);
  tl.show("w-label", f0 + 0.6);
  tl.show("feat2", f0 + 0.6, 0.6);
  tl.fromTo("featw", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  tl.fromTo("feats", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
  const g0 = f0 + 1.4;
  tl.fromTo("feats", { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "power2.out" }, g0);
  tl.fromTo("featw", { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "sine.inOut" }, g0 + 1.0);
  tl.fromTo("feats", { opacity: 1 }, { opacity: 0, duration: 1.2, ease: "sine.inOut" }, g0 + 1.2);
  return { markup, css: baseCss(theme), script: tl.script };
}

/** One literal scene's fragment, in token form, from its computed layers. */
export function literalFragment(
  kind: LiteralKind,
  layers: Layers,
  region: { width: number; height: number },
  cues: readonly Cue[],
  spec: LiteralSpec,
  theme: Theme,
): Fragment {
  const box = layout(kind, region.width, region.height);
  const href = (f: string) => `${LITERAL_DIR}/${f}`;
  if (kind === "haze") return hazeFragment(layers, box, cues, spec, theme, href);
  if (kind === "spikes") return spikeFragment(layers, box, cues, spec, theme, href);
  return sobelFragment(layers, box, cues, spec, theme, href);
}

/* -------------------------------------------------------------------- the pass */

export interface LiteralInput {
  storyboard: Storyboard;
  source: Source;
  format: Format;
  narration: DeckNarration;
  theme: string;
  plan: LiteralPlan;
  /** Directory the plan's `image` is relative to. */
  planDir: string;
  /** The deck directory: layers go under `<out>/assets/literal/`. */
  out: string;
  onStep?: (m: string) => void;
}

export interface LiteralReport {
  version: 1;
  scenes: Array<{
    beat: string;
    kind: LiteralKind;
    takeaway: string;
    layers: string[];
    cues: Cue[];
  }>;
}

/**
 * Compute every literal beat's layers and fragment. A beat not in the plan, or
 * one the cut dropped, keeps its archetype.
 */
export async function literalPass(
  input: LiteralInput,
): Promise<{ map: BespokeMap; report: LiteralReport }> {
  const { storyboard, source, format, narration, plan } = input;
  const step = input.onStep ?? (() => {});
  const { theme } = deckLook(storyboard, input.theme);
  const base = {
    theme: input.theme,
    design: "v2" as const,
    narration,
    speed: 1,
    onBeatError: () => {},
  };
  const kept = planCut(storyboard, source, format, base).kept;
  const ctxFor = (sid: string): EmitContext => ({
    source,
    format,
    theme,
    sid,
    start: 0,
    design: "v2",
  });
  const picked = kept.filter((b) => plan.beats[b.id] !== undefined);
  const placeholder: Record<string, { fragment: Fragment; holds: number[] }> = {};
  for (const beat of picked) {
    const { holds } = bespokeStaging(beat, ctxFor("s0"), narration.beats[beat.id] ?? [], 1);
    placeholder[beat.id] = { fragment: { markup: "", css: "", script: "" }, holds };
  }
  // The cue windows, read off the deck as it will be timed (as the bespoke pass does).
  const composition = emitComposition(storyboard, source, format, {
    ...base,
    bespoke: placeholder,
  });
  const timing = planTiming({
    storyboard,
    source,
    format,
    speed: 1,
    composition,
    beats: kept,
    narration,
    theme: input.theme,
    bespoke: placeholder,
  });
  const cuesOf = new Map<string, Cue[]>();
  for (const w of sceneWindows(timing)) {
    const beat = kept[Number(w.sid.slice(1)) - 1];
    if (beat)
      cuesOf.set(
        beat.id,
        w.cues.map((c) => ({ t0: c.t0, t1: c.t1 })),
      );
  }
  const dir = join(input.out, LITERAL_DIR);
  await mkdir(dir, { recursive: true });
  const image = join(input.planDir, plan.image);
  const map: Record<string, BespokeEntry> = {};
  const report: LiteralReport = { version: 1, scenes: [] };
  for (const beat of picked as Beat[]) {
    const spec = plan.beats[beat.id] as LiteralSpec;
    const region = bespokeRegion(beat, ctxFor("s0"));
    const box = layout(spec.kind, region.width, region.height);
    const cues = cuesOf.get(beat.id) ?? [];
    const layers =
      spec.kind === "haze"
        ? await hazeLayers(image, dir, beat.id, box)
        : spec.kind === "spikes"
          ? await spikeLayers(image, dir, beat.id, box)
          : await sobelLayers(image, dir, beat.id, box);
    const fragment = literalFragment(spec.kind, layers, region, cues, spec, theme);
    map[beat.id] = { fragment, holds: placeholder[beat.id]?.holds ?? [] };
    report.scenes.push({
      beat: beat.id,
      kind: spec.kind,
      takeaway: spec.takeaway,
      layers: Object.values(layers.files),
      cues,
    });
    step(
      `literal: ${beat.id} ${spec.kind} — ${Object.keys(layers.files).length} layer(s), ${cues.length} cue(s)`,
    );
  }
  return { map, report };
}
