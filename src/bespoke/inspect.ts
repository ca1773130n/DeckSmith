/**
 * What the pass learns about an illustration before any scene is written
 * around it, all of it locally and for free: where its subjects are, whether it
 * is drawn flat, and whether it carries writing.
 *
 * SUBJECTS. The illustrator is told to draw three or four subjects on the
 * pack's flat ground, separated by empty ground. So the subjects ARE the
 * connected regions that are not the ground: the ground colour is read off the
 * picture's border, every coarse cell that differs from it is foreground, and
 * the components of that mask, merged where they nearly touch, are the subject
 * boxes. Deterministic, ~20ms, and what labels, callouts and the camera's shots
 * are anchored to (round 4: labels ON their subjects, staged shots on them).
 *
 * STYLE. Round 3's pictures were soft 3D toy renders although the prompt asked
 * for flat vector art. A flat picture is regions of one colour with hard edges:
 * neighbouring pixels are either equal (inside a region) or far apart (an
 * edge). Shading is the third case — neighbours that differ a little,
 * everywhere — so `soft`, the share of the subjects' pixels whose neighbours
 * differ by a little, separates the two (calibration in `FLAT_SOFT_MAX`).
 *
 * TEXT. The picture must carry no writing: nothing downstream can measure it
 * and the scene's own labels would fight it. macOS Vision reads it, through a
 * small Swift helper compiled once into the cache (`readText`); without Swift
 * the check reports `unchecked` rather than pretending.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { decodePng, type Frame } from "../verify/fidelity.js";

/** A subject's box as a share of the picture: x, y, w, h in 0..1. */
export type UnitBox = [number, number, number, number];

/** Cell size the foreground mask is read at, px of the picture. */
const CELL = 8;
/** A pixel is foreground when its RGB differs from the ground by more than this (summed). */
const GROUND_DELTA = 48;
/** A cell is foreground when this share of its pixels is. */
const CELL_SHARE = 0.18;
/** Components smaller than this share of the picture are specks, not subjects. */
const MIN_SUBJECT = 0.006;
/** At most this many subjects are named, largest first. */
export const MAX_SUBJECTS = 5;

/**
 * The ground: the median colour of the picture's outer frame (2% each side).
 * The illustrator is asked for the pack's exact background; what comes back is
 * close to it, and the frame is what the scene's feathered edge blends into.
 */
export function groundOf(f: Frame): [number, number, number] {
  const { width: w, height: h, channels: c, pixels: p } = f;
  const bx = Math.max(2, Math.round(w * 0.02));
  const by = Math.max(2, Math.round(h * 0.02));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * c;
    rs.push(p[i] as number);
    gs.push(p[i + 1] as number);
    bs.push(p[i + 2] as number);
  };
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4) if (x < bx || x >= w - bx || y < by || y >= h - by) take(x, y);
  const med = (a: number[]) => a.sort((u, v) => u - v)[a.length >> 1] as number;
  return [med(rs), med(gs), med(bs)];
}

/** The coarse foreground mask: one entry per CELL x CELL cell. */
function cellMask(f: Frame, ground: readonly number[]) {
  const { width: w, height: h, channels: c, pixels: p } = f;
  const cw = Math.ceil(w / CELL);
  const ch = Math.ceil(h / CELL);
  const mask = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      let n = 0;
      let fg = 0;
      for (let y = cy * CELL; y < Math.min(h, (cy + 1) * CELL); y += 2)
        for (let x = cx * CELL; x < Math.min(w, (cx + 1) * CELL); x += 2) {
          const i = (y * w + x) * c;
          const d =
            Math.abs((p[i] as number) - (ground[0] as number)) +
            Math.abs((p[i + 1] as number) - (ground[1] as number)) +
            Math.abs((p[i + 2] as number) - (ground[2] as number));
          n++;
          if (d > GROUND_DELTA) fg++;
        }
      if (n && fg / n >= CELL_SHARE) mask[cy * cw + cx] = 1;
    }
  return { mask, cw, ch };
}

/** Dilate a cell mask by `r` cells (a square), so parts of one subject a hair apart join. */
function dilate(mask: Uint8Array, cw: number, ch: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      if (!mask[y * cw + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < cw && yy < ch) out[yy * cw + xx] = 1;
        }
    }
  return out;
}

/**
 * The subjects' boxes, left to right, as shares of the picture. Components of
 * the foreground mask after a small dilation (so a subject's own parts join),
 * boxed on the UNdilated cells, specks dropped, the largest `MAX_SUBJECTS` kept.
 */
