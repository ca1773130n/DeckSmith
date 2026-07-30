// The premise of the assignment: hand-rolling each new chart type does not
// scale. So measure the thing that matters — how many LINES OF SPEC does each
// library need for the six types DeckSmith does not have yet, and does each one
// come out as GSAP-addressable SVG with no wall-clock animation?
import { parseHTML } from "linkedom";
import * as Plot from "@observablehq/plot";
import * as vl from "vega-lite";
import * as vega from "vega";
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("out/coverage", { recursive: true });
const doc = () => parseHTML("<!doctype html><html><body></body></html>").document;
const D = [
  { g: "A", k: "p", x: 1, y: 3, e: 0.4 },
  { g: "A", k: "q", x: 2, y: 5, e: 0.3 },
  { g: "B", k: "p", x: 1, y: 2, e: 0.5 },
  { g: "B", k: "q", x: 2, y: 6, e: 0.2 },
  { g: "C", k: "p", x: 3, y: 4, e: 0.6 },
  { g: "C", k: "q", x: 3, y: 1, e: 0.1 },
];

const P_SPECS = {
  scatter: () => [Plot.dot(D, { x: "x", y: "y", fill: "g", r: 8 })],
  area: () => [Plot.areaY(D, { x: "x", y: "y", fill: "g", fillOpacity: 0.5 })],
  "stacked-bar": () => [Plot.barY(D, { x: "g", y: "y", fill: "k" })],
  distribution: () => [Plot.rectY(D, Plot.binX({ y: "count" }, { x: "y" }))],
  "small-multiples": () => [Plot.line(D, { x: "x", y: "y", fx: "g" })],
  "error-bars": () => [
    Plot.ruleX(D, { x: "x", y1: (d) => d.y - d.e, y2: (d) => d.y + d.e, strokeWidth: 4 }),
    Plot.dot(D, { x: "x", y: "y", fill: "currentColor", r: 8 }),
  ],
};

const V_SPECS = {
  scatter: { mark: "point", encoding: { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" }, color: { field: "g" } } },
  area: { mark: "area", encoding: { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative", stack: "zero" }, color: { field: "g" } } },
  "stacked-bar": { mark: "bar", encoding: { x: { field: "g", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" }, color: { field: "k" } } },
  distribution: { mark: "bar", encoding: { x: { field: "y", type: "quantitative", bin: true }, y: { aggregate: "count", type: "quantitative" } } },
  "small-multiples": { mark: "line", encoding: { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" }, facet: { field: "g", type: "nominal", columns: 3 } } },
  "error-bars": {
    layer: [
      { mark: "rule", encoding: { x: { field: "x", type: "quantitative" }, y: { field: "lo", type: "quantitative" }, y2: { field: "hi" } } },
      { mark: { type: "point", filled: true }, encoding: { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" } } },
    ],
  },
};

const rows = [];
for (const [name, marks] of Object.entries(P_SPECS)) {
  let r = { type: name, lib: "plot", ok: false };
  try {
    const fig = Plot.plot({ document: doc(), width: 1120, height: 600, marks: marks() });
    const svg = /^svg$/i.test(fig.tagName) ? fig : fig.querySelector("svg");
    const s = svg.outerHTML;
    writeFileSync(`out/coverage/plot-${name}.svg`, s);
    r = {
      type: name,
      lib: "plot",
      ok: true,
      bytes: s.length,
      marks: (s.match(/aria-label="[^"]*"/g) || []).length,
      wallClock: /<animate|@keyframes|animation:/.test(s),
    };
  } catch (e) {
    r.err = e.message.slice(0, 60);
  }
  rows.push(r);
}
for (const [name, base] of Object.entries(V_SPECS)) {
  let r = { type: name, lib: "vega-lite", ok: false };
  try {
    const values = name === "error-bars" ? D.map((d) => ({ ...d, lo: d.y - d.e, hi: d.y + d.e })) : D;
    const spec = vl.compile({ width: 900, height: 400, data: { values }, ...base }).spec;
    const s = await new vega.View(vega.parse(spec), { renderer: "none" }).toSVG();
    writeFileSync(`out/coverage/vl-${name}.svg`, s);
    r = {
      type: name,
      lib: "vega-lite",
      ok: true,
      bytes: s.length,
      marks: (s.match(/class="mark-[a-z]+ role-mark/g) || []).length,
      wallClock: /<animate|@keyframes|animation:/.test(s),
    };
  } catch (e) {
    r.err = e.message.slice(0, 60);
  }
  rows.push(r);
}
console.table(rows.sort((a, b) => a.type.localeCompare(b.type)));
