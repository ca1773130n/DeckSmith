/**
 * Renders the mechanism kinds from the judge cases in
 * test/fixtures/literal-judge/*.json, through the deck's own path (the kind's
 * `layers` and `frameSvgs`, src/literal/kinds/mechanisms.ts): every frame as a
 * 1920×1080 PNG, a contact strip per case and an index.html (--out), and/or
 * the frames-only judge's three frames per case plus the expected takeaway
 * (--judge, by default into the gitignored .cache/literal-judge/). Nothing it
 * writes is committed: the cases are plans, and every frame regenerates.
 *
 *   npx esbuild scripts/literal-kinds-preview.ts --bundle --platform=node \
 *     --format=esm --outfile=<scratch>/preview.mjs
 *   node <scratch>/preview.mjs [--out <dir>] [--judge [.cache/literal-judge]] \
 *     [--pack signal] [--image <photo>]
 *
 * Run from the repository root. `--image` replaces the synthetic picture in the
 * preview strips only; the judge frames always use the committed cases.
 * Needs ffmpeg (the kinds' rasters) and rsvg-convert and ImageMagick (the PNGs).
 */
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Theme } from "../src/emit/kit.js";
import { THEMES } from "../src/emit/themes/index.js";
import { type JudgeCase, loadJudgeCases, runJudgeCase } from "../test/fixtures/literal-judge.js";

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
const packName = arg("--pack") ?? "signal";
const found: Theme | undefined = THEMES[packName];
if (!found)
  throw new Error(`--pack must be one of ${Object.keys(THEMES).join(", ")}, got ${packName}`);
const theme: Theme = found;
if (!out && !judge)
  throw new Error("usage: [--out <dir>] [--judge [dir]] [--pack signal] [--image <photo>]");
const photo = arg("--image") ? resolve(arg("--image") as string) : undefined;
const cases = loadJudgeCases(resolve("test/fixtures/literal-judge"));

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
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  const r = await runJudgeCase(c, dir, theme, photo ? { photo } : {});
  const ms = performance.now() - t0;
  const rss1 = process.memoryUsage().rss;
  const pngs: string[] = [];
  for (const [i, svg] of r.svgs.entries()) {
    const name = `frame-${String(i).padStart(2, "0")}`;
    await svgToPng(svg, dir, name, 1920);
    pngs.push(`${name}.png`);
  }
  await run("magick", [
    ...pngs.map((p) => join(dir, p)),
    "-resize",
    "480x",
    "+append",
    join(dir, "strip.png"),
  ]);
  const line = `${c.name}: ${r.svgs.length} frames, layers ${ms.toFixed(0)} ms (with file writes), rss +${((rss1 - rss0) / 2 ** 20).toFixed(0)} MiB`;
  console.log(line);
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<section><h2>${c.name}</h2><p class="t">${e(r.takeaway)}</p><p class="m">${e(line)}</p><a href="${c.name}/strip.png"><img class="strip" src="${c.name}/strip.png" alt="${c.name} strip"></a><details><summary>frames</summary>${pngs.map((p) => `<a href="${c.name}/${p}"><img class="f" src="${c.name}/${p}" alt=""></a>`).join("")}</details></section>`;
}

async function judgeFrames(c: JudgeCase, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const r = await runJudgeCase(c, dir, theme);
  if (r.takeaway !== c.takeaway)
    throw new Error(
      `judge ${c.name}: the kind now says "${r.takeaway}", the case says "${c.takeaway}"`,
    );
  const files: string[] = [];
  for (const [j, i] of c.frames.entries()) {
    const svg = r.svgs[i];
    if (!svg) throw new Error(`judge ${c.name}: frame ${i} of ${r.svgs.length}`);
    await svgToPng(svg, dir, `frame-${j + 1}`, 960);
    files.push(`frame-${j + 1}.png`);
  }
  for (const f of Object.values(r.layers.files)) await rm(join(dir, f));
  await rm(join(dir, `${c.name}-picture.png`), { force: true });
  await writeFile(
    join(dir, "takeaway.json"),
    `${JSON.stringify({ kind: c.kind, pack: packName, frames: files, takeaway: r.takeaway }, null, 2)}\n`,
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
<h1>Literal mechanism kinds</h1><p>Style pack: ${packName}. Each strip is every frame of one beat, left to right, regenerated through the deck's own layers and frames from test/fixtures/literal-judge/&lt;case&gt;.json${photo ? " (picture kinds on a photograph)" : ""}.</p>
${sections.join("\n")}`,
  );
}
