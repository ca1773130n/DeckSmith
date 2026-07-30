/**
 * Chases down the scene-3 cold/warm mismatch: is it state I carry across seeks,
 * or is the GPU itself not reproducible? Prints how many pixels differ and by
 * how much, which distinguishes "wrong frame" from "last-bit rasteriser noise".
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";

const CHROME =
  "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const dir = join(fileURLToPath(new URL(".", import.meta.url)), "../out");
const TYPES = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const p = join(dir, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  let body;
  try {
    body = readFileSync(p);
  } catch {
    res.writeHead(404).end("nope");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

async function shot(sid, times, opts = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  const url = await page.evaluate(
    async (sid, times) => {
      const tl = window.__timelines[sid];
      for (const t of times) tl.seek(t, true);
      return document.querySelector(`#${sid} canvas.ds3d`).toDataURL("image/png");
    },
    sid,
    times,
  );
  if (!opts.keep) await page.close();
  return Buffer.from(url.split(",")[1], "base64");
}

async function compare(a, b) {
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  let n = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < ra.data.length; i++) {
    const d = Math.abs(ra.data[i] - rb.data[i]);
    if (d) {
      n++;
      sum += d;
      if (d > max) max = d;
    }
  }
  return { channelsDiffering: n, ofTotal: ra.data.length, maxDelta: max, meanDelta: n ? +(sum / n).toFixed(2) : 0 };
}

const WARM = [0, 1.5, 3, 4.5];
const out = {};
for (const sid of ["s1", "s3"]) {
  const t = sid === "s3" ? 4.5 : 3.2;
  const cold1 = await shot(sid, [t]);
  const cold2 = await shot(sid, [t]);
  const warm1 = await shot(sid, sid === "s3" ? WARM : [0, 0.8, 1.6, 2.4, 3.2]);
  const warm2 = await shot(sid, sid === "s3" ? WARM : [0, 0.8, 1.6, 2.4, 3.2]);
  out[sid] = {
    t,
    coldHash: sha(cold1),
    warmHash: sha(warm1),
    coldVsCold: sha(cold1) === sha(cold2) ? "identical" : await compare(cold1, cold2),
    warmVsWarm: sha(warm1) === sha(warm2) ? "identical" : await compare(warm1, warm2),
    coldVsWarm: sha(cold1) === sha(warm1) ? "identical" : await compare(cold1, warm1),
  };
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
