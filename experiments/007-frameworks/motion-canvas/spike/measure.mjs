/**
 * Drives the Motion Canvas harness in headless Chrome and prints measurements.
 *
 * Usage: node measure.mjs [--tag=run1]
 *
 * Uses the repo's already-installed puppeteer-core and the Chrome that
 * puppeteer cached for HyperFrames — nothing is installed at the repo root.
 */
import puppeteer from '/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {readdirSync} from 'node:fs';

const CHROME_ROOT = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell`;
const build = readdirSync(CHROME_ROOT)[0];
const EXEC = `${CHROME_ROOT}/${build}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const tag = (process.argv.find(a => a.startsWith('--tag=')) ?? '--tag=run').slice(6);

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: true,
  args: [
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--disable-lcd-text',
  ],
});

const page = await browser.newPage();
await page.setViewport({width: 1920, height: 1080, deviceScaleFactor: 1});
page.on('pageerror', e => console.error('PAGEERROR:', e.message));
page.on('console', m => {
  if (m.type() === 'error') console.error('CONSOLE:', m.text());
});

await page.goto('http://localhost:5199/harness.html', {waitUntil: 'networkidle0'});
await page.waitForFunction('window.mc !== undefined', {timeout: 30000});

const info = await page.evaluate(() => window.mc.ready());
console.log(`\n=== motion-canvas seek/determinism spike [${tag}] ===`);
console.log(`scenes=${info.sceneCount} fps=${info.fps} duration=${info.duration} frames`);

// 1. Cold seek — what an exporter / random-access still render costs.
const cold = await page.evaluate(() => window.mc.coldSeek([0, 2, 5, 10, 15, 19]));
console.log('\n-- COLD SEEK (reset + seek, i.e. Renderer.renderFrame) --');
console.log('  t(s)  frame  next() calls  seek ms  render ms  sha256(frame)[0:12]');
for (const r of cold) {
  console.log(
    `  ${String(r.time).padStart(4)}  ${String(r.frame).padStart(5)}  ` +
      `${String(r.advances).padStart(12)}  ${r.seekMs.toFixed(1).padStart(7)}  ` +
      `${r.renderMs.toFixed(1).padStart(9)}  ${r.hash.slice(0, 12)}`,
  );
}

// 2. Forward walk — the cheap, sequential path.
const fwd = await page.evaluate(() => window.mc.forwardWalk([2, 5, 10, 15, 19]));
console.log('\n-- FORWARD WALK (no reset, monotonic time) --');
for (const r of fwd) {
  console.log(
    `  t=${String(r.time).padStart(3)}s  next() calls=${String(r.advances).padStart(5)}  seek ${r.seekMs.toFixed(1)}ms`,
  );
}

// 3. Backward jump — deck navigation to a previous slide.
const back = await page.evaluate(() => window.mc.backwardJump(19, 2));
console.log('\n-- BACKWARD JUMP (deck nav: t=19s then back to t=2s) --');
console.log(
  `  forward to t=19s: next() calls=${back.late.advances}  ${back.late.seekMs.toFixed(1)}ms`,
);
console.log(
  `  BACK to    t=2s : next() calls=${back.back.advances}  ${back.back.seekMs.toFixed(1)}ms`,
);

// 4. Intra-process determinism at a fixed timestamp.
const hashes = await page.evaluate(() => window.mc.repeatHash(10, 5));
const unique = [...new Set(hashes)];
console.log('\n-- DETERMINISM: 5 cold renders of t=10s, same process --');
console.log(`  unique hashes: ${unique.length} / ${hashes.length}`);
console.log(`  ${unique.map(h => h.slice(0, 16)).join('\n  ')}`);

console.log(`\nJSON ${tag} ${JSON.stringify({cold: cold.map(c => [c.time, c.advances, c.hash]), unique})}`);

await browser.close();
