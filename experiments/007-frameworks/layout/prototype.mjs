/**
 * The demo's own pipeline beat, laid out four ways, drawn in DeckSmith's own
 * visual language so the only variable is the geometry.
 *
 *   A  current   — the shipped hand-rolled layout, lifted verbatim from the
 *                  built demo deck. Ground truth.
 *   B  elk-naive — ELK layered, the graph handed over as it reads: four stages,
 *                  three connectors, one feedback edge. Default options.
 *   C  elk-tuned — ELK layered with the feedback edge withheld (routed by hand
 *                  afterwards, as DeckSmith already does) and DeckSmith's own
 *                  `fitBoxes` result handed to ELK as fixed node sizes.
 *   D  dagre     — same graph as C, through dagre.
 *
 * Text metrics, wrapping and every SVG primitive come from the real
 * `src/emit/svg.ts` (bundled to ds-svg.mjs), because the interesting question is
 * what the LAYOUT changes, not what a reimplementation of textWidth changes.
 */
import { writeFileSync, readFileSync } from "node:fs";
import ELK from "elkjs/lib/elk.bundled.js";
import dagre from "@dagrejs/dagre";
import {
  arrow,
  arrowDefs,
  elbow,
  fitBoxes,
  group,
  MIN_FONT,
  n,
  roundRect,
  svg,
  text,
  textWidth,
  wrap,
} from "./ds-svg.mjs";

/* ---------------------------------------------------------------- the beat */

const beat = JSON.parse(readFileSync("../../../demo/storyboard.json", "utf8")).beats.find(
  (b) => b.archetype === "pipeline",
);
const STAGES = beat.params.stages;
/* pipeline.ts clamps `to` to at most `from - 1`; from:2,to:2 becomes 2 -> 1. */
const LOOP = { from: 2, to: 1, label: beat.params.loop.label };

/* DeckSmith's own constants, so the drawings are comparable. */
const W = 1700;
const M = 2;
const R = 18;
const LABEL = 46;
const NOTE = MIN_FONT;
const LABEL_LH = 1.2;
const NOTE_LH = 1.3;
const NOTE_TOP = 16;
const PAD_X_EM = 0.45;
const PAD_Y = 34;
const MIN_BOX_H = 172;
const GAP = 120;
const MIN_GAP = 30;
const MAX_BOX_W = 430;
const LOOP_TOP = 56;
const LOOP_LABEL_TOP = 18;
const LOOP_BOTTOM = 10;

const THEME = {
  fg: "#e8edf2",
  muted: "#9aa7b5",
  rule: "#2b333d",
  panel: "#16191e",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#8ce99a", d: "#ff8fa3" },
};

/* --------------------------------------------------- shared drawing routine */

/**
 * Draw the row from a list of placed boxes. Everything downstream of the
 * coordinates is identical for all four variants, so any visible difference is
 * a layout difference.
 */
