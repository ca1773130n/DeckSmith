/**
 * What the mechanism kinds share: the shape of their output, a seeded random
 * source, and a few raster and layout helpers.
 *
 * A mechanism kind is a PURE function from typed inputs (a picture, a table of
 * numbers, a graph, a gridworld, a corpus) and the scene's region to a
 * `MechanismResult`: rasters computed at build time, and frames of plain
 * vector primitives in region pixels. The framework renders them (`svg.ts`
 * draws one frame as SVG; an adapter turns rasters into files and frames into
 * a fragment whose steps follow the narration).
 *
 * Determinism: no `Math.random`, no `Date`; every random draw comes from
 * `mulberry32(seed)`. Same input, same bytes (`resultBytes` is what the tests
 * hash).
 *
 * Words: a kind never writes language of its own. A text primitive carries
 * either the input's own strings (tokens, item names, node labels) or a slot
 * name plus the computed values the slot's text may name as `{var}`, exactly
 * like the literal kinds' `slotText` (src/types.ts `LiteralSlot`).
 */
import type { Rgb } from "../../bespoke/literal-kit.js";
import { TYPE_SCALE } from "../../emit/type.js";
import type { LiteralSlot } from "../../types.js";

export type { LiteralSlot, Rgb };

/** A scalar map, 0..1 unless a kind says otherwise, row-major. */
export interface Gray {
  w: number;
  h: number;
  d: Float32Array;
}

/** A theme colour by name: `Theme`'s own keys (`bg` is the ground) and its four tones. */
export type Role =
  | "bg"
  | "fg"
  | "muted"
  | "dim"
  | "rule"
  | "panel"
  | "accent"
  | "a"
  | "b"
  | "c"
  | "d";

/** A picture with straight alpha, 0..1 per channel, RGBA row-major: drawn over the deck's ground. */
export interface Rgba {
  w: number;
  h: number;
  d: Float32Array;
}

/** A colour the data itself computes (a node's features, a splat's colour), 0..1 per channel. */
export type DataRgb = readonly [number, number, number];

interface Paint {
  /** Stable across frames, so the framework can tween one primitive from frame to frame. */
  id?: string;
  opacity?: number;
}

export type Prim =
  | (Paint & {
      p: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      role: Role;
      /** Tone weights (see the circle's `mix`): the line carries a data colour instead of `role`. */
      mix?: number[];
      width: number;
      arrow?: boolean;
      dash?: boolean;
    })
  | (Paint & {
      p: "path";
      /** x0, y0, x1, y1, … */
      pts: number[];
      role: Role;
      width: number;
      closed?: boolean;
      fill?: Role;
      dash?: boolean;
    })
  | (Paint & {
      p: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      /** Stroke. */
      role?: Role;
      width?: number;
      fill?: Role;
      /** 0..1 on the theme's ramp (background → accent), instead of `fill`. */
      heat?: number;
      mix?: number[];
      rgb?: DataRgb;
      radius?: number;
    })
  | (Paint & {
      p: "circle";
      cx: number;
      cy: number;
      r: number;
      role?: Role;
      width?: number;
      fill?: Role;
      heat?: number;
      /**
       * Weights 0..1 on the tones a, b, c, d (in that order): the hue is their
       * weighted mix, the strength their sum (capped at 1) over the panel.
       */
      mix?: number[];
      rgb?: DataRgb;
    })
  | (Paint & {
      p: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      /** Degrees, clockwise in screen space. */
      angle: number;
      role?: Role;
      width?: number;
      rgb?: DataRgb;
    })
  | (Paint & {
      p: "text";
      x: number;
      y: number;
      /** Baseline-free: `y` is the top of the line. */
      size: number;
      /** "auto": the theme's ink or ground, whichever reads better on what is under the text. */
      role: Role | "auto";
      anchor: "start" | "middle" | "end";
      weight?: number;
      /** The input's own string … */
      text?: string;
      /** … or a slot, filled with `vars`. */
      slot?: string;
      vars?: Readonly<Record<string, string | number>>;
    })
  | (Paint & {
      p: "image";
      x: number;
      y: number;
      w: number;
      h: number;
      /** Key into `MechanismResult.rasters`. */
      layer: string;
      /** Nearest-neighbour upscaling (a patch grid stays a grid). */
      pixelated?: boolean;
    });

