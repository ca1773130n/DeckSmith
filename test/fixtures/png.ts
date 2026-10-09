/**
 * A small, real PNG for tests that need an illustration on disk: a flat ground
 * with three discs. Written with node:zlib, so no image library is involved.
 */
import { crc32, deflateSync } from "node:zlib";

/** A disc: centre x, y and radius as shares of the width, and its colour. */
export type Disc = readonly [number, number, number, readonly [number, number, number]];

export const DISCS: readonly Disc[] = [
  [0.25, 0.55, 0.16, [63, 208, 255]],
  [0.55, 0.4, 0.12, [255, 159, 67]],
  [0.8, 0.6, 0.14, [126, 231, 135]],
];

/**
 * `shade`: each disc lit like a soft 3D render — its colour falls off smoothly
 * from a highlight to a dark rim, the look round 3's pictures had.
 */
export function testPng(
  w: number,
  h: number,
  opts: { discs?: readonly Disc[]; shade?: boolean } = {},
): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const discs = opts.discs ?? DISCS;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let c: readonly number[] = [11, 24, 48];
      for (const [cx, cy, r, col] of discs) {
        const d2 = (x / w - cx) ** 2 + ((y / h - cy) * (h / w)) ** 2;
        if (d2 >= r * r) continue;
        if (!opts.shade) c = col;
        else {
          // Lit from the top-left: bright there, falling off to 20% at the far rim.
          const lx = (x / w - (cx - r * 0.4)) / (2 * r);
          const ly = ((y / h - (cy - r * 0.4)) * (h / w)) / (2 * r);
          const k = Math.max(0.2, 1.3 - 1.4 * Math.hypot(lx, ly));
          c = col.map((v) => Math.min(255, Math.round(v * k)));
        }
      }
      raw.set(c, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
