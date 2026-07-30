import { describe, expect, it } from "vitest";
import { imageSize } from "../src/source/assets.js";
import { familyFor } from "../src/source/fonts.js";
import { parseMarkdown } from "../src/source/markdown.js";

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

  it("captions a figure from the italic paragraph that follows it", () => {
    expect(src.figures).toEqual([
      {
        id: "fig1",
        src: "https://cdn.example.com/figures/figure_000_000.jpg",
        caption: "그림 1. 파이프라인 개요.",
        width: 1,
        height: 1,
      },
    ]);
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

describe("imageSize", () => {
  it("reads the PNG IHDR", () => {
    const png = Buffer.alloc(24);
    png.write("\x89PNG\r\n\x1a\n", 0, "latin1");
    png.writeUInt32BE(1600, 16);
    png.writeUInt32BE(900, 20);
    expect(imageSize(png)).toEqual({ width: 1600, height: 900 });
  });

  it("walks JPEG segments to the SOF0", () => {
    // SOI, an APP0 that must be skipped by its length word, then SOF0 960x540.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x1c,
      0x03, 0xc0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 960, height: 540 });
  });

  it("rejects bytes that are not an image", () => {
    expect(() => imageSize(Buffer.from("<!doctype html>"))).toThrow(/unrecognised/);
  });
});

describe("familyFor", () => {
  it("ships CJK and defers Latin to the renderer's allowlist", () => {
    expect(familyFor("ko")).toBe("Noto Sans KR");
    expect(familyFor("zh-Hant-TW")).toBe("Noto Sans TC");
    expect(familyFor("en")).toBeNull();
  });
});
