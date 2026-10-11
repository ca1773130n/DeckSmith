/**
 * THE STAGE every computed verb is drawn on: a verb is a pure function from
 * its plan and its material to a `MechanismResult` (rasters computed at build
 * time, and frames of vector primitives — one frame per causal step), and this
 * file turns that into files and a fragment, the same way for every verb.
 *
 * MOTION COMES FROM THE MATERIAL, and it is generic:
 * - a frame opens on its step's sentence (a cross-fade over the one before);
 * - its primitives with `at` ≥ 1 are revealed in order over that sentence —
 *   faded in, or WIPED left to right (`wipe`), which is how an op's output
 *   sweeps over its input and a 1-D result appears bin by bin;
 * - once they are all out, the camera moves slowly over the frame's `cam`
 *   material (its picture or its plot) until the next step: a push-in on what
 *   was just computed, never a decoration.
 * So no step stands still for longer than the gap between two reveals or the
 * span of one move (src/literal/kit.ts `stillSpans` measures it on the script).
 *
 * Every tween is `Tl.fromTo`, scoped to the scene, rounded to 3 decimals.
 * `frameFill` measures how much of the region a frame's pictures, shapes and
 * plots cover, off the primitives that ship.
 *
 * A verb's run is also its plan-time check: `verbProblems` runs it on
 * placeholder material (a synthetic picture, placeholder earlier layers) in
 * the deck's face, so a plan the build cannot draw goes back for repair.
 */
import { copyFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Fragment } from "../../bespoke/contract.js";
import type { Theme } from "../../emit/kit.js";
import type { Literal, LiteralKind } from "../../types.js";
import {
  type KindImpl,
  type KindInput,
  type KindSpec,
  lab,
  spread,
  stepStarts,
  widthOf,
} from "../kind.js";
import { nativeSize } from "../kinds-shared.js";
import {
  baseCss,
  type Cue,
  esc,
  type Layers,
  mapRgba,
  r3,
  readRgb,
  Tl,
  toRgba,
  writeRaster,
} from "../kit.js";
import type { Tensor } from "../ops.js";
import {
  clamp01,
  type Frame,
  type Measure,
  type MechanismResult,
  type Prim,
  type Raster,
  type Region,
  type Rgb,
  shiftPrim,
  TYPE,
  wrapBy,
} from "./common.js";
import { type Draw, type LayerPaint, primSvg } from "./svg.js";

/** What an earlier scene left that a later one may reuse: its layers and its computed arrays. */
export interface Earlier {
  kind: string;
  layers: Layers;
  labels: Record<string, string>;
}

/** What a verb's run is given. */
export interface VerbCtx<K extends LiteralKind> {
  lit: Extract<Literal, { kind: K }>;
  labels: Readonly<Record<string, string>>;
  region: Region;
  theme: Theme;
  measure: Measure;
  /** Plan time: the material is a placeholder; check and lay out, as the build will. */
  dry: boolean;
  /** The picture, when the verb reads one (a placeholder at plan time). */
  image?: Rgb;
  earlier: ReadonlyMap<string, Earlier>;
  /** Figure id → absolute file, for a stage showing the source's own figure. */
  assets: Readonly<Record<string, string>>;
  /** The beat's headline: an item it names is the scene's subject (src/literal/kind.ts `subjectOf`). */
  headline?: string;
}

export type VerbRun<K extends LiteralKind> = (c: VerbCtx<K>) => MechanismResult;

/**
 * A verb laid out inside the room its camera push takes, for a diagram whose
 * words reach the region's edges (a plot, a chain of cards). The push scales
 * the camera's material about its middle by `PUSH`, so it grows (PUSH-1)/2 of
 * a side each way: laid out that much in, and with the clip grown by the same
 * (`Frame.pad`), nothing is cut while it leans in. Measured on r1: a plot's
 * "0.8" printed as ").8" and the outer cards of a chain lost their first and
 * last glyphs, while the push ran.
 */
