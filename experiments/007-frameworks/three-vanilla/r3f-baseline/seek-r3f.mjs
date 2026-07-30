import { createHash } from "node:crypto";
import pptr from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
const CHROME = "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = "file://" + process.cwd() + "/out/index.html";
const b = await pptr.launch({ executablePath: CHROME, headless: true });
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const TIMES = [0, 1.6, 3.2, 4.8, 6.4];
async function run(seq) {
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
  await p.setViewport({ width: 1920, height: 1080 });
  await p.goto(URL, { waitUntil: "networkidle0" });
  const r = await p.evaluate(async (seq) => {
    const tl = window.__timelines?.s1;
    const out = [];
    if (tl) for (const t of seq) { tl.seek(t, true); out.push(document.querySelector("#s1 canvas").toDataURL()); }
    return { out, sync: window.__handleRegisteredSynchronously, mounted: window.__mountReturned, hasCanvas: !!document.querySelector("#s1 canvas") };
  }, seq);
  await p.close();
  return { ...r, errs };
}
const fwd = await run(TIMES);
console.log("handle registered synchronously by setup:", fwd.sync, "| canvas present:", fwd.hasCanvas, "| page errors:", fwd.errs.slice(0, 3));
if (!fwd.out.length) { console.log("NO FRAMES — the timeline could not be built"); await b.close(); process.exit(0); }
const back = await run([...TIMES].reverse());
const cold = [];
for (const t of TIMES) cold.push((await run([t])).out[0]);
console.log("t      fwd          back==fwd  cold==fwd");
TIMES.forEach((t, i) => console.log(String(t).padEnd(6), sha(fwd.out[i]), String(sha(back.out.slice().reverse()[i]) === sha(fwd.out[i])).padEnd(10), sha(cold[i]) === sha(fwd.out[i])));
await b.close();
