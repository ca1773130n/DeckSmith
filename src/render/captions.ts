/**
 * Burned-in captions, rasterised by us and composited with `overlay`.
 *
 * WHY NOT libass. `subtitles=` is the one-line way to burn a caption in, and it
 * is a libass filter. Homebrew split its ffmpeg formula: the `ffmpeg` that
 * 165,000 people a month install has ten dependencies and neither libass NOR
 * libfreetype, so it has no `subtitles` filter and no `drawtext` either. libass
 * lives in `ffmpeg-full`, which pulls forty-seven dependencies and is KEG-ONLY —
 * installing it does not even put a libass-capable `ffmpeg` on PATH. So the
 * feature that decides whether a Short is watchable would have been unavailable
 * to the modal customer, and silently: `auto` downgrades a vertical cut to a
 * sidecar `.srt`, and a Reel is watched muted. A caption path that depends on
 * the customer's build of somebody else's binary is not a caption path.
 *
 * `overlay` is in every ffmpeg ever built. So we draw the band ourselves, one
 * transparent PNG per cue, and overlay each on its own time range.
 *
 * The renderer is Chrome, which `render` already requires — the capture is a
 * headless browser and always has been, so this adds no dependency a customer
 * does not already have. It also buys something libass could not: the burned
 * band is laid out by the SAME engine, with the SAME font files, as the band the
 * presented deck draws. Those two used to be two independent implementations of
 * one design that agreed only by inspection.
 *
 * DETERMINISM. No clock, no network, no randomness: the page is a file:// URL,
 * the font comes from the deck's own bundle, and every number below is derived
 * from font metrics measured in the page rather than assumed. What is left is
 * the Latin fallback stack — a deck with no bundled family renders captions in
 * Helvetica/Arial, whose glyphs differ slightly between platforms. Frame timing
 * does not: `enable=` is evaluated against the base video's own timestamps.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Cue } from "../deck/subtitles.js";
import type { BurnStyle } from "./ffmpeg.js";
import { wrap } from "./timing.js";

/** Where `build` puts the subset woff2 and its `@font-face` rules. */
export const DECK_FONT_CSS = "assets/fonts/fonts.css";

/**
 * One PNG per cue, and the single rectangle all of them occupy.
 *
 * ONE rectangle, not one per cue, and that is the point: a one-line cue and a
 * two-line cue are clipped to the same box, so the filtergraph carries a
 * constant `x:y` instead of per-cue geometry. Geometry that appears once cannot
 * disagree with itself, and the transparent rows a short cue leaves behind cost
 * nothing — PNG runs them out to a few bytes.
 */
