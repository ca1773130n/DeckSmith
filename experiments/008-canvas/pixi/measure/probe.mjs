/**
 * Does WebGL come up under the render browser, is the ticker really dead, and
 * does seeking backwards land on the same pixels as seeking forwards?
 *
 * Everything here goes through the browser HyperFrames renders with, driven by
 * the same Page.captureScreenshot call its producer uses.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const HERE = new URL("..", import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH ?? (
  "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/" +
  "chrome-headless-shell-mac-arm64/chrome-headless-shell"
);
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

const MODES = {
  // What HyperFrames' producer does by default on a Mac: let Chrome probe for a
  // GPU and fall back to SwiftShader.
  auto: [],
  // --no-browser-gpu equivalent: force the software rasteriser.
  swiftshader: ["--disable-gpu", "--use-gl=swiftshader", "--use-angle=swiftshader"],
};

async function run(mode) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-lcd-text",
      "--force-device-scale-factor=1",
      "--font-render-hinting=none",
      "--deterministic-mode",
      "--disable-threaded-animation",
      "--disable-skia-runtime-opts",
      "--run-all-compositor-stages-before-draw",
      "--disable-new-content-rendering-timeout",
      ...MODES[mode],
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`file://${HERE}proj/seek/index.html`, { waitUntil: "load" });
  await page.waitForFunction("window.__renderReady === true", { timeout: 30000 });

  const env = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return {
      rendererType: window.__scene.renderer.type,
      rendererName: window.__scene.renderer.name,
      glVersion: gl ? gl.getParameter(gl.VERSION) : null,
      glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : null,
      glVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      maxTexture: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null,
      ticker: window.__tickerState,
      dpr: window.devicePixelRatio,
    };
  });

  // --- ticker proof: hold the page for 2 s of wall clock and change nothing ---
  const before = await page.evaluate(() => ({ ...window.__DP.stats }));
  await new Promise((r) => setTimeout(r, 2000));
  const after = await page.evaluate(() => ({ ...window.__DP.stats }));

  // --- seek exactness: forward, then backward over the same stops ---
  const stops = [0, 0.75, 1.5, 2.25, 3, 3.75, 4.5, 5.25, 6];
  const seek = async (t) => {
    await page.evaluate((tt) => {
      window.__timelines.main.time(tt, false);
    }, t);
    const buf = await page.screenshot({ type: "png", captureBeyondViewport: false });
    return sha(buf);
  };
  const fwd = {};
  for (const t of stops) fwd[t] = await seek(t);
  const back = {};
  for (const t of [...stops].reverse()) back[t] = await seek(t);
  // and a third pass that jumps around, the way a presenter does
  const jumpOrder = [3, 0, 6, 1.5, 4.5, 0.75, 5.25, 2.25, 3.75];
  const jump = {};
  for (const t of jumpOrder) jump[t] = await seek(t);

  await browser.close();
  return {
    mode,
    env,
    errors,
    tickerHeld: { before, after, rendersDuring2sIdle: after.renders - before.renders, rafDuring: after.raf - before.raf },
    seek: {
      stops,
      forward: fwd,
      backward: back,
      jump,
      backwardMatchesForward: stops.every((t) => fwd[t] === back[t]),
      jumpMatchesForward: stops.every((t) => fwd[t] === jump[t]),
      distinctFrames: new Set(Object.values(fwd)).size,
    },
  };
}

const out = {};
for (const mode of Object.keys(MODES)) {
  out[mode] = await run(mode);
  const r = out[mode];
  console.log(`\n=== ${mode} ===`);
  console.log(`  GL         : ${r.env.glVersion}`);
  console.log(`  GL_RENDERER: ${r.env.glRenderer}`);
  console.log(`  pixi type  : ${r.env.rendererType} (1 = WebGL)  max tex ${r.env.maxTexture}`);
  console.log(`  ticker     : shared.started=${r.env.ticker.sharedStarted} system.started=${r.env.ticker.systemStarted}`);
  console.log(`  2s idle    : ${r.tickerHeld.rendersDuring2sIdle} renders, ${r.tickerHeld.rafDuring} rAF callbacks`);
  console.log(`  distinct frames over 9 stops: ${r.seek.distinctFrames}`);
  console.log(`  backward == forward: ${r.seek.backwardMatchesForward}`);
  console.log(`  jumped   == forward: ${r.seek.jumpMatchesForward}`);
  if (r.errors.length) console.log(`  errors: ${r.errors.slice(0, 3).join(" | ")}`);
}
// cross-mode: does the software rasteriser produce the same pixels as auto?
const same = out.auto.seek.stops.filter((t) => out.auto.seek.forward[t] === out.swiftshader.seek.forward[t]);
console.log(`\nauto vs swiftshader identical frames: ${same.length}/${out.auto.seek.stops.length}`);
mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/probe.json`, JSON.stringify({ ...out, autoVsSwiftshaderIdentical: same.length }, null, 2));
