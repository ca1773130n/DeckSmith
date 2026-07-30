/** Consolidated line census: total / code / comment / import / emitter / helpers. */
import { readFileSync, readdirSync } from "node:fs";
import { depths } from "./scan.mjs";

const dir = "/Users/neo/Developer/Projects/DeckSmith/src/emit";
const isC = (l) => /^\s*(\/\*|\*|\/\/)/.test(l);
const isB = (l) => l.trim() === "";

/** Emitter-body code lines, from emitter-split.mjs (structural, same scanner). */
const BODY = {
  "annotated-figure": 136,
  "bar-compare": 251,
  callout: 57,
  "claim-figure": 46,
  "data-table": 85,
  "equation-walk": 97,
  grid: 236,
  "line-chart": 138,
  pipeline: 212,
  "split-compare": 194,
  stack: 98,
  title: 35,
};

function importCode(L) {
  const { delta } = depths(L);
  let n = 0;
  let d = 0;
  let on = false;
  for (let i = 0; i < L.length; i++) {
    if (/^import\b/.test(L[i])) on = true;
    if (on && !isB(L[i]) && !isC(L[i])) n++;
    d += delta[i];
    if (on && d <= 0) on = false;
  }
  return n;
}

const files = readdirSync(`${dir}/archetypes`)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .sort();

console.log("archetype\ttotal\tcode\tcomment\timport\temitter\thelpers+consts");
const T = [0, 0, 0, 0, 0, 0];
for (const f of files) {
  const L = readFileSync(`${dir}/archetypes/${f}`, "utf8").split("\n");
  const code = L.filter((l) => !isB(l) && !isC(l)).length;
  const com = L.filter(isC).length;
  const imp = importCode(L);
  const k = f.replace(".ts", "");
  const emit = BODY[k] ?? 0;
  const rest = code - imp - emit;
  console.log([k, L.length, code, com, imp, emit, rest].join("\t"));
  T[0] += L.length;
  T[1] += code;
  T[2] += com;
  T[3] += imp;
  T[4] += emit;
  T[5] += rest;
}
console.log(["TWELVE", ...T].join("\t"));
console.log("");
console.log("shared\ttotal\tcode\tcomment");
for (const f of ["kit.ts", "svg.ts", "theme.ts", "composition.ts", "camera.ts", "island.ts"]) {
  const L = readFileSync(`${dir}/${f}`, "utf8").split("\n");
  console.log([f, L.length, L.filter((l) => !isB(l) && !isC(l)).length, L.filter(isC).length].join("\t"));
}
