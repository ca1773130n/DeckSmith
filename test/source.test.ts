import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchFigures, imageSize, sniffFormat } from "../src/source/assets.js";
import { familyFor } from "../src/source/fonts.js";
import { parseMarkdown } from "../src/source/markdown.js";
import { sourceSchema } from "../src/types.js";

/** Shaped after a real hypepaper analysis: Korean prose, a captioned CDN figure,
 *  display and inline TeX, and a GFM benchmark table. */
const MD = `# ThinkSR: 확산 기반 초해상

인라인 수식 $\\alpha$ 를 포함한 초록 문단.

## 방법

![overview](https://cdn.example.com/figures/figure_000_000.jpg)

*그림 1. 파이프라인 개요.*

$$
\\hat{x} = \\mathcal{T}_{\\theta}(z)
$$

## 결과

| Model | PSNR | LPIPS |
| --- | --- | --- |
| Baseline | 26.4 | 0.31 |
| Ours | 28.1 | 0.22 |

*표 1. 벤치마크 결과.*
`;

describe("parseMarkdown", () => {
  const src = parseMarkdown(MD);

  it("titles and sniffs the script", () => {
    expect(src.title).toBe("ThinkSR: 확산 기반 초해상");
    expect(src.lang).toBe("ko");
  });

  /**
   * A SHARE OF THE TEXT, NOT A SINGLE CHARACTER.
   *
   * Measured on the first real page URL ingest was ever pointed at: the English
   * Wikipedia article on Gaussian splatting carries THREE CJK characters in
   * twelve sections — a citation and a couple of interface strings — and the
   * old one-character test answered `zh`, which bundled Noto Sans SC and would
   * have narrated an English article as Chinese. A hand-authored analysis never
   * hit this because it is written in one language; a harvested page is not.
   */
  it("ignores a few stray CJK characters in an otherwise English page", () => {
    const stray = `# Gaussian splatting\n\nA rasterisation technique for radiance fields, described in a paper whose citation lists the venue as 中文, and which is otherwise entirely in English prose about ellipsoids, spherical harmonics and differentiable rendering.\n`;
    expect(parseMarkdown(stray).lang).toBe("en");
  });

  it("still sniffs a document that is genuinely in the script", () => {
    expect(parseMarkdown("# 확산 기반 초해상\n\n한국어 문서입니다.\n").lang).toBe("ko");
    expect(parseMarkdown("# 高斯泼溅\n\n这是一篇中文文档，讲的是辐射场。\n").lang).toBe("zh");
    expect(parseMarkdown("# ガウシアン\n\nこれは日本語の文書です。\n").lang).toBe("ja");
  });

  it("captions a figure from the italic paragraph that follows it", () => {
    expect(src.figures).toEqual([
      {
        id: "fig1",
        // Markdown carries stills only; `kind` is defaulted, and that default is
        // what every source written before clips existed parses back into.
        kind: "image",
        src: "https://cdn.example.com/figures/figure_000_000.jpg",
        caption: "그림 1. 파이프라인 개요.",
        width: 1,
        height: 1,
        // The image opens 방법, so it belongs to it — and there is no paragraph
        // under that heading to refer to it. The abstract above is under a
        // different heading and is about something else, so it is not borrowed.
        sectionId: "sec2",
      },
    ]);
    expect(src.figures[0]?.mention).toBeUndefined();
  });

  it("keeps TeX verbatim and marks display math", () => {
    expect(src.equations).toEqual([
      { id: "eq1", tex: "\\alpha", display: false },
      { id: "eq2", tex: "\\hat{x} = \\mathcal{T}_{\\theta}(z)", display: true },
    ]);
  });

  it("round-trips a GFM table", () => {
    expect(src.tables).toEqual([
      {
        id: "tbl1",
        caption: "표 1. 벤치마크 결과.",
        columns: ["Model", "PSNR", "LPIPS"],
        rows: [
          ["Baseline", "26.4", "0.31"],
          ["Ours", "28.1", "0.22"],
        ],
      },
    ]);
  });

  it("lifts figures, captions and display math out of the prose", () => {
    expect(src.sections.map((s) => s.heading)).toEqual([
      "ThinkSR: 확산 기반 초해상",
      "방법",
      "결과",
    ]);
    expect(src.sections[0]?.text).toBe("인라인 수식 $\\alpha$ 를 포함한 초록 문단.");
    expect(src.sections[1]?.text).toBe("");
  });

  it("assigns the same ids on a second run", () => {
    expect(parseMarkdown(MD)).toEqual(src);
  });
});

