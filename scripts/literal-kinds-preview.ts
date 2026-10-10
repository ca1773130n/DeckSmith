/**
 * Renders the mechanism kinds (src/literal/kinds/) from the judge cases in
 * test/fixtures/literal-judge/*.json — every frame as a 1920×1080 PNG, a
 * contact strip per case and an index.html (--out), and/or the frames-only
 * judge's three frames per case plus the expected takeaway (--judge, by
 * default into the gitignored .cache/literal-judge/). Nothing it writes is
 * committed: the cases are parameters, and every frame regenerates from them.
 *
 *   npx esbuild scripts/literal-kinds-preview.ts --bundle --platform=node \
 *     --format=esm --outfile=<scratch>/preview.mjs
 *   node --expose-gc <scratch>/preview.mjs [--out <dir>] [--judge [.cache/literal-judge]] \
 *     [--pack signal] [--image <photo>]
 *
 * Run from the repository root. `--image` replaces the synthetic picture in the
 * preview strips only; the judge frames always use the committed parameters.
 * Needs ffmpeg (writeRaster), rsvg-convert and ImageMagick on PATH.
 */
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Theme } from "../src/emit/kit.js";
import { THEMES } from "../src/emit/themes/index.js";
import type { MechanismResult, Raster, Rgb } from "../src/literal/kinds/common.js";
import { clamp01, resultBytes } from "../src/literal/kinds/common.js";
import { frameSvg, layerPaints } from "../src/literal/kinds/svg.js";
import { mapRgba, readRgb, toRgba, writeRaster } from "../src/literal/kit.js";
import {
  JUDGE_REGION,
  type JudgeCase,
  judgeFramesSvg,
  loadJudgeCases,
  runJudgeCase,
  slotTextOf,
  takeawayOf,
} from "../test/fixtures/literal-judge.js";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
};
const out = arg("--out");
const judge = flag("--judge") ? resolve(arg("--judge") ?? ".cache/literal-judge") : undefined;
/** A style pack (src/emit/themes): a dark one by default, as decks are. */
const themeName = arg("--pack") ?? "signal";
const found: Theme | undefined = THEMES[themeName];
if (!found)
  throw new Error(`--pack must be one of ${Object.keys(THEMES).join(", ")}, got ${themeName}`);
const theme: Theme = found;
if (!out && !judge)
  throw new Error("usage: [--out <dir>] [--judge [dir]] [--pack signal] [--image <photo>]");
const image = arg("--image");
const PAD = 80;
const cases = loadJudgeCases(resolve("test/fixtures/literal-judge"));
const photo: Rgb | undefined = image ? await readRgb(image, 1228, 818) : undefined;

/** A raster as 8-bit RGBA, upscaled by `k` (nearest) when the frame draws it pixelated. */
function rasterRgba(L: Raster, k: number): { w: number; h: number; rgba: Uint8Array } {
  let w: number;
  let h: number;
  let rgba: Uint8Array;
  if ("rgb" in L) {
    ({ w, h } = L.rgb);
    rgba = toRgba(L.rgb);
  } else if ("rgba" in L) {
    ({ w, h } = L.rgba);
    rgba = new Uint8Array(L.rgba.d.length);
    for (let i = 0; i < rgba.length; i++)
      rgba[i] = Math.round(clamp01(L.rgba.d[i] as number) * 255);
  } else {
    ({ w, h } = L.heat);
    // A white alpha mask: svg.ts colours it in the pack's token (as the deck does).
    rgba = mapRgba(L.heat.d, [255, 255, 255]);
  }
  if (k <= 1) return { w, h, rgba };
  const W = w * k;
  const H = h * k;
  const o = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = (Math.floor(y / k) * w + Math.floor(x / k)) * 4;
      o.set(rgba.subarray(s, s + 4), (y * W + x) * 4);
    }
  return { w: W, h: H, rgba: o };
}

/** Every raster the frames use, as PNGs in `dir`. */
async function writeRasters(r: MechanismResult, dir: string): Promise<void> {
  const scaleOf: Record<string, number> = {};
  for (const f of r.frames)
    for (const p of f.prims)
      if (p.p === "image" && p.pixelated) {
        const L = r.rasters[p.layer] as Raster;
        const w = "rgb" in L ? L.rgb.w : "rgba" in L ? L.rgba.w : L.heat.w;
        scaleOf[p.layer] = Math.max(scaleOf[p.layer] ?? 1, Math.min(64, Math.ceil(p.w / w)));
      }
  for (const [key, L] of Object.entries(r.rasters)) {
    const { w, h, rgba } = rasterRgba(L, scaleOf[key] ?? 1);
    await writeRaster(join(dir, `${key}.png`), w, h, rgba);
  }
}

