// Type sizes in a built composition, as a PERCENTAGE OF CANVAS WIDTH.
//
// Percent-of-width is the unit the complaint was made in: "it looks having a bit
// big fontsize considering the screen's aspect ratio". An absolute px number
// cannot answer that, because the same 76px is 3.96% of a 1920 canvas and 7.04%
// of a 1080 one. Reading the emitted document rather than the source constants
// is deliberate — half the sizes in a slide are solved for at emit time by
// `fitBoxes` and never appear as a literal anywhere.
//
// Counts INK-BEARING declarations only: an SVG `font-size` attribute or a
// `font-size:` in a style attribute or stylesheet rule that some element uses.
// It does not weight by how much text is set at each size, so read the
// distribution, not the mean.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const html = readFileSync(file, "utf8");
const w = Number(/data-width="(\d+)"/.exec(html)?.[1] ?? 1920);

// Reference space: sizes in the document are reference px, and `.scene.clip`
// scales the whole scene onto the canvas. A size read off the document is
// therefore not a canvas px until it has been through this.
const zoom = Number(/\.scene \{[^}]*zoom: ([\d.]+)/.exec(html)?.[1] ?? 1);

const sizes = [];
for (const m of html.matchAll(/font-size(?::\s*|=")(\d+(?:\.\d+)?)(?:px)?/g)) {
  sizes.push(Number(m[1]) * zoom);
}
sizes.sort((a, b) => a - b);
const pct = (s) => ((s / w) * 100).toFixed(2);
const q = (p) => sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))];

const uniq = [...new Set(sizes)];
console.log(
  `${file}  canvas ${w}px  scene zoom ${zoom}  ${sizes.length} font-size declarations`,
);
console.log(`  min    ${sizes[0]}px = ${pct(sizes[0])}% of width`);
console.log(`  p25    ${q(0.25)}px = ${pct(q(0.25))}%`);
console.log(`  median ${q(0.5)}px = ${pct(q(0.5))}%`);
console.log(`  p75    ${q(0.75)}px = ${pct(q(0.75))}%`);
console.log(`  max    ${sizes.at(-1)}px = ${pct(sizes.at(-1))}%`);
console.log(`  distinct: ${uniq.map((s) => `${s}(${pct(s)}%)`).join(" ")}`);
