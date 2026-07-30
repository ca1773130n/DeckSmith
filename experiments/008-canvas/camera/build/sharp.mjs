/**
 * Does the camera cost text sharpness?
 *
 * Variant A puts the grid plate through `scale(0.2)` and then views it at
 * camera scale 4.994 — a net 1.0, but only if Chrome re-rasterises the layer at
 * the composited scale rather than caching a 0.2x raster and blowing it up.
 * Variant B does the same through an SVG viewBox. The baseline does neither.
 *
 * Metric: crop the same headline in all three, then in-page compute
 *   edge  — mean |dL/dx| over the crop, normalised. A sharper glyph edge has a
 *           higher peak gradient because the same contrast is crossed in fewer
 *           pixels.
 *   band  — the fraction of pixels sitting strictly between background and
 *           foreground luminance. A blurred glyph has a wider anti-alias band,
 *           so this number goes UP with blur.
 * Both are computed from the actual captured PNG, not from a claim about it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE, OUT } from "./common.mjs";
import { open, loadComp } from "./browser.mjs";

const shots = join(HERE, "..", "shots");
await mkdir(shots, { recursive: true });

const CASES = [
  { project: "baseline", t: 13.85, sel: "#s2-h" },
  { project: "dom", t: 14.55, sel: "#s2-h" },
  { project: "viewbox", t: 14.55, sel: "#s2-h" },
];

const crops = [];
for (const c of CASES) {
  const { browser, page } = await open();
  await loadComp(page, pathToFileURL(join(OUT, c.project, "index.html")).href);
  const rect = await page.evaluate(
    ([t, sel]) => {
      for (const [k, tl] of Object.entries(window.__timelines)) {
        const el = document.querySelector(`[data-composition-id="${k}"]`);
        const start = Number(el?.getAttribute("data-start") ?? 0);
        tl.seek(Math.max(0, t - start));
      }
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    },
    [c.t, c.sel],
  );
  // A fixed crop so all three cover the same glyphs at the same pixel count.
  const clip = { x: rect.x, y: rect.y, width: 900, height: 80 };
  const buf = await page.screenshot({ clip });
  await writeFile(join(shots, `sharp-${c.project}.png`), buf);
  crops.push({ ...c, rect, b64: buf.toString("base64") });
  await browser.close();
}

// One page, three data URIs, one canvas each.
const { browser, page } = await open({ width: 1000, height: 200 });
await page.goto("about:blank");
const stats = await page.evaluate(async (items) => {
  const out = [];
  for (const it of items) {
    const img = new Image();
    img.src = `data:image/png;base64,${it.b64}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const lum = new Float64Array(cv.width * cv.height);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    }
    let lo = 255;
    let hi = 0;
    for (const v of lum) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    let grad = 0;
    let peak = 0;
    let n = 0;
    let band = 0;
    let ink = 0;
    const loT = lo + (hi - lo) * 0.15;
    const hiT = lo + (hi - lo) * 0.85;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 1; x < cv.width; x++) {
        const g = Math.abs(lum[y * cv.width + x] - lum[y * cv.width + x - 1]);
        grad += g;
        if (g > peak) peak = g;
        n++;
      }
    }
    for (const v of lum) {
      if (v > loT && v < hiT) band++;
      if (v > loT) ink++;
    }
    out.push({
      project: it.project,
      size: `${cv.width}x${cv.height}`,
      contrast: Math.round(hi - lo),
      meanGradient: Math.round((grad / n) * 100) / 100,
      peakGradient: Math.round(peak),
      antiAliasBandPct: Math.round((band / lum.length) * 10000) / 100,
      inkPct: Math.round((ink / lum.length) * 10000) / 100,
      bandPerInk: Math.round((band / Math.max(1, ink)) * 1000) / 1000,
    });
  }
  return out;
}, crops.map(({ project, b64 }) => ({ project, b64 })));
await browser.close();

console.log(JSON.stringify({ crops: crops.map((c) => ({ project: c.project, rect: c.rect })), stats }, null, 1));