/**
 * Where a figure sits and what the document says about it.
 *
 * The planner never sees the image, so these two fields are the whole of what it
 * knows about what a picture is FOR. The failure they close was measured: shown
 * only "1373x381 — Figure 2", a real run redrew the paper's architecture as a
 * synthetic pipeline and left the architecture figure unused.
 *
 * One document rather than a string per case, because every answer here depends
 * on what SURROUNDS the figure — the heading above it, the paragraphs either
 * side of it, and the numbers in every other caption, any of which can capture a
 * mention that belongs to its neighbour. Five positions in one file is the only
 * shape of this test that can go wrong the way a real ingest does.
 */
describe("parseMarkdown and the prose around a figure", () => {
  const src = parseMarkdown(
    readFileSync(fileURLToPath(new URL("./fixtures/figure-mentions.md", import.meta.url)), "utf8"),
  );

  /** A figure's two placement fields, with the heading its section id resolves to
   *  — the id alone would pass while pointing at the wrong part of the argument. */
  const placed = (id: string) => {
    const figure = src.figures.find((f) => f.id === id);
    return {
      sectionId: figure?.sectionId,
      heading: src.sections.find((s) => s.id === figure?.sectionId)?.heading,
      mention: figure?.mention,
    };
  };

  it("lifts every image in document order", () => {
    expect(src.figures.map((f) => f.id)).toEqual(["fig1", "fig2", "fig3", "fig4", "fig5", "fig6"]);
  });

  /**
   * MEASURED ON A REAL PAGE. Ingesting the Wikipedia article on neural radiance
   * fields gave its only figure `mention: "]"` — a leftover bracket from the
   * citation markup, standing alone as a paragraph, which the positional
   * fallback then handed to the planner as the sentence the document refers to
   * the figure with. The prompt prints it as `the document says: ]`.
   *
   * The NAMED branch cannot do this: it only accepts a paragraph containing
   * "Figure 2", which is already evidence the paragraph is about the figure.
   * Only the unnamed fallback guesses from position, and a guess needs a floor.
   */
  it("does not offer punctuation as the sentence a figure is referred to by", () => {
    expect(placed("fig6").mention).toBeUndefined();
  });

  it("puts a figure that opens the document into the preamble section", () => {
    // Nothing is open when the image is lifted, so its section cannot be named
    // then — the flush at the first heading creates the headingless preamble and
    // the second pass names it. A document that opens with its hero figure used
    // to lose that figure's placement entirely.
    expect(src.sections[0]).toMatchObject({ id: "sec1", heading: "" });
    expect(placed("fig1")).toEqual({
      sectionId: "sec1",
      heading: "",
      mention: "Figure 1 is the map for everything the rest of this document says.",
    });
  });

  it("reads a reference that only appears after the image", () => {
    expect(placed("fig2")).toEqual({
      sectionId: "sec3",
      heading: "Method",
      mention: "Figure 2 shows the compact state above and the dense carrier below.",
    });
  });

  it("prefers the naming paragraph in front, and reads longhand off an abbreviated caption", () => {
    // Caption "Fig. 3", prose "Figure 3": the name is expanded to match either
    // spelling, because a paper abbreviates in one place and not the other.
    expect(placed("fig3")).toEqual({
      sectionId: "sec4",
      heading: "Results",
      mention: "Figure 3 is the sweep, and it is why training stopped at four ticks.",
    });
  });

  it("falls back to the paragraph in front of an unnamed figure", () => {
    // No number in "Absolute-error maps on three crops.", so there is nothing to
    // match on and position is all that is left. It shares a section with fig3
    // and must take the nearer paragraph, not that figure's.
    expect(placed("fig4")).toEqual({
      sectionId: "sec4",
      heading: "Results",
      mention: "The error concentrates on edges, which the maps below make obvious.",
    });
  });

  it("says nothing about a figure the document never refers to", () => {
    // It opens its section, so the positional fallback has nothing to offer
    // WITHIN that section — and the paragraphs above the heading are about
    // something else, which is why the fallback is bounded by the section at
    // all. Absent is the honest answer; borrowing a neighbour's sentence would
    // tell the planner a picture is for something it is not.
    expect(placed("fig5")).toEqual({
      sectionId: "sec5",
      heading: "Appendix",
      mention: undefined,
    });
  });
});

/* ------------------------------------------------ Fixtures for the sniffers */