export function withPushRoom<K extends LiteralKind>(run: VerbRun<K>): VerbRun<K> {
  return (c) => {
    const { width: W, height: H } = c.region;
    const mx = Math.ceil((W * (PUSH - 1)) / 2) + 4;
    const my = Math.ceil((H * (PUSH - 1)) / 2) + 4;
    const r = run({ ...c, region: { width: W - 2 * mx, height: H - 2 * my } });
    return {
      ...r,
      frames: r.frames.map((f) => ({
        ...f,
        pad: { x: mx, y: my },
        prims: f.prims.map((p) => shiftPrim(p, mx, my)),
      })),
    };
  };
}

/* ----------------------------------------------------------------- words */

/** Text lines as primitives, top-down from y. */
export function textLines(
  lines: readonly string[],
  x: number,
  y: number,
  size: number,
  role: Extract<Prim, { p: "text" }>["role"],
  extra: Partial<Extract<Prim, { p: "text" }>> = {},
  anchor: "start" | "middle" | "end" = "start",
): Prim[] {
  return lines.map((t, i) => ({
    p: "text" as const,
    x,
    y: y + i * Math.round(size * 1.18),
    size,
    role,
    anchor,
    text: t,
    ...extra,
  }));
}

/* ------------------------------------------------------- the band below */

const TAG_PAD = 16;

/** The band under the scene for its example tag and caption: its height, 0 when neither is given. */
export function bandHeight(
  labels: Readonly<Record<string, string>>,
  region: Region,
  measure: Measure,
) {
  const tag = labels.example?.trim();
  const caption = labels.caption?.trim();
  if (!tag && !caption) return 0;
  const tw = tag ? measure(tag, TYPE.label) + 2 * TAG_PAD + 24 : 0;
  const lines = caption ? wrapBy(caption, TYPE.label, region.width - tw, measure) : [];
  return Math.max(TYPE.label + 28, lines.length * Math.round(TYPE.label * 1.18) + 20);
}

/** The tag (accent, boxed) and caption (muted), drawn in the band. */
function bandPrims(
  labels: Readonly<Record<string, string>>,
  region: Region,
  inner: number,
  measure: Measure,
): Prim[] {
  const tag = labels.example?.trim();
  const caption = labels.caption?.trim();
  const out: Prim[] = [];
  const y = inner + 10;
  let x = 0;
  if (tag) {
    const w = measure(tag, TYPE.label) + 2 * TAG_PAD;
    out.push(
      {
        p: "rect",
        x: 0,
        y,
        w,
        h: TYPE.label + 18,
        fill: "panel",
        role: "accent",
        width: 3,
        radius: 8,
      },
      {
        p: "text",
        x: TAG_PAD,
        y: y + 7,
        size: TYPE.label,
        role: "accent",
        anchor: "start",
        slot: "example",
      },
    );
    x = w + 24;
  }
  if (caption)
    out.push(
      ...textLines(
        wrapBy(caption, TYPE.label, region.width - x, measure),
        x,
        y + 7,
        TYPE.label,
        "muted",
      ),
    );
  return out;
}

/* -------------------------------------------------------------- the run */

/** Run a verb with its band reserved; the band is added to every frame. */
export function runVerb<K extends LiteralKind>(run: VerbRun<K>, c: VerbCtx<K>): MechanismResult {
  const band = bandHeight(c.labels, c.region, c.measure);
  const inner = { width: c.region.width, height: c.region.height - band };
  if (inner.height < 300)
    throw new Error(
      `the caption and example tag leave the scene ${Math.round(inner.height)}px; shorten them`,
    );
  const r = run({ ...c, region: inner });
  if (!band) return r;
  const extra = bandPrims(c.labels, c.region, inner.height, c.measure);
  return { ...r, frames: r.frames.map((f) => ({ ...f, prims: [...f.prims, ...extra] })) };
}

