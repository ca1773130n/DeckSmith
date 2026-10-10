/**
 * The literal kinds beyond the prototype's three (haze, spikes, sobel): every
 * part of a paper's deck drawn as its real objects, never a metaphor device.
 *
 * Two families.
 * - PICTURE KINDS compute their layers from the deck's own picture at build
 *   time: `dark-channel` (the classical prior, run for real), `channel-threshold`
 *   and `ema-threshold` (TM-LIF's per-channel threshold, its calibration and its
 *   freeze), `backbone` (an encoder–decoder of FIXED operations at true relative
 *   sizes), `fixed-filters` (the Sobel kernels and the structure map SSM builds),
 *   `crops` (training crops at true scale).
 * - DATA KINDS draw what the source states: `table` (numbers and claims,
 *   cited, rows lit in spoken order, winning or missing cells marked), `scale`
 *   (reported quantities as lengths to scale, no growth), `recap` (the earlier
 *   scenes' own computed layers, small, in order).
 *
 * WHAT IS EXACT AND WHAT IS ILLUSTRATIVE. The Dark Channel Prior is He et al.'s
 * (min filter, top-0.1% airlight, ω = 0.95, t₀ = 0.1, guided-filter refinement),
 * and the haze it runs on was added with a KNOWN uniform t, so the estimate is
 * checked against the truth on screen. TM-LIF's quantizer (clip(⌊u/θ⌋, 0, D)/D,
 * D = 4), α = 0.6 and μ = 0.9 are the paper's stated defaults; the CHANNELS
 * are fixed filter responses, not the trained network's, and θ = α·σ̂ reads the
 * paper's "proportional to the variance estimate" through its spread — every
 * scene says "예시" (illustrative) where that matters. The backbone's operations
 * are fixed, not learned, and its output — which needs trained weights — is
 * never drawn.
 */
import { join } from "node:path";
import type { Theme } from "../emit/kit.js";
import { faceOf, textWidth } from "../emit/svg.js";
import type { Fragment } from "./contract.js";
import {
  AIRLIGHT,
  baseCss,
  boxBlur,
  type Cue,
  EDGE,
  esc,
  haze,
  LABEL,
  type Layers,
  label,
  luma,
  mapRgba,
  px,
  quantile,
  type Rgb,
  r3,
  readRgb,
  SMALL,
  sobel,
  T_HAZE,
  Tl,
  toRgba,
  writeRaster,
} from "./literal-kit.js";

/* ---------------------------------------------------------------- contract */

/** What a kind is given: its picture (picture kinds), its data (data kinds), the earlier scenes (recap). */
export interface KindInput {
  beatId: string;
  /** Absolute path of the picture, for a picture kind. */
  image?: string;
  /** Where the layers are written. */
  dir: string;
  region: { width: number; height: number };
  spec: KindSpec;
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

const lab = (spec: KindSpec, k: string, dflt: string) => spec.labels[k] ?? dflt;
const LAB_H = 60;
const even = (n: number) => 2 * Math.round(n / 2);

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

function img(id: string, src: string, x: number, y: number, w: number, h: number, extra = "") {
  return `<img id="SCENEID-${id}" src="${src}" style="left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};${extra}" alt="">`;
}

function panel(id: string, x: number, y: number, w: number, h: number, inner: string, cls = "") {
  return `<div id="SCENEID-${id}" class="lit-panel ${cls}" style="left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}">${inner}</div>`;
}

/** Rendered width of a label, px, in the deck's face. */
function widthOf(text: string, size: number, theme: Theme, weight = 600): number {
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
  const words = text.split(/\s+/).filter(Boolean);
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

function std(v: ArrayLike<number>): number {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i] as number;
    s2 += (v[i] as number) ** 2;
  }
  const m = s / Math.max(1, v.length);
  return Math.sqrt(Math.max(0, s2 / Math.max(1, v.length) - m * m));
}

function mean(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] as number;
  return s / Math.max(1, v.length);
}

function normBy(v: Float32Array, k: number): Float32Array {
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

/* ------------------------------------------------------- dark channel prior */

/** Separable min filter of radius r (a (2r+1)² patch), edges clamped. */
export function minFilter(v: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = Number.POSITIVE_INFINITY;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          const s = src[yy * w + xx] as number;
          if (s < m) m = s;
        }
        out[y * w + x] = m;
      }
    return out;
  };
  return pass(pass(v, true), false);
}

/** The dark channel: the patch minimum of the per-pixel minimum over colour. */
export function darkChannel(img: Rgb, r: number, A: readonly number[] = [1, 1, 1]): Float32Array {
  const m = new Float32Array(img.w * img.h);
  for (let i = 0, j = 0; i < m.length; i++, j += 3)
    m[i] = Math.min(
      (img.d[j] as number) / (A[0] as number),
      (img.d[j + 1] as number) / (A[1] as number),
      (img.d[j + 2] as number) / (A[2] as number),
    );
  return minFilter(m, img.w, img.h, r);
}