function draw(sid, placed, boxH, size, loopGeom, svgH) {
  const innerW = Math.max(size, (placed[0]?.w ?? 400) - 2 * PAD_X_EM * size);
  const labelLines = STAGES.map((s) => wrap(s.label, size, innerW, 600));
  const noteLines = STAGES.map((s) => (s.note ? wrap(s.note, NOTE, innerW, 400) : []));

  const stages = STAGES.map((stage, i) => {
    const b = placed[i];
    const box = { x: b.x, y: b.y, w: b.w, h: boxH };
    const tone = stage.tone ? THEME.tones[stage.tone] : undefined;
    const shell = tone
      ? roundRect(box, R, { fill: tone, "fill-opacity": "0.12", stroke: tone, "stroke-width": 4 })
      : roundRect(box, R, { fill: THEME.panel, stroke: THEME.rule, "stroke-width": 3 });
    const labelH = labelLines[i].length * size * LABEL_LH;
    const noteCount = noteLines[i].length;
    const noteH = noteCount > 0 ? NOTE_TOP + noteCount * NOTE * NOTE_LH : 0;
    const top = box.y + (boxH - labelH - noteH) / 2;
    const label = text(
      stage.label,
      { x: box.x + box.w / 2, y: top + labelH / 2 },
      {
        size,
        weight: 600,
        fill: tone ?? THEME.fg,
        anchor: "middle",
        maxWidth: innerW,
        lineHeight: LABEL_LH,
        vAlign: "middle",
      },
    );
    const note =
      noteCount > 0
        ? text(
            stage.note,
            { x: box.x + box.w / 2, y: top + labelH + NOTE_TOP + (noteH - NOTE_TOP) / 2 },
            {
              size: NOTE,
              fill: THEME.muted,
              anchor: "middle",
              maxWidth: innerW,
              lineHeight: NOTE_LH,
              vAlign: "middle",
            },
          )
        : "";
    return group([shell, label, note]);
  });

  const connectors = [];
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i];
    const b = placed[i + 1];
    // Straight when the two boxes share a centreline; an elbow when they do not,
    // which is the case ELK's own routing hands back.
    const ay = a.y + boxH / 2;
    const by = b.y + boxH / 2;
    if (Math.abs(ay - by) < 0.5) {
      connectors.push(
        arrow(sid, { x: a.x + a.w, y: ay }, { x: b.x, y: by }, { stroke: THEME.muted, width: 5, inset: 8 }),
      );
    } else {
      connectors.push(
        elbow(sid, { x: a.x + a.w, y: ay }, { x: b.x, y: by }, {
          stroke: THEME.muted,
          width: 5,
          inset: 8,
          axis: "h",
          via: (a.x + a.w + b.x) / 2,
          radius: 18,
        }),
      );
    }
  }

  let loopSvg = "";
  if (loopGeom) {
    const { fromX, toX, bottom, via } = loopGeom;
    const lines = wrap(LOOP.label, NOTE, 700, 500);
    loopSvg =
      elbow(sid, { x: fromX, y: bottom }, { x: toX, y: bottom }, {
        stroke: THEME.tones.b,
        width: 4,
        dash: "16 12",
        inset: 10,
        via,
        radius: 22,
      }) +
      text(
        LOOP.label,
        { x: (fromX + toX) / 2, y: via + LOOP_LABEL_TOP + (lines.length * NOTE * NOTE_LH) / 2 },
        {
          size: NOTE,
          weight: 500,
          fill: THEME.tones.b,
          anchor: "middle",
          maxWidth: 700,
          lineHeight: NOTE_LH,
          vAlign: "middle",
        },
      );
  }

  return svg(
    `${sid}-pipe`,
    W,
    svgH,
    [arrowDefs(sid, [THEME.muted, THEME.tones.b]), loopSvg, ...connectors, ...stages].join(""),
  );
}

/* --------------------------------------------------------------- A: current */

/** DeckSmith's `fitBoxes` solve, reproduced here so every variant can use it. */
function dsFit() {
  const balance = (l) => l;
  const width = W - 2 * M;
  const labels = STAGES.map((s) =>
    textWidth(s.label, 1, 600) > textWidth(s.note ?? "", 1, 600) ? s.label : s.note,
  );
  const capped = Math.min(width, STAGES.length * MAX_BOX_W + (STAGES.length - 1) * GAP);
  const req = (w) => ({
    labels,
    width: w,
    size: LABEL,
    gap: GAP,
    minGap: MIN_GAP,
    padEm: PAD_X_EM,
    weight: 600,
    x0: M + (W - 2 * M - w) / 2,
  });
  let fit = fitBoxes(req(capped));
  if (!fit.ok && capped < width) fit = fitBoxes(req(width));
  return fit;
}