export function subjectBoxes(f: Frame, ground = groundOf(f)): UnitBox[] {
  const { mask, cw, ch } = cellMask(f, ground);
  const joined = dilate(mask, cw, ch, 2);
  const label = new Int32Array(cw * ch).fill(-1);
  const comps: Array<{ x0: number; y0: number; x1: number; y1: number; n: number }> = [];
  const stack: number[] = [];
  for (let start = 0; start < joined.length; start++) {
    if (!joined[start] || label[start] !== -1) continue;
    const id = comps.length;
    const comp = { x0: cw, y0: ch, x1: -1, y1: -1, n: 0 };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % cw;
      const y = (i - x) / cw;
      if (mask[i]) {
        comp.n++;
        comp.x0 = Math.min(comp.x0, x);
        comp.y0 = Math.min(comp.y0, y);
        comp.x1 = Math.max(comp.x1, x);
        comp.y1 = Math.max(comp.y1, y);
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
          const j = yy * cw + xx;
          if (joined[j] && label[j] === -1) {
            label[j] = id;
            stack.push(j);
          }
        }
    }
    if (comp.n > 0) comps.push(comp);
  }
  const total = cw * ch;
  return comps
    .filter((c) => c.n / total >= MIN_SUBJECT)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_SUBJECTS)
    .sort((a, b) => a.x0 + a.x1 - (b.x0 + b.x1))
    .map((c): UnitBox => {
      const r = (v: number) => Math.round(v * 1000) / 1000;
      return [
        r((c.x0 * CELL) / f.width),
        r((c.y0 * CELL) / f.height),
        r(Math.min(1, ((c.x1 + 1 - c.x0) * CELL) / f.width)),
        r(Math.min(1, ((c.y1 + 1 - c.y0) * CELL) / f.height)),
      ];
    });
}

/** How flat a picture is drawn: the measures `flatEnough` reads. */
export interface Flatness {
  /** Share of the subjects' pixel pairs that differ a little (shading), 0..1. */
  soft: number;
  /** Share of the subjects' pixels in their 16 commonest colours (4 bits a channel), 0..1. */
  palette: number;
  /** `palette - soft`: high for flat fills with hard edges, low for a shaded render. */
  score: number;
  /** Share of the picture that is not ground. */
  coverage: number;
}

/** Neighbour differences (summed RGB) at or under this are one flat region. */
const SAME = 6;
/** Over this they are an edge between regions; between the two is shading. */
const EDGE = 60;

export function flatness(f: Frame, ground = groundOf(f)): Flatness {
  const { width: w, height: h, channels: c, pixels: p } = f;
  let fg = 0;
  let pairs = 0;
  let soft = 0;
  const d = (i: number, j: number) =>
    Math.abs((p[i] as number) - (p[j] as number)) +
    Math.abs((p[i + 1] as number) - (p[j + 1] as number)) +
    Math.abs((p[i + 2] as number) - (p[j + 2] as number));
  let n = 0;
  const hist = new Map<number, number>();
  for (let y = 0; y < h - 1; y += 2)
    for (let x = 0; x < w - 1; x += 2) {
      n++;
      const i = (y * w + x) * c;
      const r = p[i] as number;
      const gg = p[i + 1] as number;
      const b = p[i + 2] as number;
      const g =
        Math.abs(r - (ground[0] as number)) +
        Math.abs(gg - (ground[1] as number)) +
        Math.abs(b - (ground[2] as number));
      if (g <= GROUND_DELTA) continue;
      fg++;
      const k = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4);
      hist.set(k, (hist.get(k) ?? 0) + 1);
      for (const j of [i + c, i + w * c]) {
        const v = d(i, j);
        pairs++;
        if (v > SAME && v <= EDGE) soft++;
      }
    }
  const top = [...hist.values()].sort((a, b) => b - a).slice(0, 16);
  const r3 = (v: number) => Math.round(1000 * v) / 1000;
  const softShare = pairs ? soft / pairs : 0;
  const palette = fg ? top.reduce((a, v) => a + v, 0) / fg : 1;
  return {
    soft: r3(softShare),
    palette: r3(palette),
    score: r3(palette - softShare),
    coverage: n ? r3(fg / n) : 0,
  };
}

/**
 * The flat-art bar on `score`. CALIBRATED 2026-10-09 on 21 round-3 pictures
 * (soft 3D toy renders by eye: 0.04-0.46, one at 0.557 — a shaded robot beside
 * a big flat curtain) and 58 pictures drawn by the round-4 prompt (0.48-0.84).
 * First set at 0.57, it refused two pictures at 0.56 and 0.565 that are flat by
 * eye (many small flat colours), each a 60s redraw on the critical path; the
 * one round-4 picture under 0.52 (0.48) has soft shading on its figures. So
 * 0.52: 20 of 21 round-3 renders refused, no flat picture seen refused. The
 * margin is thin both ways; a near miss costs one redraw, never the picture
 * (`illustrate` keeps the flatter of two attempts).
 */
export const FLAT_MIN = 0.52;

