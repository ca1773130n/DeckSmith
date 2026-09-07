/**
 * Localize a Source's figures: fetch each one into an asset directory and record
 * the intrinsic pixel size read from the file's own bytes.
 *
 * Aspect ratio is what layout keys off downstream — a 4.35-wide strip and a 1.42
 * portrait cannot be framed the same way, and guessing put a caption 200px off
 * canvas in EXPERIMENT-002 — so the size is load-bearing, not metadata.
 *
 * Two things here exist because a figure can now come from a URL a stranger
 * wrote rather than from a file beside the markdown. One bad figure is a
 * warning, not the end of the job. And what a figure IS comes from its bytes:
 * the format decides both the size reader and the name the file is written
 * under, because everything the URL says about it was written by the same
 * stranger.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import { fetchGuarded } from "../net/fetch.js";
import { type Figure, figureSchema, type Source, sourceSchema } from "../types.js";

/**
 * Fetch every figure into `dir`, rewrite `src` to the local name, measure it.
 *
 * A figure that cannot be fetched, cannot be measured, or cannot be represented
 * is DROPPED and named in `warnings` — the same shape `guardFigures` in
 * src/server/pipeline.ts already uses for the figures it refuses to fetch at
 * all. The reason is what the caller is: a whole ingest. A paper with eleven
 * figures and one dead CDN link is still the deck someone asked for, and before
 * this the dead link ended the run with `unrecognised image header` and no
 * indication of which figure had produced it.
 *
 * `warnings` is an out-parameter rather than a second return value so the two
 * callers that do not collect them (`decksmith ingest`, and the pipeline's own
 * call) keep compiling unchanged, and so a caller that does collect them can
 * pass the SAME array it already threads through `guardFigures` and have both
 * sets of drops read as one list. Omit it and the drops go to stderr instead —
 * dropping a figure only stops being an improvement over aborting if somebody
 * is told which figure went.
 */
export async function fetchFigures(
  source: Source,
  dir: string,
  warnings?: string[],
): Promise<Source> {
  const drops = warnings ?? [];
  await mkdir(dir, { recursive: true });
  // One listing rather than a stat per figure, because the cache question is no
  // longer "is this exact filename here" — the extension is not known until the
  // bytes are — but "does some file here have this stem".
  const cached = await readdir(dir).catch(() => [] as string[]);
  const figures: Source["figures"] = [];
  for (const figure of source.figures) {
    // A CLIP IS NOT AN IMAGE. It carries the video's own dimensions, measured
    // off the file by whoever harvested it, and its first bytes are an `ftyp`
    // box that `imageSize` is right to refuse — so it passes through untouched
    // instead of being dropped here as a figure that could not be read.
    if (figure.kind === "clip") {
      figures.push(figure);
      continue;
    }
    try {
      // Validated one figure at a time, on purpose: everything that reaches the
      // whole-source parse below has already passed `figureSchema` here, so that
      // parse can only object to the document AROUND the figures. Without this
      // a single figure with an unrepresentable field would abort the run on the
      // last line of the function, which is exactly the failure this loop's
      // catch exists to prevent.
      figures.push(figureSchema.parse(await localize(figure, dir, cached)));
    } catch (err) {
      drops.push(`figure ${figure.id} was left out: ${reason(err)}`);
    }
  }
  // Nobody handed us a list to fill, so the drops have nowhere to be read; say
  // them here rather than let a figure vanish out of a deck without a word.
  if (!warnings) for (const drop of drops) console.warn(`decksmith: ${drop}`);
  const parsed = sourceSchema.safeParse({ ...source, figures });
  if (!parsed.success) {
    throw new Error(
      `source "${source.id}" no longer parses after localising its figures: ${reason(parsed.error)}. ` +
        "Every figure kept was checked on its own, so the fault is in the document around them, not in an image.",
    );
  }
  return parsed.data;
}

