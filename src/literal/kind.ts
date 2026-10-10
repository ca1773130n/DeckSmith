/**
 * THE KIND CONTRACT: what a literal kind is given and what it returns, plus
 * the drawing helpers every kind shares (slot text, step timing, panels, word
 * wrap). A kind is one module in `src/literal/kinds/` exporting a `KindImpl`,
 * listed once in `src/literal/registry.ts`.
 *
 * EVERY WORD ON SCREEN IS A SLOT (src/types.ts `LITERAL_KIND_DOCS`), with no
 * default: a kind has no paper's facts and no language built in.
 */
import type { Fragment } from "../bespoke/contract.js";
import type { Theme } from "../emit/kit.js";
import { faceOf, textWidth } from "../emit/svg.js";
import type { LiteralKind } from "../types.js";
import { type Cue, type Layers, needNumber, px, r3, slotText } from "./kit.js";

/** What a kind is given: its picture (picture kinds), its data (data kinds), the earlier scenes (recap). */
export interface KindInput {
  beatId: string;
  /** Absolute path of the picture, for a picture kind. */
  image?: string;
  /** Where the layers are written. */
  dir: string;
  region: { width: number; height: number };
  spec: KindSpec;
  /**
   * The deck's theme: a kind that lays out words at build time measures them in
   * the deck's own face (`widthOf`). Required, so a caller cannot drop it silently.
   */
  theme: Theme;
  /** Earlier literal scenes of this deck, by beat id, in deck order. */
  earlier: ReadonlyMap<string, { kind: string; layers: Layers; labels: Record<string, string> }>;
}

export interface KindSpec {
  labels: Record<string, string>;
  /** The storyboard's `literal` object, for a data kind. */
  data?: unknown;
}

export interface KindImpl {
  /** Whether the kind computes from the deck's picture. */
  picture: boolean;
  layers(input: KindInput): Promise<Layers>;
  fragment(
    L: Layers,
    region: { width: number; height: number },
    cues: readonly Cue[],
    spec: KindSpec,
    theme: Theme,
    href: (f: string) => string,
  ): Fragment;
}

/* ----------------------------------------------------------------- helpers */

/** A slot's text (src/types.ts `LITERAL_KIND_DOCS`): no defaults, so no paper's facts and no language are built in. */
export const lab = (
  kind: LiteralKind,
  spec: KindSpec,
  slot: string,
  vars?: Readonly<Record<string, string | number>>,
) => slotText(kind, spec.labels, slot, vars);
export const num = (kind: LiteralKind, spec: KindSpec, slot: string) =>
  needNumber(kind, spec.labels, slot);
export const LAB_H = 60;
export const even = (n: number) => 2 * Math.round(n / 2);

/**
 * When `n` causal steps start: on the narration's cues when there are enough,
 * else spread evenly over the narrated span (one step per cue is the rule;
 * this is only for a beat narrated in fewer sentences than it has steps).
 */
export function stepStarts(cues: readonly Cue[], n: number): number[] {
  if (cues.length >= n) return cues.slice(0, n).map((c) => c.t0);
  if (!cues.length) return Array.from({ length: n }, (_, i) => r3(0.8 + i * 3));
  const t0 = (cues[0] as Cue).t0;
  const t1 = (cues[cues.length - 1] as Cue).t1;
  return Array.from({ length: n }, (_, i) => r3(t0 + ((t1 - t0) * i) / n));
}

export function img(
  id: string,
  src: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra = "",
) {
  return `<img id="SCENEID-${id}" src="${src}" style="left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};${extra}" alt="">`;
}

export function panel(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  inner: string,
  cls = "",
) {
  return `<div id="SCENEID-${id}" class="lit-panel ${cls}" style="left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}">${inner}</div>`;
}

/** Rendered width of a label, px, in the deck's face. */
export function widthOf(text: string, size: number, theme: Theme, weight = 600): number {
  return textWidth(text, size, weight, 0, false, faceOf(theme.fontStack));
}

/** Greedy word wrap to `maxW` px; a word wider than the line keeps its own line. */
export function wrap(
  text: string,
  size: number,
  maxW: number,
  theme: Theme,
  weight = 600,
): string[] {
  // A separator never starts a line: "SFSNiD · SFRDP-Net" breaks after the "·".
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .reduce<string[]>((acc, w) => {
      if (/^[·•|/]$/.test(w) && acc.length) acc[acc.length - 1] = `${acc[acc.length - 1]} ${w}`;
      else acc.push(w);
      return acc;
    }, []);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && widthOf(next, size, theme, weight) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export function std(v: ArrayLike<number>): number {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i] as number;
    s2 += (v[i] as number) ** 2;
  }
  const m = s / Math.max(1, v.length);
  return Math.sqrt(Math.max(0, s2 / Math.max(1, v.length) - m * m));
}

export function mean(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] as number;
  return s / Math.max(1, v.length);
}

export function normBy(v: Float32Array, k: number): Float32Array {
  const o = new Float32Array(v.length);
  const d = Math.max(1e-9, k);
  for (let i = 0; i < v.length; i++) o[i] = Math.min(1, (v[i] as number) / d);
  return o;
}

/** A deterministic sequence in [0, 1): a 32-bit LCG, seeded. Build time only (invariant 4 is render time). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
