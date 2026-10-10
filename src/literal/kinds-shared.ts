/**
 * Code two or more of OUR kinds share: a kind module imports from here, from
 * `../kind.js` and from `../kit.js`, never from another kind, so removing one
 * kind never breaks another. (The mechanism kinds keep theirs in
 * `kinds/common.ts`.)
 */
import { lcg } from "./kind.js";
import type { Rgb } from "./kit.js";

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
