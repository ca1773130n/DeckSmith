// Spike: does Lottie fit behind Scene { html, tl, setup, holds } unchanged?
// setup[] loads the animation; tl[] is ordinary GSAP fromTo statement TEXT that
// drives goToAndStop through a proxy object. Then we seek the GSAP timeline the
// way src/deck/runtime.ts and HyperFrames do, and check the pixels.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const dir = new URL('.', import.meta.url).pathname;
const player = readFileSync(dir + 'node_modules/lottie-web/build/player/lottie_svg.min.js', 'utf8');
const gsap = readFileSync(dir + 'node_modules/gsap/dist/gsap.min.js', 'utf8');
const data = readFileSync(dir + 'out/beat.json', 'utf8');

// ---- what an emitter would return -------------------------------------------
const scene = {
  html: `<div id="s1-lottie" style="width:960px;height:540px"></div>`,
  setup: [
    `window.__lot = lottie.loadAnimation({ container: document.querySelector('#s1-lottie'), renderer: 'svg', loop: false, autoplay: false, animationData: window.__beat });`,
    `window.__lotProxy = { f: 0 };`,
  ],
  tl: [
    `tl.fromTo(window.__lotProxy, { f: 0 }, { f: 240, duration: 4, ease: 'none', onUpdate: function () { window.__lot.goToAndStop(window.__lotProxy.f, true); } }, 0);`,
  ],
  holds: [0, 1, 2, 3],
};
// -----------------------------------------------------------------------------

const html = `<style>html,body{margin:0;background:#0b1020}</style>${scene.html}
<script>${player}</script><script>${gsap}</script>
<script>window.__beat = ${data};</script>
<script>
${scene.setup.join('\n')}
var tl = gsap.timeline({ paused: true });
${scene.tl.join('\n')}
window.__timelines = { s1: tl };
</script>`;

async function pass() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--headless=new', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
  page.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text().slice(0, 300)));
  await page.setContent(html, { waitUntil: 'load' });
  const probe = await page.evaluate(() => ({ lottie: typeof window.lottie, gsap: typeof window.gsap, lot: typeof window.__lot, tls: typeof window.__timelines }));
  console.log('  probe', JSON.stringify(probe));
  const shots = [];
  for (const t of [0, 0.5, 1, 2, 3, 4]) {
    // exactly what HyperFrames capture does
    await page.evaluate((t) => {
      window.__timelines.s1.seek(t, false);
    }, t);
    const buf = await page.screenshot({ type: 'png' });
    shots.push(`${t}:${createHash('sha256').update(buf).digest('hex').slice(0, 12)}`);
  }
  await browser.close();
  return shots;
}
const a = await pass();
const b = await pass();
console.log('A', a.join(' '));
console.log('B', b.join(' '));
console.log('seam works, deterministic =', a.join() === b.join(), '| distinct =', new Set(a.map((s) => s.split(':')[1])).size, '/6');
