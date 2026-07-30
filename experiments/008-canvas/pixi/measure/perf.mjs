/**
 * The same N-point animation, drawn by Pixi's ParticleContainer and by N SVG
 * <circle> elements, measured two ways:
 *
 *   sceneMs    time to move every point and issue the draw (in-page)
 *   captureMs  wall-clock cost of one CAPTURED frame — seek + screenshot,
 *              which is what a render actually pays per frame
 *
 * Setup cost is reported separately: building 60,000 SVG nodes is a one-off,
 * but it is a one-off the renderer pays on every worker, on every render.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const HERE = new URL("..", import.meta.url).pathname;
const CHROME =
  "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/" +
  "chrome-headless-shell-mac-arm64/chrome-headless-shell";
const STOPS = [0.4, 1.2, 2.0, 2.8, 3.6, 4.4, 5.2, 6.0, 6.8, 7.6];
const COUNTS = [1000, 5000, 20000, 60000];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--allow-file-access-from-files",
    "--hide-scrollbars",
    "--deterministic-mode",
    "--use-gl=angle",
    "--use-angle=metal",
  ],
});

const rows = [];
for (const mode of ["pixi", "svg"]) {
  for (const n of COUNTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const t0 = Date.now();
    await page.goto(`file://${HERE}proj/swarm/bench.html?mode=${mode}&n=${n}`, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true", { timeout: 180000 });
    const setupMs = Date.now() - t0;

    for (const t of STOPS) await page.evaluate((tt) => window.__scene.render(tt), t); // warm

    const sceneMs = [];
    const captureMs = [];
    for (const t of STOPS) {
      const c0 = Date.now();
      const ms = await page.evaluate((tt) => {
        window.__scene.render(tt);
        return window.__DP.stats.lastRenderMs;
      }, t);
      await page.screenshot({ type: "png" });
      captureMs.push(Date.now() - c0);
      sceneMs.push(ms);
    }
    const row = {
      mode,
      n,
      setupMs,
      sceneMs: +median(sceneMs).toFixed(2),
      captureMs: median(captureMs),
      fpsIfPlayed: +(1000 / Math.max(0.01, median(sceneMs))).toFixed(0),
    };
    rows.push(row);
    console.log(
      `${mode.padEnd(5)} n=${String(n).padStart(6)}  setup ${String(row.setupMs).padStart(6)} ms   ` +
        `scene ${String(row.sceneMs).padStart(8)} ms   captured frame ${String(row.captureMs).padStart(5)} ms   ` +
        `(${row.fpsIfPlayed} fps if played)`,
    );
    await page.close();
  }
}
await browser.close();
mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/perf.json`, JSON.stringify(rows, null, 2));

console.log("\nratio at each N (svg / pixi):");
for (const n of COUNTS) {
  const p = rows.find((r) => r.mode === "pixi" && r.n === n);
  const s = rows.find((r) => r.mode === "svg" && r.n === n);
  console.log(
    `  n=${String(n).padStart(6)}  scene ${(s.sceneMs / p.sceneMs).toFixed(1)}x   ` +
      `captured frame ${(s.captureMs / p.captureMs).toFixed(1)}x   setup ${(s.setupMs / p.setupMs).toFixed(1)}x`,
  );
}
