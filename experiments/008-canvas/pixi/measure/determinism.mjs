/**
 * Frame-level determinism for a WebGL scene under the render browser.
 *
 * probe.mjs found exactly one disagreeing stop, on the first pass only. This
 * separates the two candidate causes:
 *   (a) WebGL is nondeterministic  -> repeated identical passes would differ
 *   (b) first-render warm-up       -> a warm-up pass makes every pass agree
 * and measures how large the disagreement actually is, in pixels.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";

const HERE = new URL("..", import.meta.url).pathname;
const CHROME =
  "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/" +
  "chrome-headless-shell-mac-arm64/chrome-headless-shell";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const STOPS = [0, 0.75, 1.5, 2.25, 3, 3.75, 4.5, 5.25, 6];

async function pass(page, { warm }) {
  if (warm) for (const t of STOPS) await seekOnly(page, t);
  const frames = {};
  for (const t of STOPS) {
    await seekOnly(page, t);
    frames[t] = await page.screenshot({ type: "png" });
  }
  return frames;
}
const seekOnly = (page, t) =>
  page.evaluate((tt) => {
    window.__timelines.main.time(tt, false);
  }, t);

async function diff(a, b) {
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
  return { differingSubpixels: n, totalSubpixels: ra.data.length, maxDelta: max, meanDelta: +(sum / Math.max(1, n)).toFixed(2) };
}

async function launch(gpu) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--hide-scrollbars",
      "--disable-lcd-text",
      "--force-device-scale-factor=1",
      "--font-render-hinting=none",
      "--deterministic-mode",
      "--disable-threaded-animation",
      "--run-all-compositor-stages-before-draw",
      ...(gpu ? [] : ["--disable-gpu", "--use-gl=swiftshader", "--use-angle=swiftshader"]),
    ],
  });
}

const report = {};
for (const [name, warm] of [["cold", false], ["warmed", true]]) {
  // Two independent browser processes, exactly like two `hyperframes render`
  // invocations — a fresh page each time, not a rewind of the same one.
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const browser = await launch(false);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(`file://${HERE}proj/seek/index.html`, { waitUntil: "load" });
    await page.waitForFunction("window.__renderReady === true");
    runs.push(await pass(page, { warm }));
    await browser.close();
  }
  const [A, B] = runs;
  const rows = [];
  for (const t of STOPS) {
    const same = sha(A[t]) === sha(B[t]);
    rows.push({ t, same, ...(same ? {} : await diff(A[t], B[t])) });
  }
  report[name] = { identicalStops: rows.filter((r) => r.same).length, total: STOPS.length, rows };
  console.log(
    `${name.padEnd(7)} process-to-process: ${report[name].identicalStops}/${STOPS.length} stops byte-identical`,
  );
  for (const r of rows.filter((r) => !r.same))
    console.log(
      `   t=${r.t}: ${r.differingSubpixels}/${r.totalSubpixels} subpixels differ, max delta ${r.maxDelta}, mean ${r.meanDelta}`,
    );
}

// Same page, forward then backward, warmed — the presenter-scrub case.
{
  const browser = await launch(false);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`file://${HERE}proj/seek/index.html`, { waitUntil: "load" });
  await page.waitForFunction("window.__renderReady === true");
  for (const t of STOPS) await seekOnly(page, t); // warm-up
  const fwd = {};
  for (const t of STOPS) {
    await seekOnly(page, t);
    fwd[t] = sha(await page.screenshot({ type: "png" }));
  }
  const back = {};
  for (const t of [...STOPS].reverse()) {
    await seekOnly(page, t);
    back[t] = sha(await page.screenshot({ type: "png" }));
  }
  const ok = STOPS.filter((t) => fwd[t] === back[t]).length;
  report.scrub = { identicalStops: ok, total: STOPS.length };
  console.log(`scrub   backward vs forward (warmed): ${ok}/${STOPS.length} stops byte-identical`);
  await browser.close();
}

mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/determinism.json`, JSON.stringify(report, null, 2));
