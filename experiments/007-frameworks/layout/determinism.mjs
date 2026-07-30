/**
 * Do these layout engines return the same coordinates twice?
 *
 * Three questions, because "deterministic" hides three different failures:
 *   1. same process, repeated calls  — is there hidden mutable state?
 *   2. fresh process, fresh import   — is there a seed drawn at module load?
 *   3. same graph, permuted input    — is the result a function of the graph,
 *      or of the order we happened to hand it over? (A planner that renames a
 *      stage must not reshuffle the slide.)
 */
import { createHash } from "node:crypto";
import ELK from "elkjs/lib/elk.bundled.js";
import dagre from "@dagrejs/dagre";
import { instance } from "@viz-js/viz";

const h = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

/* The demo's own pipeline beat, as a graph. */
const STAGES = [
  { id: "n0", label: "Encode", note: "SwinIR-style" },
  { id: "n1", label: "Window", note: "no pooling" },
  { id: "n2", label: "DQ-CTM", note: "shared ticks" },
  { id: "n3", label: "Decode", note: "×4 upsample" },
];
const EDGES = [
  ["n0", "n1"],
  ["n1", "n2"],
  ["n2", "n3"],
  ["n2", "n1"], // the feedback loop, from stage 2 back to stage 1
];
/* Sizes measured by DeckSmith's own textWidth; the engines take them as given. */
const SIZE = { width: 430, height: 172 };

function elkGraph(order = [0, 1, 2, 3], edgeOrder = [0, 1, 2, 3]) {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "120",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: order.map((i) => ({ id: STAGES[i].id, ...SIZE })),
    edges: edgeOrder.map((i) => ({
      id: `e${i}`,
      sources: [EDGES[i][0]],
      targets: [EDGES[i][1]],
    })),
  };
}

/** Strip ids/labels so we compare geometry only. */
function elkGeom(g) {
  const nodes = [...g.children]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => [c.id, c.x, c.y, c.width, c.height]);
  const edges = [...(g.edges ?? [])]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => [e.id, JSON.stringify(e.sections ?? [])]);
  return { nodes, edges };
}

async function elkRuns() {
  const elk = new ELK();
  const hashes = [];
  for (let i = 0; i < 5; i++) hashes.push(h(elkGeom(await elk.layout(elkGraph()))));
  // A second engine instance, in case state lives on the instance.
  const elk2 = new ELK();
  hashes.push(h(elkGeom(await elk2.layout(elkGraph()))));
  // Reversed child order, same graph.
  const permuted = h(elkGeom(await elk.layout(elkGraph([3, 2, 1, 0]))));
  // Reversed edge declaration order, same graph.
  const eperm = h(elkGeom(await elk.layout(elkGraph([0, 1, 2, 3], [3, 2, 1, 0]))));
  return { hashes, permuted, eperm };
}

function dagreGeom(g) {
  const nodes = g
    .nodes()
    .sort()
    .map((id) => {
      const n = g.node(id);
      return [id, n.x, n.y, n.width, n.height];
    });
  const edges = g
    .edges()
    .map((e) => [e.v, e.w, JSON.stringify(g.edge(e).points)])
    .sort();
  return { nodes, edges };
}

function dagreRun(order = [0, 1, 2, 3], edgeOrder = [0, 1, 2, 3]) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 120, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const i of order) g.setNode(STAGES[i].id, { ...SIZE });
  for (const i of edgeOrder) g.setEdge(EDGES[i][0], EDGES[i][1], {}, `e${i}`);
  dagre.layout(g);
  return dagreGeom(g);
}

async function vizRuns() {
  const viz = await instance();
  const dot = `digraph{rankdir=LR;node[shape=box,width=6,height=2.4,fixedsize=true];${EDGES.map(
    ([a, b]) => `${a}->${b};`,
  ).join("")}}`;
  const hashes = [];
  for (let i = 0; i < 3; i++) hashes.push(h(viz.renderString(dot, { format: "json" })));
  const viz2 = await instance();
  hashes.push(h(viz2.renderString(dot, { format: "json" })));
  return hashes;
}

const uniq = (a) => [...new Set(a)];

const elkR = await elkRuns();
console.log("ELK   5 calls + 2nd instance :", uniq(elkR.hashes).length === 1 ? "IDENTICAL" : "DIFFER", uniq(elkR.hashes));
console.log("ELK   node order permuted    :", elkR.permuted === elkR.hashes[0] ? "IDENTICAL" : "DIFFERS", elkR.permuted);
console.log("ELK   edge order permuted    :", elkR.eperm === elkR.hashes[0] ? "IDENTICAL" : "DIFFERS", elkR.eperm);

const dHashes = [];
for (let i = 0; i < 5; i++) dHashes.push(h(dagreRun()));
console.log("dagre 5 calls                :", uniq(dHashes).length === 1 ? "IDENTICAL" : "DIFFER", uniq(dHashes));
console.log("dagre node order permuted    :", h(dagreRun([3, 2, 1, 0])) === dHashes[0] ? "IDENTICAL" : "DIFFERS", h(dagreRun([3, 2, 1, 0])));
console.log("dagre edge order permuted    :", h(dagreRun([0, 1, 2, 3], [3, 2, 1, 0])) === dHashes[0] ? "IDENTICAL" : "DIFFERS");

const vHashes = await vizRuns();
console.log("viz   3 calls + 2nd instance :", uniq(vHashes).length === 1 ? "IDENTICAL" : "DIFFER", uniq(vHashes));

/* And the numbers themselves, for the writeup. */
const elk = new ELK();
const laid = await elk.layout(elkGraph());
console.log("\nELK canvas:", laid.width, "x", laid.height, "(the slide is 1700 x ~600)");
console.log("ELK nodes:", laid.children.map((c) => `${c.id}@${c.x},${c.y}`).join(" "));
const d = dagreRun();
console.log("dagre nodes:", d.nodes.map((n) => `${n[0]}@${n[1]},${n[2]}`).join(" "));
