import pptr from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import { createHash } from "node:crypto";
const b = await pptr.launch({ executablePath: "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
await p.goto("file://" + process.cwd() + "/out/index.html", { waitUntil: "networkidle0" });
console.log(await p.evaluate(async () => {
  const c = () => document.querySelector("#s1 canvas");
  const out = {};
  window.__timelines.s1.seek(0, true);
  out.atMount = c().toDataURL().length;
  out.canvasAttrs = [c().width, c().height, c().clientWidth, c().clientHeight];
  await new Promise((r) => setTimeout(r, 300));
  out.after300msNoAdvance = c().toDataURL().length;
  window.__3d.s1.render(); // one more advance(), nothing else changed
  out.afterExplicitAdvance = c().toDataURL().length;
  out.canvasAttrsAfter = [c().width, c().height];
  return out;
}));
await b.close();
