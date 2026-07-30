// Spike: is the native Web Animations API seekable and deterministic enough to
// stand where GSAP stands? Zero bytes, no license, but WAAPI commits on the
// compositor — the question is whether `currentTime = t` is visible to a
// screenshot taken immediately after.
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const html = `<style>html,body{margin:0;background:#0b1020;overflow:hidden}
.bar{position:absolute;left:0;width:600px;height:84px;border-radius:12px}
#b0{top:220px;background:#3498db}#b1{top:340px;background:#e74c3c}#b2{top:460px;background:#2ecc71}
h1{position:absolute;top:60px;left:60px;color:#fff;font:700 72px Helvetica;margin:0}</style>
<h1 id="t">Backpropagation</h1>
<div class="bar" id="b0"></div><div class="bar" id="b1"></div><div class="bar" id="b2"></div>
<script>
window.__anims = [];
function A(sel, kf, opts){ const a = document.querySelector(sel).animate(kf, Object.assign({fill:'both'}, opts)); a.pause(); window.__anims.push(a); return a; }
A('#t', [{opacity:0, transform:'translateY(40px)'},{opacity:1, transform:'translateY(0)'}], {duration:600, delay:0, easing:'cubic-bezier(.16,1,.3,1)'});
[0,1,2].forEach(function(i){
  A('#b'+i, [{transform:'translateX(-700px)'},{transform:'translateX(60px)'}], {duration:600, delay:300+i*300, easing:'cubic-bezier(.16,1,.3,1)'});
});
// the "timeline seek" primitive: set every animation to the same absolute time
window.__seek = function(ms){ window.__anims.forEach(function(a){ a.currentTime = ms; }); };
</script>`;

async function pass(settle) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--headless=new', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const shots = [];
  for (const ms of [0, 300, 700, 1100, 1500, 2000]) {
    await page.evaluate((ms) => window.__seek(ms), ms);
    if (settle) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const buf = await page.screenshot({ type: 'png' });
    shots.push(`${ms}:${createHash('sha256').update(buf).digest('hex').slice(0, 12)}`);
  }
  await browser.close();
  return shots;
}

for (const settle of [false, true]) {
  const a = await pass(settle);
  const b = await pass(settle);
  console.log(`settle=${settle}`);
  console.log('  A', a.join(' '));
  console.log('  B', b.join(' '));
  console.log(`  deterministic=${a.join() === b.join()} distinct=${new Set(a.map((s) => s.split(':')[1])).size}/6`);
}
