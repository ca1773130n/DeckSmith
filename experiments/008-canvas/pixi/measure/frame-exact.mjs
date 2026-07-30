/**
 * The seek marker is a bar whose width is exactly (t/6)*1920 px, drawn INSIDE
 * the WebGL canvas. Measuring it in the captured PNGs says whether the frame
 * HyperFrames wrote at index n really carries t = n/fps, or whether the GL
 * canvas lagged the DOM by a frame.
 */
import { readdirSync } from "node:fs";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";

const dir = process.argv[2] ?? new URL("../out/seek-A", import.meta.url).pathname;
const fps = Number(process.argv[3] ?? 10);
const DUR = 6;
const W = 1920;

const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
let worst = 0;
const rows = [];
for (const [i, f] of files.entries()) {
  // one scanline through the marker bar (canvas y = 1080-12)
  const { data } = await sharp(`${dir}/${f}`)
    .extract({ left: 0, top: 1068, width: W, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = data.length / W;
  let last = -1;
  for (let x = 0; x < W; x++) {
    // marker is #f2b134
    if (data[x * ch] > 200 && data[x * ch + 1] > 140 && data[x * ch + 2] < 100) last = x;
  }
  const measured = last + 1;
  const t = i / fps; // HyperFrames frame n <-> t = n/fps
  const expected = (t / DUR) * W;
  const err = measured - expected;
  if (Math.abs(err) > Math.abs(worst)) worst = err;
  rows.push({ frame: i, t: +t.toFixed(3), expected: +expected.toFixed(1), measured, errPx: +err.toFixed(1) });
}
console.log(`frames ${files.length} @ ${fps}fps`);
console.log(rows.filter((r) => r.frame % 10 === 0).map((r) => `  f${String(r.frame).padStart(3)} t=${r.t}s  expected ${r.expected}px  measured ${r.measured}px  err ${r.errPx}px`).join("\n"));
console.log(`worst error across all frames: ${worst.toFixed(1)} px  (1 frame of drift would be ${(W / DUR / fps).toFixed(1)} px)`);
