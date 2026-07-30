import { writeFile, mkdir } from "node:fs/promises";
const V = "3.14.2";
const files = [
  ["gsap.min.js", `https://cdn.jsdelivr.net/npm/gsap@${V}/dist/gsap.min.js`],
  ["MorphSVGPlugin.min.js", `https://cdn.jsdelivr.net/npm/gsap@${V}/dist/MorphSVGPlugin.min.js`],
  ["MotionPathPlugin.min.js", `https://cdn.jsdelivr.net/npm/gsap@${V}/dist/MotionPathPlugin.min.js`],
  ["DrawSVGPlugin.min.js", `https://cdn.jsdelivr.net/npm/gsap@${V}/dist/DrawSVGPlugin.min.js`],
];
await mkdir(new URL("./vendor/", import.meta.url), { recursive: true });
for (const [name, url] of files) {
  const r = await globalThis.fetch(url);
  if (!r.ok) { console.log(`${name}\tHTTP ${r.status}`); continue; }
  const b = Buffer.from(await r.arrayBuffer());
  await writeFile(new URL(`./vendor/${name}`, import.meta.url), b);
  console.log(`${name}\t${b.length} bytes`);
}
