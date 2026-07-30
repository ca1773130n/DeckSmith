// Spike: seek + determinism for a PROGRAM-GENERATED Lottie, via lottie-web.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const dir = new URL('.', import.meta.url).pathname;
const player = readFileSync(dir + `node_modules/lottie-web/build/player/${process.env.BUILD || 'lottie_svg.min.js'}`, 'utf8');
const data = readFileSync(dir + 'out/beat.json', 'utf8');
const FRAMES = [0, 30, 60, 90, 120, 180];

const html = `<style>html,body{margin:0;background:#0b1020}#c{width:960px;height:540px}</style>
<div id="c"></div><script>${player}</script>`;

async function pass(label) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--headless=new', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  const net = [];
  page.on('request', (r) => { if (!r.url().startsWith('data:')) net.push(r.url()); });
  await page.setContent(html, { waitUntil: 'load' });
  const info = await page.evaluate((d) => {
    window.__a = window.lottie.loadAnimation({
      container: document.getElementById('c'),
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: JSON.parse(d),
    });
    return { totalFrames: window.__a.totalFrames, hasGoToAndStop: typeof window.__a.goToAndStop === 'function' };
  }, data);

  const shots = [];
  for (const f of FRAMES) {
    // THE seek call. isFrame=true => absolute frame index, no wall clock involved.
    await page.evaluate((f) => window.__a.goToAndStop(f, true), f);
    const buf = await page.screenshot({ type: 'png' });
    shots.push({ f, hash: createHash('sha256').update(buf).digest('hex').slice(0, 16) });
    if (label === 'a') writeFileSync(`${dir}out/lottie-${f}.png`, buf);
  }
  // seek OUT OF ORDER on a fresh instance state to prove path-independence
  const backwards = [];
  for (const f of [...FRAMES].reverse()) {
    await page.evaluate((f) => window.__a.goToAndStop(f, true), f);
    const buf = await page.screenshot({ type: 'png' });
    backwards.push({ f, hash: createHash('sha256').update(buf).digest('hex').slice(0, 16) });
  }
  await browser.close();
  return { info, shots, backwards, net };
}

const a = await pass('a');
const b = await pass('b');
console.log('info:', JSON.stringify(a.info), 'network requests at render time:', a.net.length);
console.log('A   ', a.shots.map((s) => `${s.f}:${s.hash}`).join(' '));
console.log('B   ', b.shots.map((s) => `${s.f}:${s.hash}`).join(' '));
const rev = [...a.backwards].reverse();
console.log('Arev', rev.map((s) => `${s.f}:${s.hash}`).join(' '));
console.log('cross-process deterministic =', a.shots.every((s, i) => s.hash === b.shots[i].hash));
console.log('seek path-independent       =', a.shots.every((s, i) => s.hash === rev[i].hash));
console.log('distinct frames             =', new Set(a.shots.map((s) => s.hash)).size, '/', FRAMES.length);
