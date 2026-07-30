/**
 * Graphviz is the only one of the three that will fit a drawing to a frame.
 * It does it by scaling the whole drawing uniformly — text included. DeckSmith
 * instead re-wraps labels onto more lines and only then reduces type, with a
 * hard floor at 40px (invariant 5). This measures what the two answers cost.
 */
import { instance } from "@viz-js/viz";
import { fitBoxes, MIN_FONT, wrap, textWidth } from "./ds-svg.mjs";

const viz = await instance();
const PT = 72;
const FRAME_W = 1696;
const FRAME_H = 600;
const LABELS = [
  "Encode",
  "Window Partition",
  "DQ-CTM",
  "Cross Attention",
  "Refine",
  "Decode",
];

for (const n of [2, 3, 4, 5, 6, 7, 8]) {
  const labels = LABELS.slice(0, n).concat(
    Array.from({ length: Math.max(0, n - LABELS.length) }, (_, i) => `Stage ${i + 7}`),
  );

  /* --- Graphviz: draw at natural size, then scale to the frame --- */
  const body = labels.map((_, i) => (i ? `n${i - 1}->n${i};` : "")).join("");
  const g = JSON.parse(
    viz.renderString(
      `digraph{rankdir=LR;node[shape=box,fixedsize=true,width=${(430 / PT).toFixed(
        4,
      )},height=${(192 / PT).toFixed(4)},fontsize=46];${body || "n0;"}}`,
      { format: "json" },
    ),
  );
  const bb = g.bb.split(",").map(Number);
  const natural = bb[2] - bb[0];
  const k = Math.min(1, FRAME_W / natural, FRAME_H / (bb[3] - bb[1]));
  const gvType = 46 * k;

  /* --- DeckSmith: solve box width and type size against the fixed frame --- */
  const fit = fitBoxes({
    labels,
    width: FRAME_W,
    size: 46,
    gap: 120,
    minGap: 30,
    padEm: 0.45,
    weight: 600,
  });
  const dsType = Math.max(MIN_FONT, Math.floor(fit.size));
  const innerW = Math.max(dsType, fit.boxes[0].w - 2 * 0.45 * dsType);
  const maxLines = Math.max(...labels.map((l) => wrap(l, dsType, innerW, 600).length));

  console.log(
    `${String(n).padStart(2)} stages | graphviz: natural ${String(Math.round(natural)).padStart(
      4,
    )}px, scale ${k.toFixed(2)}, type ${gvType.toFixed(0).padStart(2)}px ` +
      `${gvType < MIN_FONT ? "BELOW THE 40px FLOOR" : "ok               "}` +
      ` | decksmith: type ${String(dsType).padStart(2)}px on ${maxLines} line(s), ` +
      `box ${Math.round(fit.boxes[0].w)}px, ${fit.ok ? "ok" : "REFUSES (needs " + Math.round(fit.needed) + "px)"}`,
  );
}
