#!/usr/bin/env node
/**
 * Does the sweep clip actually CONTAIN the loop it reveals?
 *
 * The clip rect is where the reveal tween ENDS, so anything outside it is not
 * "not yet drawn" — it is never drawn. `short-9x16` sized the clip from the
 * LABEL's extent (72px) over a route 147px long, so both corners and the
 * arrowhead were amputated and the demo's self-loop rendered as a dashed stub
 * floating beside DQ-CTM. `hyperframes check` said PASS, 0 errors: a clip is not
 * a layout finding, and the one warning that does fire (`connector_detached`)
 * fires identically on the CORRECT 16:9 deck, so it carries no signal.
 *
 * Landscape escaped by luck — "one thought tick" happens to be wider than the
 * span it labels. A shorter label would have clipped it the same way.
 *
 * Run:  node experiments/016-watch/clip-contains-route.mjs <built-deck-dir>...
 */
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/** Flow axis is Y when the clip spans the full width, X when it spans the height. */
const parseRect = (html, id) => {
  const m = html.match(new RegExp(`<rect x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)" id="${id}"`));
  return m && { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
};

/** Every coordinate the dashed route touches, split by axis. */
const routeExtent = (d) => {
  const nums = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const xs = nums.map((p) => p[0]);
  const ys = nums.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

let bad = 0;
for (const dir of process.argv.slice(2)) {
  const html = await readFile(join(dir, "index.html"), "utf8");
  const sids = [...new Set([...html.matchAll(/id="(s\d+)-sweep"/g)].map((m) => m[1]))];
  if (sids.length === 0) {
    console.log(`${basename(dir)}: no loop to check`);
    continue;
  }
  for (const sid of sids) {
    const clip = parseRect(html, `${sid}-sweep`);
    // The dashed stroke is the loop route; solid ones are the between-stage arrows.
    const dashed = html.match(new RegExp(`<path d="(M[^"]+)"[^>]*stroke-dasharray[^>]*marker-end`));
    if (!clip || !dashed) continue;
    const r = routeExtent(dashed[1]);
    // Only the flow axis can clip: the other spans the whole canvas by construction.
    const vertical = clip.x === 0;
    const [c0, c1, e0, e1, axis] = vertical
      ? [clip.y, clip.y + clip.h, r.y0, r.y1, "y"]
      : [clip.x, clip.x + clip.w, r.x0, r.x1, "x"];
    const ok = c0 <= e0 && c1 >= e1;
    if (!ok) bad++;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${basename(dir)} ${sid}  ` +
        `clip ${axis} ${c0}..${c1} (${(c1 - c0).toFixed(1)})  ` +
        `route ${axis} ${e0}..${e1} (${(e1 - e0).toFixed(1)})` +
        `${ok ? "" : `  — ${(e1 - e0 - (c1 - c0)).toFixed(1)}px of the loop can never be drawn`}`,
    );
  }
}
process.exitCode = bad ? 1 : 0;