export function flatEnough(m: Flatness): boolean {
  return m.score >= FLAT_MIN;
}

/* ---------------------------------------------------------------- the text */

/** One run of text Vision read, with its box as shares of the picture (top-left origin). */
export interface ReadText {
  s: string;
  c: number;
  b: UnitBox;
  l?: string;
}

/** Whether a run is writing and not a shape Vision guessed at: confident, or long and fairly sure. */
export function isWriting(t: ReadText): boolean {
  const n = [...t.s.replace(/\s/g, "")].length;
  return (t.c >= 0.9 && n >= 2) || (t.c >= 0.5 && n >= 3);
}

/**
 * The Swift helper: Vision's accurate recogniser, once per script the decks
 * are written in (one request with all four reads only Latin reliably —
 * MEASURED 2026-10-09: 학습 단계, 学習の流れ, 训练过程 were found only by their own
 * language's pass). Prints one JSON line per file.
 */
export const OCR_SWIFT = `import Foundation
import Vision
import ImageIO
func run(_ img: CGImage, _ langs: [String]) -> [[String: Any]] {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  req.recognitionLanguages = langs
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  var out: [[String: Any]] = []
  for o in req.results ?? [] {
    guard let c = o.topCandidates(1).first else { continue }
    let b = o.boundingBox
    out.append(["s": c.string, "c": c.confidence, "b": [b.minX, 1 - b.maxY, b.width, b.height], "l": langs[0]])
  }
  return out
}
for path in CommandLine.arguments.dropFirst() {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    print("{\\"error\\":\\"unreadable\\"}"); continue
  }
  var out: [[String: Any]] = []
  for langs in [["en-US"], ["ko-KR"], ["ja-JP"], ["zh-Hans"]] { out += run(img, langs) }
  let data = try! JSONSerialization.data(withJSONObject: ["texts": out])
  print(String(data: data, encoding: .utf8)!)
}
`;