const fit = dsFit();
const size = Math.max(MIN_FONT, Math.floor(fit.size));
const innerW = Math.max(size, fit.boxes[0].w - 2 * PAD_X_EM * size);
const boxH = Math.max(
  MIN_BOX_H,
  ...STAGES.map((s) => {
    const label = wrap(s.label, size, innerW, 600).length * size * LABEL_LH;
    const note = s.note ? wrap(s.note, NOTE, innerW, 400).length : 0;
    return Math.ceil(2 * PAD_Y + label + (note > 0 ? NOTE_TOP + note * NOTE * NOTE_LH : 0));
  }),
);
const loopLines = wrap(LOOP.label, NOTE, 700, 500).length;
const svgH = M + boxH + LOOP_TOP + LOOP_LABEL_TOP + loopLines * NOTE * NOTE_LH + LOOP_BOTTOM;
const cx = (boxes, i) => boxes[i].x + boxes[i].w / 2;

const currentPlaced = fit.boxes.map((b) => ({ x: b.x, y: M, w: b.w }));
const A = draw("sA", currentPlaced, boxH, size, {
  fromX: cx(fit.boxes, LOOP.from),
  toX: cx(fit.boxes, LOOP.to),
  bottom: M + boxH,
  via: M + boxH + LOOP_TOP,
}, svgH);

console.log("A current : boxes", fit.boxes.map((b) => `${n(b.x)}w${n(b.w)}`).join(" "),
  `| gap ${n(fit.gap)} | size ${size} | row width ${n(fit.boxes[3].x + fit.boxes[3].w - fit.boxes[0].x)}`);

/* --------------------------------------------------------- B & C: ELK */

const elk = new ELK();
const chainEdges = STAGES.slice(1).map((_, i) => ({
  id: `e${i}`,
  sources: [`n${i}`],
  targets: [`n${i + 1}`],
}));
const loopEdge = {
  id: "loop",
  sources: [`n${LOOP.from}`],
  targets: [`n${LOOP.to}`],
};

/** B: hand ELK the graph as it reads, with its own defaults. */
const bRaw = await elk.layout({
  id: "root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": String(GAP),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(GAP),
    "elk.edgeRouting": "ORTHOGONAL",
  },
  children: STAGES.map((_, i) => ({ id: `n${i}`, width: MAX_BOX_W, height: boxH })),
  edges: [...chainEdges, loopEdge],
});
const bPlaced = STAGES.map((_, i) => {
  const c = bRaw.children.find((x) => x.id === `n${i}`);
  return { x: c.x, y: c.y, w: c.width };
});
const B = draw("sB", bPlaced, boxH, size, null, Math.max(svgH, bRaw.height + 4));
console.log(
  "B elk-naive:", bPlaced.map((p) => `${n(p.x)},${n(p.y)}`).join(" "),
  `| canvas ${n(bRaw.width)}x${n(bRaw.height)} vs the 1700x${n(svgH)} the slide has`,
);

/** C: ELK with the loop withheld and DeckSmith's solved sizes handed in. */
const cRaw = await elk.layout({
  id: "root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": String(n(fit.gap)),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(n(fit.gap)),
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.padding": "[top=2,left=2,bottom=2,right=2]",
  },
  children: STAGES.map((_, i) => ({ id: `n${i}`, width: fit.boxes[i].w, height: boxH })),
  edges: chainEdges,
});
const cPlaced = STAGES.map((_, i) => {
  const c = cRaw.children.find((x) => x.id === `n${i}`);
  return { x: c.x, y: c.y, w: c.width };
});
const C = draw("sC", cPlaced, boxH, size, {
  fromX: cPlaced[LOOP.from].x + cPlaced[LOOP.from].w / 2,
  toX: cPlaced[LOOP.to].x + cPlaced[LOOP.to].w / 2,
  bottom: cPlaced[0].y + boxH,
  via: cPlaced[0].y + boxH + LOOP_TOP,
}, svgH);
console.log(
  "C elk-tuned:", cPlaced.map((p) => `${n(p.x)},${n(p.y)}w${n(p.w)}`).join(" "),
  `| canvas ${n(cRaw.width)}x${n(cRaw.height)}`,
);

