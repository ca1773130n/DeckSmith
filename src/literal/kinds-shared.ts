/**
 * Code two or more of OUR kinds share: a kind module imports from here, from
 * `../kind.js` and from `../kit.js`, never from another kind, so removing one
 * kind never breaks another. (The mechanism kinds keep theirs in
 * `kinds/common.ts`.)
 */
import { lcg } from "./kind.js";
import { boxBlur, luma, type Rgb } from "./kit.js";

/** The layout of a picture scene drawn on one picture and its maps (haze, spikes, sobel). */
export interface Box {
  W: number;
  H: number;
  img: { w: number; h: number };
  edge: { w: number; h: number };
  feat: { w: number; h: number };
}

/** TM-LIF's quantizer at one step from rest: clip(⌊u/θ⌋, 0, D) / D. */
export function tmQuantize(u: ArrayLike<number>, theta: number, D: number): Float32Array {
  const o = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++)
    o[i] = Math.max(0, Math.min(D, Math.floor((u[i] as number) / Math.max(1e-12, theta)))) / D;
  return o;
}

/**
 * `n` crop origins of size `c` inside w×h, from a seeded LCG. Refuses a
 * picture smaller than one crop: a crop cannot be cut from it, and a negative
 * origin would read outside the picture.
 */
export function cropOrigins(
  w: number,
  h: number,
  c: number,
  n: number,
  seed: number,
): Array<[number, number]> {
  if (!(c > 0) || w < c || h < c)
    throw new Error(`literal: a ${c}×${c} crop does not fit a ${w}×${h} picture`);
  const rnd = lcg(seed);
  const out: Array<[number, number]> = [];
  while (out.length < n) {
    const x = Math.floor(rnd() * (w - c + 1));
    const y = Math.floor(rnd() * (h - c + 1));
    out.push([x, y]);
  }
  return out;
}

export function cropOf(img: Rgb, x0: number, y0: number, c: number): Rgb {
  const d = new Float32Array(c * c * 3);
  for (let y = 0; y < c; y++)
    for (let x = 0; x < c; x++)
      for (let k = 0; k < 3; k++)
        d[(y * c + x) * 3 + k] = img.d[((y0 + y) * img.w + (x0 + x)) * 3 + k] as number;
  return { w: c, h: c, d };
}

export async function nativeSize(image: string): Promise<{ w: number; h: number }> {
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

/** How many copies of the smallest value tile the largest (0: too close to be worth it). */
export const tiles = (vals: readonly number[]) => {
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return min > 0 && max / min >= 1.5 ? Math.floor(max / min) : 0;
};

/* ------------------------------------------- the classical Dark Channel Prior */

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