/** A synthetic picture for plan-time checks: deterministic, with edges and texture. */
export function placeholderPicture(w = 96, h = 64): Rgb {
  const d = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++)
        d[(y * w + x) * 3 + c] = clamp01(
          0.5 + 0.4 * Math.sin((x + 2 * c) / 5) * Math.cos(y / 7) + (x > w / 2 ? 0.1 : -0.1),
        );
  return { w, h, d };
}

/** The picture at its own aspect, at most `maxSide` on its longer side. */
export async function readPicture(image: string, maxSide: number): Promise<Rgb> {
  const { w, h } = await nativeSize(image);
  const k = Math.min(1, maxSide / Math.max(w, h));
  return readRgb(image, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
}

/* -------------------------------------------------------- arrays → rasters */

/** The display scale of one-channel arrays drawn side by side: one scale, so a weaker map looks weaker. */
export function sharedScale(ts: readonly Tensor[]): number {
  const v: number[] = [];
  for (const t of ts) for (let i = 0; i < t.h * t.w; i++) v.push(t.d[i * t.c] as number);
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.995))] || v[v.length - 1] || 1;
}

/** An array as a raster to draw: RGB as itself, one channel on the theme's accent (signed: grey around mid). */
export function rasterOf(t: Tensor, scaleTo?: number): Raster {
  if (t.c === 3) {
    const d = new Float32Array(t.d.length);
    for (let i = 0; i < d.length; i++) d[i] = clamp01(t.d[i] as number);
    return { rgb: { w: t.w, h: t.h, d } };
  }
  const n = t.h * t.w;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = t.d[i * t.c] as number;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const x of v) {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  if (lo < 0) {
    // Signed: drawn as grey, zero at mid-grey. Display scaling only, never printed.
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const d = new Float32Array(n * 3);
    for (let i = 0; i < n; i++)
      d[i * 3] = d[i * 3 + 1] = d[i * 3 + 2] = 0.5 + (v[i] as number) / (2 * m);
    return { rgb: { w: t.w, h: t.h, d } };
  }
  // Display scaling to the 99.5% value, so one bright pixel does not blacken the map.
  const sorted = Array.from(v).sort((a, b) => a - b);
  const top = scaleTo ?? (sorted[Math.min(n - 1, Math.floor(n * 0.995))] || hi || 1);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = clamp01((v[i] as number) / top);
  return { heat: { w: t.w, h: t.h, d }, role: "accent", alpha: 1 };
}

/* ------------------------------------------------------------------ files */

/** Write a result's rasters under `dir`; the layers carry the frames and how each raster is painted. */
export async function writeLayers(
  r: MechanismResult,
  beatId: string,
  dir: string,
): Promise<Layers> {
  const files: Record<string, string> = {};
  const paints: Record<string, LayerPaint> = {};
  for (const [key, L] of Object.entries(r.rasters)) {
    let out: { w: number; h: number; rgba: Uint8Array };
    let ext = "png";
    if ("rgb" in L) {
      out = { w: L.rgb.w, h: L.rgb.h, rgba: toRgba(L.rgb) };
      ext = "jpg";
    } else if ("rgba" in L) {
      const rgba = new Uint8Array(L.rgba.d.length);
      for (let i = 0; i < rgba.length; i++)
        rgba[i] = Math.round(clamp01(L.rgba.d[i] as number) * 255);
      out = { w: L.rgba.w, h: L.rgba.h, rgba };
    } else {
      out = { w: L.heat.w, h: L.heat.h, rgba: mapRgba(L.heat.d, [255, 255, 255]) };
      paints[key] = { mask: L.role, alpha: L.alpha };
    }
    const file = `${beatId}-${key}.${ext}`;
    await writeRaster(join(dir, file), out.w, out.h, out.rgba);
    files[key] = file;
  }
  // A layer a later scene brings back (recap, prior-work, a flow stage): the verb's last picture.
  const thumb = r.data.thumb as string | undefined;
  if (thumb && files[thumb]) files.thumb = files[thumb] as string;
  return { files, data: { frames: r.frames, paints, vars: r.vars } };
}

