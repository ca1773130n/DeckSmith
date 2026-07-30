// Spike: load a PROGRAM-GENERATED .riv in the real Rive runtime, seek to absolute
// times, and hash the pixels. Run twice to measure determinism.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH;
const dir = new URL('.', import.meta.url).pathname;
const riv = readFileSync(dir + (process.env.RIV || 'out/beat.riv'));
const runtime = readFileSync(dir + 'node_modules/@rive-app/canvas/rive.js', 'utf8');
const wasm = readFileSync(dir + 'node_modules/@rive-app/canvas/rive.wasm');

const html = `<canvas id="c" width="960" height="540"></canvas><script>${runtime}</script>`;

async function pass(label) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-lcd-text'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  page.on('console', (m) => process.env.VERBOSE && console.log('  [page]', m.text().slice(0, 200)));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('data:') && !u.startsWith('blob:')) console.log('  [net]', u.slice(0, 120));
  });
  const result = await page.evaluate(async (b64, wasmB64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wasm = Uint8Array.from(atob(wasmB64), (c) => c.charCodeAt(0));
    const R = window.rive;
    window.__anim = undefined;
    // Self-host the wasm: by default the runtime FETCHES it from unpkg.com at
    // render time, which breaks the offline/self-contained invariant.
    R.RuntimeLoader.setWasmUrl(URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })));
    const api = Object.keys(R).slice(0, 40);
    return await new Promise((resolve) => {
      let r;
      const t0 = Date.now();
      try {
        r = window.__r = new R.Rive({
          buffer: bytes.buffer,
          canvas: document.getElementById('c'),
          autoplay: false,
          animations: window.__anim,
          onLoad: () => resolve({ ok: true, api, anims: r.animationNames, hasScrub: typeof r.scrub === 'function', ms: Date.now() - t0 }),
          onLoadError: (e) => resolve({ ok: false, api, err: (e && (e.data || e.message)) ? JSON.stringify(e.data || e.message) : String(e) }),
        });
      } catch (e) {
        resolve({ ok: false, api, err: String(e) });
      }
      setTimeout(() => resolve({ ok: false, api, err: 'timeout' }), 5000);
    });
  }, riv.toString('base64'), wasm.toString('base64'));

  if (!result.ok) {
    await browser.close();
    return { result, shots: [] };
  }

  const shots = [];
  for (const t of [0.0, 0.5, 1.0, 1.5]) {
    // absolute seek: scrubTo is an absolute time in seconds on the linear timeline
    await page.evaluate((t) => window.__r.scrub(window.__r.animationNames[0], t), t).catch(() => {});
    await new Promise((r) => setTimeout(r, 120));
    const buf = await page.screenshot({ type: 'png' });
    shots.push({ t, hash: createHash('sha256').update(buf).digest('hex').slice(0, 16), bytes: buf.length });
    writeFileSync(`${dir}out/rive-${label}-${t}.png`, buf);
  }
  await browser.close();
  return { result, shots };
}

const a = await pass('a');
console.log('load:', JSON.stringify(a.result));
if (a.result.ok) {
  const b = await pass('b');
  console.log('A', a.shots.map((s) => `${s.t}:${s.hash}`).join(' '));
  console.log('B', b.shots.map((s) => `${s.t}:${s.hash}`).join(' '));
  const identical = a.shots.every((s, i) => s.hash === b.shots[i].hash);
  const distinct = new Set(a.shots.map((s) => s.hash)).size;
  console.log(`deterministic=${identical} distinctFrames=${distinct}/4`);
}
