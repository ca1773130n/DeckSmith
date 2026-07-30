/**
 * Localize a Source's figures: fetch each one into an asset directory and record
 * the intrinsic pixel size read from the file's own bytes.
 *
 * Aspect ratio is what layout keys off downstream — a 4.35-wide strip and a 1.42
 * portrait cannot be framed the same way, and guessing put a caption 200px off
 * canvas in EXPERIMENT-002 — so the size is load-bearing, not metadata.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { type Source, sourceSchema } from "../types.js";

/** Fetch every figure into `dir`, rewrite `src` to the local name, measure it. */
export async function fetchFigures(source: Source, dir: string): Promise<Source> {
  await mkdir(dir, { recursive: true });
  const figures = [];
  for (const figure of source.figures) {
    const name = assetName(figure.id, figure.src);
    const bytes = await cache(join(dir, name), figure.src);
    figures.push({ ...figure, src: name, ...imageSize(bytes) });
  }
  return sourceSchema.parse({ ...source, figures });
}

/**
 * The URL hash is what makes the cache correct: it invalidates the moment a
 * figure's source changes under a stable id. The id is only there so the asset
 * directory stays readable.
 */
function assetName(id: string, src: string): string {
  const ext = extname(new URL(src, "file:///").pathname)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  return `${id}-${createHash("sha256").update(src).digest("hex").slice(0, 8)}${ext || ".img"}`;
}

async function cache(path: string, src: string): Promise<Buffer> {
  const hit = await readFile(path).catch(() => null);
  if (hit) return hit;
  let bytes: Buffer;
  if (/^https?:/i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } else {
    bytes = await readFile(src);
  }
  await writeFile(path, bytes);
  return bytes;
}

/**
 * Intrinsic size from the file header. Just enough PNG/JPEG/GIF to answer the
 * one question layout asks — four field reads do not justify a dependency.
 */
export function imageSize(b: Buffer): { width: number; height: number } {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47)
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && b.toString("latin1", 0, 4) === "GIF8")
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length >= 4 && b.readUInt16BE(0) === 0xffd8) return jpegSize(b);
  throw new Error("unrecognised image header (expected PNG, JPEG or GIF)");
}

function jpegSize(b: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++; // resync: some encoders pad between segments
      continue;
    }
    const marker = b[i + 1];
    if (marker === undefined) break;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Standalone markers carry no length word, so they cannot be skipped by one.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    // SOF0..SOF15 hold the frame header; C4/C8/CC are Huffman and arithmetic tables.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("JPEG has no SOF segment");
}
