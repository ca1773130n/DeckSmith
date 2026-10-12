/**
 * What the mechanism kinds share: the shape of their output, a seeded random
 * source, and a few raster and layout helpers.
 *
 * A mechanism kind is a PURE function from typed inputs (a picture, a table of
 * numbers, a graph) and the scene's region to a
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

import { TYPE_SCALE } from "../../emit/type.js";
import type { LiteralSlot } from "../../types.js";

/** FNV-1a, the repo's one copy (src/emit/motion.ts): a deterministic bucket from text. */
export { fnv1a } from "../../emit/motion.js";

import type { Rgb } from "../kit.js";

export type { LiteralSlot, Rgb };

/** A scalar map, 0..1 unless a kind says otherwise, row-major. */
export interface Gray {
  w: number;
  h: number;
  d: Float32Array;
}

/**
 * A theme colour by name — the style pack's tokens and nothing else: ink (fg),
 * muted, dim, rule, panel, accent and the four tones. The ground is the shell's;
 * a kind never paints it.
 */
export type Role = "fg" | "muted" | "dim" | "rule" | "panel" | "accent" | "a" | "b" | "c" | "d";

/** A picture with straight alpha, 0..1 per channel, RGBA row-major: drawn over the deck's ground. */
export interface Rgba {
  w: number;
  h: number;
  d: Float32Array;
}

/** A colour the data itself computes (a node's features), 0..1 per channel. */
export type DataRgb = readonly [number, number, number];

interface Paint {
  /** Stable across frames, so the framework can tween one primitive from frame to frame. */
  id?: string;
  opacity?: number;
  /**
   * STAGING (src/literal/kinds/stage.ts). `at` ≥ 1: hidden when its frame
   * opens, revealed as the frame's `at`-th sub-step, spread over the frame's
   * sentence; `wipe`: revealed left to right by a clip, not a fade; `cam`: part
   * of the frame's material the camera moves over once the reveals are done.
   */
  at?: number;
  wipe?: boolean;
  cam?: boolean;
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
      /** "auto": the theme's ink (fg) or its panel, whichever reads better on what is under the text. */
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
      /** Keep the picture's own aspect inside the box (a figure, a layer of unknown size). */
      fit?: boolean;
      /** With `fit`, at the box's top rather than its middle (a picture under its title). */
      top?: boolean;
    });

/** A raster layer: a picture, or a scalar map drawn in a theme colour with alpha = value × `alpha`. */
export type Raster = { rgb: Rgb } | { rgba: Rgba } | { heat: Gray; role: Role; alpha: number };

export interface Frame {
  id: string;
  prims: Prim[];
  /**
   * Room left around the camera's material for its push-in, px a side: the
   * camera's clip is its material's box grown by this, so text at the edge of
   * a plot is not cut while the camera leans in (`text_clipped`).
   */
  pad?: { x: number; y: number };
  /**
   * The frame's faded reveals stand at `PREVIEW` opacity from the frame's
   * first moment and come to full when spoken, so every hold shows the whole
   * diagram (the fill gate measures the content's box at EVERY hold). For a
   * diagram whose parts are known up front — a chain's stages, a plane's points,
   * a set's members — never for a computed result, which must not show before
   * the op that makes it. Wipes are untouched.
   */
  preview?: boolean;
  /**
   * Px the camera's material moves LEFT across the frame's time: a picture wider
   * than the scene read along (a band of a figure), instead of a push-in.
   */
  pan?: number;
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
  /** What a later verb may take as input (src/literal/kit.ts `Material`). */
  material?: import("../kit.js").Material;
}

export interface Region {
  width: number;
  height: number;
}

/** Text width in px; the adapter passes the deck's own measure (src/emit/svg.ts `textWidth`). */
export type Measure = (text: string, size: number) => number;

/** A conservative Latin estimate, for tests and previews. */
export const roughMeasure: Measure = (text, size) => text.length * size * 0.6;

/**
 * Han and kana: the scripts with no spaces between words, so a line breaks
 * between any two characters — as the deck's own CSS lets Chinese and Japanese
 * break (src/emit/composition.ts `cjkTypesetCss`). Hangul is not here: Korean
 * breaks at spaces, and a Korean word stays whole (`keep-all`).
 */
export const BREAKS_ANYWHERE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** Never opens a line (kinsoku): closing punctuation and the marks that lean on the character before. */
const NO_LINE_START = /[、。，．！？：；）」』】〕〉》”’ー々…・,.!?:;)\]%]/u;

/**
 * Greedy wrap by a measure. Breaks at spaces and, inside Han or kana, between
 * characters — without that a Chinese label is one unbreakable word (a
 * 14-character item ran 621px into a 582px part). A lone separator ("·") never
 * opens a line. A unit wider than the line keeps its own line; the caller decides
 * whether that is an error. An empty text is no lines.
 */
export function wrapBy(text: string, size: number, maxW: number, measure: Measure): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const { t, join, glue } of breakUnits(text)) {
    const next = cur ? `${cur}${join}${t}` : t;
    if (cur && !glue && measure(next, size) > maxW) {
      lines.push(cur);
      cur = t;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A text's break units, each with what joins it to the unit before on one line. */
function breakUnits(text: string): { t: string; join: string; glue: boolean }[] {
  const out: { t: string; join: string; glue: boolean }[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (/^[·•|/]$/.test(word)) {
      out.push({ t: word, join: " ", glue: true });
      continue;
    }
    const pieces: string[] = [];
    let run = "";
    for (const ch of word) {
      if (BREAKS_ANYWHERE.test(ch)) {
        if (run) pieces.push(run);
        run = "";
        pieces.push(ch);
      } else if (!run && pieces.length && NO_LINE_START.test(ch)) {
        pieces[pieces.length - 1] += ch;
      } else run += ch;
    }
    if (run) pieces.push(run);
    for (const [i, t] of pieces.entries()) out.push({ t, join: i ? "" : " ", glue: false });
  }
  return out;
}

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

/** `p` moved by (dx, dy). */
export function shiftPrim(p: Prim, dx: number, dy: number): Prim {
  switch (p.p) {
    case "line":
      return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    case "path":
      return { ...p, pts: p.pts.map((v, i) => v + (i % 2 ? dy : dx)) };
    case "circle":
    case "ellipse":
      return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    default:
      return { ...p, x: p.x + dx, y: p.y + dy };
  }
}
