/**
 * Seek a built deck's timelines to absolute times and capture each frame.
 * Seek only, never play — what lands on disk is what the renderer captures.
 * The clip visibility the engine owns during a render is reproduced here by
 * hand, because a bare page shows every scene stacked.
 *
 *   node experiments/009-camera/shoot.mjs <deckDir> <label> t1 t2 ...
 */
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

const run = promisify(execFile);
const [dir, label, ...times] = process.argv.slice(2);
const shots = resolve("experiments/009-camera/shots");
await mkdir(shots, { recursive: true });

const { stdout } = await run("npx", ["hyperframes", "browser", "path"]);
const browser = await puppeteer.launch({
  executablePath: stdout.trim().split("\n").pop().trim(),
  headless: true,
  args: ["--font-render-hinting=none", "--force-color-profile=srgb", "--hide-scrollbars"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(dir, "index.html")).href, { waitUntil: "networkidle0" });
await page.waitForFunction("window.__timelines && Object.keys(window.__timelines).length > 0");
await page.waitForFunction("window.__hfTimelinesBuilding === false");

for (const raw of times) {
  const t = Number(raw);
  await page.evaluate((tt) => {
    for (const [k, tl] of Object.entries(window.__timelines)) {
      if (k === "main") { tl.seek(tt); continue; }
      const el = document.querySelector(`[data-composition-id="${k}"]`);
      const start = Number(el?.getAttribute("data-start") ?? 0);
      const dur = Number(el?.getAttribute("data-duration") ?? 0);
      el.style.display = tt >= start && tt < start + dur ? "" : "none";
      tl.seek(Math.max(0, tt - start));
    }
  }, t);
  await new Promise((r) => setTimeout(r, 120));
  const name = `${label}-${String(t).replace(".", "_")}.png`;
  await page.screenshot({ path: join(shots, name) });
  console.log(name);
}
await browser.close();
