/**
 * Per-frame determinism analysis over two PNG sequences.
 *
 * Normalises to RGB before comparing, because HyperFrames' capture path does
 * not always emit the same channel count between runs — a fact this script
 * exists to have discovered rather than to have assumed.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/Users/neo/Developer/Projects/DeckSmith/package.json");
const sharp = require("sharp");

const [dirA, dirB] = process.argv.slice(2);

function frames(d) {
  return readdirSync(d).filter((f) => f.endsWith(".png")).sort();
}

async function rgb(p) {
  const { data, info } = await sharp(p)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

const fa = frames(dirA);
const fb = frames(dirB);
if (fa.length !== fb.length) throw new Error(`frame count ${fa.length} vs ${fb.length}`);

let identical = 0;
const differing = [];
const channelMismatch = [];

for (let i = 0; i < fa.length; i++) {
  const pa = `${dirA}/${fa[i]}`;
  const pb = `${dirB}/${fb[i]}`;
  const ba = readFileSync(pa);
  const bb = readFileSync(pb);
  if (createHash("sha256").update(ba).digest("hex") === createHash("sha256").update(bb).digest("hex")) {
    identical++;
    continue;
  }
  const A = await rgb(pa);
  const B = await rgb(pb);
  if (A.data.length !== B.data.length) channelMismatch.push(i + 1);
  let n = 0;
  let max = 0;
  let sum = 0;
  const len = Math.min(A.data.length, B.data.length);
  for (let k = 0; k < len; k++) {
    const d = Math.abs(A.data[k] - B.data[k]);
    if (d) {
      n++;
      sum += d;
      if (d > max) max = d;
    }
  }
  if (n === 0) {
    identical++; // byte-different PNG encoding, pixel-identical image
    differing.push({ f: i + 1, n: 0, max: 0, mean: 0, encodingOnly: true });
  } else {
    differing.push({ f: i + 1, n, max, mean: sum / len, pct: (100 * n) / len });
  }
}

const real = differing.filter((d) => d.n > 0);
console.log(
  JSON.stringify(
    {
      dirA,
      dirB,
      frames: fa.length,
      pixelIdenticalFrames: identical,
      pixelDifferingFrames: real.length,
      encodingOnlyDifferences: differing.filter((d) => d.encodingOnly).length,
      channelCountMismatchFrames: channelMismatch.length,
      worst: real
        .slice()
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 6)
        .map((d) => ({ frame: d.f, pctSubpixels: +d.pct.toFixed(4), maxDelta: d.max })),
      deltaHistogram: {
        "maxDelta<=1": real.filter((d) => d.max <= 1).length,
        "maxDelta 2-8": real.filter((d) => d.max > 1 && d.max <= 8).length,
        "maxDelta>8": real.filter((d) => d.max > 8).length,
      },
      differingFrameNumbers: real.length <= 40 ? real.map((d) => d.f) : `${real.length} frames`,
    },
    null,
    2,
  ),
);
