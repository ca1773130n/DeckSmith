/**
 * A small, real PNG for tests that need an illustration on disk: a flat ground
 * with three discs. Written with node:zlib, so no image library is involved.
 */
import { crc32, deflateSync } from "node:zlib";

export function testPng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const discs = [
    [0.25, 0.55, 0.16, [63, 208, 255]],
    [0.55, 0.4, 0.12, [255, 159, 67]],
    [0.8, 0.6, 0.14, [126, 231, 135]],
  ] as const;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let c: readonly number[] = [11, 24, 48];
      for (const [cx, cy, r, col] of discs)
        if ((x / w - cx) ** 2 + ((y / h - cy) * (h / w)) ** 2 < r * r) c = col;
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
