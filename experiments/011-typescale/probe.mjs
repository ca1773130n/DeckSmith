// What the BROWSER thinks the geometry is. Reference space is an argument about
// how Chrome resolves `zoom`, and an argument is not evidence.
//
//   node probe.mjs <deckDir>
//
// Prints, per scene: the scene box in canvas px (must be the whole canvas), the
// content box (must be canvas less the scaled gutter), and the largest and
// smallest rendered font size in canvas px — `getComputedStyle` reports the
// zoomed value, so this is what the eye actually gets.
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const deck = resolve(process.argv[2]);
const timing = require(join(deck, "timing.json"));

const { getInstalledBrowsers } = await import("@puppeteer/browsers");
const cacheDir = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
const chrome =
  process.env.DECKSMITH_CHROME ||
  (await getInstalledBrowsers({ cacheDir })).find((b) => b.browser === "chrome")?.executablePath;
const { default: puppeteer } = await import("puppeteer-core");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: timing.width, height: timing.height });
await page.goto(`file://${join(deck, "index.html")}`, { waitUntil: "networkidle0" });

const out = await page.evaluate(() => {
  const rows = [];
  for (const el of document.querySelectorAll(".scene.clip")) {
    const r = el.getBoundingClientRect();
    const plate = el.querySelector(".scene");
    const box = plate ?? el;
    const cs = getComputedStyle(box);
    const br = box.getBoundingClientRect();
    const pad = [Number.parseFloat(cs.paddingLeft), Number.parseFloat(cs.paddingTop)];
    let lo = Number.POSITIVE_INFINITY;
    let hi = 0;
    let widest = 0;
    for (const t of el.querySelectorAll("*")) {
      if (!t.textContent?.trim() || t.children.length) continue;
      const s = Number.parseFloat(getComputedStyle(t).fontSize);
      if (s > 0) {
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      widest = Math.max(widest, t.getBoundingClientRect().right);
    }
    rows.push({
      id: el.id,
      cameraed: !!plate,
      scene: `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}`,
      contentBox: `${Math.round(br.width - 2 * pad[0] * (br.width / box.offsetWidth))}x${Math.round(br.height - 2 * pad[1] * (br.height / box.offsetHeight))}`,
      gutter: Math.round(pad[0] * (br.width / box.offsetWidth)),
      fontPx: `${lo.toFixed(1)}..${hi.toFixed(1)}`,
      rightmostInk: Math.round(widest),
    });
  }
  return rows;
});
await browser.close();
console.log(`${deck}  canvas ${timing.width}x${timing.height}`);
console.table(out);
