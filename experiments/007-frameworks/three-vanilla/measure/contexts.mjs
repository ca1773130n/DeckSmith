/** How many 3D scenes can one deck hold before Chrome starts dropping contexts? */
import pptr from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
const b = await pptr.launch({ executablePath: "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
await p.goto("file://" + process.cwd() + "/out/index.html", { waitUntil: "networkidle0" });
console.log(await p.evaluate(() => {
  const lost = [];
  const kept = [];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement("canvas");
    c.width = 1920; c.height = 1080;
    const gl = c.getContext("webgl2", { antialias: true });
    if (!gl) { lost.push(i); continue; }
    c.addEventListener("webglcontextlost", () => lost.push(i));
    kept.push({ i, gl });
  }
  // a context that was silently killed reports isContextLost()
  const dead = kept.filter((k) => k.gl.isContextLost()).map((k) => k.i);
  return { requested: 40, nullContexts: lost.length, deadAfterAllocation: dead.length, firstDead: dead[0] ?? null, alive: kept.length - dead.length };
}));
await b.close();