/** He et al.'s guided filter, grey guide. */
export function guidedFilter(
  I: Float32Array,
  p: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const n = I.length;
  const mul = (a: Float32Array, b: Float32Array) => a.map((v, i) => v * (b[i] as number));
  const mI = boxBlur(I, w, h, r);
  const mP = boxBlur(p, w, h, r);
  const cII = boxBlur(mul(I, I), w, h, r);
  const cIP = boxBlur(mul(I, p), w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = (cII[i] as number) - (mI[i] as number) ** 2;
    const cov = (cIP[i] as number) - (mI[i] as number) * (mP[i] as number);
    a[i] = cov / (varI + eps);
    b[i] = (mP[i] as number) - (a[i] as number) * (mI[i] as number);
  }
  const mA = boxBlur(a, w, h, r);
  const mB = boxBlur(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = (mA[i] as number) * (I[i] as number) + (mB[i] as number);
  return q;
}

export interface DcpResult {
  dark: Float32Array;
  A: [number, number, number];
  t: Float32Array;
  J: Rgb;
}

/** The classical Dark Channel Prior dehaze (He, Sun, Tang), guided-filter refined. */
export function dcp(I: Rgb, r: number, omega = 0.95, t0 = 0.1): DcpResult {
  const { w, h } = I;
  const dark = darkChannel(I, r);
  // Airlight: among the brightest 0.1% of the dark channel, the brightest input pixel.
  const order = Array.from(dark, (v, i) => [v, i] as const).sort(
    (a, b) => b[0] - a[0] || a[1] - b[1],
  );
  const top = order.slice(0, Math.max(1, Math.round(dark.length * 0.001)));
  let best = (top[0] as readonly [number, number])[1];
  let bestY = -1;
  const L = luma(I);
  for (const [, i] of top)
    if ((L[i] as number) > bestY) {
      bestY = L[i] as number;
      best = i;
    }
  const A: [number, number, number] = [
    I.d[best * 3] as number,
    I.d[best * 3 + 1] as number,
    I.d[best * 3 + 2] as number,
  ];
  const raw = darkChannel(I, r, A).map((v) => 1 - omega * v);
  const t = guidedFilter(L, raw, w, h, Math.max(4, r * 4), 1e-3).map((v) =>
    Math.max(0, Math.min(1, v)),
  );
  const d = new Float32Array(I.d.length);
  for (let i = 0; i < w * h; i++) {
    const ti = Math.max(t[i] as number, t0);
    for (let c = 0; c < 3; c++) {
      const a = A[c] as number;
      d[i * 3 + c] = Math.max(0, Math.min(1, ((I.d[i * 3 + c] as number) - a) / ti + a));
    }
  }
  return { dark, A, t, J: { w, h, d } };
}

const DCP_W = 600;
const DCP_H = 400;
/** Where the estimate misses the transmission we applied by more than this, the prior failed. */
export const DCP_MISS = 0.08;

const darkChannelKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const hazy = haze(await readRgb(image as string, DCP_W, DCP_H), T_HAZE, AIRLIGHT);
    const r = 7; // a 15×15 patch, He et al.'s, at this width
    const { dark, t, J, A } = dcp(hazy, r);
    const files = {
      hazy: `${beatId}-hazy.jpg`,
      dark: `${beatId}-dark.png`,
      trans: `${beatId}-trans.png`,
      rec: `${beatId}-rec.jpg`,
      miss: `${beatId}-miss.png`,
      thumb: `${beatId}-rec.jpg`,
    };
    await writeRaster(join(dir, files.hazy), DCP_W, DCP_H, toRgba(hazy));
    await writeRaster(join(dir, files.dark), DCP_W, DCP_H, mapRgba(dark));
    await writeRaster(join(dir, files.trans), DCP_W, DCP_H, mapRgba(t));
    await writeRaster(join(dir, files.rec), DCP_W, DCP_H, toRgba(J));
    // Where the estimate misses the truth: opacity grows with the miss beyond the tolerance.
    const miss = t.map((v) => {
      const e = Math.abs(v - T_HAZE);
      return e > DCP_MISS ? Math.min(0.9, 0.45 + (e - DCP_MISS) * 8) : 0;
    });
    await writeRaster(join(dir, files.miss), DCP_W, DCP_H, mapRgba(miss, [255, 64, 160]));
    // The row the estimate misses most on, in the middle band: its transmission profile.
    let row = Math.round(DCP_H / 2);
    let worst = -1;
    for (let y = Math.round(DCP_H * 0.25); y < Math.round(DCP_H * 0.75); y++) {
      let e = 0;
      for (let x = 0; x < DCP_W; x++) e += Math.abs((t[y * DCP_W + x] as number) - T_HAZE);
      if (e > worst) {
        worst = e;
        row = y;
      }
    }
    const N = 120;
    const profile: number[] = [];
    for (let i = 0; i < N; i++) {
      const x0 = Math.floor((i * DCP_W) / N);
      const x1 = Math.floor(((i + 1) * DCP_W) / N);
      let s = 0;
      for (let x = x0; x < x1; x++) s += t[row * DCP_W + x] as number;
      profile.push(r3(s / (x1 - x0)));
    }
    const missFrac = r3(mean(miss.map((v) => (v > 0 ? 1 : 0))));
    // The prior's own premise, tested on the CLEAR picture: its dark channel should be about 0.
    const clearDark = darkChannel(await readRgb(image as string, DCP_W, DCP_H), r);
    const premise = quantile(clearDark, 0.5).toFixed(2);
    return {
      files,
      data: { row: row / DCP_H, profile, tTrue: T_HAZE, A: A.map(r3), missFrac, premise },
    };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const d = L.data as {
      row: number;
      profile: number[];
      tTrue: number;
      missFrac: number;
      premise: string;
    };
    const f = L.files as Record<string, string>;
    const gap = 28;
    const ph = even((H - 2 * LAB_H - gap) / 2);
    const pw = even(ph * 1.5);
    const x2 = pw + gap;
    const y2 = LAB_H * 2 + ph + gap;
    const qx = 2 * pw + gap + 64;
    const qw = W - qx;
    const rowY = r3(d.row * ph);
    const tile = (id: string, src: string, x: number, y: number, over = "") =>
      panel(id, x, y, pw, ph, `${img(`${id}-i`, href(src), 0, 0, pw, ph)}${over}`, "lit-dark");
    // Transmission plot: 0..1 up the axis, the truth as a dashed line.
    const py0 = LAB_H + 20;
    const plotH = H - py0 - LAB_H * 3 - 30;
    const plotW = qw - 10;
    // A window around the truth, so a miss of a few hundredths is visible.
    const lo = Math.max(0, Math.min(d.tTrue - 0.2, ...d.profile) - 0.02);
    const hi = Math.min(1, Math.max(d.tTrue + 0.2, ...d.profile) + 0.02);
    const yOf = (v: number) => r3(py0 + (1 - (v - lo) / (hi - lo)) * plotH);
    const pts = d.profile
      .map((v, i) => `${r3((i / (d.profile.length - 1)) * plotW)},${yOf(v)}`)
      .join(" ");
    const truthY = yOf(d.tTrue);
    const scan = (id: string) =>
      `<div id="SCENEID-${id}" style="position:absolute;left:0;top:${px(rowY - 2)};width:${px(pw)};height:4px;background:${theme.accent}"></div>`;
    const markup = `<div id="SCENEID-lit">
${label("l-hazy", lab(spec, "hazy", "안개 입력"), 0, 0, LABEL, theme.fg)}
${tile("p-hazy", f.hazy as string, 0, LAB_H)}
${label("l-dark", lab(spec, "dark", "고전 DCP의 암채널"), x2, 0, LABEL, theme.fg)}
${panel("p-dark", x2, LAB_H, pw, ph, `<div id="SCENEID-dark-w" style="position:absolute;left:0;top:0;width:0;height:${px(ph)};overflow:hidden">${img("dark-i", href(f.dark as string), 0, 0, pw, ph)}</div>`, "lit-dark")}
${label("l-trans", lab(spec, "transmission", "추정 투과율"), 0, y2 - LAB_H, LABEL, theme.fg)}
${tile("p-trans", f.trans as string, 0, y2, scan("scan"))}
${label("l-rec", lab(spec, "recovered", "고전 DCP 복원"), x2, y2 - LAB_H, LABEL, theme.fg)}
${tile("p-rec", f.rec as string, x2, y2, img("miss", href(f.miss as string), 0, 0, pw, ph))}
${label("l-plot", lab(spec, "profile", "선 위의 투과율"), qx, 0, LABEL, theme.fg)}
<svg id="SCENEID-plot" width="${qw}" height="${H}" viewBox="0 0 ${qw} ${H}" style="left:${px(qx)};top:0">
<line x1="0" y1="${py0}" x2="0" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<line x1="0" y1="${r3(py0 + plotH)}" x2="${plotW}" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<line id="SCENEID-truth" x1="0" y1="${truthY}" x2="${plotW}" y2="${truthY}" stroke="${theme.fg}" stroke-width="3" stroke-dasharray="12 10"/>
<polyline id="SCENEID-est" points="${pts}" fill="none" stroke="${theme.accent}" stroke-width="4" stroke-linejoin="round"/>
</svg>
${label("l-truth", lab(spec, "truth", `실제 투과율 ${d.tTrue}`), qx, H - LAB_H * 3 - 4, SMALL, theme.fg)}
${label("l-premise", lab(spec, "premise", "가정: 맑은 영상의 암채널 ≈ 0"), qx, H - LAB_H * 2 + 4, SMALL, theme.fg)}
${label("l-premise2", lab(spec, "premise2", `이 장면에서는 ${d.premise}`), qx, H - LAB_H + 4, SMALL, theme.accent)}
${label("l-est", lab(spec, "estimate", "DCP 추정"), qx + qw / 2, H - LAB_H * 3 - 4, SMALL, theme.accent)}
</div>`;
    const [, s1, s2, s3] = stepStarts(cues, 4) as [number, number, number, number];
    const tl = new Tl();
    // Step 1: the classical prior is applied to the hazy input.
    tl.show("p-hazy", 0.05, 0.5);
    tl.show("l-hazy", 0.2);
    // Step 2: the dark channel, computed patch by patch, sweeps in.
    tl.show("l-dark", Math.max(0.6, s1 - 0.2));
    tl.show("p-dark", Math.max(0.6, s1 - 0.2), 0.4);
    tl.fromTo(
      "dark-w",
      { width: 0 },
      { width: pw, duration: 2.4, ease: "none" },
      Math.max(0.8, s1 + 0.2),
    );
    // Step 3: transmission from the dark channel; along one line it is checked against the truth.
    tl.show("l-trans", s2);
    tl.show("p-trans", s2, 0.8);
    tl.fromTo("scan", { opacity: 0 }, { opacity: 1, duration: 0.4 }, s2 + 1.0);
    tl.show("l-plot", s2 + 1.0);
    tl.show("plot", s2 + 1.0, 0.5);
    tl.show("l-truth", s2 + 1.2);
    tl.show("l-est", s2 + 1.6);
    tl.fromTo("est", { opacity: 0 }, { opacity: 1, duration: 0.8 }, s2 + 1.6);
    // Step 4: the recovered picture, then where the prior's estimate missed.
    tl.show("l-rec", s3);
    tl.show("p-rec", s3, 0.8);
    tl.fromTo("miss", { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "sine.inOut" }, s3 + 2.2);
    tl.show("l-premise", s3 + 2.6);
    tl.show("l-premise2", s3 + 3.0);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* ---------------------------------------------------------------- TM-LIF */

/** The paper's stated defaults (analysis Q3): α, D, EMA momentum μ, T. */
export const ALPHA = 0.6;
export const LEVELS_D = 4;
export const MOMENTUM = 0.9;
export const T_STEPS = 1;

/** TM-LIF's quantizer at one step from rest: clip(⌊u/θ⌋, 0, D) / D. */
export function tmQuantize(u: ArrayLike<number>, theta: number, D = LEVELS_D): Float32Array {
  const o = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++)
    o[i] = Math.max(0, Math.min(D, Math.floor((u[i] as number) / Math.max(1e-12, theta)))) / D;
  return o;
}

/** A threshold per channel from its spread: θ = α·σ (illustrative reading of "proportional to the variance estimate"). */
export const thetaOf = (sigma: number, alpha = ALPHA) => alpha * sigma;

interface Channel {
  name: string;
  u: Float32Array;
}

/** Five fixed-filter channels of a picture, of very different scales (illustrative, not the trained network's). */
export function channelsOf(img: Rgb): Channel[] {
  const { w, h } = img;
  const l = luma(img);
  const rb = new Float32Array(w * h);
  for (let i = 0; i < rb.length; i++)
    rb[i] = Math.abs((img.d[i * 3] as number) - (img.d[i * 3 + 2] as number));
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number;
  const gx = new Float32Array(w * h);
  const lap = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      gx[y * w + x] = Math.abs(
        -at(x - 1, y - 1) +
          at(x + 1, y - 1) -
          2 * at(x - 1, y) +
          2 * at(x + 1, y) -
          at(x - 1, y + 1) +
          at(x + 1, y + 1),
      );
      lap[y * w + x] = Math.abs(
        4 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1),
      );
    }
  const bl = boxBlur(l, w, h, 3);
  const hp = l.map((v, i) => Math.abs(v - (bl[i] as number)));
  // Each channel's membrane is its deviation from its own mean (a normalised feature's magnitude).
  const centred = (v: Float32Array) => {
    const m = mean(v);
    return v.map((x) => Math.abs(x - m));
  };
  return [
    { name: "밝기", u: centred(l) },
    { name: "Sobel x", u: centred(gx) },
    { name: "색차 R−B", u: centred(rb) },
    { name: "라플라시안", u: centred(lap) },
    { name: "고주파", u: centred(hp) },
  ];
}

const CH_W = 360;
const CH_H = 240;
/** The histogram's log axis, decades of the membrane potential. */
const LOG_LO = -3.5;
const LOG_HI = 0.5;
const BINS = 40;