/* ------------------------------------------------------------- D: dagre */

const g = new dagre.graphlib.Graph();
g.setGraph({ rankdir: "LR", nodesep: fit.gap, ranksep: fit.gap, marginx: M, marginy: M });
g.setDefaultEdgeLabel(() => ({}));
STAGES.forEach((_, i) => g.setNode(`n${i}`, { width: fit.boxes[i].w, height: boxH }));
STAGES.slice(1).forEach((_, i) => g.setEdge(`n${i}`, `n${i + 1}`));
dagre.layout(g);
const dPlaced = STAGES.map((_, i) => {
  const c = g.node(`n${i}`);
  return { x: c.x - c.width / 2, y: c.y - c.height / 2, w: c.width };
});
const D = draw("sD", dPlaced, boxH, size, {
  fromX: dPlaced[LOOP.from].x + dPlaced[LOOP.from].w / 2,
  toX: dPlaced[LOOP.to].x + dPlaced[LOOP.to].w / 2,
  bottom: dPlaced[0].y + boxH,
  via: dPlaced[0].y + boxH + LOOP_TOP,
}, svgH);
console.log("D dagre    :", dPlaced.map((p) => `${n(p.x)},${n(p.y)}w${n(p.w)}`).join(" "));

/* Does C reproduce A? That is the whole question for `pipeline`. */
const dx = cPlaced.map((p, i) => Math.abs(p.x - currentPlaced[i].x));
console.log(
  `\nC vs A, per-box |dx|: ${dx.map((v) => n(v)).join(", ")}  ->`,
  Math.max(...dx) < 0.5 ? "ELK REPRODUCED the hand-rolled row exactly" : "differs",
);

/* ------------------------------------------------------------------ output */

const page = (title, sub, body) => `
<section>
  <div class="eyebrow">Method</div>
  <h2 class="headline">One pass in, one pass out, and a loop in the middle</h2>
  <div class="pipewrap">${body}</div>
  <div class="pipenote">Parameters are shared across every tick.</div>
  <div class="stamp">${title}<span>${sub}</span></div>
</section>`;

const html = `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{background:#0b0d10;font-family:Inter,system-ui,sans-serif}
  section{position:relative;width:1920px;height:1080px;padding:84px 110px;display:flex;
          flex-direction:column;justify-content:center;overflow:hidden;
          border-bottom:1px solid #2b333d}
  .eyebrow{font-size:34px;letter-spacing:.14em;text-transform:uppercase;color:#9aa7b5;margin-bottom:22px}
  .headline{font-size:66px;line-height:1.15;font-weight:700;color:#e8edf2}
  .pipewrap{margin-top:38px;display:flex;justify-content:center}
  .pipenote{font-size:40px;line-height:1.5;color:#9aa7b5;margin-top:36px;max-width:1500px}
  .stamp{position:absolute;top:28px;right:32px;font-size:26px;color:#ffd166;text-align:right}
  .stamp span{display:block;color:#9aa7b5;font-size:22px;max-width:640px}
  svg{overflow:visible}
</style>
${page("A — current (hand-rolled)", "src/emit/archetypes/pipeline.ts, as shipped", A)}
${page("B — ELK, graph as it reads", "layered + the feedback edge, default options", B)}
${page("C — ELK, loop withheld + DeckSmith box sizes", "elkjs 0.12.0, elk.layered", C)}
${page("D — dagre, same input as C", "@dagrejs/dagre 3.0.0", D)}
`;
writeFileSync("compare.html", html);
writeFileSync("variant-A.svg", A);
writeFileSync("variant-B.svg", B);
writeFileSync("variant-C.svg", C);
writeFileSync("variant-D.svg", D);
console.log("\nwrote compare.html + variant-{A,B,C,D}.svg");
