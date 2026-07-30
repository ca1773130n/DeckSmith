import { createHash } from "node:crypto";
import pptr from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
const CHROME = "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "file:///Users/neo/Developer/Projects/DeckSmith/experiments/007-frameworks/three-vanilla/out/index.html";
const b = await pptr.launch({ executablePath: CHROME, headless: true });
const seqs = [[4.5], [4.4, 4.5], [3, 4.5], [1.5, 4.5], [0, 4.5], [2.3, 4.5], [2.1, 4.5], [0, 1.5, 3, 4.5], [4.5, 4.5]];
for (const seq of seqs) {
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  await p.goto(URL, { waitUntil: "networkidle0" });
  const r = await p.evaluate((seq) => {
    const tl = window.__timelines.s3;
    for (const t of seq) tl.seek(t, true);
    const g = window.__3d.s3.probe();
    return { png: document.querySelector("#s3 canvas.ds3d").toDataURL(), g };
  }, seq);
  console.log(JSON.stringify(seq).padEnd(22), createHash("sha256").update(r.png).digest("hex").slice(0, 12), "n=" + r.g.n, "inst=" + r.g.instanceCount, "seg=" + r.g.trailSegments);
  await p.close();
}
await b.close();
