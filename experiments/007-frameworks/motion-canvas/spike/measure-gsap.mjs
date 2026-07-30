/**
 * Baseline: what DeckSmith's own seek costs, on an equivalent 196-node,
 * ~21s scene. Compared directly against Motion Canvas's replay-based seek.
 */
import puppeteer from '/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {readdirSync} from 'node:fs';

const CHROME_ROOT = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell`;
const build = readdirSync(CHROME_ROOT)[0];
const EXEC = `${CHROME_ROOT}/${build}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({width: 1920, height: 1080, deviceScaleFactor: 1});
page.on('pageerror', e => console.error('PAGEERROR:', e.message));

await page.goto('http://localhost:5199/gsap-baseline.html', {waitUntil: 'networkidle0'});
await page.waitForFunction('window.bench !== undefined', {timeout: 20000});

const info = await page.evaluate(() => window.bench.info());
console.log(`\n=== GSAP baseline: ${info.nodes} nodes, ${info.tweens} tweens, ${info.duration.toFixed(1)}s ===`);

// Deliberately non-monotonic: forward, backward, far jumps.
const times = [1, 19, 5, 21, 2, 15, 0.5, 10];
const r = await page.evaluate(ts => window.bench.seekSeries(ts), times);
console.log('\n-- timeline.seek(t) — random access, non-monotonic --');
for (const x of r) {
  console.log(`  seek to t=${String(x.time).padStart(4)}s : ${x.ms.toFixed(3)} ms`);
}
const mean = r.reduce((a, b) => a + b.ms, 0) / r.length;
console.log(`\n  mean random-access seek: ${mean.toFixed(3)} ms`);

await browser.close();