/** Copy the source's own figures a result references (`fig:<id>`) beside the layers. */
export async function copyFigures(
  r: MechanismResult,
  assets: Readonly<Record<string, string>>,
  beatId: string,
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const f of r.frames)
    for (const p of f.prims)
      if (p.p === "image" && p.layer.startsWith("fig:") && !files[p.layer]) {
        const src = assets[p.layer.slice(4)];
        if (!src) throw new Error(`literal: figure ${p.layer.slice(4)} has no file`);
        const file = `${beatId}-${p.layer.slice(4)}${extname(src)}`;
        await copyFile(src, join(dir, file));
        files[p.layer] = file;
      }
}

/* --------------------------------------------------------------- the svg */

interface Reveal {
  id: string;
  at: number;
  /** A wipe's clip rect and its full width; undefined for a fade. */
  wipe?: number;
}

/** The axis-aligned box a primitive covers. */
export function boxOf(p: Prim): { x: number; y: number; w: number; h: number } {
  switch (p.p) {
    case "rect":
    case "image":
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case "circle":
      return { x: p.cx - p.r, y: p.cy - p.r, w: 2 * p.r, h: 2 * p.r };
    case "ellipse": {
      const r = Math.max(p.rx, p.ry);
      return { x: p.cx - r, y: p.cy - r, w: 2 * r, h: 2 * r };
    }
    case "line":
      return {
        x: Math.min(p.x1, p.x2) - p.width,
        y: Math.min(p.y1, p.y2) - p.width,
        w: Math.abs(p.x2 - p.x1) + 2 * p.width,
        h: Math.abs(p.y2 - p.y1) + 2 * p.width,
      };
    case "path": {
      const xs = p.pts.filter((_, i) => i % 2 === 0);
      const ys = p.pts.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x: x - p.width,
        y: y - p.width,
        w: Math.max(...xs) - x + 2 * p.width,
        h: Math.max(...ys) - y + 2 * p.width,
      };
    }
    case "text":
      return {
        x: p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - 400 : p.x - 200,
        y: p.y,
        w: 400,
        h: p.size * 1.2,
      };
  }
}

/** One frame as SVG with its reveals wrapped and its camera group: what the scene ships. */
function stagedSvg(
  frame: Frame,
  i: number,
  region: Region,
  d: Omit<Draw, "ids">,
): {
  svg: string;
  reveals: Reveal[];
  cam: { x: number; y: number; w: number; h: number } | undefined;
} {
  const ids = `SCENEID-f${i}-`;
  const draw: Draw = { ...d, ids };
  const reveals: Reveal[] = [];
  const defs: string[] = [];
  const one = (j: number) => {
    const p = frame.prims[j] as Prim;
    const s = primSvg(frame.prims, j, draw);
    if (!s || !(p.at && p.at >= 1)) return s;
    const id = `f${i}-p${j}`;
    if (p.wipe) {
      const b = boxOf(p);
      defs.push(
        `<clipPath id="SCENEID-f${i}-c${j}"><rect id="SCENEID-f${i}-w${j}" x="${r3(b.x - 2)}" y="${r3(b.y - 2)}" width="0" height="${r3(b.h + 4)}"/></clipPath>`,
      );
      reveals.push({ id: `f${i}-w${j}`, at: p.at, wipe: r3(b.w + 4) });
      return `<g clip-path="url(#SCENEID-f${i}-c${j})">${s}</g>`;
    }
    reveals.push({ id, at: p.at });
    return `<g id="SCENEID-${id}">${s}</g>`;
  };
  const camIdx = frame.prims.map((p, j) => (p.cam ? j : -1)).filter((j) => j >= 0);
  const rest = frame.prims.map((p, j) => (p.cam ? -1 : j)).filter((j) => j >= 0);
  let cam: { x: number; y: number; w: number; h: number } | undefined;
  let camSvg = "";
  if (camIdx.length) {
    const bs = camIdx.map((j) => boxOf(frame.prims[j] as Prim));
    const px = frame.pad?.x ?? 0;
    const py = frame.pad?.y ?? 0;
    const x0 = Math.max(0, Math.min(...bs.map((b) => b.x)) - px);
    const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)) - py);
    const x1 = Math.min(region.width, Math.max(...bs.map((b) => b.x + b.w)) + px);
    const y1 = Math.min(region.height, Math.max(...bs.map((b) => b.y + b.h)) + py);
    cam = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    defs.push(
      `<clipPath id="SCENEID-f${i}-cc"><rect x="${r3(x0)}" y="${r3(y0)}" width="${r3(cam.w)}" height="${r3(cam.h)}"/></clipPath>`,
    );
    camSvg = `<g clip-path="url(#SCENEID-f${i}-cc)"><g id="SCENEID-f${i}-cam">\n${camIdx.map(one).join("\n")}\n</g></g>`;
  }
  const body = rest.map(one).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="SCENEID-f${i}" style="left:0;top:0" width="${region.width}" height="${region.height}" viewBox="0 0 ${region.width} ${region.height}" font-family="${esc(d.theme.fontStack)}">
