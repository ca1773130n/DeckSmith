/**
 * The question DeckSmith actually asks a layout engine, asked of the engines.
 *
 * A slide is a FIXED 1920x1080 frame. `fitBoxes` is therefore a solver for
 * "what type size and box width make these N labels fit in 1700px". A graph
 * layout engine solves the dual — given fixed node sizes, how big must the
 * canvas be — and is free to return any canvas it likes. This measures the gap.
 */
import ELK from "elkjs/lib/elk.bundled.js";
import dagre from "@dagrejs/dagre";

const elk = new ELK();
const W = 1696; // DeckSmith's content width, less its 2px stroke margin

const OPTS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "120",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.edgeRouting": "ORTHOGONAL",
};

async function lay(children, edges, extra = {}) {
  return elk.layout({
    id: "root",
    layoutOptions: { ...OPTS, ...extra },
    children: structuredClone(children),
    edges: structuredClone(edges),
  });
}

const chain = (n) =>
  Array.from({ length: n - 1 }, (_, i) => ({
    id: `e${i}`,
    sources: [`n${i}`],
    targets: [`n${i + 1}`],
  }));
const boxes = (n, w = 430, h = 172) =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, width: w, height: h }));

console.log("=== 1. Does the feedback loop wreck the layering? ===");
const four = boxes(4);
const withLoop = [...chain(4), { id: "loop", sources: ["n2"], targets: ["n1"] }];
for (const [name, edges, extra] of [
  ["chain only", chain(4), {}],
  ["chain + loop", withLoop, {}],
  ["chain + loop, DEPTH_FIRST", withLoop, { "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST" }],
  ["chain + loop, INTERACTIVE", withLoop, { "elk.layered.cycleBreaking.strategy": "INTERACTIVE" }],
  ["chain + loop, MODEL_ORDER", withLoop, { "elk.layered.cycleBreaking.strategy": "MODEL_ORDER" }],
]) {
  const r = await lay(four, edges, extra);
  const xs = r.children.map((c) => `${c.id}@x${c.x}`).join(" ");
  const layers = new Set(r.children.map((c) => c.x)).size;
  console.log(
    `  ${name.padEnd(28)} canvas ${String(Math.round(r.width)).padStart(5)}x${String(
      Math.round(r.height),
    ).padStart(4)}  layers=${layers}  ${xs}`,
  );
}

console.log("\n=== 2. Can the engines fit a row into 1696px? ===");
console.log("   (DeckSmith caps a box at 430 and shrinks type from 46px to a 40px floor.)");
for (const n of [2, 3, 4, 5, 6, 7]) {
  const r = await lay(boxes(n), chain(n));
  const d = new dagre.graphlib.Graph();
  d.setGraph({ rankdir: "LR", nodesep: 120, ranksep: 120 });
  d.setDefaultEdgeLabel(() => ({}));
  for (let i = 0; i < n; i++) d.setNode(`n${i}`, { width: 430, height: 172 });
  for (let i = 0; i < n - 1; i++) d.setEdge(`n${i}`, `n${i + 1}`);
  dagre.layout(d);
  const dw = Math.max(...d.nodes().map((id) => d.node(id).x + 215));
  const over = (w) => (w > W ? `OVERFLOWS by ${Math.round(w - W)}px` : `fits (${Math.round(W - w)}px spare)`);
  console.log(
    `  ${n} stages: ELK width ${String(Math.round(r.width)).padStart(5)} ${over(r.width).padEnd(24)}` +
      `| dagre width ${String(Math.round(dw)).padStart(5)} ${over(dw)}`,
  );
}

console.log("\n=== 3. Told the frame is 1696 wide, does either engine shrink anything? ===");
const forced = await lay(boxes(6), chain(6), {
  "elk.nodeSize.constraints": "MINIMUM_SIZE",
  "elk.aspectRatio": String(1696 / 600),
});
console.log(
  `  ELK with aspectRatio=${(1696 / 600).toFixed(2)} and a 1696x600 frame: canvas ${Math.round(
    forced.width,
  )}x${Math.round(forced.height)}`,
);
console.log(
  `  node widths returned: ${[...new Set(forced.children.map((c) => c.width))].join(", ")} (input was 430)`,
);
