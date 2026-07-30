// One PNG per scene at its LAST hold — the settled slide, everything revealed.
//
// Not the renderer: the renderer draws the whole deck and costs minutes, and the
// question here is only "what does a finished slide look like". Same discipline
// though — SEEK to an absolute time, never play (invariant 1), and drive the
// scene's own paused timeline rather than waiting for anything.
//
//   node shoot.mjs <deckDir> <outDir> [--width N] [--scale S]
//
// `--width` renders the canvas down to a device width, which is the whole point
// at 9:16: 390 is a phone, and a portrait slide that reads at 1080 and dies at
// 390 has not been tested at all.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const deck = resolve(process.argv[2]);
const outDir = resolve(process.argv[3]);
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i === -1 ? d : Number(process.argv[i + 1]);
};

const timing = require(join(deck, "timing.json"));
const shotWidth = arg("--width", timing.width);
const scale = shotWidth / timing.width;

const { getInstalledBrowsers } = await import("@puppeteer/browsers");
const { homedir } = await import("node:os");
const cacheDir = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
const installed = await getInstalledBrowsers({ cacheDir });
const chrome = process.env.DECKSMITH_CHROME || installed.find((b) => b.browser === "chrome")?.executablePath;

const { default: puppeteer } = await import("puppeteer-core");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--font-render-hinting=none"] });
const page = await browser.newPage();
// deviceScaleFactor carries the down-scale: the page still lays out at the
// composition's own width, and the screenshot comes out at the device width.
// Resizing the viewport instead would just crop.
await page.setViewport({ width: timing.width, height: timing.height, deviceScaleFactor: scale });
await page.goto(`file://${join(deck, "index.html")}`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);

await mkdir(outDir, { recursive: true });
for (const s of timing.scenes) {
  const at = s.holds.length ? s.holds[s.holds.length - 1] : s.duration * 0.8;
  await page.evaluate(
    (sid, t) => {
      for (const el of document.querySelectorAll(".scene.clip")) {
        el.style.visibility = el.id === sid ? "visible" : "hidden";
      }
      const tl = window.__timelines[sid];
      // suppressEvents, as capture does: an onUpdate that fires here would be
      // motion the renderer never sees (invariant 11).
      if (tl) tl.seek(t, true);
    },
    s.id,
    at,
  );
  const buf = await page.screenshot({ type: "png" });
  await writeFile(join(outDir, `${s.id}.png`), buf);
}
await browser.close();
console.log(`${timing.scenes.length} shots at ${shotWidth}px wide → ${outDir}`);