export interface CaptionBand {
  /** Basenames inside the work directory, in cue order. */
  files: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ The page */

/** CSS strings are the one place a stray quote silently changes the layout. */
function cssString(value: string): string {
  return `"${value.replace(/["\\]/g, "")}"`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/**
 * The caption page: every cue laid out at the same place, all hidden.
 *
 * All of them in one document rather than one document per cue, because a
 * navigation costs about as much as the screenshot does and there are dozens of
 * cues. Hidden by default and revealed one at a time, so what is measured is
 * exactly what is captured.
 *
 * The scrim is `box-decoration-break: clone`, which gives each LINE its own box
 * — the same treatment ASS's `BorderStyle=4` produces, and the only one that
 * reads as a caption rather than as a letterbox: a single box around a block
 * whose second line is two words wide is a wide black bar with a short line
 * floating in it.
 *
 * `line-height` is set from a measurement, not from a ratio. The inline box is
 * as tall as the font's content area plus the padding, and that is a number only
 * the font knows; guessing it either overlaps the two boxes — and two 70%
 * scrims stacked composite to a visible dark seam across the middle of the band
 * — or opens a gap the slide shows through. `--line` is written by `measure()`
 * below once the font has actually loaded.
 *
 * THE BREAK IS OURS TO MAKE, and forgetting that cost a render. `splitCue` caps
 * a cue at two lines' worth of characters, but `plan.cues` carries the text
 * UNWRAPPED — `toSrt` calls `wrap` on its way out to the sidecar, so the hard
 * `\n` exists only in the .srt. Handing the raw text to CSS let it soft-wrap at
 * the container instead, and the first burned frame came out as a 49-character
 * line over the orphan "up against": the same one-word-flash failure `splitCue`
 * was fixed for, reappearing three modules downstream. So `wrap` is called here,
 * the same function on the same text, and the burned band and the .srt break in
 * the same places by construction rather than by coincidence.
 *
 * `white-space: pre-wrap` then honours those breaks, and still soft-wraps if a
 * line somehow overruns rather than letting it run off the frame.
 */
export function captionPage(
  cues: readonly Cue[],
  style: BurnStyle,
  fontHref: string | null,
): string {
  const stack = [cssString(style.font), '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"];
  // 8px, as the ASS `Outline=8` scrim was. Horizontal padding is wider because a
  // box that hugs the glyphs at the sides looks accidental.
  const padY = Math.round(style.fontSize * 0.2);
  const padX = Math.round(style.fontSize * 0.35);
  const link = fontHref ? `<link rel="stylesheet" href="${fontHref}">` : "";

  const bands = cues
    .map((cue, i) => `<div class="cue" id="c${i}"><span>${escapeHtml(wrap(cue.text))}</span></div>`)
    .join("\n");

  return `<!doctype html>
<meta charset="utf-8">
${link}
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #stage {
    position: relative;
    width: ${style.width}px;
    height: ${style.height}px;
    overflow: hidden;
  }
  .cue {
    position: absolute;
    left: ${style.marginX}px;
    right: ${style.marginX}px;
    bottom: ${style.marginV}px;
    visibility: hidden;
    text-align: center;
    font-family: ${stack.join(", ")};
    font-size: ${style.fontSize}px;
    font-weight: 700;
    line-height: var(--line, ${Math.round(style.fontSize * 1.6)}px);
  }
  .cue.on { visibility: visible; }
  .cue span {
    display: inline;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    /* 70% OPAQUE. Measured against both a dark and a light slide: 50% loses the
       text over a light figure, 100% reads as a hole cut in the picture. */
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    padding: ${padY}px ${padX}px;
    white-space: pre-wrap;
  }
</style>
<div id="stage">
${bands}
</div>
`;
}

/**
 * Run in the page: settle the line box, then report every cue's rectangle.
 *
 * Serialised into the browser, so it may not close over anything here.
 */
function measure(count: number): { x: number; y: number; w: number; h: number }[] {
  const doc = document;
  const probe = doc.getElementById("c0");
  if (probe) {
    // One line's inline box, padding included. Setting `line-height` to exactly
    // this stacks the per-line scrims edge to edge: no seam, no gap.
    probe.classList.add("on");
    const span = probe.querySelector("span") as HTMLElement;
    const before = span.textContent ?? "";
    span.textContent = "Hg";
    doc.documentElement.style.setProperty("--line", `${span.getBoundingClientRect().height}px`);
    span.textContent = before;
    probe.classList.remove("on");
  }
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < count; i++) {
    const el = doc.getElementById(`c${i}`);
    if (!el) continue;
    el.classList.add("on");
    const r = (el.querySelector("span") as HTMLElement).getBoundingClientRect();
    el.classList.remove("on");
    // The span is inline: its rect is the union of the line boxes, which is the
    // scrim's true extent. The .cue div is full-width and would over-report.
    rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return rects;
}

/* -------------------------------------------------------------------- Chrome */

/**
 * The browser `render` already uses.
 *
 * `@puppeteer/browsers` and `puppeteer-core` are DIRECT dependencies of this
 * package. They arrive with hyperframes too — a hard dependency of this verb,
 * since there is no `render` without a browser — but relying on that made this
 * module's imports resolve through somebody else's dependency tree, and the day
 * hyperframes swaps its automation library the burned captions stop working for
 * a reason nothing in this repo mentions. They are still imported DYNAMICALLY,
 * which is a different concern: a machine that cannot supply a browser must
 * degrade to the sidecar rather than throw after the capture has already run.
 */
async function chromePath(): Promise<string> {
  const explicit = process.env.DECKSMITH_CHROME || process.env.CHROME_PATH;
  if (explicit) return explicit;

  const { getInstalledBrowsers } = await import("@puppeteer/browsers");
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir }).catch(() => []);
  // headless-shell first: it is the smaller download hyperframes prefers, and
  // for a screenshot of a static page the two render identically.
  const found =
    installed.find((b) => b.browser === "chrome-headless-shell") ??
    installed.find((b) => b.browser === "chrome");
  if (found) return found.executablePath;

  throw new Error(
    "no Chrome to draw the captions with. `render` needs one for the capture too; " +
      "run `npx puppeteer browsers install chrome`, or set DECKSMITH_CHROME to a Chrome binary.",
  );
}

/**
 * Why captions cannot be drawn here, or null if they can.
 *
 * Asked BEFORE the capture, because discovering it afterwards is discovering it
 * an hour late — the same reason the libass probe this replaced was asked early.
 */
export async function captionBlocker(): Promise<string | null> {
  try {
    await import("puppeteer-core");
    await chromePath();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Write one transparent PNG per cue and report the box they share.
 *
 * `omitBackground` is what makes the PNG transparent outside the scrim;
 * `deviceScaleFactor: 1` keeps a pixel a pixel on a retina host, without which
 * every band comes back at twice the size and lands half off the frame.
 */
export async function renderCaptions(
  cues: readonly Cue[],
  style: BurnStyle,
  deck: string,
  work: string,
): Promise<CaptionBand> {
  if (cues.length === 0) throw new Error("renderCaptions was given no cues.");

  const fontCss = join(deck, DECK_FONT_CSS);
  const href = (await import("node:fs/promises").then((fs) => fs.stat(fontCss).catch(() => null)))
    ? pathToFileURL(fontCss).href
    : null;

  const page = join(work, "captions.html");
  await mkdir(work, { recursive: true });
  await writeFile(page, captionPage(cues, style, href));

  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  });
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: style.width, height: style.height, deviceScaleFactor: 1 });
    await tab.goto(pathToFileURL(page).href, { waitUntil: "load" });
    // Without this the first cues are measured and shot in the fallback face,
    // which is the silent CJK-tofu failure this whole path exists to avoid.
    await tab.evaluate(() => document.fonts.ready);

    const rects = await tab.evaluate(measure, cues.length);
    const box = union(rects);

    const files: string[] = [];
    for (const [i, cue] of cues.entries()) {
      void cue;
      const name = `cap${String(i).padStart(4, "0")}.png`;
      await tab.evaluate((id) => document.getElementById(id)?.classList.add("on"), `c${i}`);
      await tab.screenshot({
        path: join(work, name),
        type: "png",
        omitBackground: true,
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
      await tab.evaluate((id) => document.getElementById(id)?.classList.remove("on"), `c${i}`);
      files.push(name);
    }
    return { files, ...box };
  } finally {
    await browser.close();
  }
}

