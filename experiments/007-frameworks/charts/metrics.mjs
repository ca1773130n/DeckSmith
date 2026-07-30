// Do the SSR libraries lay out text correctly at 40px in OUR font?
// They estimate glyph widths in Node (no canvas / no font files). Measure the
// gap between what they reserved and what the browser actually paints.
import { chromium } from "playwright-core";
import { homedir } from "node:os";

const EXE = `${homedir()}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const rows = [];
for (const k of ["A", "B", "C"]) {
  await page.goto(`file://${process.cwd()}/out/slide-${k}.html`);
  await page.evaluate("window.__seek(window.__dur)");
  const r = await page.evaluate(() => {
    const scene = document.querySelector(".scene");
    const svg = scene.querySelector("svg");
    const sb = svg.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, tiny = 0, n = 0;
    for (const t of svg.querySelectorAll("text")) {
      const b = t.getBoundingClientRect();
      if (!b.width) continue;
      n++;
      const fs = parseFloat(getComputedStyle(t).fontSize);
      if (fs < 40) tiny++;
      minX = Math.min(minX, b.left); maxX = Math.max(maxX, b.right);
      minY = Math.min(minY, b.top); maxY = Math.max(maxY, b.bottom);
    }
    // pairwise text overlap inside the svg
    const boxes = [...svg.querySelectorAll("text")].map((t) => t.getBoundingClientRect()).filter((b) => b.width);
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) overlaps++;
      }
    return {
      texts: n,
      belowFloor: tiny,
      overflowLeft: +(sb.left - minX).toFixed(1),
      overflowRight: +(maxX - sb.right).toFixed(1),
      overflowTop: +(sb.top - minY).toFixed(1),
      overflowBottom: +(maxY - sb.bottom).toFixed(1),
      textOverlaps: overlaps,
    };
  });
  rows.push({ slide: k, ...r });
}
console.table(rows);
await browser.close();
