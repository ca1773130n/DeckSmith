/**
 * Read back which SOURCE frame each video cell was showing, per output frame.
 *
 * Source frame n is a flat grey of 2n, so mean/2 recovers n. Only the middle of
 * each cell is sampled, to stay clear of the label and any cell border.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import sharp from "sharp";

const mp4 = process.argv[2] ?? "m1.mp4";
const dir = ".readframes";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const want = [0, 15, 30, 45, 60, 75, 90, 105, 119];
execFileSync("ffmpeg", [
  "-v", "error", "-i", mp4,
  "-vf", `select='${want.map((n) => `eq(n\\,${n})`).join("+")}'`,
  "-vsync", "0", `${dir}/o%02d.png`,
]);
const files = readdirSync(dir).sort();
const CELLS = ["V1 bare", "V2 autoplay", "V3 plugin currentTime", "I1 static img"];
console.log("out frame  " + CELLS.map((c) => c.padEnd(22)).join(""));
for (let f = 0; f < files.length; f++) {
  const cols = [];
  for (let i = 0; i < 4; i++) {
    const buf = await sharp(`${dir}/${files[f]}`)
      .extract({ left: i * 480 + 120, top: 90, width: 240, height: 180 })
      .raw()
      .toBuffer();
    let sum = 0;
    for (let p = 0; p < buf.length; p += 3) sum += buf[p];
    const mean = sum / (buf.length / 3);
    cols.push(i === 3 ? `R=${mean.toFixed(1)}` : `grey ${mean.toFixed(1)} -> src f${(mean / 2).toFixed(1)}`);
  }
  console.log(`n=${String(want[f]).padStart(3)}      ` + cols.map((c) => c.padEnd(22)).join(""));
}
rmSync(dir, { recursive: true, force: true });
