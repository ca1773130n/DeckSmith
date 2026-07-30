/**
 * Which CELLS differ between two independent renders of the same composition.
 *
 * The deck-level drift gate compares whole files, so one nondeterministic cell
 * condemns the frame. This localises it: same frame index, same 480x360 crop,
 * two renders. Reports max per-channel delta as well as equality, because a
 * one-LSB antialiasing difference and a wholesale wrong frame are not the same
 * finding.
 */
import { readdir } from "node:fs/promises";
import sharp from "sharp";

const CELLS = [
  "01 attr (control)", "02 dashoffset", "03 DrawSVG", "04 MorphSVG",
  "05 MotionPath", "06 CSS offset-path", "07 clipPath attr", "08 SMIL",
  "09 CSS @keyframes", "10 custom plugin", "11 onUpdate (control)", "12 canvas via plugin",
];
const [aDir, bDir] = [process.argv[2] ?? "frames", process.argv[3] ?? "frames2"];
const files = (await readdir(aDir)).filter((f) => f.endsWith(".png")).sort();

const crop = (dir, f, i) =>
  sharp(`${dir}/${f}`)
    .extract({ left: (i % 4) * 480, top: Math.floor(i / 4) * 360, width: 480, height: 360 })
    .raw()
    .toBuffer();

const stat = Array.from({ length: 12 }, () => ({ diffFrames: 0, maxDelta: 0, diffPx: 0 }));
for (const f of files) {
  for (let i = 0; i < 12; i++) {
    const [a, b] = [await crop(aDir, f, i), await crop(bDir, f, i)];
    let maxD = 0;
    let px = 0;
    for (let p = 0; p < a.length; p++) {
      const d = Math.abs(a[p] - b[p]);
      if (d > maxD) maxD = d;
      if (d > 0) px++;
    }
    if (maxD > 0) stat[i].diffFrames++;
    stat[i].maxDelta = Math.max(stat[i].maxDelta, maxD);
    stat[i].diffPx = Math.max(stat[i].diffPx, px);
  }
}
console.log(`${files.length} frame pairs compared\n`);
console.log("cell".padEnd(24), "frames differing", "max channel delta", "worst differing subpixels");
for (let i = 0; i < 12; i++) {
  const s = stat[i];
  console.log(
    CELLS[i].padEnd(24),
    `${s.diffFrames}/${files.length}`.padStart(16),
    String(s.maxDelta).padStart(18),
    String(s.diffPx).padStart(25),
    s.maxDelta === 0 ? " IDENTICAL" : s.maxDelta <= 4 ? " subpixel" : " DIFFERENT",
  );
}
