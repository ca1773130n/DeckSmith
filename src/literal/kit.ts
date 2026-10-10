/**
 * The shared kit of the literal scenes (src/literal/index.ts and every kind
 * under src/literal/kinds/): decoding and writing rasters through ffmpeg,
 * the plain-TypeScript maths every layer is computed with, and the fragment
 * helpers that keep each scene inside the deck's invariants (fromTo only,
 * scoped selectors, 3-decimal times, type never under 40px).
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Theme } from "../emit/kit.js";
import { TYPE_SCALE } from "../emit/type.js";
import { type LITERAL_KIND_NAMES, literalSlotsOf } from "../types.js";

type LiteralKindName = (typeof LITERAL_KIND_NAMES)[number];

const run = promisify(execFile);

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

export function toRgba(img: Rgb): Uint8Array {
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
export function mapRgba(v: Float32Array, color?: [number, number, number]): Uint8Array {
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

export function clamp255(x: number): number {
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

export function scale(v: Float32Array, k: number): Float32Array {
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
export const EDGE: [number, number, number] = [255, 226, 120];

/* ---------------------------------------------------------------- fragments */

export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const round3 = r3;
export const px = (n: number) => `${Math.round(n)}px`;
/** Escape a label for markup. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The scene's tween lines, every one `fromTo` (invariant 2), every selector `#SCENEID-…` (invariant 3). */
export class Tl {
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
    // Invariant 10 holds for a duration as for a position: a computed span
    // (10.324000000000002) would move a byte with float drift.
    const timed = typeof to.duration === "number" ? { ...to, duration: r3(to.duration) } : to;
    this.lines.push(
      `tl.fromTo("#SCENEID-${id}", ${JSON.stringify(from)}, ${JSON.stringify(first ? timed : { ...timed, immediateRender: false })}, ${r3(at)});`,
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

/* --------------------------------------------------------------------- slots */

/**
 * A scene's words by slot (src/types.ts `LITERAL_KIND_DOCS`). Throws on a slot the
 * kind does not declare — a fragment reading an undocumented slot is a bug,
 * since the planner was never told to fill it — and on a required one the
 * plan left out: no kind has a default, in any language or for any paper.
 * `{name}` in the text is replaced by the computed `vars[name]`.
 */
export function slotText(
  kind: LiteralKindName,
  labels: Readonly<Record<string, string>>,
  slot: string,
  vars: Readonly<Record<string, string | number>> = {},
): string {
  const decl = literalSlotsOf(kind)[slot];
  if (!decl)
    throw new Error(
      `literal: ${kind} reads slot "${slot}", which its LITERAL_KIND_DOCS entry does not declare`,
    );
  if (decl.number)
    throw new Error(`literal: ${kind} slot "${slot}" is a number; read it with slotNumber`);
  const text = labels[slot];
  if (text === undefined || !text.trim()) {
    if (decl.optional) return "";
    throw new Error(`literal: ${kind} needs the label slot "${slot}" (${decl.what})`);
  }
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!decl.vars?.includes(name) || vars[name] === undefined)
      throw new Error(
        `literal: ${kind} slot "${slot}" names ${m}, which the scene does not compute`,
      );
    return String(vars[name]);
  });
}

/** A number slot's value: a fact of the paper the scene computes with. Undefined only when optional and absent. */
export function slotNumber(
  kind: LiteralKindName,
  labels: Readonly<Record<string, string>>,
  slot: string,
): number | undefined {
  const decl = literalSlotsOf(kind)[slot];
  if (!decl?.number) throw new Error(`literal: ${kind} has no number slot "${slot}"`);
  const text = labels[slot];
  if (text === undefined || !text.trim()) {
    if (decl.optional) return undefined;
    throw new Error(`literal: ${kind} needs the number slot "${slot}" (${decl.what})`);
  }
  const v = Number(text.trim());
  if (!Number.isFinite(v))
    throw new Error(`literal: ${kind} slot "${slot}" must be a number, got "${text}"`);
  return v;
}

/** `slotNumber` for a required slot. */
export function needNumber(
  kind: LiteralKindName,
  labels: Readonly<Record<string, string>>,
  slot: string,
): number {
  return slotNumber(kind, labels, slot) as number;
}

export const LABEL = TYPE_SCALE.body; // 44
export const SMALL = TYPE_SCALE.label; // 40

/** A label as positioned HTML. Never below 40px (invariant 5). */
export function label(
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

export const ON_PHOTO =
  "color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.75),0 0 2px rgba(0,0,0,.9);font-weight:600";

export function baseCss(theme: Theme): string {
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
