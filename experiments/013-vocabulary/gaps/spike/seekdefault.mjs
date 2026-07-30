/** Does bare `tl.seek(t)` — what src/deck/runtime.ts calls — suppress events? */
import { launch } from "puppeteer-core";
import { readdir } from "node:fs/promises";
const chromeDir = `${process.env.HOME}/.cache/puppeteer/chrome`;
const [ver] = await readdir(chromeDir);
const browser = await launch({
  executablePath: `${chromeDir}/${ver}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`file://${process.cwd()}/index.html`, { waitUntil: "networkidle0" });
const r = await page.evaluate(() => {
  const tl = window.__timelines.main;
  const y = (id) => /L 90 ([\d.-]+)/.exec(document.getElementById(id).getAttribute("d") || "")?.[1];
  const out = [];
  for (const t of [0, 2, 4]) {
    tl.pause();
    tl.seek(t); // exactly what the deck runtime does
    out.push({ t, plugin: y("c10"), onUpdate: y("c11") });
  }
  return out;
});
console.log("bare tl.seek(t) — no second argument:");
for (const row of r) console.log(` t=${row.t}  plugin d=${row.plugin}  onUpdate d=${row.onUpdate}`);
await browser.close();
