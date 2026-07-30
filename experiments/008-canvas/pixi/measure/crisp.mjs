/**
 * Typography: Pixi Text and Pixi BitmapText against DOM and SVG text, same
 * family, same sizes, same 1920x1080 frame.
 *
 * Two numbers per band:
 *   lapVar   variance of the Laplacian — higher means harder glyph edges
 *   midFrac  share of pixels stranded between background and foreground —
 *            lower means the edge resolves in fewer pixels
 * plus 6x nearest-neighbour crops to actually look at.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";

const HERE = new URL("..", import.meta.url).pathname;
const CHROME =
  "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/" +
  "chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BANDS = ["DOM", "SVG", "PixiText", "PixiBitmapText"];
const OUT = `${HERE}out`;
mkdirSync(OUT, { recursive: true });

async function metrics(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  let mid = 0;
  let ink = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += l;
      sum2 += l * l;
      n++;
      const v = data[i];
      if (v > 40 && v < 200) mid++;
      if (v > 40) ink++;
    }
  }
  const mean = sum / n;
  return {
    lapVar: +(sum2 / n - mean * mean).toFixed(1),
    midFrac: +(mid / Math.max(1, ink)).toFixed(4),
    inkPx: ink,
  };
}

async function shoot(page, tag, dpr) {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: dpr });
  const full = `${OUT}/text-${tag}.png`;
  await page.screenshot({ path: full });
  const rows = [];
  for (const [i, name] of BANDS.entries()) {
    // the 88px Korean row of each band, at native capture density
    const box = { left: 40 * dpr, top: (i * 270 + 10) * dpr, width: 640 * dpr, height: 110 * dpr };
    const crop = `${OUT}/crop-${tag}-${name}.png`;
    await sharp(full).extract(box).toFile(crop);
    // downsample any high-DPR crop back to 1920x1080 scale — that is the frame
    // the viewer actually sees — then blow it up to look at.
    await sharp(crop)
      .resize({ width: 640, kernel: "lanczos3" })
      .resize({ width: 640 * 3, kernel: "nearest" })
      .toFile(`${OUT}/zoom-${tag}-${name}.png`);
    rows.push({ band: name, ...(await metrics(crop)) });
  }
  return rows;
}

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--hide-scrollbars",
      "--disable-lcd-text",
      "--font-render-hinting=none",
      "--deterministic-mode",
      "--use-gl=angle",
      "--use-angle=metal",
    ],
  });
}

const report = {};
for (const [tag, dpr, query] of [
  ["dpr1", 1, ""],
  ["dpr2-aware", 2, ""], // Pixi told about the device pixel ratio
  ["dpr2-naive", 2, "?res=1"], // Pixi left at resolution 1, the default integration
]) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: dpr });
  await page.goto(`file://${HERE}proj/text/index.html${query}`, { waitUntil: "load" });
  await page.waitForFunction("window.__renderReady === true", { timeout: 30000 });
  const meta = await page.evaluate(() => ({
    dpr: window.__scenes.dpr,
    devicePixelRatio: window.devicePixelRatio,
    pixiWidths: window.__scenes.text.info.widths,
    bitmapWidths: window.__scenes.bitmap.info.widths,
    domWidths: [...document.querySelectorAll("#b0 .r")].map((e) => Math.round(e.getBoundingClientRect().width)),
    svgWidths: [...document.querySelectorAll("#b1 text")].map((e) => Math.round(e.getBBox().width)),
    fontsLoaded: document.fonts.status,
  }));
  report[tag] = { dpr, meta, bands: await shoot(page, tag, dpr) };
  await browser.close();

  console.log(`\n=== ${tag} (deviceScaleFactor ${dpr}${query}) — pixi resolution ${report[tag].meta.dpr} ===`);
  for (const b of report[tag].bands)
    console.log(`  ${b.band.padEnd(15)} lapVar ${String(b.lapVar).padStart(8)}   midFrac ${b.midFrac}   ink ${b.inkPx}`);
}

const m = report.dpr1.meta;
console.log("\nadvance widths for the same 88/56/40px strings (px):");
console.log(`  DOM  ${m.domWidths.join(", ")}`);
console.log(`  SVG  ${m.svgWidths.join(", ")}`);
console.log(`  Pixi Text        ${m.pixiWidths.join(", ")}`);
console.log(`  Pixi BitmapText  ${m.bitmapWidths.join(", ")}`);
writeFileSync(`${OUT}/crisp.json`, JSON.stringify(report, null, 2));