async function localize(figure: Figure, dir: string, cached: string[]): Promise<Figure> {
  const stem = assetStem(figure.id, figure.src);
  const hit = cached.find((name) => name.startsWith(`${stem}.`));
  const bytes = hit ? await readFile(join(dir, hit)) : await load(figure.src);
  // Measure BEFORE writing. A URL can answer with an HTML error page, a login
  // wall or three bytes of a truncated PNG, and there is no reason to leave any
  // of that in the asset directory under a figure's name once we know what it
  // is — a later run would then find it as a cache hit and fail on it again.
  const size = imageSize(bytes);
  if (hit) return { ...figure, src: hit, ...size };
  const src = `${stem}${assetExt(bytes, figure.src)}`;
  await writeFile(join(dir, src), bytes);
  cached.push(src); // two figures sharing an id and a URL share the one file
  return { ...figure, src, ...size };
}

/**
 * The URL hash is what makes the cache correct: it invalidates the moment a
 * figure's source changes under a stable id. The id is only there so the asset
 * directory stays readable — which is also why it is scrubbed down to what a
 * filename may hold. In the server's path the id came out of an uploaded
 * document, and this string is joined onto a directory path.
 */
function assetStem(id: string, src: string): string {
  const readable = id.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+/, "") || "figure";
  return `${readable}-${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
}

/** The one extension per format, so a cache hit never depends on which spelling was used. */
const EXT: Readonly<Record<ImageFormat, string>> = {
  png: ".png",
  jpeg: ".jpg",
  gif: ".gif",
  webp: ".webp",
  avif: ".avif",
  svg: ".svg",
};

/**
 * The extension comes from the BYTES, and only falls back to the URL.
 *
 * The URL is the stranger's half of the exchange: `hero.png?fmt=webp`, a CDN
 * that serves AVIF from a path ending `.jpg`, a redirect to `/render.php`, or a
 * path with no extension at all. Naming the local file after that produces an
 * asset whose extension contradicts its content, and `pack` picks a MIME type
 * out of the extension (`MIME_EXT` in src/pack/media.ts) — so the URL's claim
 * would be carried into the deck as a Content-Type rather than stopped here.
 *
 * The URL is consulted only when the bytes name nothing, which today cannot
 * happen: `imageSize` has already refused whatever `sniffFormat` cannot name. It
 * stays because naming a file and measuring it are two different questions, and
 * the answer to the first should not quietly depend on the second staying this
 * strict.
 */
function assetExt(bytes: Buffer, src: string): string {
  const format = sniffFormat(bytes);
  if (format) return EXT[format];
  const fromUrl = extname(new URL(src, "file:///").pathname)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  return fromUrl || ".img";
}

/**
 * Larger than any figure a 1920x1080 slide can use, and small enough that a
 * mislabelled video stops before it fills the job directory. The timeout is a
 * whole-call budget — DNS, connect, every redirect and the body — so a figure
 * that stalls costs one ingest twenty seconds rather than the whole run.
 */
const FIGURE_MAX_BYTES = 32 * 1024 * 1024;
const FIGURE_TIMEOUT_MS = 20_000;

/**
 * A figure's bytes, off the disk or through the one guarded door.
 *
 * `fetchGuarded` rather than `fetch`, because this line is one of the two holes
 * src/net/fetch.ts was written to close: a bare `fetch(src)` on a URL a document
 * chose, with no timeout, no size cap, and an SSRF pre-check in the server's
 * pipeline that the socket never honoured.
 *
 * No `accept` filter on purpose. Real CDNs serve real PNGs as
 * `application/octet-stream`, and what the bytes ARE is decided three lines
 * later by `imageSize` from the bytes themselves — refusing on the header would
 * drop figures that are fine, and would trust the header over the file.
 */
async function load(src: string): Promise<Buffer> {
  if (!/^https?:/i.test(src)) return readFile(src);
  const got = await fetchGuarded(src, {
    maxBytes: FIGURE_MAX_BYTES,
    timeoutMs: FIGURE_TIMEOUT_MS,
  });
  return got.bytes;
}

/** Zod's own message is a JSON dump; a warning is read by a person. */
function reason(err: unknown): string {
  if (err instanceof z.ZodError)
    return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------- Measurement */

/** Every format this reads. Also every format a page is likely to serve a figure in. */
export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "avif" | "svg";

/** How far into a file the SVG root element is allowed to be, and how much of the tag is read. */
const SVG_WINDOW = 64 * 1024;

/**
 * The format the bytes claim to be, from the header alone.
 *
 * Exported and separate from `imageSize` because two callers ask two different
 * questions of the same eight bytes: what to name the file, and how to measure
 * it. Keeping them one function is how a file ends up named after the reader
 * that happened to succeed.
 */
export function sniffFormat(b: Buffer): ImageFormat | undefined {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a)
    return "png";
  if (b.length >= 6 && b.toString("latin1", 0, 4) === "GIF8") return "gif";
  if (b.length >= 2 && b.readUInt16BE(0) === 0xffd8) return "jpeg";
  if (
    b.length >= 12 &&
    b.toString("latin1", 0, 4) === "RIFF" &&
    b.toString("latin1", 8, 12) === "WEBP"
  )
    return "webp";
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && isAvifBrand(b)) return "avif";
  if (isSvg(b)) return "svg";
  return undefined;
}

/**
 * AVIF among the ISO-BMFF family, by brand rather than by extension.
 *
 * The major brand is usually `avif`, but an encoder that also writes HEIF
 * structures puts `mif1` there and lists `avif` among the compatible brands, so
 * both are checked. Everything else in the family — `heic`, `heix`, `mp4 ` — is
 * deliberately NOT admitted: the box layout is the same and the size would read
 * fine, but no browser in this pipeline can draw one, so a figure that measured
 * correctly would still be a hole in the slide.
 */
function isAvifBrand(b: Buffer): boolean {
  const declared = b.readUInt32BE(0);
  const end = Math.min(declared >= 16 ? declared : b.length, b.length);
  const brand = (at: number) => b.toString("latin1", at, at + 4);
  if (brand(8) === "avif" || brand(8) === "avis") return true;
  // The compatible brands follow minor_version, four ASCII characters each.
  for (let i = 16; i + 4 <= end; i += 4)
    if (brand(i) === "avif" || brand(i) === "avis") return true;
  return false;
}

/**
 * True when the first markup in the buffer is an `<svg>` element.
 *
 * NOT `text.includes("<svg")`: an HTML page with an inline icon contains that
 * too, and an HTML page is the single most common thing a figure URL actually
 * returns. So skip only what may legally precede the root element — a BOM,
 * whitespace, an XML declaration, an SVG doctype, comments — and then insist
 * that the very next tag is the SVG one. A doctype naming anything else, `html`
 * above all, ends it here: that document's root is not an SVG, whatever it may
 * embed further down.
 */
function isSvg(b: Buffer): boolean {
  const text = b.toString("utf8", 0, Math.min(b.length, SVG_WINDOW)).replace(/^\uFEFF/, "");
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    const comment = text.startsWith("<!--", i);
    if (text.startsWith("<?", i) || comment || /^<!doctype\s+svg\b/i.test(text.slice(i, i + 20))) {
      const end = comment ? text.indexOf("-->", i) + 3 : text.indexOf(">", i) + 1;
      if (end <= 0) return false; // the preamble does not finish inside the window
      i = end;
      continue;
    }
    return /^<svg[\s/>]/i.test(text.slice(i, i + 5));
  }
}

/**
 * Intrinsic size from the file header, for every format a page may hand us.
 *
 * PNG, JPEG and GIF were enough while a source was a markdown file with its own
 * images beside it. A URL is not: a page today serves WebP for the photograph,
 * AVIF for the hero and SVG for the diagram, and a reader that knows three
 * formats measures the other three as "unrecognised" and drops them.
 *
 * Still no dependency for this. Each reader below is a handful of field reads
 * against a published header layout, and the alternative is a decoder that
 * pulls in the whole pixel pipeline to answer two integers.
 *
 * It THROWS rather than returning zeros, and the message names what it saw.
 * `figureSchema` requires a positive int, so a zero would not be caught here at
 * all — it would surface much later as `width: too small` against a figure id,
 * with nothing to say which URL had produced it.
 */
export function imageSize(b: Buffer): { width: number; height: number } {
  const format = sniffFormat(b);
  const raw = measure(b, format);
  // SVG user units are real numbers; every raster here reports integers already.
  const width = Math.round(raw.width);
  const height = Math.round(raw.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new Error(`${format ?? "image"} header claims ${raw.width}x${raw.height}, not a size`);
  return { width, height };
}

function measure(b: Buffer, format: ImageFormat | undefined): { width: number; height: number } {
  switch (format) {
    case "png":
      return pngSize(b);
    case "gif":
      return gifSize(b);
    case "jpeg":
      return jpegSize(b);
    case "webp":
      return webpSize(b);
    case "avif":
      return avifSize(b);
    case "svg":
      return svgFigureSize(b);
    default:
      throw new Error(
        `unrecognised image header (expected PNG, JPEG, GIF, WebP, AVIF or SVG; got ${describe(b)})`,
      );
  }
}

/**
 * What the bytes look like, for the warning a person will read.
 *
 * The two named cases are the two that actually happen: a figure URL that
 * answers with an error page or a login wall, and a photo library that hands
 * over HEIC because the phone wrote HEIC.
 */
function describe(b: Buffer): string {
  if (b.length === 0) return "an empty file";
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp")
    return `an ISO-BMFF file branded "${b.toString("latin1", 8, 12)}" — HEIC and its relatives are not drawn by the renderer`;
  const head = b.toString("latin1", 0, Math.min(b.length, 64));
  if (/^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(head))
    return "an HTML page — the URL answered with a page, not a picture";
  if (head.startsWith("%PDF")) return "a PDF";
  const hex = [...b.subarray(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
  return `${b.length} bytes beginning ${hex}`;
}

function pngSize(b: Buffer): { width: number; height: number } {
  if (b.length < 24) throw new Error(`PNG is truncated: ${b.length} bytes, IHDR ends at 24`);
  if (b.toString("latin1", 12, 16) !== "IHDR") throw new Error("PNG does not open with IHDR");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b: Buffer): { width: number; height: number } {
  if (b.length < 10)
    throw new Error(`GIF is truncated: ${b.length} bytes, the screen descriptor ends at 10`);
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
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

/**
 * WebP, whose three chunk types spell the same two numbers three ways.
 *
 * All three are here because all three are served: `VP8 ` is what a
 * quality-slider export writes, `VP8L` what a lossless export writes, and
 * `VP8X` is the extended container every WebP with alpha, animation, ICC or
 * EXIF arrives in — which on a modern page is most of them. A reader that
 * handles only the simple one measures the majority as "unrecognised".
 */
function webpSize(b: Buffer): { width: number; height: number } {
  const chunk = b.length >= 16 ? b.toString("latin1", 12, 16) : "";
  if (chunk === "VP8 ") {
    // 3-byte frame tag, then a fixed sync code, then 14-bit dimensions.
    if (b.length < 30) throw new Error(`WebP VP8 chunk is truncated: ${b.length} bytes, needs 30`);
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a)
      throw new Error("WebP VP8 chunk has no keyframe sync code");
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    // One signature byte, then width-1 and height-1 packed 14 bits each, LSB first.
    if (b.length < 25) throw new Error(`WebP VP8L chunk is truncated: ${b.length} bytes, needs 25`);
    if (b[20] !== 0x2f) throw new Error("WebP VP8L chunk has no 0x2f signature");
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // Canvas size, as two 24-bit little-endian minus-ones after the flag byte.
    if (b.length < 30) throw new Error(`WebP VP8X chunk is truncated: ${b.length} bytes, needs 30`);
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  throw new Error(`WebP opens with chunk "${chunk}", not one of VP8 , VP8L, VP8X`);
}

/**
 * AVIF, by walking the box tree to `meta` → `iprp` → `ipco` → `ispe`.
 *
 * The size is not in the header: it is a property in the item property
 * container, and there is usually more than one — an alpha plane carries its
 * own, a thumbnail carries a smaller one, and a tiled image carries one per
 * tile PLUS one for the derived grid item that stitches them. So take the
 * LARGEST, which is the canvas in every one of those shapes: an alpha plane
 * matches the image, a thumbnail is smaller by definition, and the grid item's
 * property describes the whole picture while each tile's describes a piece.
 * Reading the first one instead returns a thumbnail's aspect for a real file.
 *
 * Then `cleanAperture` below, because the ispe is the CODED size and a real
 * encoder pads it.
 */
function avifSize(b: Buffer): { width: number; height: number } {
  const meta = find(b, 0, b.length, "meta");
  if (!meta) throw new Error("AVIF has no meta box (truncated, or not an image item)");
  // `meta` is a FullBox: four bytes of version and flags before its children.
  const iprp = find(b, meta.start + 4, meta.end, "iprp");
  const ipco = iprp && find(b, iprp.start, iprp.end, "ipco");
  if (!ipco) throw new Error("AVIF has no ipco box (no item properties to read a size from)");
  let best = { width: 0, height: 0 };
  for (const box of boxes(b, ipco.start, ipco.end)) {
    if (box.type !== "ispe" || box.end - box.start < 12) continue;
    // ispe is a FullBox too, then two 32-bit extents.
    const found = { width: b.readUInt32BE(box.start + 4), height: b.readUInt32BE(box.start + 8) };
    if (found.width * found.height > best.width * best.height) best = found;
  }
  if (best.width < 1 || best.height < 1) throw new Error("AVIF has no usable ispe property");
  return cleanAperture(b, ipco, best) ?? best;
}

/**
 * The clean aperture, when the file declares one over the size we just read.
 *
 * MEASURED 2026-09-07, on this machine, with a file `sips` wrote: re-encoding a
 * 259x137 PNG to AVIF produces an `ispe` of 260x138 — the CODED size, padded so
 * the chroma planes divide — and a `clap` box trimming it back to 259x137.
 * Chrome reports `naturalWidth` 259 for that file, so the ispe alone is a size
 * the renderer never draws at, and every fit, crop and leader-line fraction
 * downstream is expressed against the box recorded here.
 *
 * Only a clap that TRIMS the size already chosen is believed — never larger,
 * never smaller than half. `clap`, like `ispe`, is a property associated with
 * one item through `ipma`, and this reader deliberately does not walk `ipma` to
 * learn which; the band is what keeps a thumbnail's crop from becoming the
 * picture's size, and a clean aperture is a trim of a padded edge rather than a
 * crop to a detail.
 */
function cleanAperture(b: Buffer, ipco: Box, ispe: { width: number; height: number }) {
  for (const box of boxes(b, ipco.start, ipco.end)) {
    // Not a FullBox: four unsigned rationals, then the offsets this ignores.
    if (box.type !== "clap" || box.end - box.start < 16) continue;
    const at = (offset: number) => b.readUInt32BE(box.start + offset);
    if (at(4) === 0 || at(12) === 0) continue; // a zero denominator says nothing
    const width = Math.round(at(0) / at(4));
    const height = Math.round(at(8) / at(12));
    if (width > ispe.width || height > ispe.height) continue;
    if (width * 2 < ispe.width || height * 2 < ispe.height) continue;
    return { width, height };
  }
  return undefined;
}

interface Box {
  type: string;
  /** First byte of the payload, past the size and type words. */
  start: number;
  /** One past the last byte of the box. */
  end: number;
}

function find(b: Buffer, from: number, to: number, type: string): Box | undefined {
  for (const box of boxes(b, from, to)) if (box.type === type) return box;
  return undefined;
}

/**
 * ISO-BMFF boxes in one container, stopping at the first one that does not fit.
 *
 * Stopping rather than throwing is deliberate: a truncated download is a
 * half-written box tree, and the caller's "no meta box" reads better against a
 * figure id than "box size 4294967295 at offset 812" would.
 */
function* boxes(b: Buffer, from: number, to: number): Generator<Box> {
  let i = from;
  while (i + 8 <= to) {
    let size = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    let start = i + 8;
    if (size === 1) {
      // A 64-bit size follows the type word, for boxes past 4 GiB.
      if (i + 16 > to) return;
      const large = b.readBigUInt64BE(i + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(large);
      start = i + 16;
    } else if (size === 0) {
      size = to - i; // the last box may declare zero and run to the end
    }
    if (size < start - i || i + size > to) return;
    yield { type, start, end: i + size };
    i += size;
  }
}

/**
 * SVG as a FIGURE, which is stricter than SVG as a file.
 *
 * A figure is drawn into a captured render, and capture advances a clock. An
 * SVG that declares SMIL or a CSS keyframe animation therefore paints something
 * different on every run while every gate stays green — the exact reason
 * src/images/providers.ts has no "ask the model for SVG" rung. A stranger's SVG
 * is the same file with a worse provenance, so it is refused by name here
 * rather than discovered as a render that will not reproduce.
 *
 * `<script>` is refused with them. It is inert today only because figures are
 * drawn through `<img>`, which is a property of the emitters rather than a
 * promise anyone made to this function.
 */
function svgFigureSize(b: Buffer): { width: number; height: number } {
  const moving = /<(?:animate|animateTransform|animateMotion|set|script)\b|@keyframes\b/i.exec(
    b.toString("utf8"),
  );
  if (moving)
    throw new Error(
      `SVG carries "${moving[0]}": animation is drawn against the capture clock, so the render would differ every run. Convert the figure to PNG and point at that.`,
    );
  return svgSize(b);
}

/**
 * The size an SVG declares, in CSS pixels.
 *
 * Two callers: figure ingest above, and `sizeOf` in src/images/illustrate.ts
 * through the re-export in src/images/providers.ts, where this used to live as a
 * regex for `viewBox="0 0 %d %d"` over the first 200 bytes. That was honest for
 * the SVG the tool draws itself and wrong for everything else, because a real
 * SVG opens with a licence comment above the root element, spells the viewBox
 * with floats, writes `width="640px"`, or carries no viewBox at all.
 *
 * `width`/`height` win when BOTH resolve to an absolute length, because that is
 * the intrinsic size a browser would use. The viewBox is the fallback, and it is
 * also the right answer for the very common `width="100%"`: a percentage is a
 * fraction of a viewport this pipeline has not created yet, so it is deliberately
 * left unresolved rather than read as 100 pixels.
 *
 * CHECKED against the browser that draws these: 60 real SVGs off this machine
 * measured here and loaded in Chrome, and all 60 agree with `naturalWidth` and
 * `naturalHeight` to the pixel. Two deliberate divergences remain. A fractional
 * viewBox is rounded, where Chrome's own rounding differs by up to a pixel in
 * either direction (300.5 → 300, 300.4 → 299, 99.9 → 100), which is a ratio
 * unchanged in the third decimal. And an SVG declaring NEITHER a size nor a
 * viewBox is refused rather than given the 300x150 a browser hands a replaced
 * element with no intrinsic size: that default is a CSS fallback, not a fact
 * about the picture, and everything downstream frames the figure against the box
 * recorded here.
 */
export function svgSize(bytes: Buffer): { width: number; height: number } {
  const text = bytes.toString("utf8", 0, Math.min(bytes.length, SVG_WINDOW));
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) throw new Error(`SVG root element is not closed within ${SVG_WINDOW} bytes`);
  const width = cssPixels(attrOf(tag, "width"));
  const height = cssPixels(attrOf(tag, "height"));
  if (width !== undefined && height !== undefined) return { width, height };
  const box = attrOf(tag, "viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const w = box?.[2];
  const h = box?.[3];
  if (box?.length === 4 && w !== undefined && h !== undefined && w > 0 && h > 0)
    return { width: w, height: h };
  throw new Error("SVG declares no absolute width and height, and no usable viewBox");
}

/** Attribute values, from the root tag only. Anchored on whitespace so `stroke-width` is not `width`. */
function attrOf(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m?.[1] ?? m?.[2];
}

/**
 * The absolute CSS units, at the 96dpi reference the spec fixes them to.
 *
 * `em` and `rem` are here because a figure is drawn inside an `<img>`, where the
 * SVG has no cascade above it and the root font-size is the browser's own 16px
 * — MEASURED 2026-09-07: Chrome reports 160x80 for `width="10em" height="5em"`.
 *
 * `%`, `ex` and `ch` are absent. A percentage is a fraction of a viewport this
 * pipeline has not created yet, and `ex`/`ch` are the font's own metrics rather
 * than the font's size (Chrome answered 26 for `3ex`, so 8.67px an ex, for
 * whatever family that build defaults to). All three fall through to the
 * viewBox, which is a ratio and does not depend on any of them.
 */
const UNIT: Readonly<Record<string, number>> = {
  "": 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: 16,
  rem: 16,
};

function cssPixels(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value);
  if (!m?.[1]) return undefined;
  const scale = UNIT[(m[2] ?? "").toLowerCase()];
  if (scale === undefined) return undefined;
  const px = Number(m[1]) * scale;
  return px > 0 ? px : undefined;
}
