import { createHash } from "node:crypto";
import pptr from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
const b = await pptr.launch({ executablePath: "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
async function go(waitMs) {
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  await p.goto("file://" + process.cwd() + "/out/index.html", { waitUntil: "networkidle0" });
  const r = await p.evaluate(async (waitMs) => {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    window.__timelines.s1.seek(0, true);
    const c = document.querySelector("#s1 canvas");
    const url = c.toDataURL();
    // is the canvas blank?
    const px = c.getContext("webgl2") ? null : null;
    return { url, registered: !!(window.__3d && window.__3d.s1), bytes: url.length };
  }, waitMs);
  await p.close();
  return r;
}
for (const w of [0, 50, 300]) {
  const r = await go(w);
  console.log(`wait ${String(w).padStart(3)}ms  handleRegistered=${r.registered}  frame=${sha(r.url)}  pngChars=${r.bytes}`);
}
await b.close();
