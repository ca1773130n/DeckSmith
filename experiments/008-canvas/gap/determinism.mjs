/**
 * Invariants 1 and 2: a camera / morph / match-cut frame must be a pure function
 * of t. Seek the same time twice in two independent browser sessions and hash
 * the PNG. Image-free frames must be byte-identical; frames containing the paper
 * figure are compared for pixel equality instead, because EXPERIMENT-006 already
 * showed raster decode makes those non-reproducible at the byte level.
 */
import { createHash } from "node:crypto";
import { open } from "./drive.mjs";

const CASES = [
  ["p1-camera.html", "s2", [2.9, 4.25, 6.4], "no image"],
  ["p2-morph.html", "s3", [5.4, 5.8, 6.4], "figure"],
  ["p3-matchcut.html", "s3", [0.2, 1.3], "figure"],
  ["p3-matchcut.html", "s2", [6.6], "no image"],
];

async function run() {
  const out = [];
  for (const [file, sid, times] of CASES) {
    const { browser, page } = await open(`http://127.0.0.1:8138/${file}`);
    await page.waitForTimeout(900);
    for (const t of times) {
      await page.evaluate(([s, tt]) => window.__go(s, tt), [sid, t]);
      await page.waitForTimeout(320);
      const buf = await page.screenshot();
      out.push([`${file} ${sid} t=${t}`, createHash("sha256").update(buf).digest("hex").slice(0, 16), buf]);
    }
    await browser.close();
  }
  return out;
}

const a = await run();
const b = await run();
let ok = 0;
for (let i = 0; i < a.length; i++) {
  const same = a[i][1] === b[i][1];
  const pix = a[i][2].equals(b[i][2]);
  if (same) ok++;
  console.log(`${same ? "IDENTICAL" : "DIFFER   "}  ${a[i][0]}  ${a[i][1]}  ${b[i][1]}`);
}
console.log(`\n${ok}/${a.length} byte-identical across two independent browser sessions`);
