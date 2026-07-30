/**
 * Which canvases the twelve archetypes actually survive, on the real demo.
 *
 * `resizeFormat` will hand any legal canvas to the emitter. That says nothing
 * about whether the emitter can DRAW on it: the archetypes lay out against a
 * vocabulary chosen at 1920 and several of them refuse rather than shrink past
 * their font floor. This finds the boundary by emitting, per canvas, and
 * reporting the beat that gave up first.
 *
 *   npm run build && node experiments/011-sizing/sweep.mjs
 */
import { readFile } from "node:fs/promises";
import { emitComposition, FORMATS, resizeFormat, sourceSchema, storyboardSchema } from "../../dist/index.js";

const storyboard = storyboardSchema.parse(JSON.parse(await readFile("demo/storyboard.json", "utf8")));
const source = sourceSchema.parse(JSON.parse(await readFile("demo/source.json", "utf8")));
const runtime = await readFile("dist/deck-runtime.js", "utf8");

/**
 * Smallest emitted type, both spellings — SVG attribute and CSS declaration.
 *
 * CHECK WHAT THIS COUNTS BEFORE TRUSTING IT. Since kit.ts moved the archetypes
 * into reference space, these are REFERENCE units, not canvas pixels — which is
 * why the column reads 40 at every canvas from 100x100 to 3840x2160. `baseCss`
 * applies one scale to the finished scene, so the real pixel size is this times
 * `width / refWidth(format)`. Reading the column as pixels is exactly the
 * "measured the bounding box instead of the ink" mistake in another costume.
 */
function minType(html) {
  let min = Infinity;
  for (const m of html.matchAll(/font-size(?:="|:\s*)(\d+(?:\.\d+)?)(?:px)?/g)) {
    min = Math.min(min, Number(m[1]));
  }
  return min;
}

const canvases = [
  ["deck-16x9 preset", 1920, 1080],
  ["short-9x16 preset", 1080, 1920],
  ["post-1x1 preset", 1080, 1080],
  ["4K", 3840, 2160],
  ["Instagram 4:5", 1080, 1350],
  ["720p", 1280, 720],
  ["1600x900", 1600, 900],
  ["1728x972", 1728, 972],
  ["960x540", 960, 540],
  ["640x360", 640, 360],
  ["100x100", 100, 100],
  ["ultrawide 21:9", 2560, 1080],
  ["4:1 strip", 4000, 1000],
];

const rows = [];
for (const [name, w, h] of canvases) {
  const format = resizeFormat(FORMATS["deck-16x9"], w, h);
  try {
    const html = emitComposition(storyboard, source, format, runtime, { theme: "ink" });
    rows.push({ name, canvas: `${w}x${h}`, result: "ok", minType: minType(html), bytes: html.length });
  } catch (err) {
    rows.push({ name, canvas: `${w}x${h}`, result: String(err.message).slice(0, 72) });
  }
}
console.table(rows);
