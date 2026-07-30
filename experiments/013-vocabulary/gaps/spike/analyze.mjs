/**
 * Per-cell pixel evidence, not bounding boxes.
 *
 * For each 480x360 cell of each captured frame: a hash of the raw pixels and a
 * count of non-background pixels ("ink"). A technique is SEEK-PURE when its cell
 * hash changes across t; frozen when it does not. Ink is reported so "frozen"
 * can be told apart from "never drew anything".
 */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import sharp from "sharp";

const dir = process.argv[2] ?? "shots";
const CELLS = [
  "01 attr (control)", "02 dashoffset", "03 DrawSVG", "04 MorphSVG",
  "05 MotionPath", "06 CSS offset-path", "07 clipPath attr", "08 SMIL",
  "09 CSS @keyframes", "10 custom plugin", "11 onUpdate (control)", "12 canvas via plugin",
];
const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();

const rows = [];
for (const f of files) {
  const img = sharp(`${dir}/${f}`);
  const meta = await img.metadata();
  const sx = meta.width / 1920;
  const per = [];
  for (let i = 0; i < 12; i++) {
    const cx = Math.round((i % 4) * 480 * sx);
    const cy = Math.round(Math.floor(i / 4) * 360 * sx);
    const cw = Math.round(480 * sx);
    const ch = Math.round(360 * sx);
    const buf = await sharp(`${dir}/${f}`)
      .extract({ left: cx, top: cy, width: cw, height: ch })
      .raw()
      .toBuffer();
    let ink = 0;
    for (let p = 0; p < buf.length; p += meta.channels) {
      // background is #0b0d10; anything materially brighter is ink or label
      if (buf[p] > 40 || buf[p + 1] > 40 || buf[p + 2] > 40) ink++;
    }
    per.push({ hash: createHash("sha256").update(buf).digest("hex").slice(0, 10), ink });
  }
  rows.push({ f, per });
}

console.log(`frames: ${files.join(", ")}  (${rows.length})`);
console.log("cell".padEnd(26), "distinct/n", "ink@first", "ink@last", "verdict");
for (let i = 0; i < 12; i++) {
  const hs = rows.map((r) => r.per[i].hash);
  const distinct = new Set(hs).size;
  const first = rows[0].per[i].ink;
  const last = rows[rows.length - 1].per[i].ink;
  const verdict = distinct === rows.length ? "MOVES (all distinct)"
    : distinct === 1 ? "FROZEN" : `PARTIAL (${distinct} states)`;
  console.log(CELLS[i].padEnd(26), String(distinct).padStart(4) + `/${rows.length}`.padEnd(6),
    String(first).padStart(9), String(last).padStart(8), " ", verdict);
}
