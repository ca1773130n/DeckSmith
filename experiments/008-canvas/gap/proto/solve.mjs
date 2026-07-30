/**
 * Solve the match-cut numerically, in the browser, against the real DOM.
 *
 * Everything here is arithmetic an emitter can do at build time — the only
 * reason it runs in a browser is that I would otherwise be asserting the page
 * geometry instead of measuring it.
 */
import { open } from "../drive.mjs";

const { browser, page, frame } = await open("http://127.0.0.1:8138/p3-matchcut.html");

const out = await page.evaluate(async () => {
  const go = window.__go;
  // 1. where does s2's DQ-CTM box sit on screen at the held stop?
  go("s2", 6.6);
  await new Promise((r) => requestAnimationFrame(r));
  const t = document.querySelector("#s2-stage2 rect").getBoundingClientRect();

  // 2. s3's plate: authored rect, and the img's base geometry
  go("s3", 8);
  await new Promise((r) => requestAnimationFrame(r));
  const plateEl = document.getElementById("s3-plate");
  const img = plateEl.querySelector("img");
  const prev = img.style.transform;
  img.style.transform = "none";
  const p = plateEl.getBoundingClientRect();
  const cs = getComputedStyle(img);
  const base = {
    left: parseFloat(cs.left),
    top: parseFloat(cs.top),
    w: parseFloat(cs.width),
    h: parseFloat(cs.height),
  };
  img.style.transform = prev;
  const plateCs = getComputedStyle(plateEl);
  return {
    target: { x: t.x, y: t.y, w: t.width, h: t.height },
    plate: { x: p.x, y: p.y, w: p.width, h: p.height,
             cssLeft: parseFloat(plateCs.left), cssTop: parseFloat(plateCs.top) },
    base,
    pad: parseFloat(plateCs.paddingLeft),
  };
});

// The figure's own DQ-CTM block, normalised on fig-compare.jpg (1373x692).
const F = { x: 0.45, y: 0.671, w: 0.127, h: 0.258 };

const { target, plate, base, pad } = out;
// The plate must BECOME the target rect, so the figure's block fills it.
const k = target.w / (F.w * base.w);
// plate-local position of the figure block's top-left, after scaling by k
const bx = base.left + k * F.x * base.w;
const by = base.top + k * F.y * base.h;
// we want that at (pad, pad) of the target-shaped plate
const dx = pad - bx;
const dy = pad - by;

console.log(JSON.stringify({ measured: out, solved: { k, dx, dy,
  plateFrom: { left: plate.cssLeft + (target.x - plate.x), top: plate.cssTop + (target.y - plate.y), w: target.w, h: target.h },
} }, null, 1));

await browser.close();
