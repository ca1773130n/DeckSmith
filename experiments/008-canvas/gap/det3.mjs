/** The decisive control: is the UNPATCHED slide bistable at the same times? */
import { createHash } from "node:crypto";
import { open } from "./drive.mjs";

const N = 4;
async function hashes(file, sid, t) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const { browser, page } = await open(`http://127.0.0.1:8138/${file}`);
    await page.waitForTimeout(900);
    await page.evaluate(([s, tt]) => window.__go(s, tt), [sid, t]);
    await page.waitForTimeout(320);
    out.push(createHash("sha256").update(await page.screenshot()).digest("hex").slice(0, 12));
    await browser.close();
  }
  return out;
}
for (const [file, sid, t, note] of [
  ["p0-control.html", "s3", 5.8, "UNPATCHED slide with the paper figure"],
  ["p2-morph.html", "s3", 5.8, "same slide + figure morph"],
  ["p0-control.html", "s2", 6.4, "UNPATCHED slide, no raster"],
  ["p1-camera.html", "s2", 6.4, "same slide + camera"],
]) {
  const h = await hashes(file, sid, t);
  console.log(`${new Set(h).size} distinct / ${N}  ${file} ${sid} t=${t}  — ${note}`);
  console.log("   ", h.join(" "));
}
