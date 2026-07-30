/** What the camera actually measured, read back out of the running page. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { open, loadComp } from "./browser.mjs";
const dir = process.argv[2];
const { browser, page } = await open();
await loadComp(page, pathToFileURL(resolve(dir, "index.html")).href);
const out = await page.evaluate(() => {
  const plate = document.querySelector("#s1 .ds-plate").getBoundingClientRect();
  const box = document.getElementById("s1-stage1").getBoundingClientRect();
  const tl = window.__timelines.s1;
  const read = () => {
    const z = getComputedStyle(document.querySelector("#s1 .ds-zoom")).transform;
    const p = getComputedStyle(document.querySelector("#s1 .ds-pan")).transform;
    return { zoom: z, pan: p };
  };
  const before = (tl.seek(8.9), read());
  const mid = (tl.seek(9.7), read());
  const landed = (tl.seek(10.4), read());
  const boxAfter = (document.getElementById("s1-stage1").getBoundingClientRect());
  return { plate: { w: plate.width, h: plate.height }, box: { x: box.x, y: box.y, w: box.width, h: box.height }, before, mid, landed, boxOnScreenAtLanding: { x: boxAfter.x, y: boxAfter.y, w: boxAfter.width, h: boxAfter.height } };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
