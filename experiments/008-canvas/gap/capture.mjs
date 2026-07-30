import { open, OUT } from "./drive.mjs";

const { browser, page } = await open("http://127.0.0.1:8137/deck.html");

const stops = await page.evaluate(() => {
  const el = document.querySelector('script[type="application/hyperframes-slideshow+json"]');
  const slides = JSON.parse(el.textContent).slides;
  const out = [];
  for (const s of slides) {
    const frags = [...new Set(s.fragments ?? [])]
      .filter((t) => t > s.startTime && t <= s.endTime)
      .sort((a, b) => a - b);
    const [landing, ...rest] = frags;
    out.push({ t: landing ?? s.startTime, slide: out.length ? out.at(-1).slide + 1 : 0, frag: 0, sid: s.sceneId });
    rest.forEach((t, i) => out.push({ t, slide: out.at(-1).slide, frag: i + 1, sid: s.sceneId }));
  }
  return out;
});
console.log("stops:", stops.length);
console.log(stops.map((s) => `${s.slide + 1}.${s.frag} t=${s.t.toFixed(2)} ${s.sid}`).join("\n"));

// 1. every stop, settled
await page.waitForTimeout(600);
for (let i = 0; i < stops.length; i++) {
  const s = stops[i];
  const label = `${String(s.slide + 1).padStart(2, "0")}-${s.frag}`;
  await page.evaluate((h) => { location.hash = h; }, s.frag ? `#${s.slide + 1}.${s.frag}` : `#${s.slide + 1}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/stop-${label}.png` });
}
console.log("wrote", stops.length, "stop shots");

// 2. transition strips — boundary (slide N last frag -> slide N+1) and intra-slide
async function strip(fromHash, key, name, n = 10, every = 45) {
  await page.evaluate((h) => { location.hash = h; }, fromHash);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/tr-${name}-000.png` });
  const t0 = Date.now();
  await page.keyboard.press(key);
  for (let i = 1; i <= n; i++) {
    await page.waitForTimeout(every);
    await page.screenshot({ path: `${OUT}/tr-${name}-${String(Date.now() - t0).padStart(3, "0")}.png` });
  }
}
// slide 2 -> slide 3 boundary: go to last fragment of slide 2 then step
const s2 = stops.filter((s) => s.sid === "s2").at(-1);
await strip(`#${s2.slide + 1}.${s2.frag}`, "ArrowRight", "boundary-s2-s3");
// intra-slide: slide 2 fragment 0 -> 1
await strip("#2", "ArrowRight", "intra-s2-f0-f1");
// backward across a boundary
await strip("#3", "ArrowLeft", "back-s3-s2");

await browser.close();
console.log("done");
