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
import { type Cue, type Layers, label, px, r3, slotText, type Tl } from "./kit.js";

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
  /** The storyboard's `literal` object. */
  data?: unknown;
  /** The source's own figures a scene may show, by id → absolute file. */
  assets?: Record<string, string>;
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

/**
 * A slow move across a real picture (or a computed layer) between two times:
 * the picture's own motion — a push-in on a detail, a pan along it — so a long
 * sentence does not play over a frozen frame. Never a decoration: the element
 * moved is the material the scene computed. `from` is where the previous move
 * of the same element left it.
 */
export interface Pose {
  x: number;
  y: number;
  scale: number;
}
export const REST: Pose = { x: 0, y: 0, scale: 1 };
export function drift(
  tl: Tl,
  id: string,
  t0: number,
  t1: number,
  to: Pose,
  from: Pose = REST,
  origin = "50% 50%",
) {
  if (!(t1 - t0 > 0.3)) return;
  tl.fromTo(
    id,
    { x: r3(from.x), y: r3(from.y), scale: r3(from.scale), transformOrigin: origin },
    {
      x: r3(to.x),
      y: r3(to.y),
      scale: r3(to.scale),
      transformOrigin: origin,
      duration: t1 - t0,
      ease: "sine.inOut",
    },
    t0,
  );
}

/**
 * When `n` sub-steps of one step start, spread over the step's own sentence
 * (from `t0` to `t1`, leaving `tail` seconds at the end), never closer than
 * `min` nor further apart than `max`: a step's parts arrive while it is spoken,
 * not in the first second and then nothing.
 */
export function spread(t0: number, t1: number, n: number, min = 0.4, max = 2.4, tail = 0.8) {
  const dt = n > 1 ? Math.max(min, Math.min(max, (t1 - tail - t0) / n)) : 0;
  return Array.from({ length: n }, (_, i) => r3(t0 + i * dt));
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
  // A separator never starts a line: "Method-A · Method-B" breaks after the "·".
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

/**
 * A label on a picture that wraps to the picture's width instead of running past its
 * edge (a panel clips it: "…적용한 장면 0" in r3 of the pure-planner deck). One element, so
 * a tween of `id` still moves all of it; the browser wraps, word by word (keep-all keeps a
 * Korean word whole), and `fromBottom` grows it upward from `y` by the lines `wrap`
 * measures.
 */
export function tag(
  id: string,
  text: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  color: string,
  theme: Theme,
  extra = "",
  fromBottom = false,
): string {
  const n = wrap(text, size, maxW, theme).length;
  const top = fromBottom ? y - (n - 1) * size * 1.15 : y;
  return label(
    id,
    text,
    x,
    top,
    size,
    color,
    `${extra};white-space:normal;word-break:keep-all;width:${px(maxW)}`,
  );
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
