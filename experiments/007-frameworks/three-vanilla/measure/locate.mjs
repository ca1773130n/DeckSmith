/** Where exactly do the cold and warm scene-3 frames differ, and what state differs with them? */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";

const CHROME =
  "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const dir = join(fileURLToPath(new URL(".", import.meta.url)), "../out");
const server = createServer((req, res) => {
  const p = join(dir, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  let b;
  try {
    b = readFileSync(p);
  } catch {
    res.writeHead(404).end("x");
    return;
  }
  res.writeHead(200, { "content-type": extname(p) === ".html" ? "text/html" : "text/javascript" });
  res.end(b);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

async function run(times) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  const r = await page.evaluate(async (times) => {
    const tl = window.__timelines.s3;
    for (const t of times) tl.seek(t, true);
    const h = window.__3d.s3;
    return {
      png: document.querySelector("#s3 canvas.ds3d").toDataURL("image/png"),
      state: Object.fromEntries(Object.keys(h.s).filter((k) => typeof h.s[k] === 'number').map((k) => [k, h.s[k]])),
      probe: h.probe ? h.probe() : null,
    };
  }, times);
  await page.close();
  return r;
}

const cold = await run([4.5]);
const warm = await run([0, 1.5, 3, 4.5]);
console.log("cold state", JSON.stringify(cold.state), "probe", JSON.stringify(cold.probe));
console.log("warm state", JSON.stringify(warm.state), "probe", JSON.stringify(warm.probe));

const [a, b] = await Promise.all(
  [cold, warm].map((r) =>
    sharp(Buffer.from(r.png.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true }),
  ),
);
let x0 = 1e9;
let y0 = 1e9;
let x1 = -1;
let y1 = -1;
let n = 0;
const W = a.info.width;
const C = a.info.channels;
for (let i = 0; i < a.data.length; i += C) {
  let d = 0;
  for (let c = 0; c < C; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
  if (d > 2) {
    n++;
    const px = (i / C) % W;
    const py = Math.floor(i / C / W);
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
}
console.log(JSON.stringify({ differingPixels: n, bbox: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } }));
if (n > 0) {
  const pad = 60;
  const region = {
    left: Math.max(0, x0 - pad),
    top: Math.max(0, y0 - pad),
    width: Math.min(W - Math.max(0, x0 - pad), x1 - x0 + 1 + pad * 2),
    height: Math.min(a.info.height - Math.max(0, y0 - pad), y1 - y0 + 1 + pad * 2),
  };
  for (const [name, r] of [["cold", cold], ["warm", warm]]) {
    await sharp(Buffer.from(r.png.split(",")[1], "base64"))
      .extract(region)
      .toFile(join(dir, `../measure/diff-${name}.png`));
  }
  console.log("wrote measure/diff-cold.png and measure/diff-warm.png");
}
await browser.close();
server.close();