<defs>${defs.join("")}</defs>
${camSvg}
${body}
</svg>`;
  return { svg, reveals, cam };
}

/** The opacity a `preview` frame's parts stand at until they are spoken. */
export const PREVIEW = 0.3;

/** How far the camera pushes in on a frame's material once its reveals are out. */
export const PUSH = 1.07;

/** The fragment of staged frames on the narration's sentences. */
export function stagedFragment(
  kind: LiteralKind,
  L: Layers,
  region: Region,
  cues: readonly Cue[],
  spec: KindSpec,
  theme: Theme,
  href: (file: string) => string,
): Fragment {
  const frames = L.data.frames as Frame[];
  const paints = (L.data.paints ?? {}) as Record<string, LayerPaint>;
  const draw: Omit<Draw, "ids"> = {
    theme,
    href: (layer) => {
      const f = L.files[layer];
      if (!f) throw new Error(`literal: ${kind} draws layer "${layer}", which was not written`);
      return href(f);
    },
    text: (slot, vars) => lab(kind, spec, slot, vars),
    paint: (layer) => paints[layer],
  };
  const staged = frames.map((f, i) => stagedSvg(f, i, region, draw));
  const n = frames.length;
  const at = stepStarts(cues, n);
  const end = Math.max(cues[cues.length - 1]?.t1 ?? 0, (at[n - 1] as number) + 6);
  const tl = new Tl();
  staged.forEach((s, i) => {
    const t0 = i === 0 ? 0.1 : (at[i] as number);
    const t1 = i < n - 1 ? (at[i + 1] as number) : end;
    tl.show(`f${i}`, t0, 0.5);
    if (i > 0) tl.hide(`f${i - 1}`, t0 + 0.5, 0.3);
    const K = Math.max(0, ...s.reveals.map((r) => r.at));
    // The sentences this frame is on: its own, and for the last frame of a verb with
    // fewer frames than sentences, every one after it. Its steps are shared out over
    // them in order, so a part arrives while it is spoken, not in a burst at the start
    // and then a still frame under the rest (r3 C s16: four curves and four groups in
    // the first 16s of 35s, then 7.8s with under 1% of the picture changing).
    const bounds = [
      t0,
      ...(i === n - 1 && cues.length > n ? cues.slice(n).map((c) => c.t0) : []),
      t1,
    ];
    const S = bounds.length - 1;
    const spanOf = (step: number) =>
      S === 1 ? 0 : Math.min(S - 1, Math.floor(((step - 1) * S) / K));
    const times: number[] = [];
    const nexts: number[] = [];
    for (let j = 0; j < S; j++) {
      const steps = Array.from({ length: K }, (_, q) => q + 1).filter((q) => spanOf(q) === j);
      const u1 = bounds[j + 1] as number;
      const ts = spread((bounds[j] as number) + (j ? 0.1 : 0.6), u1, steps.length, 0.5, 2.2, 0.6);
      steps.forEach((q, k) => {
        times[q - 1] = ts[k] as number;
        nexts[q - 1] = (ts[k + 1] as number | undefined) ?? u1 - 0.4;
      });
    }
    const last = bounds.slice(0, -1).map((u, j) => (j ? u : t0 + 0.5));
    for (const r of s.reveals) {
      const t = times[r.at - 1] as number;
      const next = nexts[r.at - 1] as number;
      const j = spanOf(r.at);
      if (r.wipe !== undefined) {
        const dur = r3(Math.max(0.8, Math.min(2.6, next - t)));
        tl.fromTo(r.id, { attr: { width: 0 } }, { attr: { width: 0 }, duration: 0.01 }, 0);
        tl.fromTo(
          r.id,
          { attr: { width: 0 } },
          { attr: { width: r.wipe }, duration: dur, ease: "sine.inOut" },
          t,
        );
        last[j] = Math.max(last[j] as number, t + dur);
      } else {
        const o = (frames[i] as Frame).preview ? PREVIEW : 0;
        tl.fromTo(r.id, { opacity: o }, { opacity: o, duration: 0.01 }, 0);
        tl.fromTo(r.id, { opacity: o }, { opacity: 1, duration: 0.5, ease: "power2.out" }, t);
        last[j] = Math.max(last[j] as number, t + 0.5);
      }
    }
    if (!s.cam)
      throw new Error(
        `literal: ${kind} frame ${i} has no material for the camera (no \`cam\` primitive)`,
      );
    // A push-in toward the material's centre of interest: the frame's own `focus`, else its middle.
    const focus = (frames[i] as Frame & { focus?: { x: number; y: number } }).focus;
    const fx = focus ? focus.x - s.cam.x : s.cam.w / 2;
    const fy = focus ? focus.y - s.cam.y : s.cam.h / 2;
    const ox = `${r3((100 * fx) / Math.max(1, s.cam.w))}% ${r3((100 * fy) / Math.max(1, s.cam.h))}%`;
    // After each sentence's parts are out the camera pushes in while it is spoken, and is
    // back at rest before the next sentence: a hold is the frame as drawn, never mid-push
    // (r3 C: four planes' tick labels pushed onto their axis names at the hold).
    for (let j = 0; j < S; j++) {
      const u1 = bounds[j + 1] as number;
      const more = j < S - 1;
      const stop = more ? u1 - 0.85 : u1 - 0.05;
      const from = last[j] as number;
      if (!(stop - from > 0.3)) continue;
      tl.fromTo(
        `f${i}-cam`,
        { scale: 1, transformOrigin: ox },
        { scale: PUSH, transformOrigin: ox, duration: r3(stop - from), ease: "sine.inOut" },
        from,
      );
      if (more)
        tl.fromTo(
          `f${i}-cam`,
          { scale: PUSH, transformOrigin: ox },
          { scale: 1, transformOrigin: ox, duration: 0.6, ease: "sine.inOut" },
          r3(u1 - 0.8),
        );
    }
  });
  return {
    markup: `<div id="SCENEID-lit">\n${staged.map((s) => s.svg).join("\n")}\n</div>`,
    css: baseCss(theme),
    script: tl.script,
  };
}