export function exec(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

/** One compile per helper per process: the pass inspects its pictures concurrently. */
const compiling = new Map<string, Promise<string>>();

/**
 * A compiled Swift helper, `<dir>/<name>-<hash of its source>`, compiled on
 * first use (MEASURED ~25s once; then ~0.5s a picture). Rejects with the
 * reason when this machine cannot build it — no macOS, no Swift toolchain.
 */
export function swiftBinary(name: string, source: string, dir: string): Promise<string> {
  if (process.platform !== "darwin")
    return Promise.reject(new Error(`no ${name} helper off macOS (Vision)`));
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const bin = join(dir, `${name}-${hash}`);
  let p = compiling.get(bin);
  if (!p) {
    p = (async () => {
      if (
        await access(bin).then(
          () => true,
          () => false,
        )
      )
        return bin;
      await mkdir(dir, { recursive: true });
      const tmp = `${bin}.${process.pid}.tmp`;
      const src = `${tmp}.swift`;
      await writeFile(src, source);
      await exec("swiftc", ["-O", src, "-o", tmp], 300_000);
      await rename(tmp, bin);
      return bin;
    })();
    compiling.set(bin, p);
    // A failed compile is retried by the next process, not cached as an answer.
    p.catch(() => compiling.delete(bin));
  }
  return p;
}

function ocrBinary(dir: string): Promise<string> {
  return swiftBinary("ocr", OCR_SWIFT, dir);
}

/** The writing in a picture; rejects (with why) when nothing here can read it. */
export async function readText(png: string, toolDir: string): Promise<ReadText[]> {
  const bin = await ocrBinary(toolDir);
  const out = await exec(bin, [png], 120_000);
  const j = JSON.parse(out.trim().split("\n")[0] ?? "{}") as { texts?: ReadText[]; error?: string };
  if (j.error) throw new Error(`the text reader could not open the picture: ${j.error}`);
  return j.texts ?? [];
}

/** Everything the inspection says about one picture. */
export interface Inspection {
  subjects: UnitBox[];
  flat: Flatness;
  /** Writing found, or null when no reader was available (`unread` says why). */
  text: string[] | null;
  unread?: string;
  /** The picture has a transparent ground (a subjects layer for a backdrop). */
  cutout?: boolean;
  /** The flattened copy the reader read, when the picture is a cutout. */
  flatFile?: string;
}

/**
 * Inspect a drawn picture. A subjects layer drawn on a transparent ground
 * (round 5) is inspected as it will be seen against the pack's ground: laid
 * on `ground` first, and the text reader reads that flattened copy, written
 * beside `file` as `<file>.flat.png` (Vision reads a transparent pixel as
 * black, which would hide dark writing).
 */
export async function inspectPicture(
  bytes: Buffer,
  file: string,
  toolDir: string,
  ground?: readonly [number, number, number],
): Promise<Inspection> {
  const raw = await decodePng(bytes);
  const cutout = raw.channels === 4 && transparentShare(raw) > 0.05;
  const frame = cutout ? flattenOn(raw, ground ?? [255, 255, 255]) : raw;
  if (cutout) {
    file = `${file}.flat.png`;
    await writeFile(file, encodePng(frame));
  }
  const groundRgb: [number, number, number] =
    cutout && ground ? [ground[0], ground[1], ground[2]] : groundOf(frame);
  const base = {
    subjects: subjectBoxes(frame, groundRgb),
    flat: flatness(frame, groundRgb),
    ...(cutout ? { cutout: true, flatFile: file } : {}),
  };
  try {
    const read = await readText(file, toolDir);
    return { ...base, text: read.filter(isWriting).map((t) => t.s) };
  } catch (err) {
    return {
      ...base,
      text: null,
      unread: (err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 200),
    };
  }
}

/* ------------------------------------------------------- layers and pixels */

/** "#rrggbb" (or "#rgb") as RGB; mid grey for anything else. */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const h =
    (m[1] as string).length === 3
      ? [...(m[1] as string)].map((c) => c + c).join("")
      : (m[1] as string);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Share of an RGBA picture's pixels that are (nearly) transparent, sampled. */
export function transparentShare(f: Frame): number {
  if (f.channels !== 4) return 0;
  let n = 0;
  let clear = 0;
  for (let i = 3; i < f.pixels.length; i += 4 * 7) {
    n++;
    if ((f.pixels[i] as number) < 16) clear++;
  }
  return n ? clear / n : 0;
}

/** An RGBA picture laid over a flat ground, as RGB. */
export function flattenOn(f: Frame, ground: readonly number[]): Frame {
  if (f.channels !== 4) return f;
  const out = new Uint8Array(f.width * f.height * 3);
  for (let i = 0, j = 0; i < f.pixels.length; i += 4, j += 3) {
    const a = (f.pixels[i + 3] as number) / 255;
    for (let k = 0; k < 3; k++)
      out[j + k] = Math.round((f.pixels[i + k] as number) * a + (ground[k] as number) * (1 - a));
  }
  return { width: f.width, height: f.height, channels: 3, pixels: out };
}

/** A minimal PNG encoder (8-bit RGB or RGBA, filter 0): the repository decodes PNGs, and the text reader needs one written. */
export function encodePng(f: Frame): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(f.width, 0);
  ihdr.writeUInt32BE(f.height, 4);
  ihdr[8] = 8;
  ihdr[9] = f.channels === 4 ? 6 : 2;
  const stride = f.width * f.channels;
  const raw = Buffer.alloc((stride + 1) * f.height);
  for (let y = 0; y < f.height; y++)
    Buffer.from(f.pixels.buffer, f.pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- repetition */

/**
 * The Swift helper for REPETITION across a deck's pictures: Vision's image
 * feature print (`VNGenerateImageFeaturePrintRequest`), a learned embedding of
 * what a picture shows, local and free. Prints one JSON line per file with the
 * print as a float array. Two pictures of the same friendly robot sit close
 * whatever their colours; two different scenes sit far apart (calibration in
 * `SIMILAR_MAX`).
 */
export const PRINT_SWIFT = `import Foundation
import Vision
import ImageIO
for path in CommandLine.arguments.dropFirst() {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    print("{\\"error\\":\\"unreadable\\"}"); continue
  }
  let req = VNGenerateImageFeaturePrintRequest()
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  guard let o = req.results?.first as? VNFeaturePrintObservation else {
    print("{\\"error\\":\\"no print\\"}"); continue
  }
  var v = [Float](repeating: 0, count: o.elementCount)
  o.data.withUnsafeBytes { raw in
    let p = raw.bindMemory(to: Float.self)
    for i in 0..<min(o.elementCount, p.count) { v[i] = p[i] }
  }
  let data = try! JSONSerialization.data(withJSONObject: ["v": v.map { Double($0) }])
  print(String(data: data, encoding: .utf8)!)
}
`;

/** Each picture's feature print; rejects when this machine has no Vision. */
export async function featurePrints(pngs: readonly string[], toolDir: string): Promise<number[][]> {
  if (!pngs.length) return [];
  const bin = await swiftBinary("print", PRINT_SWIFT, toolDir);
  const out = await exec(bin, [...pngs], 120_000);
  return out
    .trim()
    .split("\n")
    .map((l) => {
      const j = JSON.parse(l) as { v?: number[]; error?: string };
      if (!j.v) throw new Error(`no feature print: ${j.error ?? "?"}`);
      return j.v;
    });
}

/** Vision's distance between two prints (Euclidean, as `computeDistance`). */
export function printDistance(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    s += ((a[i] as number) - (b[i] as number)) ** 2;
  return Math.round(Math.sqrt(s) * 1000) / 1000;
}