/** Signature, IHDR type and the two extents — everything `imageSize` reads of a PNG. */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b.write("\x89PNG\r\n\x1a\n", 0, "latin1");
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** A GIF87a screen descriptor: the two extents are little-endian, unlike PNG's. */
function gif(width: number, height: number): Buffer {
  const b = Buffer.alloc(10);
  b.write("GIF87a", 0, "latin1");
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

/** RIFF container: `RIFF`, size, `WEBP`, the chunk's fourcc, the chunk's size, the chunk. */
function webp(chunk: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(12 + payload.length, 4);
  head.write("WEBP", 8, "latin1");
  head.write(chunk, 12, "latin1");
  head.writeUInt32LE(payload.length, 16);
  return Buffer.concat([head, payload]);
}

/** Lossy: a 3-byte frame tag, the keyframe sync code, then 14-bit extents. */
function webpLossy(width: number, height: number): Buffer {
  const p = Buffer.alloc(10);
  p[3] = 0x9d;
  p[4] = 0x01;
  p[5] = 0x2a;
  p.writeUInt16LE(width, 6);
  p.writeUInt16LE(height, 8);
  return webp("VP8 ", p);
}

/** Lossless: a signature byte, then width-1 and height-1 packed 14 bits each. */
function webpLossless(width: number, height: number): Buffer {
  const p = Buffer.alloc(5);
  p[0] = 0x2f;
  p.writeUInt32LE((((height - 1) << 14) | (width - 1)) >>> 0, 1);
  return webp("VP8L", p);
}

/** Extended: flags, three reserved bytes, then the canvas as two 24-bit minus-ones. */
function webpExtended(width: number, height: number): Buffer {
  const p = Buffer.alloc(10);
  p.writeUIntLE(width - 1, 4, 3);
  p.writeUIntLE(height - 1, 7, 3);
  return webp("VP8X", p);
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

/** An `ispe` item property: a FullBox, then the two extents. */
function ispe(width: number, height: number): Buffer {
  const p = Buffer.alloc(12);
  p.writeUInt32BE(width, 4);
  p.writeUInt32BE(height, 8);
  return box("ispe", p);
}

/** A `clap` clean aperture: width and height as unsigned rationals, then offsets. */
function clap(width: number, height: number): Buffer {
  const p = Buffer.alloc(32);
  p.writeUInt32BE(width, 0);
  p.writeUInt32BE(1, 4);
  p.writeUInt32BE(height, 8);
  p.writeUInt32BE(1, 12);
  return box("clap", p);
}

/**
 * An ISO-BMFF file carrying the given item properties, nested where a real AVIF
 * puts them. `brands` is major brand, minor version, then the compatible list.
 */
function isobmff(brands: string, ...properties: Buffer[]): Buffer {
  return Buffer.concat([
    box("ftyp", Buffer.from(brands, "latin1")),
    box(
      "meta",
      Buffer.alloc(4), // meta is a FullBox
      box("iprp", box("ipco", ...properties)),
    ),
  ]);
}

const avif = (...sizes: [number, number][]) =>
  isobmff("avif\0\0\0\0avifmif1", ...sizes.map(([w, h]) => ispe(w, h)));

describe("imageSize", () => {
  it("reads the PNG IHDR", () => {
    expect(imageSize(png(1600, 900))).toEqual({ width: 1600, height: 900 });
  });

  it("walks JPEG segments to the SOF0", () => {
    // SOI, an APP0 that must be skipped by its length word, then SOF0 960x540.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x1c,
      0x03, 0xc0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 960, height: 540 });
  });

  it("reads the GIF screen descriptor", () => {
    expect(imageSize(gif(640, 480))).toEqual({ width: 640, height: 480 });
  });

  /** All three, because a WebP with alpha or EXIF is a VP8X and that is most of them. */
  it("reads every WebP chunk type, which spell the size three different ways", () => {
    expect(imageSize(webpLossy(1200, 675))).toEqual({ width: 1200, height: 675 });
    expect(imageSize(webpLossless(1200, 675))).toEqual({ width: 1200, height: 675 });
    expect(imageSize(webpExtended(1200, 675))).toEqual({ width: 1200, height: 675 });
    // The 14-bit fields hold 16383 at most, and a lossless file is off by one if
    // the minus-one is forgotten — 1 is where that shows.
    expect(imageSize(webpLossless(1, 1))).toEqual({ width: 1, height: 1 });
    expect(imageSize(webpExtended(16384, 16384))).toEqual({ width: 16384, height: 16384 });
  });

  it("walks an AVIF to its ispe, and takes the canvas rather than a thumbnail", () => {
    expect(imageSize(avif([2048, 1152]))).toEqual({ width: 2048, height: 1152 });
    // A real file carries several: a thumbnail, an alpha plane, one per tile of a
    // grid, and the grid item's own. The largest is the picture in all of those.
    expect(imageSize(avif([320, 180], [2048, 1152], [512, 288]))).toEqual({
      width: 2048,
      height: 1152,
    });
    // Some encoders brand the file `mif1` and only mention `avif` in the list.
    expect(imageSize(isobmff("mif1\0\0\0\0mif1avif", ispe(800, 600)))).toEqual({
      width: 800,
      height: 600,
    });
  });

  /**
   * Measured 2026-09-07: `sips` re-encoding a 259x137 PNG writes an ispe of
   * 260x138 — the coded size, padded — and a clap trimming it back, and Chrome
   * reports naturalWidth 259 for that file. The ispe alone is a size the
   * renderer never draws at.
   */
  it("trims an AVIF's coded size by its clean aperture", () => {
    expect(imageSize(isobmff("avif\0\0\0\0avif", ispe(260, 138), clap(259, 137)))).toEqual({
      width: 259,
      height: 137,
    });
    // A clap that is a crop rather than a trim belongs to some other item — a
    // thumbnail's, most likely — and must not become the picture's size.
    expect(imageSize(isobmff("avif\0\0\0\0avif", ispe(2048, 1152), clap(64, 36)))).toEqual({
      width: 2048,
      height: 1152,
    });
  });

  it("will not measure a HEIC, which nothing in this pipeline can draw", () => {
    expect(() => imageSize(isobmff("heic\0\0\0\0heicmif1", ispe(800, 600)))).toThrow(
      /unrecognised.*heic/s,
    );
  });

  it("measures an SVG the way a browser would, not the way this tool writes one", () => {
    // Absolute width/height win, units and floats included.
    expect(imageSize(Buffer.from(`<svg width="640px" height="360.4px"></svg>`))).toEqual({
      width: 640,
      height: 360,
    });
    expect(imageSize(Buffer.from(`<svg width="1in" height="72pt"></svg>`))).toEqual({
      width: 96,
      height: 96,
    });
    // `em` resolves because an <img> gives the SVG no cascade above it, so the
    // root font-size is the browser's 16px — Chrome answers 160x80 for this one.
    expect(imageSize(Buffer.from(`<svg width="10em" height="5em" viewBox="0 0 9 9"/>`))).toEqual({
      width: 160,
      height: 80,
    });
    // A percentage is not an intrinsic size, so the viewBox answers instead —
    // and it is allowed floats and commas. The fraction is rounded here and
    // rounded differently by Chrome (which says 300x150 for this one); a third
    // of a pixel does not move a ratio, and every consumer wants an int.
    expect(
      imageSize(Buffer.from(`<svg width="100%" height="100%" viewBox="0,0,300.5,150.25"></svg>`)),
    ).toEqual({ width: 301, height: 150 });
    // A preamble is normal in a hand-authored or exported file.
    const real = `<?xml version="1.0"?>\n<!-- Generator: Illustrator -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" stroke-width="4" viewBox="0 0 1024 768"></svg>`;
    expect(imageSize(Buffer.from(real))).toEqual({ width: 1024, height: 768 });
  });

  /**
   * The reason this file is fussy about SVG: capture advances a clock, so a
   * figure that animates renders differently every run and every gate stays
   * green. See invariant 11 and the note in src/images/providers.ts.
   */
  it("refuses an SVG that would move under capture", () => {
    const smil = `<svg viewBox="0 0 10 10"><circle r="5"><animate attributeName="r" to="1"/></circle></svg>`;
    expect(() => imageSize(Buffer.from(smil))).toThrow(/animate/);
    const css = `<svg viewBox="0 0 10 10"><style>@keyframes spin { to { rotate: 360deg } }</style></svg>`;
    expect(() => imageSize(Buffer.from(css))).toThrow(/@keyframes/);
    const script = `<svg viewBox="0 0 10 10"><script>fetch("/x")</script></svg>`;
    expect(() => imageSize(Buffer.from(script))).toThrow(/script/);
  });

  it("names the format in the failure when a file of that format is truncated", () => {
    expect(() => imageSize(png(16, 16).subarray(0, 20))).toThrow(/PNG is truncated/);
    expect(() => imageSize(Buffer.concat([png(16, 16).subarray(0, 12), Buffer.alloc(12)]))).toThrow(
      /PNG does not open with IHDR/,
    );
    expect(() => imageSize(gif(16, 16).subarray(0, 8))).toThrow(/GIF is truncated/);
    expect(() => imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04]))).toThrow(
      /JPEG has no SOF/,
    );
    expect(() => imageSize(webpLossy(16, 16).subarray(0, 24))).toThrow(/WebP VP8 chunk is trunc/);
    expect(() => imageSize(webpLossless(16, 16).subarray(0, 22))).toThrow(
      /WebP VP8L chunk is trunc/,
    );
    expect(() => imageSize(webpExtended(16, 16).subarray(0, 26))).toThrow(
      /WebP VP8X chunk is trunc/,
    );
    expect(() => imageSize(webp("VP8?", Buffer.alloc(10)))).toThrow(
      /WebP opens with chunk "VP8\?"/,
    );
    expect(() => imageSize(avif([16, 16]).subarray(0, 30))).toThrow(/AVIF has no meta box/);
    expect(() => imageSize(Buffer.concat([box("ftyp", Buffer.from("avif")), box("meta")]))).toThrow(
      /AVIF has no ipco box/,
    );
    expect(() => imageSize(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" wid`))).toThrow(
      /SVG root element is not closed/,
    );
    expect(() => imageSize(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`))).toThrow(
      /no absolute width and height, and no usable viewBox/,
    );
  });

  /** Zero would pass this function and fail far away, against `figureSchema`'s positive int. */
  it("refuses a header that claims no size at all", () => {
    expect(() => imageSize(png(0, 900))).toThrow(/not a size/);
    expect(() => imageSize(avif([0, 0]))).toThrow(/no usable ispe/);
  });

  it("rejects bytes that are not an image, and says what they were instead", () => {
    expect(() => imageSize(Buffer.from("<!doctype html>"))).toThrow(/unrecognised/);
    expect(() => imageSize(Buffer.from("<!doctype html>"))).toThrow(/HTML page/);
    // An HTML page with an inline icon in it is still an HTML page.
    expect(() =>
      imageSize(Buffer.from(`<html><body><svg viewBox="0 0 8 8"/></body></html>`)),
    ).toThrow(/HTML page/);
    expect(() => imageSize(Buffer.from("%PDF-1.7\n"))).toThrow(/a PDF/);
    expect(() => imageSize(Buffer.alloc(0))).toThrow(/an empty file/);
  });
});

describe("sniffFormat", () => {
  it("names each format from its header alone", () => {
    expect(sniffFormat(png(2, 2))).toBe("png");
    expect(sniffFormat(gif(2, 2))).toBe("gif");
    expect(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffFormat(webpExtended(2, 2))).toBe("webp");
    expect(sniffFormat(avif([2, 2]))).toBe("avif");
    expect(sniffFormat(Buffer.from(`<?xml version="1.0"?><svg/>`))).toBe("svg");
    expect(sniffFormat(Buffer.from("<!doctype html><svg/>"))).toBeUndefined();
    expect(sniffFormat(Buffer.alloc(0))).toBeUndefined();
  });
});

describe("fetchFigures", () => {
  const source = (figures: { id: string; src: string }[]) =>
    sourceSchema.parse({
      id: "src1",
      title: "Doc",
      sections: [],
      figures: figures.map((f) => ({ ...f, caption: "c", width: 1, height: 1 })),
      equations: [],
      tables: [],
    });

  const work = () => mkdtemp(join(tmpdir(), "decksmith-assets-"));

  /**
   * The failure this replaced: one dead link ended a whole ingest, and the
   * message said `unrecognised image header` without naming the figure.
   */
  it("drops the figure it cannot read, keeps the rest, and names each drop", async () => {
    const dir = await work();
    await writeFile(join(dir, "real.png"), png(1600, 900));
    await writeFile(join(dir, "login.png"), Buffer.from("<!doctype html><title>Sign in</title>"));
    const assets = join(dir, "assets");
    const warnings: string[] = [];
    const out = await fetchFigures(
      source([
        { id: "ok", src: join(dir, "real.png") },
        { id: "wall", src: join(dir, "login.png") },
        { id: "gone", src: join(dir, "missing.png") },
      ]),
      assets,
      warnings,
    );

    expect(out.figures.map((f) => f.id)).toEqual(["ok"]);
    expect(out.figures[0]).toMatchObject({ width: 1600, height: 900 });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^figure wall was left out: unrecognised image header/);
    expect(warnings[0]).toMatch(/HTML page/);
    expect(warnings[1]).toMatch(/^figure gone was left out: ENOENT/);
    // Nothing a figure could not be read from is left in the asset directory,
    // or the next run would find it as a cache hit and fail on it again.
    expect(await readdir(assets)).toEqual([out.figures[0]?.src]);
  });

  /**
   * `decksmith ingest` passes no list, and a figure that leaves a deck without
   * anyone being told is the silent failure this whole change would otherwise
   * have introduced — dropping is only better than aborting if it is audible.
   */
  it("says the drop out loud when nobody is collecting warnings", async () => {
    const dir = await work();
    await writeFile(join(dir, "page.png"), Buffer.from("<!doctype html><title>404</title>"));
    const said: string[] = [];
    const warn = console.warn;
    console.warn = (m: unknown) => said.push(String(m));
    try {
      await fetchFigures(source([{ id: "wall", src: join(dir, "page.png") }]), join(dir, "assets"));
    } finally {
      console.warn = warn;
    }
    expect(said).toEqual([expect.stringMatching(/^decksmith: figure wall was left out/)]);
  });

  /** A clip's first bytes are an `ftyp` box, which `imageSize` is right to refuse. */
  it("passes a clip through instead of measuring it as an image", async () => {
    const dir = await work();
    const clip = sourceSchema.parse({
      id: "src1",
      title: "Doc",
      sections: [],
      figures: [
        {
          id: "v1",
          kind: "clip",
          src: "v1.mp4",
          caption: "c",
          width: 1920,
          height: 1080,
          poster: "v1.png",
          seconds: 4,
        },
      ],
      equations: [],
      tables: [],
    });
    const warnings: string[] = [];
    expect((await fetchFigures(clip, join(dir, "assets"), warnings)).figures).toEqual(clip.figures);
    expect(warnings).toEqual([]);
  });

  it("still throws when the document around the figures is the thing at fault", async () => {
    const dir = await work();
    const broken = { ...source([]), title: 7 as unknown as string };
    await expect(fetchFigures(broken, join(dir, "assets"))).rejects.toThrow(
      /no longer parses after localising its figures.*title/s,
    );
  });

  /**
   * Task C: the URL is the stranger's half of the exchange. `photo.jpg` serving
   * a PNG is what a CDN does on a Tuesday; naming the asset `.jpg` would carry
   * that lie into `pack`, which picks a Content-Type out of the extension.
   */
  it("names the asset after the bytes, not after the URL", async () => {
    const dir = await work();
    await writeFile(join(dir, "photo.jpg"), png(800, 600));
    await writeFile(join(dir, "diagram.png"), Buffer.from(`<svg viewBox="0 0 40 20"/>`));
    await writeFile(join(dir, "no-extension-at-all"), webpExtended(300, 200));
    const assets = join(dir, "assets");
    const out = await fetchFigures(
      source([
        { id: "a", src: join(dir, "photo.jpg") },
        { id: "b", src: join(dir, "diagram.png") },
        { id: "c", src: join(dir, "no-extension-at-all") },
      ]),
      assets,
    );

    expect(out.figures.map((f) => f.src.replace(/-[0-9a-f]{8}\./, "."))).toEqual([
      "a.png",
      "b.svg",
      "c.webp",
    ]);
    expect(out.figures.map((f) => `${f.width}x${f.height}`)).toEqual([
      "800x600",
      "40x20",
      "300x200",
    ]);
    expect((await readdir(assets)).sort()).toEqual(out.figures.map((f) => f.src).sort());
  });

  /** The cache is keyed on the stem now, because the extension is not known until the bytes are. */
  it("reuses the file it already wrote, even though the extension is no longer in the name", async () => {
    const dir = await work();
    const upstream = join(dir, "photo.jpg");
    await writeFile(upstream, png(800, 600));
    const assets = join(dir, "assets");
    const first = await fetchFigures(source([{ id: "a", src: upstream }]), assets);
    await rm(upstream);

    const second = await fetchFigures(source([{ id: "a", src: upstream }]), assets);
    expect(second.figures).toEqual(first.figures);
    expect(await readdir(assets)).toHaveLength(1);
  });
});

describe("familyFor", () => {
  it("ships CJK and defers Latin to the renderer's allowlist", () => {
    expect(familyFor("ko")).toBe("Noto Sans KR");
    expect(familyFor("zh-Hant-TW")).toBe("Noto Sans TC");
    expect(familyFor("en")).toBeNull();
  });
});
