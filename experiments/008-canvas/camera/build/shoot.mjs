/**
 * Seek a composition's root timeline to a list of absolute times and capture
 * each frame. Seek only — never play — so what lands on disk is what the
 * renderer would capture at that frame.
 *
 *   node shoot.mjs <project> <label> t1 t2 t3 ...
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE, OUT } from "./common.mjs";
import { open, loadComp } from "./browser.mjs";

const [project, label, ...times] = process.argv.slice(2);
const shots = join(HERE, "..", "shots");
await mkdir(shots, { recursive: true });

const { browser, page } = await open();
await loadComp(page, pathToFileURL(join(OUT, project, "index.html")).href);

const keys = await page.evaluate("Object.keys(window.__timelines)");
for (const raw of times) {
  const t = Number(raw);
  await page.evaluate((tt) => {
    const r = window.__timelines;
    for (const [k, tl] of Object.entries(r)) {
      const el = document.querySelector(`[data-composition-id="${k}"]`);
      const start = Number(el?.getAttribute("data-start") ?? 0);
      tl.seek(Math.max(0, tt - start));
    }
  }, t);
  // One paint after the seek, no timers: the seek is synchronous, this just
  // lets the compositor flush.
  await new Promise((r) => setTimeout(r, 120));
  const name = `${label}-${String(t).replace(".", "_")}.png`;
  await page.screenshot({ path: join(shots, name) });
  console.log(name);
}
console.log("timelines:", keys.join(","));
await browser.close();