/** A raster layer: a picture, or a scalar map drawn in a theme colour with alpha = value × `alpha`. */
export type Raster = { rgb: Rgb } | { rgba: Rgba } | { heat: Gray; role: Role; alpha: number };

export interface Frame {
  id: string;
  prims: Prim[];
  /** The values this frame's slots may name. */
  vars: Record<string, string | number>;
}

export interface MechanismResult {
  rasters: Record<string, Raster>;
  frames: Frame[];
  /** The computed numbers, for tests and for a fragment that wants them. */
  data: Record<string, unknown>;
  /** Values the takeaway template names. */
  vars: Record<string, string | number>;
}

export interface Region {
  width: number;
  height: number;
}

/** Text width in px; the adapter passes the deck's own measure (src/emit/svg.ts `textWidth`). */
export type Measure = (text: string, size: number) => number;

/** A conservative Latin estimate, for tests and previews. */
export const roughMeasure: Measure = (text, size) => text.length * size * 0.6;

/** The deck's type, never below 40 px at 1920×1080 (invariant 5). */
export const TYPE = {
  headline: TYPE_SCALE.headline,
  body: TYPE_SCALE.body,
  label: TYPE_SCALE.label,
} as const;

/** Mulberry32: a 32-bit seeded generator, uniform on [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws (Box–Muller) from a seeded uniform source. */
export function normals(rng: () => number): () => number {
  let spare: number | undefined;
  return () => {
    if (spare !== undefined) {
      const s = spare;
      spare = undefined;
      return s;
    }
    const u = 1 - rng();
    const v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/** FNV-1a of a string: a deterministic seed or bucket from text. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** `{name}` in a template, replaced by `vars[name]`; throws on a name it was not given. */
export function fillTemplate(
  template: string,
  vars: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`template names ${m}, which was not computed`);
    return String(v);
  });
}

/** A number as a plain value: `digits` decimals, no trailing noise, "-0" never shown. */
export function fmt(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/** Area-average resample of a picture to w×h (any ratio). */
export function resample(img: Rgb, w: number, h: number): Rgb {
  const d = new Float32Array(w * h * 3);
  const kx = img.w / w;
  const ky = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ky);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * kx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
      const n = (x1 - x0) * (y1 - y0);
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) s += img.d[(yy * img.w + xx) * 3 + c] as number;
        d[(y * w + x) * 3 + c] = s / n;
      }
    }
  }
  return { w, h, d };
}

/** The largest w×h box of the picture's aspect inside bw×bh, centred at (bx, by). */
export function fitBox(
  w: number,
  h: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): { x: number; y: number; w: number; h: number } {
  const k = Math.min(bw / w, bh / h);
  const W = w * k;
  const H = h * k;
  return { x: bx + (bw - W) / 2, y: by + (bh - H) / 2, w: W, h: H };
}

/** A polyline as flat points, rounded to 2 decimals (bytes do not drift). */
export function flat(points: ReadonlyArray<readonly [number, number]>): number[] {
  const o: number[] = [];
  for (const [x, y] of points) o.push(r2(x), r2(y));
  return o;
}

/** Clamped to 0..1. */
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** "Nice" axis ticks (1, 2, 5 × 10^k) covering [lo, hi], about `n` of them. */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number((Math.round(v / step) * step).toPrecision(12)) + 0); // no float dust, never "-0"
  return out;
}

/**
 * Every byte a result carries, for determinism checks: each raster's floats and
 * the frames and data as JSON (typed arrays as their bytes' hex).
 */
export function resultBytes(r: MechanismResult): Buffer {
  const parts: Buffer[] = [];
  for (const key of Object.keys(r.rasters).sort()) {
    const L = r.rasters[key] as Raster;
    const m = "rgb" in L ? L.rgb : "rgba" in L ? L.rgba : L.heat;
    parts.push(Buffer.from(`${key}:${m.w}x${m.h};`));
    parts.push(Buffer.from(m.d.buffer, m.d.byteOffset, m.d.byteLength));
  }
  const replacer = (_k: string, v: unknown) =>
    ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("hex") : v;
  parts.push(Buffer.from(JSON.stringify([r.frames, r.data, r.vars], replacer)));
  return Buffer.concat(parts);
}
