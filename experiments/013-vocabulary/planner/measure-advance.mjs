/**
 * Measure the deck font's mean advance per character, so the text-overflow
 * check in coherence.mjs rests on a measurement rather than a guess.
 *
 * Renders every text string the pilot composition produced, at its own fontPx,
 * in the theme's actual font (Inter, from experiments/007-frameworks), and
 * divides measured width by (chars * fontPx).
 *
 *   node measure-advance.mjs <path-to-composition.json>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const FONT = join(ROOT, "experiments", "007-frameworks", "runtimes", "out", "inter-0.ttf");

const comp = JSON.parse(readFileSync(process.argv[2], "utf8"));
const samples = [];
for (const sc of comp.scenes)
  for (const o of sc.objects)
    if (o.kind === "text" && o.text) samples.push({ text: o.text, px: o.fontPx ?? 48 });

const fontB64 = readFileSync(FONT).toString("base64");
const dir = mkdtempSync(join(tmpdir(), "ds-measure-"));
const page = join(dir, "m.html");
writeFileSync(
  page,
  `<!doctype html><meta charset="utf-8">
<style>
@font-face{font-family:Inter;src:url(data:font/ttf;base64,${fontB64}) format("truetype");}
body{margin:0}
span{font-family:Inter,system-ui,sans-serif;white-space:pre;position:absolute;visibility:hidden}
</style>
<body><pre id="out"></pre><script>
const S = ${JSON.stringify(samples)};
const rows = S.map(s => {
  const el = document.createElement("span");
  el.style.fontSize = s.px + "px";
  el.textContent = s.text;
  document.body.appendChild(el);
  const w = el.getBoundingClientRect().width;
  return { text: s.text, px: s.px, w, emPerChar: w / (s.text.length * s.px) };
});
document.fonts.ready.then(() => {
  const rows2 = S.map((s, i) => {
    const el = document.querySelectorAll("span")[i];
    const w = el.getBoundingClientRect().width;
    return { text: s.text, px: s.px, w: +w.toFixed(1), emPerChar: +(w / (s.text.length * s.px)).toFixed(4) };
  });
  const m = rows2.map(r => r.emPerChar).sort((a,b)=>a-b);
  document.getElementById("out").textContent = JSON.stringify({
    n: m.length,
    mean: +(m.reduce((a,b)=>a+b,0)/m.length).toFixed(4),
    median: m[m.length>>1],
    min: m[0], max: m[m.length-1],
    rows: rows2,
  }, null, 1);
  document.title = "ready";
});
void rows;
</script>`,
);
console.log(page);
void execFileSync;
