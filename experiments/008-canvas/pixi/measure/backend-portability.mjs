/**
 * Does the GPU backend change the pixels? Control: the DOM and SVG bands of the
 * text composition, which never touch GL. Treatment: the Pixi bands, and the
 * 60k swarm.
 */
import { writeFileSync } from "node:fs";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";
const HERE = new URL("..", import.meta.url).pathname;
const CHROME = "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const GL = { metal: ["--use-gl=angle", "--use-angle=metal"], swiftshader: ["--disable-gpu", "--use-gl=swiftshader", "--use-angle=swiftshader"] };
const shots = {};
for (const [name, gl] of Object.entries(GL)) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ["--allow-file-access-from-files", "--hide-scrollbars", "--disable-lcd-text", "--font-render-hinting=none", "--deterministic-mode", ...gl] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`file://${HERE}proj/text/index.html`, { waitUntil: "load" });
  await page.waitForFunction("window.__renderReady === true");
  shots[name] = await page.screenshot({ type: "png" });
  await browser.close();
}
const BANDS = [["DOM", 0], ["SVG", 270], ["Pixi Text", 540], ["Pixi BitmapText", 810]];
const rep = [];
for (const [label, top] of BANDS) {
  const [a, b] = await Promise.all(Object.values(shots).map((s) => sharp(s).extract({ left: 0, top, width: 1920, height: 270 }).raw().toBuffer()));
  let n = 0, max = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { n++; if (d > max) max = d; } }
  rep.push({ band: label, differing: n, total: a.length, pct: +(100 * n / a.length).toFixed(3), maxDelta: max });
  console.log(`${label.padEnd(16)} metal vs swiftshader: ${String(n).padStart(8)}/${a.length} subpixels (${(100 * n / a.length).toFixed(3)}%), max delta ${max}`);
}
writeFileSync(`${HERE}out/backend-portability.json`, JSON.stringify(rep, null, 2));
