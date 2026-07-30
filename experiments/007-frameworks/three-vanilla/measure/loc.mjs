/** Lines of code to express the SAME animation, comments and blanks excluded. */
import { readFileSync } from "node:fs";

const strip = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//")).length;

const src = readFileSync("src/three-scenes.mjs", "utf8");
const slice = (from, to) => src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined);

const rows = [
  ["vanilla: cloud scene", strip(slice("function cloud(", "layers --- */"))],
  ["vanilla: layers scene", strip(slice("function layers(", "surface --- */"))],
  ["vanilla: surface scene", strip(slice("function surface(", "const KINDS ="))],
  ["vanilla: shared helpers (reactive/renderer/lights/project/labels)", strip(slice("function reactive(", "/* ---------------------------------------------------------------- cloud"))],
  ["vanilla: whole runtime (3 scenes)", strip(src)],
  ["vanilla: emitter (emit.mjs, incl. 3 beats of data)", strip(readFileSync("emit.mjs", "utf8"))],
  ["r3f+drei: cloud scene only", strip(readFileSync("r3f-baseline/cloud-r3f.jsx", "utf8"))],
  ["r3f+drei+theatre: sphere + keyframe JSON", strip(readFileSync("r3f-baseline/cloud-theatre.jsx", "utf8"))],
];
for (const [k, v] of rows) console.log(String(v).padStart(5), k);
