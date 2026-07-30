/**
 * What happens when the render host has no GL.
 *
 * probe.mjs found that with no --use-gl flag, `autoDetectRenderer({preference:
 * 'webgl'})` returns a CANVAS renderer with no error and no warning. This asks
 * the question that matters: does the WebGL-only feature still draw?
 */
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";

const HERE = new URL("..", import.meta.url).pathname;
const CHROME =
  "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/" +
  "chrome-headless-shell-mac-arm64/chrome-headless-shell";

const MODES = {
  metal: ["--use-gl=angle", "--use-angle=metal"],
  swiftshader: ["--disable-gpu", "--use-gl=swiftshader", "--use-angle=swiftshader"],
  "no-gl-flags": [],
};

const out = {};
for (const [name, gl] of Object.entries(MODES)) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--allow-file-access-from-files", "--hide-scrollbars", "--deterministic-mode", ...gl],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
  const t0 = Date.now();
  await page.goto(`file://${HERE}proj/swarm/bench.html?mode=pixi&n=60000`, { waitUntil: "load" });
  let ready = true;
  try {
    await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  } catch {
    ready = false;
  }
  const info = ready
    ? await page.evaluate(() => {
        window.__scene.render(3.0);
        return { renderer: window.__scene.renderer?.name ?? "n/a", type: window.__scene.renderer?.type ?? null };
      })
    : {};
  const path = `${HERE}out/fallback-${name}.png`;
  await page.screenshot({ path });
  // "did anything draw?" — count pixels brighter than the background
  const { data } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > 40) ink++;
  out[name] = { ready, ...info, inkPx: ink, bootMs: Date.now() - t0, errors: errors.slice(0, 4) };
  console.log(
    `${name.padEnd(13)} ready=${ready} renderer=${String(info.renderer).padEnd(7)} ` +
      `ink=${String(ink).padStart(8)} px  boot ${out[name].bootMs} ms  errors=${out[name].errors.length}`,
  );
  if (out[name].errors.length) console.log(`    ${out[name].errors.join("\n    ")}`);
  await browser.close();
}
mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/fallback.json`, JSON.stringify(out, null, 2));