const logPos = (v: number) => (Math.log10(Math.max(10 ** LOG_LO, v)) - LOG_LO) / (LOG_HI - LOG_LO);

const channelThresholdKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const hazy = haze(await readRgb(image as string, CH_W, CH_H), T_HAZE, AIRLIGHT);
    const chans = channelsOf(hazy);
    // ONE fixed threshold for all: α × the spread of every channel pooled.
    const pooled = new Float32Array(chans.reduce((n, c) => n + c.u.length, 0));
    let o = 0;
    for (const c of chans) {
      pooled.set(c.u, o);
      o += c.u.length;
    }
    const thetaFixed = thetaOf(std(pooled));
    const files: Record<string, string> = {};
    const out: Array<Record<string, unknown>> = [];
    for (const [k, c] of chans.entries()) {
      const sigma = std(c.u);
      const theta = thetaOf(sigma);
      const fix = tmQuantize(c.u, thetaFixed);
      const cal = tmQuantize(c.u, theta);
      files[`map${k}`] = `${beatId}-ch${k}.png`;
      files[`fix${k}`] = `${beatId}-ch${k}-fix.png`;
      files[`cal${k}`] = `${beatId}-ch${k}-cal.png`;
      await writeRaster(
        join(dir, files[`map${k}`] as string),
        CH_W,
        CH_H,
        mapRgba(normBy(c.u, quantile(c.u, 0.99))),
      );
      await writeRaster(join(dir, files[`fix${k}`] as string), CH_W, CH_H, mapRgba(fix));
      await writeRaster(join(dir, files[`cal${k}`] as string), CH_W, CH_H, mapRgba(cal));
      const hist = new Array<number>(BINS).fill(0);
      for (const v of c.u) {
        const b = Math.min(BINS - 1, Math.max(0, Math.floor(logPos(v) * BINS)));
        hist[b] = (hist[b] as number) + 1;
      }
      const top = Math.max(...hist);
      out.push({
        name: c.name,
        hist: hist.map((n) => r3(n / top)),
        theta: r3(logPos(theta)),
        fired: {
          fix: r3(mean(fix.map((v) => (v > 0 ? 1 : 0)))),
          cal: r3(mean(cal.map((v) => (v > 0 ? 1 : 0)))),
        },
      });
    }
    // The recap's thumbnail: the smallest channel's calibrated spikes, silent under the fixed threshold.
    const fixOf = (i: number) => (out[i]?.fired as { fix: number } | undefined)?.fix ?? 1;
    const quiet = out.reduce((a, _b, i) => (fixOf(i) < fixOf(a) ? i : a), 0);
    files.thumb = files[`cal${quiet}`] as string;
    return {
      files,
      data: { channels: out, thetaFixed: r3(logPos(thetaFixed)), alpha: ALPHA, D: LEVELS_D },
    };
  },
  fragment(L, { width: W }, cues, spec, theme, href) {
    const d = L.data as {
      channels: Array<{
        name: string;
        hist: number[];
        theta: number;
        fired: { fix: number; cal: number };
      }>;
      thetaFixed: number;
      alpha: number;
      D: number;
    };
    const f = L.files as Record<string, string>;
    const n = d.channels.length;
    const gap = 24;
    const cw = Math.floor((W - (n - 1) * gap) / n);
    const ch = even(cw / 1.5);
    const histH = 150;
    const yMap = LAB_H * 2;
    const yHist = yMap + ch + 24;
    const yRow = yHist + histH + 20;
    const ySp = yRow + LAB_H;
    const cols = d.channels
      .map((c, k) => {
        const x = k * (cw + gap);
        const bw = cw / c.hist.length;
        const bars = c.hist
          .map(
            (v, i) =>
              `<rect x="${r3(i * bw)}" y="${r3(histH - v * (histH - 8))}" width="${r3(bw - 1)}" height="${r3(v * (histH - 8))}" fill="${theme.muted}"/>`,
          )
          .join("");
        return `${label(`n${k}`, c.name, x, LAB_H, SMALL, theme.fg)}
${panel(`m${k}`, x, yMap, cw, ch, img(`mi${k}`, href(f[`map${k}`] as string), 0, 0, cw, ch), "lit-dark")}
<svg id="SCENEID-h${k}" width="${cw}" height="${histH}" viewBox="0 0 ${cw} ${histH}" style="left:${px(x)};top:${px(yHist)}">${bars}<line x1="0" y1="${histH}" x2="${cw}" y2="${histH}" stroke="${theme.rule}" stroke-width="2"/></svg>
<div id="SCENEID-th${k}" style="position:absolute;left:${px(x + d.thetaFixed * cw - 2)};top:${px(yHist - 6)};width:5px;height:${px(histH + 12)};background:${theme.accent}"></div>
${panel(`s${k}`, x, ySp, cw, ch, `${img(`sf${k}`, href(f[`fix${k}`] as string), 0, 0, cw, ch)}${img(`sc${k}`, href(f[`cal${k}`] as string), 0, 0, cw, ch)}`, "lit-dark")}`;
      })
      .join("\n");
    const markup = `<div id="SCENEID-lit">
${label("l-ch", lab(spec, "channels", "규모가 다른 채널"), 0, 0, LABEL, theme.fg)}
${label("l-note", `α = ${d.alpha} · D = ${d.D}`, W - widthOf(`α = ${d.alpha} · D = ${d.D}`, SMALL, theme) - 8, 0, SMALL, theme.muted)}
${cols}
${label("l-fix", lab(spec, "fixed", "하나의 고정 임계값"), 0, yRow, LABEL, theme.fg)}
${label("l-cal", lab(spec, "calibrated", "채널별 보정 · 예시 값"), 0, yRow, LABEL, theme.accent)}
</div>`;
    const [s0, s1] = stepStarts(cues, 2) as [number, number];
    // With one cue, the calibration is the cue's second half.
    const cal =
      cues.length >= 2 ? s1 : Math.max(s0 + 4.5, ((cues[0]?.t0 ?? 0.8) + (cues[0]?.t1 ?? 9)) / 2);
    const tl = new Tl();
    tl.show("l-ch", 0.1);
    tl.show("l-note", 0.4);
    for (let k = 0; k < n; k++) {
      tl.show(`m${k}`, 0.2 + k * 0.12, 0.5);
      tl.show(`n${k}`, 0.2 + k * 0.12, 0.5);
      tl.show(`h${k}`, s0 + 0.6 + k * 0.1, 0.5);
    }
    // Step 1: ONE threshold for every channel; the small-scale ones fall silent.
    const f0 = s0 + 1.6;
    tl.show("l-fix", f0);
    for (let k = 0; k < n; k++) {
      tl.show(`th${k}`, f0, 0.4);
      tl.show(`s${k}`, f0 + 0.3, 0.6);
      tl.fromTo(`sc${k}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    }
    tl.fromTo("l-cal", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    // Step 2: each channel's threshold moves to its own scale, and its spikes appear.
    d.channels.forEach((c, k) => {
      tl.fromTo(
        `th${k}`,
        { x: 0 },
        { x: r3((c.theta - d.thetaFixed) * cw), duration: 1.6, ease: "sine.inOut" },
        cal,
      );
      tl.fromTo(
        `sc${k}`,
        { opacity: 0 },
        { opacity: 1, duration: 1.0, ease: "sine.inOut" },
        cal + 0.9,
      );
    });
    tl.hide("l-fix", cal, 0.4);
    tl.fromTo("l-cal", { opacity: 0 }, { opacity: 1, duration: 0.5 }, cal + 0.4);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* --------------------------------------------- calibrated, then frozen (EMA) */

export interface EmaRun {
  /** Each training crop's own α·σ. */
  own: number[];
  /** The threshold after each crop: α·√(EMA of σ²). */
  theta: number[];
}

/** TM-LIF's running estimate: v̂ ← μ·v̂ + (1−μ)·σ², θ = α·√v̂; v̂ starts at the first crop's. */
export function emaThresholds(sigmas: readonly number[], mu = MOMENTUM, alpha = ALPHA): EmaRun {
  let v = (sigmas[0] ?? 0) ** 2;
  const theta: number[] = [];
  sigmas.forEach((s, i) => {
    if (i > 0) v = mu * v + (1 - mu) * s * s;
    theta.push(alpha * Math.sqrt(v));
  });
  return { own: sigmas.map((s) => alpha * s), theta };
}

/** `n` non-identical crop origins of size `c` inside w×h, from a seeded LCG. */
export function cropOrigins(
  w: number,
  h: number,
  c: number,
  n: number,
  seed: number,
): Array<[number, number]> {
  const rnd = lcg(seed);
  const out: Array<[number, number]> = [];
  while (out.length < n) {
    const x = Math.floor(rnd() * (w - c + 1));
    const y = Math.floor(rnd() * (h - c + 1));
    out.push([x, y]);
  }
  return out;
}

const CROP = 256;
const N_CROPS = 16;
/** The test picture's haze: denser than training's, so its statistics differ (illustrative). */
const T_TEST = 0.2;

function sobelChannelStd(img: Rgb): number {
  return std(sobel(luma(img), img.w, img.h));
}

function cropOf(img: Rgb, x0: number, y0: number, c: number): Rgb {
  const d = new Float32Array(c * c * 3);
  for (let y = 0; y < c; y++)
    for (let x = 0; x < c; x++)
      for (let k = 0; k < 3; k++)
        d[(y * c + x) * 3 + k] = img.d[((y0 + y) * img.w + (x0 + x)) * 3 + k] as number;
  return { w: c, h: c, d };
}

async function nativeSize(image: string): Promise<{ w: number; h: number }> {
  // The picture's own pixel size, through ffprobe (render's dependency already).
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    image,
  ]);
  const [w, h] = String(stdout).trim().split(",").map(Number);
  if (!w || !h) throw new Error(`literal: ffprobe could not size ${image}`);
  return { w, h };
}

const emaKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const { w, h } = await nativeSize(image as string);
    const full = haze(await readRgb(image as string, w, h), T_HAZE, AIRLIGHT);
    const origins = cropOrigins(w, h, CROP, N_CROPS, 20261010);
    const sig = origins.map(([x, y]) => sobelChannelStd(cropOf(full, x, y, CROP)));
    const run = emaThresholds(sig);
    const testImg = haze(await readRgb(image as string, w, h), T_TEST, AIRLIGHT);
    const testOwn = ALPHA * sobelChannelStd(testImg);
    const DW = 720;
    const DH = Math.round((DW * h) / w);
    const files = { hazy: `${beatId}-train.jpg`, test: `${beatId}-test.jpg` };
    await writeRaster(
      join(dir, files.hazy),
      DW,
      DH,
      toRgba(haze(await readRgb(image as string, DW, DH), T_HAZE, AIRLIGHT)),
    );
    await writeRaster(
      join(dir, files.test),
      DW,
      DH,
      toRgba(haze(await readRgb(image as string, DW, DH), T_TEST, AIRLIGHT)),
    );
    return {
      files,
      data: {
        w,
        h,
        crop: CROP,
        origins,
        own: run.own.map((v) => r3(v * 1000) / 1000),
        theta: run.theta.map((v) => r3(v * 1000) / 1000),
        testOwn: r3(testOwn * 1000) / 1000,
        mu: MOMENTUM,
        alpha: ALPHA,
      },
    };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const d = L.data as {
      w: number;
      h: number;
      crop: number;
      origins: Array<[number, number]>;
      own: number[];
      theta: number[];
      testOwn: number;
      mu: number;
      alpha: number;
    };
    const f = L.files as Record<string, string>;
    const pw = Math.min(760, even(((H - LAB_H) * 1.5) | 0));
    const ph = even((pw * d.h) / d.w);
    const k = pw / d.w;
    const cs = r3(d.crop * k);
    const qx = pw + 72;
    const qw = W - qx;
    // Plot: crops 1..N on the left 72%, then the inference column.
    const n = d.own.length;
    const trainW = qw * 0.68;
    const infX = trainW + 60;
    const py0 = LAB_H + 30;
    const plotH = H - py0 - LAB_H * 2;
    const vals = [...d.own, ...d.theta, d.testOwn];
    const vmax = Math.max(...vals) * 1.15;
    const vmin = Math.min(...vals) * 0.8;
    const yOf = (v: number) => r3(py0 + (1 - (v - vmin) / (vmax - vmin)) * plotH);
    const xOf = (i: number) => r3(((i + 0.5) / n) * trainW);
    const dots = d.own
      .map(
        (v, i) =>
          `<circle id="SCENEID-o${i}" cx="${xOf(i)}" cy="${yOf(v)}" r="9" fill="${theme.muted}"/>`,
      )
      .join("");
    const segs = d.theta
      .map((v, i) => {
        const x0 = i === 0 ? 0 : xOf(i - 1);
        const y0 = i === 0 ? yOf(v) : yOf(d.theta[i - 1] as number);
        return `<line id="SCENEID-e${i}" x1="${x0}" y1="${y0}" x2="${xOf(i)}" y2="${yOf(v)}" stroke="${theme.accent}" stroke-width="5" stroke-linecap="round"/>`;
      })
      .join("");
    const last = d.theta[n - 1] as number;
    const markup = `<div id="SCENEID-lit">
${label("l-train", lab(spec, "train", "학습: 무작위 256×256 크롭"), 0, 0, LABEL, theme.fg)}
${label("l-infer", lab(spec, "infer", "추론: 새 영상"), 0, 0, LABEL, theme.fg)}
${panel("pic", 0, LAB_H, pw, ph, `${img("train", href(f.hazy as string), 0, 0, pw, ph)}${img("test", href(f.test as string), 0, 0, pw, ph)}<div id="SCENEID-crop" style="position:absolute;left:0;top:0;width:${px(cs)};height:${px(cs)};border:4px solid ${theme.accent};box-sizing:border-box"></div>`, "lit-dark")}
${label("l-ema", lab(spec, "ema", `임계값 = α·√EMA(분산) · μ = ${d.mu}`), qx, 0, LABEL, theme.fg)}
<svg id="SCENEID-plot" width="${qw}" height="${H}" viewBox="0 0 ${qw} ${H}" style="left:${px(qx)};top:0">
<line x1="0" y1="${r3(py0 + plotH)}" x2="${qw}" y2="${r3(py0 + plotH)}" stroke="${theme.rule}" stroke-width="2"/>
<rect id="SCENEID-zone" x="${r3(infX - 24)}" y="${py0}" width="${r3(qw - infX + 24)}" height="${r3(plotH)}" fill="${theme.rule}" opacity="0.35"/>
${dots}${segs}
<line id="SCENEID-frozen" x1="${xOf(n - 1)}" y1="${yOf(last)}" x2="${qw}" y2="${yOf(last)}" stroke="${theme.accent}" stroke-width="5" stroke-dasharray="14 10"/>
<circle id="SCENEID-tdot" cx="${r3(infX + (qw - infX) / 2)}" cy="${yOf(d.testOwn)}" r="12" fill="none" stroke="${theme.fg}" stroke-width="4"/>
<line id="SCENEID-gap" x1="${r3(infX + (qw - infX) / 2)}" y1="${yOf(d.testOwn)}" x2="${r3(infX + (qw - infX) / 2)}" y2="${yOf(last)}" stroke="${theme.fg}" stroke-width="3" stroke-dasharray="4 6"/>
</svg>
${label("l-own", lab(spec, "own", "크롭마다의 값 (예시)"), qx, H - LAB_H * 2 + 6, SMALL, theme.muted)}
${label("l-frozen", lab(spec, "frozen", "추론: 임계값 고정"), qx + infX - 24, py0 + plotH + 6, SMALL, theme.accent)}
${label("l-test", lab(spec, "test", "새 영상의 값 — 다시 맞추지 않음"), qx, H - LAB_H + 6, SMALL, theme.fg)}
</div>`;
    const [s0, s1] = stepStarts(cues, 2) as [number, number];
    const tl = new Tl();
    tl.show("l-train", 0.1);
    tl.show("pic", 0.05, 0.5);
    tl.show("l-ema", 0.4);
    tl.show("plot", 0.4, 0.5);
    tl.fromTo("test", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    tl.fromTo("l-infer", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    tl.fromTo("zone", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    // Step 1, training: the crop visits N places; each one's spread moves the running average.
    const c0 = s0 + 0.8;
    const span = Math.max(4, Math.min(n * 0.55, s1 - c0 - 0.6));
    const dt = span / n;
    tl.show("crop", c0 - 0.3, 0.3);
    tl.show("l-own", c0);
    d.origins.forEach(([x, y], i) => {
      const at = c0 + i * dt;
      const prev = d.origins[i - 1] ?? [x, y];
      tl.fromTo(
        "crop",
        { x: r3(prev[0] * k), y: r3(prev[1] * k) },
        { x: r3(x * k), y: r3(y * k), duration: Math.min(0.2, dt * 0.5), ease: "power1.inOut" },
        at,
      );
      tl.show(`o${i}`, at + dt * 0.4, 0.25);
      tl.show(`e${i}`, at + dt * 0.5, 0.25);
    });
    // Step 2, inference: the threshold stops; a new picture arrives and is not recalibrated.
    const i0 = Math.max(c0 + span + 0.4, s1);
    tl.hide("crop", i0, 0.3);
    tl.hide("l-train", i0, 0.4);
    tl.fromTo("l-infer", { opacity: 0 }, { opacity: 1, duration: 0.5 }, i0 + 0.3);
    tl.fromTo("zone", { opacity: 0 }, { opacity: 0.35, duration: 0.6 }, i0);
    tl.show("frozen", i0 + 0.3, 0.6);
    tl.show("l-frozen", i0 + 0.5);
    tl.fromTo("test", { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "sine.inOut" }, i0 + 1.0);
    tl.show("tdot", i0 + 2.0, 0.5);
    tl.show("gap", i0 + 2.4, 0.5);
    tl.show("l-test", i0 + 2.4);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* --------------------------------------------------- encoder–decoder (fixed) */

const BB_W = 384;
const BB_H = 256;

/** 2×2 average pooling. */
export function avgPool(v: Float32Array, w: number, h: number): Float32Array {
  const W = w >> 1;
  const H = h >> 1;
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      o[y * W + x] =
        ((v[2 * y * w + 2 * x] as number) +
          (v[2 * y * w + 2 * x + 1] as number) +
          (v[(2 * y + 1) * w + 2 * x] as number) +
          (v[(2 * y + 1) * w + 2 * x + 1] as number)) /
        4;
  return o;
}

/** Nearest-neighbour 2× upsampling. */
export function upsample(v: Float32Array, w: number, h: number): Float32Array {
  const o = new Float32Array(w * h * 4);
  for (let y = 0; y < 2 * h; y++)
    for (let x = 0; x < 2 * w; x++) o[y * 2 * w + x] = v[(y >> 1) * w + (x >> 1)] as number;
  return o;
}

/** Spike-quantize a map at its own calibrated threshold, returning levels in [0, 1] and θ. */
function spikeMap(u: Float32Array): { s: Float32Array; theta: number } {
  const theta = thetaOf(std(u));
  return { s: tmQuantize(u, theta), theta };
}

export interface Backbone {
  shallow: Float32Array;
  enc: Float32Array[];
  dec: Float32Array[];
  prb: Float32Array;
}

/** An encoder–decoder of FIXED operations on a grey map w×h (w, h divisible by 8). */
export function fixedBackbone(l: Float32Array, w: number, h: number): Backbone {
  // Shallow: a fixed 3×3 (8-neighbour Laplacian) response, rectified.
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number;
  const shallow = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 8 * at(x, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) s -= at(x + dx, y + dy);
      shallow[y * w + x] = Math.abs(s);
    }
  const s0 = spikeMap(shallow).s;
  const enc: Float32Array[] = [s0];
  let cw = w;
  let chh = h;
  for (let i = 0; i < 3; i++) {
    const pooled = avgPool(enc[i] as Float32Array, cw, chh);
    cw >>= 1;
    chh >>= 1;
    enc.push(spikeMap(pooled).s);
  }
  // Decoder: up 2×, add the skip from the encoder at that scale, quantize.
  const dec: Float32Array[] = [];
  let cur = enc[3] as Float32Array;
  for (let i = 2; i >= 0; i--) {
    const up = upsample(cur, cw, chh);
    cw <<= 1;
    chh <<= 1;
    const skip = enc[i] as Float32Array;
    const sum = up.map((v, j) => v + (skip[j] as number));
    cur = spikeMap(sum).s;
    dec.unshift(cur);
  }
  // PRB (fixed stand-in): spike levels back to a continuous map, smoothed by a 3×3 mean.
  const prb = boxBlur(dec[0] as Float32Array, w, h, 1);
  return { shallow, enc, dec, prb };
}

const backboneKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const hazy = haze(await readRgb(image as string, BB_W, BB_H), T_HAZE, AIRLIGHT);
    const bb = fixedBackbone(luma(hazy), BB_W, BB_H);
    const files: Record<string, string> = {
      input: `${beatId}-input.jpg`,
      shallow: `${beatId}-shallow.png`,
      prb: `${beatId}-prb.png`,
    };
    await writeRaster(join(dir, files.input as string), BB_W, BB_H, toRgba(hazy));
    await writeRaster(
      join(dir, files.shallow as string),
      BB_W,
      BB_H,
      mapRgba(normBy(bb.shallow, quantile(bb.shallow, 0.99))),
    );
    const sizes = [1, 2, 4, 8];
    for (let i = 1; i <= 3; i++) {
      files[`e${i}`] = `${beatId}-e${i}.png`;
      await writeRaster(
        join(dir, files[`e${i}`] as string),
        BB_W / (sizes[i] as number),
        BB_H / (sizes[i] as number),
        mapRgba(bb.enc[i] as Float32Array),
      );
    }
    for (let i = 0; i <= 2; i++) {
      files[`d${i}`] = `${beatId}-d${i}.png`;
      await writeRaster(
        join(dir, files[`d${i}`] as string),
        BB_W / (sizes[i] as number),
        BB_H / (sizes[i] as number),
        mapRgba(bb.dec[i] as Float32Array),
      );
    }
    await writeRaster(join(dir, files.prb as string), BB_W, BB_H, mapRgba(bb.prb));
    files.thumb = files.prb as string;
    return { files, data: { w: BB_W, h: BB_H } };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const f = L.files as Record<string, string>;
    // A U: full size at the top corners, then 1/2, 1/4, 1/8 down the middle and back up.
    // Every map at its TRUE relative size; seven columns = 3.625 full widths + six gaps.
    const gap = 36;
    const full = even(Math.min(420, (W - 6 * gap) / 3.625, ((H - 2 * LAB_H) / 2) * 1.5));
    const sz = [full, full / 2, full / 4, full / 8].map((v) => even(v));
    const hz = sz.map((v) => even(v / 1.5));
    const lv = [0, 1, 2, 3, 2, 1, 0];
    const X: number[] = [];
    let x = 0;
    for (const l of lv) {
      X.push(x);
      x += (sz[l] as number) + gap;
    }
    const off = Math.max(0, (W - (x - gap)) / 2);
    for (let i = 0; i < X.length; i++) X[i] = (X[i] as number) + off;
    const fullH = hz[0] as number;
    const yIn = H - fullH;
    // Levels step down between the top row and the bottom of the region.
    const bottom = H - (hz[3] as number) - 4;
    const top1 = LAB_H + fullH * 0.55;
    const Y = lv.map((l) => (l === 0 ? LAB_H : top1 + ((bottom - top1) * (l - 1)) / 2));
    const centre = (i: number) => {
      const l = lv[i] as number;
      return [
        (X[i] as number) + (sz[l] as number) / 2,
        (Y[i] as number) + (hz[l] as number) / 2,
      ] as const;
    };
    const map = (id: string, file: string, i: number, pix = true) => {
      const l = lv[i] as number;
      return panel(
        id,
        X[i] as number,
        Y[i] as number,
        sz[l] as number,
        hz[l] as number,
        img(
          `${id}-i`,
          href(file),
          0,
          0,
          sz[l] as number,
          hz[l] as number,
          pix ? "image-rendering:pixelated" : "",
        ),
        "lit-dark",
      );
    };
    const mapLabel = (id: string, text: string, i: number) =>
      label(id, text, X[i] as number, (Y[i] as number) - LAB_H, SMALL, theme.fg);
    const skip = (i: number, j: number) => {
      const [, y] = centre(i);
      const l = lv[i] as number;
      return `<line id="SCENEID-k${i}" x1="${r3((X[i] as number) + (sz[l] as number) + 6)}" y1="${r3(y)}" x2="${r3((X[j] as number) - 6)}" y2="${r3(y)}" stroke="${theme.muted}" stroke-width="4" stroke-dasharray="10 9"/>`;
    };
    const outLines = wrap(
      lab(spec, "untrained", "학습된 가중치가 필요해 그리지 않음"),
      SMALL,
      full - 48,
      theme,
    );
    const outText = outLines
      .map((t, i) =>
        label(`ot${i}`, t, (X[6] as number) + 24, yIn + 24 + i * 52, SMALL, theme.muted),
      )
      .join("");
    const note = lab(spec, "note", "고정 연산 예시 · 학습된 EM-SNN이 아님");
    const markup = `<div id="SCENEID-lit">
${label("l-in", lab(spec, "input", "입력"), X[0] as number, yIn - LAB_H, SMALL, theme.fg)}
${panel("in", X[0] as number, yIn, full, fullH, img("in-i", href(f.input as string), 0, 0, full, fullH), "lit-dark")}
${mapLabel("l0", lab(spec, "shallow", "3×3 특징"), 0)}
${map("m0", f.shallow as string, 0, false)}
${mapLabel("l1", lab(spec, "encoder", "인코더 1/2"), 1)}${map("m1", f.e1 as string, 1)}
${mapLabel("l2", "1/4", 2)}${map("m2", f.e2 as string, 2)}
${mapLabel("l3", "1/8", 3)}${map("m3", f.e3 as string, 3)}
${mapLabel("l4", "1/4", 4)}${map("m4", f.d2 as string, 4)}
${mapLabel("l5", lab(spec, "decoder", "디코더 1/2"), 5)}${map("m5", f.d1 as string, 5)}
${mapLabel("l6", lab(spec, "prb", "PRB: 연속 표현"), 6)}
${panel("m6", X[6] as number, Y[6] as number, full, fullH, `${img("m6-s", href(f.d0 as string), 0, 0, full, fullH, "image-rendering:pixelated")}${img("m6-c", href(f.prb as string), 0, 0, full, fullH)}`, "lit-dark")}
<svg id="SCENEID-skips" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="left:0;top:0">${skip(0, 6)}${skip(1, 5)}${skip(2, 4)}</svg>
${label("l-skip", lab(spec, "skip", "스킵 연결"), (X[1] as number) + (sz[1] as number) + 16, centre(1)[1] - 58, SMALL, theme.muted)}
${label("l-out", lab(spec, "output", "출력 3×3 합성곱"), X[6] as number, yIn - LAB_H, SMALL, theme.fg)}
<div id="SCENEID-out" style="position:absolute;left:${px(X[6] as number)};top:${px(yIn)};width:${px(full)};height:${px(fullH)};border:3px dashed ${theme.muted};box-sizing:border-box;border-radius:6px"></div>
${outText}
${label("l-fixed", note, Math.max(X[1] as number, (W - widthOf(note, SMALL, theme)) / 2), 0, SMALL, theme.muted)}
</div>`;
    const [s0, s1, s2, s3] = stepStarts(cues, 4) as [number, number, number, number];
    const tl = new Tl();
    tl.show("in", 0.05, 0.5);
    tl.show("l-in", 0.2);
    tl.show("l-fixed", 0.6);
    const appear = (
      id: string,
      i: number,
      from: readonly [number, number],
      scale: number,
      at: number,
    ) => {
      const [cx, cy] = centre(i);
      tl.fromTo(
        id,
        { opacity: 0, x: r3(from[0] - cx), y: r3(from[1] - cy), scale },
        { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.9, ease: "power2.inOut" },
        at,
      );
    };
    // Step 1: a 3×3 filter turns the input into shallow features.
    appear("m0", 0, [(X[0] as number) + full / 2, yIn + fullH / 2], 1, s0 + 0.6);
    tl.show("l0", s0 + 1.3);
    // Step 2: down, scale by scale — each map is the one before, pooled to half and spiked.
    for (let i = 1; i <= 3; i++) {
      const at = s1 + 0.3 + (i - 1) * 1.1;
      appear(`m${i}`, i, centre(i - 1), 2, at);
      tl.show(`l${i}`, at + 0.6);
    }
    // Step 3: up, scale by scale, each joined by the encoder's map across its skip.
    tl.show("skips", s2 + 0.1, 0.6);
    tl.show("l-skip", s2 + 0.1);
    for (const [i, from] of [
      [4, 3],
      [5, 4],
    ] as const) {
      const at = s2 + 0.5 + (i - 4) * 1.4;
      appear(`m${i}`, i, centre(from), 0.5, at);
      tl.show(`l${i}`, at + 0.6);
    }
    // Step 4: full size as spike levels, then the PRB's continuous map; the output is not drawn.
    appear("m6", 6, centre(5), 0.5, s3 + 0.2);
    tl.show("l6", s3 + 0.8);
    tl.fromTo("m6-c", { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "sine.inOut" }, s3 + 1.6);
    tl.show("l-out", s3 + 2.6);
    tl.show("out", s3 + 2.6, 0.5);
    for (let i = 0; i < outLines.length; i++) tl.show(`ot${i}`, s3 + 2.9);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* ------------------------------------------------------------- fixed filters */

export const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1] as const;
export const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1] as const;

/** SSM's structure map (analysis Q3): |Gx| + |Gy| of the channel mean, divided by its spatial mean. */
export function structureMap(
  l: Float32Array,
  w: number,
  h: number,
): { gx: Float32Array; gy: Float32Array; s: Float32Array } {
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] as number;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < 9; j++) {
        const v = at(x + (j % 3) - 1, y + Math.floor(j / 3) - 1);
        sx += (SOBEL_X[j] as number) * v;
        sy += (SOBEL_Y[j] as number) * v;
      }
      gx[y * w + x] = Math.abs(sx);
      gy[y * w + x] = Math.abs(sy);
    }
  const sum = gx.map((v, i) => v + (gy[i] as number));
  const m = Math.max(1e-9, mean(sum));
  return { gx, gy, s: sum.map((v) => v / m) };
}

const FF_W = 420;
const FF_H = 280;

const fixedFiltersKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const hazy = haze(await readRgb(image as string, FF_W, FF_H), T_HAZE, AIRLIGHT);
    const { gx, gy, s } = structureMap(luma(hazy), FF_W, FF_H);
    const top = quantile(
      gx.map((v, i) => Math.max(v, gy[i] as number)),
      0.99,
    );
    const files = { gx: `${beatId}-gx.png`, gy: `${beatId}-gy.png`, s: `${beatId}-s.png` };
    await writeRaster(join(dir, files.gx), FF_W, FF_H, mapRgba(normBy(gx, top), EDGE));
    await writeRaster(join(dir, files.gy), FF_W, FF_H, mapRgba(normBy(gy, top), EDGE));
    await writeRaster(join(dir, files.s), FF_W, FF_H, mapRgba(normBy(s, quantile(s, 0.99))));
    return { files: { ...files, thumb: files.s }, data: { T: T_STEPS } };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const f = L.files as Record<string, string>;
    const d = L.data as { T: number };
    const cell = 64;
    const kw = cell * 3;
    const g = 28;
    const mw = Math.min(FF_W, even((W - 2 * kw - 4 * g - 16) / 3));
    const mh = even(mw / 1.5);
    const y0 = LAB_H;
    const kernel = (id: string, k: readonly number[], x: number) =>
      `<div id="SCENEID-${id}" style="position:absolute;left:${px(x)};top:${px(y0 + (mh - kw) / 2)};width:${px(kw)};height:${px(kw)}">${k
        .map(
          (v, i) =>
            `<div style="position:absolute;left:${px((i % 3) * cell)};top:${px(Math.floor(i / 3) * cell)};width:${px(cell - 4)};height:${px(cell - 4)};background:${theme.panel};border:2px solid ${theme.rule};box-sizing:border-box;color:${theme.fg};font-size:${SMALL}px;line-height:${px(cell - 8)};text-align:center;font-weight:600">${v}</div>`,
        )
        .join("")}</div>`;
    const xs = [0, kw + g, kw + 2 * g + mw, 2 * kw + 3 * g + mw];
    const xS = W - mw;
    const yCap = y0 + mh + 10;
    const yP = yCap + 56;
    const yT = yP + 2 * LAB_H + 24;
    const boxH = Math.max(150, H - yT - 4);
    const bw = Math.min(820, W * 0.5);
    const gw = (W - bw - 40) / 2 - 24;
    const ghosts = [1, 2].map((i) => {
      const gx = bw + 40 + (i - 1) * (gw + 24);
      return `<div id="SCENEID-g${i}" style="position:absolute;left:${px(gx)};top:${px(yT)};width:${px(gw)};height:${px(boxH)};border:3px dashed ${theme.muted};border-radius:8px;box-sizing:border-box"></div>${label(`gt${i}`, `t = ${i + 1}`, gx + 24, yT + 20, SMALL, theme.muted)}${label(`gs${i}`, lab(spec, "same", "같은 가중치"), gx + 24, yT + 76, SMALL, theme.muted)}`;
    });
    const lines = [
      lab(spec, "mlp", "채널 조절: 소형 MLP"),
      lab(spec, "gate", "공간 게이트: 경량 스파이킹 합성곱"),
    ];
    const markup = `<div id="SCENEID-lit">
${label("l-k", lab(spec, "kernels", "고정 Sobel 필터 → 기울기"), 0, 0, LABEL, theme.fg)}
${kernel("kx", SOBEL_X, xs[0] as number)}
${panel("gx", xs[1] as number, y0, mw, mh, img("gx-i", href(f.gx as string), 0, 0, mw, mh), "lit-dark")}
${kernel("ky", SOBEL_Y, xs[2] as number)}
${panel("gy", xs[3] as number, y0, mw, mh, img("gy-i", href(f.gy as string), 0, 0, mw, mh), "lit-dark")}
${label("l-s", lab(spec, "structure", "구조 맵"), xS, 0, LABEL, theme.fg)}
${panel("s", xS, y0, mw, mh, img("s-i", href(f.s as string), 0, 0, mw, mh), "lit-dark")}
${label("l-gx", "|Gx|", xs[1] as number, yCap, SMALL, theme.muted)}
${label("l-gy", "|Gy|", xs[3] as number, yCap, SMALL, theme.muted)}
${label("l-sf", "(|Gx|+|Gy|) / 평균", xS, yCap, SMALL, theme.muted)}
${label("l-p", lab(spec, "params", "필터 숫자는 고정 · 학습 파라미터 0개"), 0, yP, LABEL, theme.accent)}
${label("l-steps", lab(spec, "steps", `학습되는 작은 분기 · 기본 T = ${d.T}`), 0, yT - LAB_H - 6, LABEL, theme.fg)}
<div id="SCENEID-t1" style="position:absolute;left:0;top:${px(yT)};width:${px(bw)};height:${px(boxH)};border:3px solid ${theme.fg};border-radius:8px;box-sizing:border-box"></div>
${label("t1-l", "t = 1", 24, yT + 20, SMALL, theme.fg)}
${lines.map((t, i) => label(`t1-${i}`, t, 24, yT + 80 + i * 56, SMALL, theme.fg)).join("")}
${label("l-ghost", lab(spec, "shared", "T > 1이라면"), bw + 40, yT - LAB_H - 6, LABEL, theme.muted)}
${ghosts.join("")}
</div>`;
    const [s0, s1, s2] = stepStarts(cues, 3) as [number, number, number];
    const tl = new Tl();
    tl.show("l-k", 0.1);
    // Step 1: two fixed kernels, their responses on the picture, and their sum: nothing here is learned.
    tl.show("kx", s0 + 0.2, 0.5);
    tl.show("gx", s0 + 0.8, 0.6);
    tl.show("l-gx", s0 + 0.8);
    tl.show("ky", s0 + 1.4, 0.5);
    tl.show("gy", s0 + 2.0, 0.6);
    tl.show("l-gy", s0 + 2.0);
    tl.show("l-s", s0 + 2.8);
    tl.show("s", s0 + 2.8, 0.8);
    tl.show("l-sf", s0 + 2.8);
    tl.show("l-p", s0 + 3.6);
    // Step 2: the learned part is small: one MLP and one light spiking conv, in one time step.
    tl.show("l-steps", s1);
    tl.show("t1", s1 + 0.2, 0.5);
    tl.show("t1-l", s1 + 0.2);
    tl.show("t1-0", s1 + 0.6);
    tl.show("t1-1", s1 + 1.2);
    // Step 3: more steps would reuse the same weights; the default runs one.
    tl.show("l-ghost", s2);
    for (const i of [1, 2]) {
      tl.show(`g${i}`, s2 + 0.3 * i, 0.5);
      tl.show(`gt${i}`, s2 + 0.3 * i);
      tl.show(`gs${i}`, s2 + 0.3 * i + 0.4);
    }
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* ------------------------------------------------------------------ crops */

const BATCH = 4;

const cropsKind: KindImpl = {
  picture: true,
  async layers({ image, dir, beatId }) {
    const { w, h } = await nativeSize(image as string);
    const full = haze(await readRgb(image as string, w, h), T_HAZE, AIRLIGHT);
    // Four crops that do not overlap much: draw until each is a crop away from the others.
    const rnd = lcg(4);
    const origins: Array<[number, number]> = [];
    for (let tries = 0; origins.length < BATCH && tries < 400; tries++) {
      const x = Math.floor(rnd() * (w - CROP + 1));
      const y = Math.floor(rnd() * (h - CROP + 1));
      if (origins.every(([a, b]) => Math.abs(a - x) > CROP || Math.abs(b - y) > CROP))
        origins.push([x, y]);
    }
    const DW = 1080;
    const DH = Math.round((DW * h) / w);
    const files: Record<string, string> = { pic: `${beatId}-pic.jpg` };
    await writeRaster(
      join(dir, files.pic as string),
      DW,
      DH,
      toRgba(haze(await readRgb(image as string, DW, DH), T_HAZE, AIRLIGHT)),
    );
    for (const [i, [x, y]] of origins.entries()) {
      files[`c${i}`] = `${beatId}-crop${i}.jpg`;
      await writeRaster(
        join(dir, files[`c${i}`] as string),
        CROP,
        CROP,
        toRgba(cropOf(full, x, y, CROP)),
      );
    }
    return { files, data: { w, h, crop: CROP, origins } };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const d = L.data as { w: number; h: number; crop: number; origins: Array<[number, number]> };
    const f = L.files as Record<string, string>;
    const right = 560;
    const pw = Math.min(W - right - 60, even((H - LAB_H) * (d.w / d.h)));
    const ph = even((pw * d.h) / d.w);
    const k = pw / d.w;
    const cs = r3(d.crop * k);
    const bx = pw + 60;
    const tile = Math.min(250, (W - bx - 24) / 2, (H - LAB_H - 3 * LAB_H - 40) / 2);
    const slot = (i: number) =>
      [bx + (i % 2) * (tile + 24), LAB_H + Math.floor(i / 2) * (tile + 24)] as const;
    const crops = d.origins
      .map(([x, y], i) => {
        const [sx, sy] = slot(i);
        return `<div id="SCENEID-r${i}" style="position:absolute;left:${px(x * k)};top:${px(LAB_H + y * k)};width:${px(cs)};height:${px(cs)};border:4px solid ${theme.accent};box-sizing:border-box"></div>
<div id="SCENEID-t${i}" class="lit-panel" style="left:${px(sx)};top:${px(sy)};width:${px(tile)};height:${px(tile)}">${img(`t${i}-i`, href(f[`c${i}`] as string), 0, 0, tile, tile)}</div>`;
      })
      .join("\n");
    const yText = LAB_H + 2 * tile + 24 + 40;
    const facts = [lab(spec, "optimizer", "AdamW"), lab(spec, "metrics", "평가: PSNR · SSIM")];
    const markup = `<div id="SCENEID-lit">
${label("l-pic", lab(spec, "picture", `예시 영상 ${d.w}×${d.h} · 크롭은 실제 비율`), 0, 0, LABEL, theme.fg)}
${panel("pic", 0, LAB_H, pw, ph, img("pic-i", href(f.pic as string), 0, 0, pw, ph), "lit-dark")}
${label("l-batch", lab(spec, "batch", `${d.crop}×${d.crop} 크롭 · 배치 ${d.origins.length}`), bx, 0, LABEL, theme.fg)}
${crops}
${facts.map((t, i) => label(`f${i}`, t, bx, yText + i * 56, SMALL, theme.fg)).join("\n")}
${label("f-ep", lab(spec, "epochs", "1000 에폭"), bx, yText + 2 * 56, SMALL, theme.fg)}
</div>`;
    const [s0, s1] = stepStarts(cues, 2) as [number, number];
    const tl = new Tl();
    tl.show("pic", 0.05, 0.5);
    tl.show("l-pic", 0.2);
    // Step 1: how it is trained and measured.
    tl.show("f0", s0 + 0.4);
    tl.show("f1", s0 + 1.2);
    // Step 2: random crops cut out of the picture, at true size, and stacked into a batch.
    tl.show("l-batch", s1);
    d.origins.forEach(([x, y], i) => {
      const at = s1 + 0.4 + i * 0.9;
      const [sx, sy] = slot(i);
      tl.show(`r${i}`, at, 0.4);
      tl.fromTo(
        `t${i}`,
        {
          opacity: 0,
          x: r3(x * k - sx + (cs - tile) / 2),
          y: r3(LAB_H + y * k - sy + (cs - tile) / 2),
          scale: r3(cs / tile),
        },
        { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.8, ease: "power2.inOut" },
        at + 0.3,
      );
    });
    tl.show("f-ep", s1 + 0.4 + d.origins.length * 0.9 + 0.4);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* ------------------------------------------------------------------ table */

interface TableData {
  columns: string[];
  rows: string[][];
  highlight: number[];
  marks: Array<{ row: number; col: number }>;
}

/**
 * Which rows light on which step: spoken order, spread over the cues when there
 * are more rows than cues — the LATER steps take the extra rows, since a
 * narration names its point first and then elaborates.
 */
export function rowSteps(highlight: readonly number[], cues: number): number[][] {
  const len = highlight.length;
  const n = Math.min(Math.max(1, cues), Math.max(1, len));
  const out: number[][] = Array.from({ length: n }, () => []);
  highlight.forEach((r, i) => {
    const k = n - 1 - Math.floor(((len - 1 - i) * n) / len);
    (out[k] as number[]).push(r);
  });
  return out;
}

/**
 * Column widths that fit `W`: water-filling from the narrowest column, so a
 * short column keeps its natural width and only the widest ones wrap.
 */
export function fitColumns(natural: readonly number[], W: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= W) return natural.map((w) => w + (W - total) / natural.length);
  const widths = new Array<number>(natural.length).fill(0);
  let avail = W;
  let left = natural.length;
  const order = natural.map((w, j) => [w, j] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [w, j] of order) {
    const share = avail / left;
    widths[j] = Math.min(w, share);
    avail -= widths[j] as number;
    left--;
  }
  return widths;
}

const tableKind: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const t = spec.data as TableData;
    const size = LABEL;
    const head = SMALL;
    const padX = 24;
    const lineH = Math.round(size * 1.25);
    const natural = t.columns.map(
      (c, j) =>
        Math.max(widthOf(c, head, theme), ...t.rows.map((r) => widthOf(r[j] ?? "", size, theme))) +
        2 * padX,
    );
    const widths = fitColumns(natural, W);
    const xs = widths.map((_, j) => widths.slice(0, j).reduce((a, b) => a + b, 0));
    const linesOf = (text: string, j: number, sz: number) =>
      wrap(text, sz, (widths[j] as number) - 2 * padX, theme);
    const caption = spec.labels.caption;
    const capH = caption ? 90 : 0;
    const headLines = Math.max(...t.columns.map((c, j) => linesOf(c, j, head).length));
    const bodyLines = t.rows.map((r) => Math.max(...r.map((c, j) => linesOf(c, j, size).length)));
    const content = headLines * lineH + bodyLines.reduce((a, b) => a + b, 0) * lineH;
    // Rows breathe to fill the region (quiet, not crammed), within limits.
    const pad = Math.max(14, Math.min(44, (H * 0.86 - content - capH) / (2 * (t.rows.length + 1))));
    const headH = headLines * lineH + 2 * pad;
    const bodyH = bodyLines.map((n) => n * lineH + 2 * pad);
    const cell = (
      id: string,
      text: string,
      j: number,
      y: number,
      h: number,
      color: string,
      sz: number,
      weight = 600,
    ) => {
      const lines = linesOf(text, j, sz);
      const top = y + (h - lines.length * lineH) / 2;
      return lines
        .map(
          (ln, i) =>
            `<div id="SCENEID-${id}-${i}" class="lit-label" style="left:${px((xs[j] as number) + padX)};top:${px(top + i * lineH + (lineH - sz * 1.15) / 2)};font-size:${sz}px;color:${color};font-weight:${weight}">${esc(ln)}</div>`,
        )
        .join("");
    };
    const y0 = 0;
    const headRow = t.columns
      .map((c, j) => cell(`h${j}`, c, j, y0, headH, theme.muted, head))
      .join("");
    let y = y0 + headH;
    const bodies: string[] = [];
    t.rows.forEach((r, i) => {
      const h = bodyH[i] as number;
      const marks = t.marks
        .filter((m) => m.row === i)
        .map(
          (m) =>
            `<div id="SCENEID-k${i}-${m.col}" style="position:absolute;left:${px((xs[m.col] as number) + 6)};top:${px(y + 6)};width:${px((widths[m.col] as number) - 12)};height:${px(h - 12)};border:3px solid ${theme.accent};box-sizing:border-box;border-radius:8px"></div>`,
        )
        .join("");
      bodies.push(
        `<div id="SCENEID-band${i}" style="position:absolute;left:0;top:${px(y)};width:${px(W)};height:${px(h)};background:${theme.rule}"></div>${marks}<div id="SCENEID-row${i}" style="position:absolute;left:0;top:0;width:100%;height:100%">${r
          .map((c, j) => {
            const marked = t.marks.some((m) => m.row === i && m.col === j);
            return cell(
              `c${i}-${j}`,
              c,
              j,
              y,
              h,
              marked ? theme.accent : theme.fg,
              size,
              marked ? 700 : 600,
            );
          })
          .join(
            "",
          )}</div><div style="position:absolute;left:0;top:${px(y + h)};width:${px(W)};height:2px;background:${theme.rule}"></div>`,
      );
      y += h;
    });
    const markup = `<div id="SCENEID-lit">
<div id="SCENEID-head" style="position:absolute;left:0;top:0;width:100%;height:100%">${headRow}<div style="position:absolute;left:0;top:${px(y0 + headH - 2)};width:${px(W)};height:3px;background:${theme.fg}"></div></div>
${bodies.join("\n")}
${caption ? label("cap", caption, 0, Math.min(H - LAB_H, y + 30), SMALL, theme.muted) : ""}
</div>`;
    const steps = rowSteps(t.highlight, cues.length);
    const at = stepStarts(cues, steps.length);
    const lit = new Set(t.highlight);
    const tl = new Tl();
    tl.show("head", 0.1, 0.5);
    // The whole table is there from the start, quiet; a row comes forward when it is spoken.
    t.rows.forEach((_, i) => {
      tl.fromTo(
        `row${i}`,
        { opacity: 0 },
        { opacity: lit.has(i) ? 0.4 : 1, duration: 0.6 },
        0.3 + i * 0.08,
      );
      tl.fromTo(`band${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
      for (const m of t.marks.filter((mm) => mm.row === i))
        tl.fromTo(`k${i}-${m.col}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    });
    if (caption) tl.show("cap", 0.6);
    steps.forEach((rows, s) => {
      const t0 = Math.max(0.3 + t.rows.length * 0.08 + 0.7, (at[s] as number) + 0.2);
      for (const i of rows) {
        tl.fromTo(
          `row${i}`,
          { opacity: 0.4 },
          { opacity: 1, duration: 0.6, ease: "power2.out" },
          t0,
        );
        tl.fromTo(`band${i}`, { opacity: 0 }, { opacity: 0.45, duration: 0.6 }, t0);
        for (const m of t.marks.filter((mm) => mm.row === i))
          tl.fromTo(
            `k${i}-${m.col}`,
            { opacity: 0 },
            { opacity: 1, duration: 0.8, ease: "sine.inOut" },
            t0 + 0.5,
          );
      }
      // The rows lit on the step before step back, so the spoken one leads.
      for (const i of steps[s - 1] ?? [])
        tl.fromTo(
          `band${i}`,
          { opacity: 0.45 },
          { opacity: 0, duration: 0.6, immediateRender: false },
          t0,
        );
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* ------------------------------------------------------------------ scale */

interface ScaleData {
  groups: Array<{ label: string; unit: string; items: Array<{ label: string; value: string }> }>;
  tile: boolean;
}

const tiles = (vals: readonly number[]) => {
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return min > 0 && max / min >= 1.5 ? Math.floor(max / min) : 0;
};

const scaleKind: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const s = spec.data as ScaleData;
    const tones = [theme.tones.a, theme.tones.b, theme.tones.c, theme.tones.d];
    const nameW =
      Math.max(...s.groups.flatMap((g) => g.items.map((it) => widthOf(it.label, LABEL, theme)))) +
      48;
    const valW =
      Math.max(
        ...s.groups.flatMap((g) =>
          g.items.map((it) => widthOf(`${it.value} ${g.unit}`, LABEL, theme)),
        ),
      ) + 48;
    const barX = nameW;
    const barW = W - nameW - valW;
    const barH = 60;
    const rowH = 104;
    const tileH = 120;
    const caption = spec.labels.caption;
    const groupH = (g: ScaleData["groups"][number]) =>
      LAB_H +
      10 +
      g.items.length * rowH +
      (s.tile && tiles(g.items.map((it) => Number(it.value))) ? tileH : 0) +
      48;
    const total = s.groups.reduce((a, g) => a + groupH(g), 0) + (caption ? LAB_H : 0);
    const parts: string[] = [];
    let y = Math.max(0, (H - total) / 2);
    s.groups.forEach((g, gi) => {
      const vals = g.items.map((it) => Number(it.value));
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      parts.push(label(`g${gi}`, `${g.label} (${g.unit})`, 0, y, LABEL, theme.fg));
      g.items.forEach((it, i) => {
        const yy = y + LAB_H + 10 + i * rowH;
        const len = r3((Number(it.value) / max) * barW);
        const tone = tones[i % tones.length] as string;
        parts.push(
          `<div id="SCENEID-i${gi}-${i}" style="position:absolute;left:0;top:${px(yy)};width:${px(W)};height:${px(rowH)}">${label(`n${gi}-${i}`, it.label, 0, (rowH - 52) / 2, LABEL, theme.fg)}<div style="position:absolute;left:${px(barX)};top:${px((rowH - barH) / 2)};width:${px(len)};height:${px(barH)};background:${tone};border-radius:4px"></div>${label(`v${gi}-${i}`, `${it.value} ${g.unit}`, barX + len + 24, (rowH - 52) / 2, LABEL, theme.fg)}</div>`,
        );
      });
      const n = s.tile ? tiles(vals) : 0;
      if (n) {
        // Copies of the smallest length laid along the largest: how many fit is the ratio.
        const unit = (min / max) * barW;
        const yy = y + LAB_H + 10 + g.items.length * rowH + 8;
        for (let k = 0; k < n; k++)
          parts.push(
            `<div id="SCENEID-u${gi}-${k}" style="position:absolute;left:${px(barX + k * unit)};top:${px(yy)};width:${px(unit - 6)};height:${px(barH * 0.7)};border:4px solid ${tones[1] as string};box-sizing:border-box;border-radius:4px"></div>`,
          );
        const ratio = `${g.items[vals.indexOf(max)]?.value} ÷ ${g.items[vals.indexOf(min)]?.value} = ${(max / min).toFixed(2)}`;
        parts.push(label(`r${gi}`, ratio, barX, yy + barH * 0.7 + 10, SMALL, theme.muted));
      }
      y += groupH(g);
    });
    const markup = `<div id="SCENEID-lit">
${parts.join("\n")}
${caption ? label("cap", caption, 0, Math.min(H - LAB_H, y), SMALL, theme.muted) : ""}
</div>`;
    const at = stepStarts(cues, s.groups.length);
    const tl = new Tl();
    s.groups.forEach((g, gi) => {
      // The first group is there as the scene opens: the narration names it at once.
      const t0 = gi === 0 ? 0.1 : (at[gi] as number) + 0.2;
      tl.show(`g${gi}`, t0, 0.5);
      g.items.forEach((_, i) => {
        tl.show(`i${gi}-${i}`, t0 + 0.1 + i * 0.3, 0.6);
      });
      const n = s.tile ? tiles(g.items.map((it) => Number(it.value))) : 0;
      if (n) {
        const t1 = Math.max(t0 + 2.0, (at[gi] as number) + 2.4);
        for (let k = 0; k < n; k++) tl.show(`u${gi}-${k}`, t1 + k * 0.5, 0.4);
        tl.show(`r${gi}`, t1 + n * 0.5);
      }
    });
    if (caption) tl.show("cap", 1.0);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* ------------------------------------------------------------------ recap */

const recapKind: KindImpl = {
  picture: false,
  async layers({ spec, earlier }) {
    const ids = (spec.data as { beats: string[] }).beats;
    const files: Record<string, string> = {};
    const names: string[] = [];
    for (const id of ids) {
      const thumb = earlier.get(id)?.layers.files.thumb;
      if (!thumb)
        throw new Error(`literal: the recap names ${id}, which drew no literal scene before it`);
      files[`p${names.length}`] = thumb;
      names.push(id);
    }
    return { files, data: { beats: names } };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const d = L.data as { beats: string[] };
    const f = L.files as Record<string, string>;
    const n = d.beats.length;
    const cols = n <= 3 ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / cols);
    const gap = 64;
    const capH = 64;
    const tw = even(
      Math.min((W - (cols - 1) * gap) / cols, ((H - rows * capH - (rows - 1) * 32) / rows) * 1.5),
    );
    const th = even(tw / 1.5);
    const gw = cols * tw + (cols - 1) * gap;
    const x0 = (W - gw) / 2;
    const words = (spec.labels.caption ?? "")
      .split("→")
      .map((s) => s.trim())
      .filter(Boolean);
    const at = stepStarts(cues, n);
    const pos = (i: number) =>
      [x0 + (i % cols) * (tw + gap), Math.floor(i / cols) * (th + capH + 32)] as const;
    const tilesMarkup = d.beats
      .map((_, i) => {
        const [x, y] = pos(i);
        const text = `${i + 1}  ${words[i] ?? ""}`;
        return `${panel(`p${i}`, x, y, tw, th, img(`p${i}-i`, href(f[`p${i}`] as string), 0, 0, tw, th), "lit-dark")}
${label(`w${i}`, text, x, y + th + 10, SMALL, theme.fg)}`;
      })
      .join("\n");
    const markup = `<div id="SCENEID-lit">\n${tilesMarkup}\n</div>`;
    const tl = new Tl();
    d.beats.forEach((_, i) => {
      const t0 = Math.max(0.2, (at[i] as number) + 0.1);
      tl.show(`p${i}`, t0, 0.7);
      tl.show(`w${i}`, t0 + 0.3);
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/* --------------------------------------------------------------- registry */

export const MORE_KINDS = {
  "dark-channel": darkChannelKind,
  "channel-threshold": channelThresholdKind,
  "ema-threshold": emaKind,
  backbone: backboneKind,
  "fixed-filters": fixedFiltersKind,
  crops: cropsKind,
  table: tableKind,
  scale: scaleKind,
  recap: recapKind,
} as const satisfies Record<string, KindImpl>;
export type MoreKind = keyof typeof MORE_KINDS;
