/**
 * Second measurement: does replay-based seek cost real wall time once a scene
 * has DeckSmith-grade content (~200 animated nodes)?
 *
 * Also answers the scoping question: is seek cost O(frames in the whole deck)
 * or O(frames in the current scene)?
 */
import puppeteer from '/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {readdirSync} from 'node:fs';

const CHROME_ROOT = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell`;
const build = readdirSync(CHROME_ROOT)[0];
const EXEC = `${CHROME_ROOT}/${build}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'],
});
const page = await browser.newPage();
await page.setViewport({width: 1920, height: 1080, deviceScaleFactor: 1});
page.on('pageerror', e => console.error('PAGEERROR:', e.message));

await page.goto('http://localhost:5199/harness.html', {waitUntil: 'networkidle0'});
await page.waitForFunction('window.mc !== undefined', {timeout: 30000});

const info = await page.evaluate(() => window.mc.ready());
console.log('\n=== scene ranges (fps=60) ===');
for (const s of info.scenes) {
  console.log(
    `  ${s.name.padEnd(8)} frames ${s.first}..${s.last}  ` +
      `= ${(s.first / 60).toFixed(1)}s..${(s.last / 60).toFixed(1)}s`,
  );
}
console.log(`  total duration = ${info.duration} frames = ${(info.duration / 60).toFixed(1)}s`);

const heavy = info.scenes[1];
const hStart = heavy.first / 60;
const hEnd = heavy.last / 60;

// Cold seeks progressively deeper into the HEAVY scene.
const times = [hStart + 1, hStart + 5, hStart + 10, hStart + 20, hEnd - 1].map(
  t => Math.round(t * 10) / 10,
);
const cold = await page.evaluate(ts => window.mc.coldSeek(ts), times);

console.log('\n-- COLD SEEK into the 196-node scene --');
console.log('  t(s)   abs frame  next() calls  seek ms   render ms');
for (const r of cold) {
  console.log(
    `  ${String(r.time).padStart(5)}  ${String(r.frame).padStart(9)}  ` +
      `${String(r.advances).padStart(12)}  ${r.seekMs.toFixed(1).padStart(7)}  ` +
      `${r.renderMs.toFixed(1).padStart(9)}`,
  );
}

const perAdvance = cold
  .filter(r => r.advances > 50)
  .map(r => r.seekMs / r.advances);
console.log(
  `\n  mean cost per generator advance: ${(
    perAdvance.reduce((a, b) => a + b, 0) / perAdvance.length
  ).toFixed(3)} ms/frame`,
);

// Is seek cost scoped to the scene or to the whole deck?
console.log('\n-- SCOPING: does a late-scene seek replay earlier scenes? --');
const deep = cold[cold.length - 1];
console.log(`  absolute frame ${deep.frame}, but only ${deep.advances} advances`);
console.log(`  heavy scene firstFrame = ${heavy.first}`);
console.log(
  `  => replay is scoped to ${deep.advances === deep.frame - heavy.first ? 'THE CURRENT SCENE' : 'SOMETHING ELSE'}`,
);

await browser.close();