/* -------------------------------------------------------------- the fill */

/**
 * The share of the region a frame's material covers: its pictures, filled
 * shapes and plotted lines, on an 8px grid. Text and outlines do not count. Pure,
 * read off the primitives that ship.
 */
export function frameFill(frame: Frame, region: Region): number {
  const G = 8;
  const cols = Math.ceil(region.width / G);
  const rows = Math.ceil(region.height / G);
  const cover = new Uint8Array(cols * rows);
  for (const p of frame.prims) {
    const counts =
      p.p === "image" ||
      ((p.p === "rect" || p.p === "circle") &&
        (p.fill || p.heat !== undefined || p.mix || p.rgb)) ||
      (p.p === "path" && (p.fill || p.closed || p.width >= 3));
    if (!counts || (p.opacity ?? 1) < 0.1) continue;
    const b = boxOf(p);
    const c0 = Math.max(0, Math.floor(b.x / G));
    const c1 = Math.min(cols, Math.ceil((b.x + b.w) / G));
    const r0 = Math.max(0, Math.floor(b.y / G));
    const r1 = Math.min(rows, Math.ceil((b.y + b.h) / G));
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) cover[r * cols + c] = 1;
  }
  return cover.reduce((a, v) => a + v, 0) / cover.length;
}

/* ------------------------------------------------------------ as a kind */

