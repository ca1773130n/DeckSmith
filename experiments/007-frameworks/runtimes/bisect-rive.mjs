// Bisect: which construct makes the generated .riv unloadable by the real runtime?
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { RiveFile, hex, PropertyKey } from '@stevysmith/rive-generator';

const dir = new URL('.', import.meta.url).pathname;
const runtime = readFileSync(dir + 'node_modules/@rive-app/canvas/rive.js', 'utf8');
const wasm = readFileSync(dir + 'node_modules/@rive-app/canvas/rive.wasm');

const cases = {
  'artboard-only': () => {
    const r = new RiveFile();
    r.addArtboard({ name: 'A', width: 400, height: 400 });
    return r;
  },
  'artboard+shape': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'A', width: 400, height: 400 });
    r.addShape(a, { name: 'S', x: 200, y: 200 });
    return r;
  },
  'shape+ellipse': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'A', width: 400, height: 400 });
    const s = r.addShape(a, { name: 'S', x: 200, y: 200 });
    r.addEllipse(s, { width: 100, height: 100 });
    return r;
  },
  'readme-quickstart': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'My Animation', width: 400, height: 400 });
    const s = r.addShape(a, { name: 'Circle', x: 200, y: 200 });
    r.addEllipse(s, { width: 100, height: 100 });
    const f = r.addFill(s);
    r.addSolidColor(f, hex('#3498db'));
    return r;
  },
  'readme-animation': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'Pulse', width: 200, height: 200 });
    const s = r.addShape(a, { name: 'Circle', x: 100, y: 100 });
    r.addEllipse(s, { width: 50, height: 50 });
    const f = r.addFill(s);
    r.addSolidColor(f, hex('#e74c3c'));
    const an = r.addLinearAnimation(a, { name: 'pulse', fps: 60, duration: 60, loop: 'pingPong' });
    const ko = r.addKeyedObject(an, s);
    for (const key of [PropertyKey.scaleX, PropertyKey.scaleY]) {
      const kp = r.addKeyedProperty(ko, key);
      r.addKeyFrameDouble(kp, { frame: 0, value: 1.0, interpolation: 'cubic' });
      r.addKeyFrameDouble(kp, { frame: 30, value: 1.2, interpolation: 'cubic' });
      r.addKeyFrameDouble(kp, { frame: 60, value: 1.0, interpolation: 'cubic' });
    }
    return r;
  },
  'rect-fill': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'A', width: 1920, height: 1080 });
    const s = r.addShape(a, { name: 'S', x: 200, y: 400 });
    r.addRectangle(s, { width: 900, height: 90 });
    const f = r.addFill(s); r.addSolidColor(f, hex('#3498db'));
    return r;
  },
  'three-shapes': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'A', width: 1920, height: 1080 });
    for (let i = 0; i < 3; i++) {
      const s = r.addShape(a, { name: 'bar' + i, x: 200, y: 400 + i * 160 });
      r.addRectangle(s, { width: 900, height: 90 });
      const f = r.addFill(s); r.addSolidColor(f, hex('#3498db'));
    }
    return r;
  },
  'anim-x-one-target': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'A', width: 1920, height: 1080 });
    const s = r.addShape(a, { name: 'bar0', x: 200, y: 400 });
    r.addRectangle(s, { width: 900, height: 90 });
    const f = r.addFill(s); r.addSolidColor(f, hex('#3498db'));
    const an = r.addLinearAnimation(a, { name: 'reveal', fps: 60, duration: 120, loop: 'oneShot' });
    const ko = r.addKeyedObject(an, s);
    const kx = r.addKeyedProperty(ko, PropertyKey.x);
    r.addKeyFrameDouble(kx, { frame: 0, value: -900, interpolation: 'cubic' });
    r.addKeyFrameDouble(kx, { frame: 40, value: 200, interpolation: 'cubic' });
    return r;
  },
  'anim-x-three-targets': () => {
    const r = new RiveFile();
    const a = r.addArtboard({ name: 'A', width: 1920, height: 1080 });
    const shapes = [];
    for (let i = 0; i < 3; i++) {
      const s = r.addShape(a, { name: 'bar' + i, x: 200, y: 400 + i * 160 });
      r.addRectangle(s, { width: 900, height: 90 });
      const f = r.addFill(s); r.addSolidColor(f, hex('#3498db'));
      shapes.push(s);
    }
    const an = r.addLinearAnimation(a, { name: 'reveal', fps: 60, duration: 120, loop: 'oneShot' });
    shapes.forEach((s, i) => {
      const ko = r.addKeyedObject(an, s);
      const kx = r.addKeyedProperty(ko, PropertyKey.x);
      r.addKeyFrameDouble(kx, { frame: i * 20, value: -900, interpolation: 'cubic' });
      r.addKeyFrameDouble(kx, { frame: i * 20 + 40, value: 200, interpolation: 'cubic' });
    });
    return r;
  },
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--headless=new'],
});
const page = await browser.newPage();
await page.setContent(`<canvas id="c" width="400" height="400"></canvas><script>${runtime}</script>`);
await page.evaluate((w) => {
  const wasm = Uint8Array.from(atob(w), (c) => c.charCodeAt(0));
  window.rive.RuntimeLoader.setWasmUrl(URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })));
}, wasm.toString('base64'));

for (const [name, build] of Object.entries(cases)) {
  const bytes = Buffer.from(build().export());
  writeFileSync(`${dir}out/bisect-${name}.riv`, bytes);
  const res = await page.evaluate(
    (b64) =>
      new Promise((resolve) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const r = new window.rive.Rive({
          buffer: bytes.buffer,
          canvas: document.getElementById('c'),
          autoplay: false,
          onLoad: () => resolve('LOAD OK anims=' + JSON.stringify(r.animationNames)),
          onLoadError: () => resolve('LOAD FAIL'),
        });
        setTimeout(() => resolve('timeout'), 4000);
      }),
    bytes.toString('base64'),
  );
  console.log(`${name.padEnd(20)} ${String(bytes.length).padStart(5)}B  ${res}`);
}
await browser.close();
