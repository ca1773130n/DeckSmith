/**
 * Read the world rects of the pipeline stage boxes out of the baseline render.
 * Plate A sits at world (0,0) at scale 1, so an element's rect inside a plain
 * 1920x1080 scene IS its world rect.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE, OUT } from "./common.mjs";
import { open, loadComp } from "./browser.mjs";

const { browser, page } = await open();
await loadComp(page, pathToFileURL(join(OUT, "baseline", "index.html")).href);
await page.evaluate("window.__timelines.s1.seek(8)");

const rects = await page.evaluate(() => {
  const out = {};
  for (const part of ["stage0", "stage1", "stage2", "stage3"]) {
    const el = document.getElementById(`s1-${part}`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out[part] = {
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
    };
  }
  return out;
});
await browser.close();

await writeFile(join(HERE, "anchors.json"), `${JSON.stringify(rects, null, 2)}\n`);
console.log(JSON.stringify(rects, null, 1));