/** How large a verb reads its picture. */
export interface VerbOpts {
  /** Longest side the picture is read at; 0: the verb reads no picture. */
  pictureSide: number;
  /** The beat whose picture the verb reads (absent: none). */
  pictureOf?: (lit: Literal) => string | undefined;
}

const measureOf =
  (theme: Theme): Measure =>
  (text, size) =>
    widthOf(text, size, theme);

/** A verb drawn on the stage, as the build's `KindImpl`. */
export function verbKind<K extends LiteralKind>(
  kind: K,
  run: VerbRun<K>,
  opts: VerbOpts,
): KindImpl {
  return {
    picture: opts.pictureSide > 0,
    async layers(input: KindInput) {
      const lit = input.spec.data as Extract<Literal, { kind: K }> | undefined;
      if (!lit || lit.kind !== kind)
        throw new Error(`literal: the ${kind} scene has no \`literal\` data`);
      const wants = opts.pictureOf?.(lit);
      if (wants && !input.image) throw new Error(`literal: the ${kind} scene needs its picture`);
      const image =
        wants && input.image ? await readPicture(input.image, opts.pictureSide) : undefined;
      const r = runVerb(run, {
        lit,
        labels: input.spec.labels,
        region: input.region,
        theme: input.theme,
        measure: measureOf(input.theme),
        dry: false,
        ...(image ? { image } : {}),
        earlier: input.earlier,
        assets: input.spec.assets ?? {},
        ...(input.spec.headline ? { headline: input.spec.headline } : {}),
      });
      const L = await writeLayers(r, input.beatId, input.dir);
      await copyFigures(r, input.spec.assets ?? {}, input.beatId, input.dir, L.files);
      // Earlier layers this one shows keep their own files.
      for (const f of r.frames)
        for (const p of f.prims)
          if (p.p === "image" && p.layer.startsWith("from:") && !L.files[p.layer]) {
            const [, beat, key] = p.layer.split(":");
            const file = input.earlier.get(beat as string)?.layers.files[key as string];
            if (!file)
              throw new Error(`literal: ${kind} shows ${beat}'s ${key}, which it did not compute`);
            L.files[p.layer] = file;
          }
      return r.material ? { ...L, material: r.material } : L;
    },
    fragment(L, region, cues, spec, theme, href) {
      return stagedFragment(kind, L, region, cues, spec, theme, href);
    },
  };
}

/** Why a verb cannot be drawn, at plan time: its run on placeholder material. Empty when it can. */
export function verbProblems<K extends LiteralKind>(
  kind: K,
  run: VerbRun<K>,
  lit: Literal,
  region: Region,
  theme: Theme,
): string[] {
  const labels = Object.fromEntries(lit.labels.map((l) => [l.slot, l.text]));
  try {
    const r = runVerb(run, {
      lit: lit as Extract<Literal, { kind: K }>,
      labels,
      region,
      theme,
      measure: measureOf(theme),
      dry: true,
      image: placeholderPicture(),
      earlier: new Map(),
      assets: {},
    });
    // Every slot a frame names must have its words: the fragment would throw at build.
    for (const f of r.frames)
      for (const p of f.prims)
        if (p.p === "text" && p.slot) lab(kind, { labels }, p.slot, p.vars ?? f.vars);
    return [];
  } catch (e) {
    return [(e as Error).message.replace(/^(?:literal|op|formula): /, "")];
  }
}

export type { Frame, MechanismResult, Prim, Raster, Region };