async function svgToPng(svg: string, dir: string, name: string, width: number): Promise<void> {
  await writeFile(join(dir, `${name}.svg`), svg);
  await run("rsvg-convert", [
    "-w",
    String(width),
    "-o",
    join(dir, `${name}.png`),
    join(dir, `${name}.svg`),
  ]);
  await rm(join(dir, `${name}.svg`));
}

async function preview(c: JudgeCase, dir: string): Promise<string> {
  const g = globalThis as { gc?: () => void };
  g.gc?.();
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  const r = runJudgeCase(c, photo);
  const ms = performance.now() - t0;
  const rss1 = process.memoryUsage().rss;
  const same = Buffer.compare(resultBytes(r), resultBytes(runJudgeCase(c, photo))) === 0;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeRasters(r, dir);
  const pngs: string[] = [];
  for (const [i, f] of r.frames.entries()) {
    const name = `frame-${String(i).padStart(2, "0")}`;
    await svgToPng(
      frameSvg(f, JUDGE_REGION, (l) => `${l}.png`, slotTextOf(c), {
        theme,
        pad: PAD,
        ground: true,
        paint: layerPaints(r.rasters),
      }),
      dir,
      name,
      1920,
    );
    pngs.push(`${name}.png`);
  }
  await run("magick", [
    ...pngs.map((p) => join(dir, p)),
    "-resize",
    "480x",
    "+append",
    join(dir, "strip.png"),
  ]);
  const line = `${c.name}: ${r.frames.length} frames, ${ms.toFixed(0)} ms, result ${(resultBytes(r).length / 2 ** 20).toFixed(1)} MiB, rss +${((rss1 - rss0) / 2 ** 20).toFixed(0)} MiB, deterministic ${same}`;
  console.log(line);
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<section><h2>${c.name}</h2><p class="t">${e(takeawayOf(c, r))}</p><p class="m">${e(line)}</p><a href="${c.name}/strip.png"><img class="strip" src="${c.name}/strip.png" alt="${c.name} strip"></a><details><summary>frames</summary>${pngs.map((p) => `<a href="${c.name}/${p}"><img class="f" src="${c.name}/${p}" alt=""></a>`).join("")}</details></section>`;
}

async function judgeFrames(c: JudgeCase, dir: string): Promise<void> {
  const r = runJudgeCase(c);
  const sentence = takeawayOf(c, r);
  if (sentence !== c.takeaway)
    throw new Error(
      `judge ${c.name}: the kind now says "${sentence}", the case says "${c.takeaway}"`,
    );
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeRasters(r, dir);
  const files: string[] = [];
  for (const [j, svg] of judgeFramesSvg(c, r, theme, (l) => `${l}.png`, PAD).entries()) {
    await svgToPng(svg, dir, `frame-${j + 1}`, 960);
    files.push(`frame-${j + 1}.png`);
  }
  for (const key of Object.keys(r.rasters)) await rm(join(dir, `${key}.png`));
  await writeFile(
    join(dir, "takeaway.json"),
    `${JSON.stringify({ kind: c.kind, pack: themeName, frames: files, takeaway: sentence }, null, 2)}\n`,
  );
}

if (judge) {
  for (const c of cases) await judgeFrames(c, join(judge, c.name));
  console.log(`judge frames: ${judge}`);
}
if (out) {
  await mkdir(out, { recursive: true });
  const sections: string[] = [];
  for (const c of cases) sections.push(await preview(c, join(out, c.name)));
  await writeFile(
    join(out, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Literal mechanism kinds</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:24px;background:${theme.bg};color:${theme.fg}}section{margin:0 0 40px}img.strip{max-width:100%;border:1px solid ${theme.rule}}img.f{width:480px;max-width:100%;margin:4px;border:1px solid ${theme.rule}}.t{font-size:18px}.m{color:${theme.muted};font:13px ui-monospace,monospace}a{color:${theme.accent}}</style>
<h1>Literal mechanism kinds</h1><p>Style pack: ${themeName}. Each strip is every frame of one beat, left to right, regenerated from test/fixtures/literal-judge/&lt;case&gt;.json${photo ? " (picture kinds on a photograph)" : ""}.</p>
${sections.join("\n")}`,
  );
}