/**
 * The rectangle every band fits in, snapped outwards to whole pixels.
 *
 * Snapped because a fractional clip makes Chrome resample, and a resampled
 * caption is a soft caption. Every band shares a bottom edge — they are all
 * bottom-anchored — so the union only ever grows upwards and sideways.
 */
export function union(rects: readonly { x: number; y: number; w: number; h: number }[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const left = Math.floor(Math.min(...rects.map((r) => r.x)));
  const top = Math.floor(Math.min(...rects.map((r) => r.y)));
  const right = Math.ceil(Math.max(...rects.map((r) => r.x + r.w)));
  const bottom = Math.ceil(Math.max(...rects.map((r) => r.y + r.h)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/* --------------------------------------------------------------- Filtergraph */

/** 3 decimals, so float drift never moves a byte. Invariant 10. */
const t3 = (seconds: number) => seconds.toFixed(3);

/**
 * Chain one `overlay` per cue onto `input`, each gated to its own time range.
 *
 * HALF-OPEN, `gte * lt` rather than `between`: `between` closes both ends, and
 * `splitCue` hands over at an exact shared instant, so every sentence boundary
 * in the deck would put two captions on screen for one frame. This is the same
 * `[start, end)` rule `activeCue` applies in the presented deck.
 *
 * A disabled `overlay` passes its frame through untouched, so the cost of the
 * chain is one pointer copy per cue per frame, not one blend.
 *
 * `format=yuv444` keeps the alpha at full resolution through the blend. At the
 * default `yuv420` the scrim's edges are composited from half-resolution alpha,
 * which frays a 40px glyph's outline by a pixel — free to avoid, since the
 * encode subsamples afterwards either way.
 */
export function overlayGraph(
  cues: readonly Cue[],
  band: CaptionBand,
  input = "0:v",
  output = "vout",
): string {
  return cues
    .map((cue, i) => {
      const from = i === 0 ? `[${input}]` : `[v${i}]`;
      const to = i === cues.length - 1 ? `[${output}]` : `[v${i + 1}]`;
      const enable = `enable='gte(t,${t3(cue.start)})*lt(t,${t3(cue.end)})'`;
      return `${from}[${i + 1}:v]overlay=x=${band.x}:y=${band.y}:format=yuv444:${enable}${to}`;
    })
    .join(";\n");
}

/** `-i` for every band PNG, in the order `overlayGraph` expects them. */
export function overlayInputs(band: CaptionBand): string[] {
  return band.files.flatMap((file) => ["-i", file]);
}
