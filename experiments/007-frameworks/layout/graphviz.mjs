/**
 * Graphviz, via @viz-js/viz (Graphviz compiled to WASM).
 *
 * Two things distinguish it from ELK/dagre and are worth measuring:
 *   - `constraint=false` marks an edge as decoration, so a feedback loop can be
 *     drawn without joining the layering. That is exactly the hint ELK lacks.
 *   - Graphviz carries its own font metrics and will size a node to its label,
 *     which overlaps `textWidth` in src/emit/svg.ts. Is it any more accurate?
 *   - `size=` + `ratio=` will scale a drawing down to fit a page, which is the
 *     closest thing any of the three has to DeckSmith's fixed frame.
 */
import { instance } from "@viz-js/viz";
import { textWidth } from "./ds-svg.mjs";

const viz = await instance();
const PT = 72; // Graphviz works in inches at 72dpi

const stages = [
  ["n0", "Encode"],
  ["n1", "Window"],
  ["n2", "DQ-CTM"],
  ["n3", "Decode"],
];

function dot(body, graphAttrs = "") {
  return `digraph{rankdir=LR;${graphAttrs}node[shape=box,fixedsize=true,width=${(349.49 / PT).toFixed(4)},height=${(192 / PT).toFixed(4)}];${body}}`;
}

const chain = "n0->n1;n1->n2;n2->n3;";
const loopHard = `${chain}n2->n1;`;
const loopSoft = `${chain}n2->n1[constraint=false];`;

function geom(json) {
  const g = JSON.parse(json);
  const bb = g.bb.split(",").map(Number);
  const nodes = (g.objects ?? [])
    .filter((o) => o.pos)
    .map((o) => {
      const [x, y] = o.pos.split(",").map(Number);
      return `${o.name}@${Math.round(x)},${Math.round(y)}`;
    });
  return { w: bb[2] - bb[0], h: bb[3] - bb[1], nodes: nodes.join(" ") };
}

console.log("=== Graphviz dot: does constraint=false rescue the feedback loop? ===");
for (const [name, body] of [
  ["chain only", chain],
  ["chain + loop (default)", loopHard],
  ["chain + loop constraint=false", loopSoft],
]) {
  const g = geom(viz.renderString(dot(body), { format: "json" }));
  const ranks = new Set(g.nodes.split(" ").map((s) => s.split("@")[1].split(",")[0])).size;
  console.log(
    `  ${name.padEnd(30)} ${Math.round(g.w)}x${Math.round(g.h)}pt  ranks=${ranks}  ${g.nodes}`,
  );
}

console.log("\n=== Does size= scale the drawing into a 1696x600 frame? ===");
for (const attrs of [
  "",
  `size="${(1696 / PT).toFixed(3)},${(600 / PT).toFixed(3)}";`,
  `size="${(1696 / PT).toFixed(3)},${(600 / PT).toFixed(3)}!";ratio=compress;`,
]) {
  const svg = viz.renderString(dot(loopSoft, attrs), { format: "svg" });
  const m = svg.match(/width="(\d+)pt" height="(\d+)pt"/);
  const vb = svg.match(/viewBox="([^"]+)"/);
  console.log(`  attrs=${(attrs || "(none)").padEnd(38)} svg ${m?.[1]}x${m?.[2]}pt  viewBox ${vb?.[1]}`);
}

console.log("\n=== Graphviz's own text metrics vs DeckSmith's textWidth ===");
console.log("   (autosized node width minus 2*0.11in padding, at fontsize 46, vs textWidth)");
const probes = [
  "Encode",
  "DQ-CTM",
  "Reconstruction",
  "×4 upsample",
  "Window Partitioning",
  "일관된 한국어 라벨",
];
const auto = viz.renderString(
  `digraph{node[shape=box,fontsize=46,fontname="Helvetica"];${probes
    .map((p, i) => `p${i}[label="${p}"];`)
    .join("")}}`,
  { format: "json" },
);
const objs = JSON.parse(auto).objects;
for (let i = 0; i < probes.length; i++) {
  const o = objs.find((x) => x.name === `p${i}`);
  const gv = Number(o.width) * PT - 2 * 0.11 * PT;
  const ds = textWidth(probes[i], 46, 400);
  console.log(
    `  ${probes[i].padEnd(22)} graphviz ${gv.toFixed(0).padStart(5)}px   decksmith ${ds
      .toFixed(0)
      .padStart(5)}px   delta ${(ds - gv).toFixed(0).padStart(5)}px`,
  );
}
