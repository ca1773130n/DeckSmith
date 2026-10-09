/**
 * Hand-made reference scenes: the bar a generated scene is held to, shown to
 * the model as worked examples (few-shot) and run through every gate by
 * test/bespoke-references.test.ts, so a reference that stops passing a gate
 * stops being a reference.
 *
 * WHY EXAMPLES AND NOT MORE PROSE. Round 1's prompt said "use the whole box",
 * "keep it alive", "64px for the key quantity" and the model drew 40-56px boxes
 * and arrows in two thirds of the frame. Code2Video (arXiv 2510.01174) and
 * TheoremExplainAgent (arXiv 2502.19400) both found layout and visual quality
 * respond to concrete anchors and examples far more than to adjectives. Each
 * reference is a complete scene in the contract's own token form, written to the
 * motion-design habits round 1 lacked:
 *
 *  - THE STAGE IS FILLED: every reference spans >= 85% of its box at the end.
 *  - HIERARCHY: one 88-120px focal element per cue; labels 48-60px; nothing
 *    under 44px.
 *  - ONE FOCUS PER CUE: what the voice is naming is lit (accent, full opacity);
 *    what it is not is dimmed to ~0.3 — never removed, so the viewer keeps place.
 *  - IDENTITY IS KEPT: a thing that changes state moves or morphs into the new
 *    state (3Blue1Brown's transforms) instead of cutting to a new drawing.
 *  - SEMANTIC GROUPS (Vector Prism, arXiv 2512.14336): each part is a <g> with a
 *    descriptive id and `data-cue`, and motion is attached to groups.
 *  - A RICHER VERB SET, chosen to fit: flow (particles), camera (viewBox zoom),
 *    counters (textContent + snap), morph (morphSVG), staggered builds, draws.
 *  - ARROWHEADS ARE SHAPES, not markers, and appear when their line arrives.
 *
 * Colours are `{{token}}` placeholders filled from the deck's pack, so the
 * examples are in the palette the model must use. All are written for a
 * 1700x732 body box; the prompt says how to adapt to the real one.
 */
import type { Theme } from "../emit/kit.js";
import type { Fragment } from "./contract.js";

export interface Reference {
  name: string;
  /** What it demonstrates, one line, quoted in the prompt. */
  shows: string;
  /** Archetypes whose beats this reference suits best (selection order). */
  fits: readonly string[];
  /** The narration cues the script is timed to (scene seconds). */
  cues: ReadonlyArray<{ t0: number; t1: number; text: string }>;
  duration: number;
  fragment: Fragment;
}

/** The box every reference is drawn for. */
export const REFERENCE_BOX = { width: 1700, height: 732 } as const;

/* ------------------------------------------------------------- 1. route */

const TOKEN_Y = [110, 240, 370, 500, 630];
const EXPERT_Y = [30, 206, 382, 558];
const SCORES = [0.62, 0.21, 0.71, 0.09];

const route: Reference = {
  name: "route",
  shows:
    "a mechanism that RUNS: a queue of tokens streams particles into a router, wires draw out to four experts, scores grow, the two chosen paths light while the rest dim (focus) and particles flow along them, and a big counter lands the consequence",
  fits: ["pipeline", "stack", "grid", "process", "flow", "cycle", "split-compare"],
  cues: [
    { t0: 1.0, t1: 4.6, text: "Every token arrives at the router." },
    { t0: 4.6, t1: 9.0, text: "The router scores all four experts," },
    { t0: 9.0, t1: 13.4, text: "and sends each token to its top two." },
    { t0: 13.4, t1: 17.8, text: "Only those run, so compute drops by half." },
  ],
  duration: 19,
  fragment: {
    markup: `<svg id="SCENEID-svg" width="1700" height="732" viewBox="0 0 1700 732" style="position:absolute;left:0;top:0;overflow:visible">
  <g id="SCENEID-tokens" data-cue="1">
    <text id="SCENEID-tokens-label" x="130" y="34" font-size="52" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle">Tokens</text>
${TOKEN_Y.map((y, i) => `    <circle id="SCENEID-tok${i}" cx="130" cy="${y}" r="40" fill="{{${"abcda"[i]}}}"/>`).join("\n")}
  </g>
  <g id="SCENEID-stream" data-cue="1">
${TOKEN_Y.map((y, i) => `    <circle id="SCENEID-s${i}" cx="130" cy="${y}" r="16" fill="{{${"abcda"[i]}}}"/>`).join("\n")}
  </g>
  <g id="SCENEID-wires" data-cue="2">
${EXPERT_Y.map((y, i) => `    <line id="SCENEID-wire${i}" x1="890" y1="370" x2="1176" y2="${y + 72}" stroke="{{rule}}" stroke-width="7" stroke-linecap="round"/>`).join("\n")}
  </g>
  <g id="SCENEID-flow" data-cue="3">
${[0, 1, 2, 3, 4, 5].map((i) => `    <circle id="SCENEID-p${i}" cx="890" cy="370" r="15" fill="{{accent}}"/>`).join("\n")}
  </g>
  <g id="SCENEID-router" data-cue="1">
    <circle id="SCENEID-disc-fill" cx="700" cy="370" r="190" fill="{{bg}}"/>
    <circle id="SCENEID-disc" cx="700" cy="370" r="190" fill="{{accent}}" fill-opacity="0.22" stroke="{{accent}}" stroke-width="7"/>
    <text id="SCENEID-router-label" x="700" y="370" font-size="80" font-weight="700" fill="{{fg}}" text-anchor="middle" dominant-baseline="middle">Router</text>
  </g>
${EXPERT_Y.map(
  (y, i) => `  <g id="SCENEID-expert${i}" data-cue="2">
    <rect id="SCENEID-box${i}" x="1180" y="${y}" width="480" height="144" rx="22" fill="{{${"abcd"[i]}}}" fill-opacity="0.16" stroke="{{rule}}" stroke-width="5"/>
    <text id="SCENEID-name${i}" x="1224" y="${y + 56}" font-size="60" font-weight="600" fill="{{fg}}" dominant-baseline="middle">Expert ${i + 1}</text>
    <rect id="SCENEID-bar${i}" x="1224" y="${y + 100}" width="${Math.round(380 * (SCORES[i] as number))}" height="22" rx="11" fill="{{${"abcd"[i]}}}"/>
  </g>`,
).join("\n")}
  <g id="SCENEID-saving" data-cue="4">
    <text id="SCENEID-count" x="770" y="660" font-size="120" font-weight="800" fill="{{accent}}" text-anchor="end" dominant-baseline="middle">100</text>
    <text id="SCENEID-count-unit" x="786" y="668" font-size="60" fill="{{fg}}" dominant-baseline="middle">% compute</text>
  </g>
</svg>`,
    css: "",
    script: `// Layout (box 1700x732): tokens x 90-170, y 10-670 · router disc 510-890 x 180-560 ·
// wires 890-1176 · experts 1180-1660 x 30-702 · counter 560-1090 x 600-700.
// Particles are drawn BEFORE the router so they slide under its disc (absorbed).
var tokens = [], stream = [], ps = [];
var ys = [110, 240, 370, 500, 630];
for (var i = 0; i < 5; i++) {
  tokens.push("#SCENEID-tok" + i);
  stream.push("#SCENEID-s" + i);
}
for (var j = 0; j < 6; j++) ps.push("#SCENEID-p" + j);
var experts = ["#SCENEID-expert0", "#SCENEID-expert1", "#SCENEID-expert2", "#SCENEID-expert3"];
var wires = ["#SCENEID-wire0", "#SCENEID-wire1", "#SCENEID-wire2", "#SCENEID-wire3"];
var bars = ["#SCENEID-bar0", "#SCENEID-bar1", "#SCENEID-bar2", "#SCENEID-bar3"];

// Baselines: every animated thing's start state, set once, before any tween.
gsap.set(tokens, { scale: 0, transformOrigin: "50% 50%" });
gsap.set("#SCENEID-tokens-label", { opacity: 0 });
gsap.set(stream, { opacity: 0, x: 0, y: 0 });
gsap.set(["#SCENEID-disc", "#SCENEID-disc-fill"], { scale: 0, transformOrigin: "50% 50%" });
gsap.set("#SCENEID-router-label", { opacity: 0 });
gsap.set(experts, { opacity: 0, x: 60 });
gsap.set(wires, { drawSVG: "0% 0%", opacity: 0 });
gsap.set(bars, { scaleX: 0, transformOrigin: "0% 50%" });
gsap.set(ps, { opacity: 0, x: 0, y: 0 });
gsap.set("#SCENEID-saving", { opacity: 0, y: 30 });

// C1 1.0-4.6 "Every token arrives at the router." — the queue pops in, then streams into the router.
tl.to("#SCENEID-tokens-label", { opacity: 1, duration: 0.4 }, 1.0);
tl.to(tokens, { scale: 1, duration: 0.5, ease: "back.out(2)", stagger: 0.08 }, 1.05);
tl.to(["#SCENEID-disc", "#SCENEID-disc-fill"], { scale: 1, duration: 0.7, ease: "expo.out" }, 1.4);
tl.to("#SCENEID-router-label", { opacity: 1, duration: 0.4 }, 1.8);
for (var k = 0; k < 5; k++) {
  tl.to(stream[k], { opacity: 1, duration: 0.1 }, 2.2 + k * 0.15);
  tl.to(stream[k], { x: 440, y: 370 - ys[k], duration: 0.9, ease: "power2.in", repeat: 2 }, 2.2 + k * 0.15);
  tl.to(stream[k], { opacity: 0, duration: 0.1 }, 4.9 + k * 0.15);
}

// C2 4.6-9.0 "The router scores all four experts," — experts slide in, wires draw, scores grow.
tl.to(experts, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out", stagger: 0.15 }, 4.7);
tl.to(wires, { opacity: 1, duration: 0.01, stagger: 0.2 }, 5.0);
tl.to(wires, { drawSVG: "0% 100%", duration: 0.7, ease: "power2.inOut", stagger: 0.2 }, 5.0);
tl.to(bars, { scaleX: 1, duration: 0.9, ease: "power2.out", stagger: 0.3 }, 6.4);
tl.to("#SCENEID-disc", { scale: 1.05, duration: 0.35, yoyo: true, repeat: 3, ease: "sine.inOut" }, 7.6);

// C3 9.0-13.4 "and sends each token to its top two." — focus: the two winners light, the rest dim; particles flow.
tl.to(["#SCENEID-expert1", "#SCENEID-expert3", "#SCENEID-wire1", "#SCENEID-wire3"], { opacity: 0.25, duration: 0.5 }, 9.1);
tl.to(["#SCENEID-wire0", "#SCENEID-wire2"], { stroke: "{{accent}}", strokeWidth: 12, duration: 0.5 }, 9.1);
var dest = [[286, -268], [286, 84]];
for (var n = 0; n < 6; n++) {
  var d = dest[n % 2];
  tl.to(ps[n], { opacity: 1, duration: 0.15 }, 9.6 + n * 0.35);
  tl.to(ps[n], { x: d[0], y: d[1], duration: 0.9, ease: "none", repeat: 2 }, 9.6 + n * 0.35);
  tl.to(ps[n], { opacity: 0, duration: 0.2 }, 13.1);
}

// C4 13.4-17.8 "Only those run, so compute drops by half." — the consequence, as a number that moves.
tl.to("#SCENEID-saving", { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 13.5);
tl.to("#SCENEID-count", { textContent: 50, snap: { textContent: 1 }, duration: 1.8, ease: "power2.inOut" }, 13.7);
tl.to(["#SCENEID-box0", "#SCENEID-box2"], { stroke: "{{accent}}", fillOpacity: 0.32, duration: 0.5 }, 13.7);
tl.to(["#SCENEID-bar0", "#SCENEID-bar2"], { opacity: 0.55, duration: 0.45, yoyo: true, repeat: 3, ease: "sine.inOut" }, 15.6);
// The end frame is the summary: everything back at full strength; the winners keep their accent.
tl.to(["#SCENEID-expert1", "#SCENEID-expert3", "#SCENEID-wire1", "#SCENEID-wire3"], { opacity: 1, duration: 0.5 }, 16.6);`,
  },
};

/* ------------------------------------------------------------ 2. zoom in */

const SLABS = Array.from({ length: 12 }, (_, i) => 70 + i * 132);
/** Block 6's inside, drawn in its own units and placed at half scale: legible only zoomed in. */
const INSIDE = "translate(634.5 259.5) scale(0.5)";

const zoom: Reference = {
  name: "zoom",
  shows:
    "structure then detail: a staggered build of the whole, a CAMERA zoom (viewBox tween) into one part whose inside is drawn at its own scale, a draw that explains it, and a zoom back out where a pulse runs through every part",
  fits: ["stack", "grid", "annotated-figure", "claim-figure", "layers", "pipeline"],
  cues: [
    { t0: 1.0, t1: 4.8, text: "The model is a stack of twelve identical blocks." },
    { t0: 4.8, t1: 9.2, text: "Inside each one, attention" },
    { t0: 9.2, t1: 13.6, text: "lets every token read from every other." },
    { t0: 13.6, t1: 18.0, text: "Then the next block does it again, twelve times over." },
  ],
  duration: 19.2,
  fragment: {
    markup: `<svg id="SCENEID-svg" width="1700" height="732" viewBox="0 0 1700 732" style="position:absolute;left:0;top:0;overflow:hidden">
  <g id="SCENEID-stack" data-cue="1">
${SLABS.map(
  (x, i) =>
    `    <rect id="SCENEID-slab${i}" x="${x}" y="150" width="104" height="440" rx="18" fill="{{panel}}" stroke="{{${i === 5 ? "accent" : "rule"}}}" stroke-width="5"/>`,
).join("\n")}
  </g>
  <g id="SCENEID-count" data-cue="1">
    <text id="SCENEID-times" x="850" y="60" font-size="96" font-weight="700" fill="{{fg}}" text-anchor="middle" dominant-baseline="middle">× 12</text>
    <text id="SCENEID-in" x="122" y="664" font-size="48" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle">input</text>
    <text id="SCENEID-out" x="1574" y="664" font-size="48" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle">output</text>
  </g>
  <g id="SCENEID-inside" data-cue="2" transform="${INSIDE}">
    <text id="SCENEID-att" x="295" y="40" font-size="64" font-weight="700" fill="{{accent}}" text-anchor="middle" dominant-baseline="middle">Attention</text>
${[0, 1, 2, 3, 4].map((i) => `    <circle id="SCENEID-q${i}" cx="${55 + i * 120}" cy="150" r="34" fill="{{${"abcda"[i]}}}"/>`).join("\n")}
${[0, 1, 2, 3, 4].map((i) => `    <circle id="SCENEID-k${i}" cx="${55 + i * 120}" cy="400" r="34" fill="{{${"abcda"[i]}}}"/>`).join("\n")}
  </g>
  <g id="SCENEID-links" data-cue="3" transform="${INSIDE}">
${[0, 1, 2, 3, 4]
  .flatMap((a) =>
    [0, 1, 2, 3, 4].map(
      (b) =>
        `    <line id="SCENEID-l${a}${b}" x1="${55 + a * 120}" y1="186" x2="${55 + b * 120}" y2="364" stroke="{{accent}}" stroke-width="${a === 2 ? 7 : 4}" stroke-linecap="round"/>`,
    ),
  )
  .join("\n")}
  </g>
  <g id="SCENEID-pulse" data-cue="4">
${SLABS.map((x, i) => `    <rect id="SCENEID-glow${i}" x="${x}" y="150" width="104" height="440" rx="18" fill="{{accent}}"/>`).join("\n")}
  </g>
</svg>`,
    css: "",
    script: `// Layout (box 1700x732): "× 12" centre top · 12 slabs x 70-1626, y 150-590 · input/output
// under the ends. Block 6 (x 730-834) has an inside drawn in its own units at half scale
// (x 645-919, y 263-477): only legible with the camera in (viewBox 482 240.8 600 258.4,
// 2.83x), so it shows only then. overflow:hidden on the svg keeps the zoomed view in its box.
var slabs = [], glows = [];
for (var i = 0; i < 12; i++) {
  slabs.push("#SCENEID-slab" + i);
  glows.push("#SCENEID-glow" + i);
}
var links = root.querySelectorAll("#SCENEID-links line");
var row3 = ["#SCENEID-l20", "#SCENEID-l21", "#SCENEID-l22", "#SCENEID-l23", "#SCENEID-l24"];
var labels = ["#SCENEID-times", "#SCENEID-in", "#SCENEID-out"];
var wide = "0 0 1700 732";
var close = "482 240.8 600 258.4";

gsap.set("#SCENEID-svg", { attr: { viewBox: wide } });
gsap.set(slabs, { scaleY: 0, transformOrigin: "50% 100%" });
gsap.set(labels, { opacity: 0 });
gsap.set("#SCENEID-inside", { opacity: 0 });
gsap.set(links, { drawSVG: "0% 0%", opacity: 0 });
gsap.set(glows, { opacity: 0 });

// C1 1.0-4.8 "a stack of twelve identical blocks." — a staggered build, then the count lands.
tl.to(slabs, { scaleY: 1, duration: 0.6, ease: "expo.out", stagger: 0.12 }, 1.0);
tl.to(["#SCENEID-in", "#SCENEID-out"], { opacity: 1, duration: 0.4 }, 2.4);
tl.to("#SCENEID-times", { opacity: 1, duration: 0.5 }, 2.9);
tl.to(slabs, { y: -10, duration: 0.3, yoyo: true, repeat: 1, ease: "sine.inOut", stagger: 0.08 }, 3.4);

// C2 4.8-9.2 "Inside each one, attention" — the camera flies into block 6; the others become ghosts.
tl.to(labels, { opacity: 0, duration: 0.3 }, 4.85);
tl.to("#SCENEID-svg", { attr: { viewBox: close }, duration: 1.4, ease: "power3.inOut" }, 4.9);
tl.to(slabs, { opacity: 0.15, duration: 0.5 }, 5.9);
tl.to("#SCENEID-inside", { opacity: 1, duration: 0.5 }, 6.2);
tl.to("#SCENEID-att", { scale: 1.08, transformOrigin: "50% 50%", duration: 0.4, yoyo: true, repeat: 3, ease: "sine.inOut" }, 7.2);

// C3 9.2-13.6 "lets every token read from every other." — every link draws; one token's reads are the focus.
tl.to(links, { opacity: 0.35, duration: 0.01 }, 9.25);
tl.to(links, { drawSVG: "0% 100%", duration: 0.6, ease: "power2.out", stagger: 0.06 }, 9.3);
tl.to(row3, { opacity: 1, duration: 0.4 }, 11.4);
tl.to("#SCENEID-q2", { scale: 1.3, transformOrigin: "50% 50%", duration: 0.4, yoyo: true, repeat: 3 }, 11.6);

// C4 13.6-18.0 "the next block does it again, twelve times over." — out to the whole; block after block lights.
tl.to(["#SCENEID-inside", "#SCENEID-links"], { opacity: 0, duration: 0.3 }, 13.65);
tl.to(slabs, { opacity: 1, duration: 0.4 }, 13.9);
tl.to("#SCENEID-svg", { attr: { viewBox: wide }, duration: 1.3, ease: "power3.inOut" }, 13.9);
tl.to(labels, { opacity: 1, duration: 0.4 }, 15.0);
tl.to(glows, { opacity: 0.5, duration: 0.3, ease: "power2.out", stagger: 0.14 }, 15.3);`,
  },
};

/* ------------------------------------------------------- 3. curve + morph */

const growth: Reference = {
  name: "growth",
  shows:
    "a quantity being traced: axes draw, a curve draws while a tracking dot rides it and a counter reads the value, a plateau line lands, a second curve overtakes, and the gap between them MORPHS into the headline number",
  fits: [
    "bar-compare",
    "chart",
    "claim-figure",
    "equation",
    "equation-walk",
    "stat",
    "split-compare",
  ],
  cues: [
    { t0: 1.0, t1: 4.6, text: "Baseline accuracy rises with more training data" },
    { t0: 4.6, t1: 9.0, text: "but flattens out near seventy-one percent." },
    { t0: 9.0, t1: 13.4, text: "Our method keeps climbing, to eighty-three." },
    { t0: 13.4, t1: 17.8, text: "A twelve-point gain at the same data budget." },
  ],
  duration: 19,
  fragment: {
    markup: `<svg id="SCENEID-svg" width="1700" height="732" viewBox="0 0 1700 732" style="position:absolute;left:0;top:0;overflow:visible">
  <defs>
    <path id="SCENEID-badge-shape" d="M282 40 L658 40 Q680 40 680 62 L680 178 Q680 200 658 200 L282 200 Q260 200 260 178 L260 62 Q260 40 282 40 Z"/>
  </defs>
  <g id="SCENEID-axes" data-cue="1">
    <path id="SCENEID-axis" d="M220 40 L220 600 L1640 600" fill="none" stroke="{{muted}}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text id="SCENEID-xlab" x="930" y="668" font-size="48" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle">training data</text>
    <text id="SCENEID-ylab" x="110" y="320" font-size="48" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 110 320)">accuracy</text>
  </g>
  <g id="SCENEID-gain-area" data-cue="3">
    <path id="SCENEID-ours-area" d="M220 600" fill="{{accent}}" fill-opacity="0.18"/>
  </g>
  <g id="SCENEID-base" data-cue="1">
    <path id="SCENEID-base-curve" d="M220 600" fill="none" stroke="{{b}}" stroke-width="8" stroke-linecap="round"/>
    <circle id="SCENEID-base-dot" cx="220" cy="600" r="16" fill="{{b}}"/>
  </g>
  <g id="SCENEID-readout" data-cue="1">
    <text id="SCENEID-read" x="1560" y="420" font-size="96" font-weight="700" fill="{{b}}" text-anchor="end" dominant-baseline="middle">0</text>
    <text id="SCENEID-read-unit" x="1568" y="428" font-size="52" fill="{{b}}" dominant-baseline="middle">%</text>
  </g>
  <g id="SCENEID-plateau" data-cue="2">
    <rect id="SCENEID-ceiling" x="222" y="40" width="1418" height="254" fill="{{b}}" fill-opacity="0.16"/>
    <line id="SCENEID-plateau-line" x1="220" y1="296" x2="1640" y2="296" stroke="{{b}}" stroke-width="4" stroke-dasharray="14 14"/>
    <text id="SCENEID-plateau-label" x="430" y="252" font-size="52" fill="{{b}}" text-anchor="middle" dominant-baseline="middle">plateau</text>
  </g>
  <g id="SCENEID-ours" data-cue="3">
    <path id="SCENEID-gap" d="M1380 307 L1640 301 L1640 158 L1380 167 Z" fill="{{accent}}" fill-opacity="0.22"/>
    <path id="SCENEID-ours-curve" d="M220 600" fill="none" stroke="{{accent}}" stroke-width="10" stroke-linecap="round"/>
    <circle id="SCENEID-ours-dot" cx="220" cy="600" r="18" fill="{{accent}}"/>
  </g>
  <g id="SCENEID-gain" data-cue="4">
    <text id="SCENEID-gain-n" x="470" y="124" font-size="120" font-weight="800" fill="{{bg}}" text-anchor="middle" dominant-baseline="middle">+12</text>
  </g>
</svg>`,
    css: "",
    script: `// Layout (box 1700x732): y label x 86-134 · plot x 220-1640, y 40-600 · x label under it ·
// readout right of the plot (x 1440-1610, y 372-468), clear of both curves · a ceiling
// band above the plateau (C2) · the plot's empty top-left (x 260-680, y 40-200) is
// where the gap lands as the "+12" badge, clear of the rising curve.
// Both curves come from one function, so the tracking dot and the line agree.
function yAt(peak, u) { return 600 - (600 - peak) * (1 - Math.exp(-4 * u)); }
function trace(peak) {
  var d = "M220 600", pts = [];
  for (var i = 1; i <= 24; i++) {
    var u = i / 24, x = 220 + 1420 * u, y = yAt(peak, u);
    d += " L" + x.toFixed(1) + " " + y.toFixed(1);
    pts.push({ x: x - 220, y: y - 600 });
  }
  return { d: d, pts: pts };
}
var base = trace(296);
var ours = trace(150);
root.querySelector("#SCENEID-base-curve").setAttribute("d", base.d);
root.querySelector("#SCENEID-ours-curve").setAttribute("d", ours.d);
// The area under our curve: the extra accuracy, as a shape that fills the plot.
root.querySelector("#SCENEID-ours-area").setAttribute("d", ours.d + " L1640 600 Z");

gsap.set("#SCENEID-axis", { drawSVG: "0% 0%" });
gsap.set(["#SCENEID-xlab", "#SCENEID-ylab", "#SCENEID-readout"], { opacity: 0 });
gsap.set(["#SCENEID-base-curve", "#SCENEID-ours-curve"], { drawSVG: "0% 0%" });
gsap.set(["#SCENEID-base-dot", "#SCENEID-ours-dot"], { opacity: 0, x: 0, y: 0 });
gsap.set("#SCENEID-plateau-line", { drawSVG: "0% 0%" });
gsap.set("#SCENEID-plateau-label", { opacity: 0 });
gsap.set("#SCENEID-ceiling", { scaleY: 0, transformOrigin: "50% 100%" });
gsap.set("#SCENEID-gap", { opacity: 0 });
gsap.set("#SCENEID-ours-area", { opacity: 0 });
gsap.set("#SCENEID-gain", { opacity: 0 });

// C1 1.0-4.6 "Baseline accuracy rises with more training data" — axes, then the curve traced live.
tl.to("#SCENEID-axis", { drawSVG: "0% 100%", duration: 0.8, ease: "power2.inOut" }, 1.0);
tl.to(["#SCENEID-xlab", "#SCENEID-ylab"], { opacity: 1, duration: 0.4 }, 1.5);
tl.to(["#SCENEID-base-dot", "#SCENEID-readout"], { opacity: 1, duration: 0.3 }, 1.8);
tl.to("#SCENEID-base-curve", { drawSVG: "0% 100%", duration: 2.6, ease: "none" }, 1.9);
tl.to("#SCENEID-base-dot", { keyframes: base.pts, duration: 2.6, ease: "none" }, 1.9);
tl.to("#SCENEID-read", { textContent: 71, snap: { textContent: 1 }, duration: 2.6, ease: "power1.out" }, 1.9);

// C2 4.6-9.0 "but flattens out near seventy-one percent." — the ceiling, named where it is.
tl.to("#SCENEID-plateau-line", { drawSVG: "0% 100%", duration: 1.0, ease: "power2.inOut" }, 4.7);
tl.to("#SCENEID-plateau-label", { opacity: 1, duration: 0.4 }, 5.4);
tl.to("#SCENEID-ceiling", { scaleY: 1, duration: 0.9, ease: "power3.out" }, 5.6);
tl.to("#SCENEID-base-dot", { scale: 1.5, transformOrigin: "50% 50%", duration: 0.4, yoyo: true, repeat: 5, ease: "sine.inOut" }, 6.0);

// C3 9.0-13.4 "Our method keeps climbing, to eighty-three." — a second trace overtakes; the readout follows it.
tl.to(["#SCENEID-base-curve", "#SCENEID-base-dot", "#SCENEID-plateau"], { opacity: 0.3, duration: 0.5 }, 9.05);
tl.to(["#SCENEID-read", "#SCENEID-read-unit"], { fill: "{{accent}}", duration: 0.3 }, 9.1);
tl.to("#SCENEID-ours-dot", { opacity: 1, duration: 0.2 }, 9.2);
tl.to("#SCENEID-ours-curve", { drawSVG: "0% 100%", duration: 3.0, ease: "none" }, 9.3);
tl.to("#SCENEID-ours-dot", { keyframes: ours.pts, duration: 3.0, ease: "none" }, 9.3);
tl.to("#SCENEID-read", { textContent: 83, snap: { textContent: 1 }, duration: 3.0, ease: "power1.out" }, 9.3);
tl.to("#SCENEID-ours-area", { opacity: 1, duration: 0.8, ease: "power2.out" }, 12.4);

// C4 13.4-17.8 "A twelve-point gain at the same data budget." — the gap is shaded, then BECOMES the number.
tl.to("#SCENEID-gap", { opacity: 1, duration: 0.5 }, 13.5);
tl.to("#SCENEID-gap", { morphSVG: "#SCENEID-badge-shape", fillOpacity: 1, duration: 1.2, ease: "power3.inOut" }, 14.3);
tl.to("#SCENEID-gain", { opacity: 1, duration: 0.4 }, 15.4);
tl.to("#SCENEID-gain-n", { scale: 1.06, transformOrigin: "50% 50%", duration: 0.4, yoyo: true, repeat: 3, ease: "sine.inOut" }, 16.0);
// The end frame is the summary: the baseline comes back beside the gain it lost to.
tl.to(["#SCENEID-base-curve", "#SCENEID-base-dot", "#SCENEID-plateau"], { opacity: 1, duration: 0.5 }, 16.4);`,
  },
};

/* ------------------------------------------------- 4. before -> after */

/** Deterministic scatter: no Math.random anywhere in a seeked scene. */
const SPREAD = Array.from({ length: 24 }, (_, i) => {
  const h = (n: number) => {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };
  return { x: Math.round(160 + h(i + 1) * 1380), y: Math.round(210 + h(i + 31) * 380) };
});
/** The bell the same dots settle into: 9 bins, 1-2-3-4-4-4-3-2-1, filled in order of x. */
const BELL = (() => {
  const counts = [1, 2, 3, 4, 4, 4, 3, 2, 1];
  const slots: Array<[number, number]> = [];
  counts.forEach((c, b) => {
    for (let k = 0; k < c; k++) slots.push([850 + (b - 4) * 150, 596 - k * 68]);
  });
  const byX = SPREAD.map((p, i) => ({ i, x: p.x })).sort((a, b) => a.x - b.x);
  const to: Array<[number, number]> = new Array(24);
  byX.forEach((d, rank) => {
    to[d.i] = slots[rank] as [number, number];
  });
  return to;
})();
const OUTLIERS = [0, 7, 14, 21];

const gather: Reference = {
  name: "gather",
  shows:
    "one set of objects keeps its identity through a change of state: a scatter whose outliers are singled out, then every dot TRAVELS (staggered) into a bell on a shared axis, a band marks one standard deviation and a counter measures the spread shrinking",
  fits: ["split-compare", "bar-compare", "grid", "claim-figure", "definition", "concept"],
  cues: [
    { t0: 1.0, t1: 4.8, text: "Without normalization, activations spread wide," },
    { t0: 4.8, t1: 9.0, text: "and a few outliers dominate every update." },
    { t0: 9.0, t1: 13.4, text: "Normalizing reshapes them onto one standard scale," },
    { t0: 13.4, t1: 17.6, text: "cutting the spread from three point two to one." },
  ],
  duration: 18.8,
  fragment: {
    markup: `<svg id="SCENEID-svg" width="1700" height="732" viewBox="0 0 1700 732" style="position:absolute;left:0;top:0;overflow:visible">
  <g id="SCENEID-scale" data-cue="1">
    <line id="SCENEID-axis" x1="120" y1="652" x2="1580" y2="652" stroke="{{muted}}" stroke-width="5" stroke-linecap="round"/>
    <text id="SCENEID-lo" x="120" y="702" font-size="48" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle">−3σ</text>
    <text id="SCENEID-mid" x="850" y="702" font-size="48" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle">0</text>
    <text id="SCENEID-hi" x="1580" y="702" font-size="48" fill="{{muted}}" text-anchor="middle" dominant-baseline="middle">+3σ</text>
    <text id="SCENEID-sigma" x="850" y="60" font-size="96" font-weight="700" fill="{{fg}}" text-anchor="end" dominant-baseline="middle">σ =</text>
    <text id="SCENEID-sigma-n" x="880" y="60" font-size="96" font-weight="700" fill="{{fg}}" dominant-baseline="middle">3.2</text>
  </g>
  <g id="SCENEID-band" data-cue="4">
    <rect id="SCENEID-band-fill" x="700" y="130" width="300" height="500" rx="16" fill="{{accent}}" fill-opacity="0.16"/>
  </g>
  <g id="SCENEID-dots" data-cue="1">
${SPREAD.map((p, i) => `    <circle id="SCENEID-d${i}" cx="${p.x}" cy="${p.y}" r="${OUTLIERS.includes(i) ? 36 : 26}" fill="{{${OUTLIERS.includes(i) ? "d" : "a"}}}"/>`).join("\n")}
  </g>
  <g id="SCENEID-outliers" data-cue="2">
${OUTLIERS.map((i, k) => `    <circle id="SCENEID-ring${k}" cx="${SPREAD[i]?.x}" cy="${SPREAD[i]?.y}" r="54" fill="none" stroke="{{d}}" stroke-width="6"/>`).join("\n")}
    <text id="SCENEID-outlier-label" x="1600" y="60" font-size="52" fill="{{d}}" text-anchor="end" dominant-baseline="middle">outliers</text>
  </g>
  <g id="SCENEID-norm" data-cue="3">
    <text id="SCENEID-norm-label" x="200" y="60" font-size="52" fill="{{accent}}" dominant-baseline="middle">normalized</text>
  </g>
  <g id="SCENEID-band-tag" data-cue="4">
    <text id="SCENEID-band-label" x="850" y="176" font-size="64" font-weight="700" fill="{{accent}}" text-anchor="middle" dominant-baseline="middle">±1σ</text>
  </g>
</svg>`,
    css: "",
    script: `// Layout (box 1700x732): σ readout top centre · scatter x 150-1550, y 200-600 · axis at
// y 652 (x 120-1580) with −3σ/0/+3σ under it. The same 24 dots travel into a bell of
// 9 bins on that axis (x 250-1450, stacks up from y 600) — one set changing state,
// not two pictures — and a ±1σ band (x 700-1000) lands behind them.
var dots = [], rest = [], rings = [];
for (var i = 0; i < 24; i++) {
  dots.push("#SCENEID-d" + i);
  if (i % 7 !== 0) rest.push("#SCENEID-d" + i);
}
for (var k = 0; k < 4; k++) rings.push("#SCENEID-ring" + k);
var from = ${JSON.stringify(SPREAD.map((p) => [p.x, p.y]))};
var to = ${JSON.stringify(BELL)};

gsap.set(dots, { scale: 0, transformOrigin: "50% 50%", x: 0, y: 0 });
gsap.set("#SCENEID-axis", { drawSVG: "50% 50%" });
gsap.set(["#SCENEID-lo", "#SCENEID-mid", "#SCENEID-hi", "#SCENEID-sigma", "#SCENEID-sigma-n"], { opacity: 0 });
gsap.set(rings, { drawSVG: "0% 0%", opacity: 0 });
gsap.set("#SCENEID-outlier-label", { opacity: 0 });
gsap.set("#SCENEID-norm-label", { opacity: 0, x: -40 });
gsap.set("#SCENEID-band-fill", { scaleX: 0, transformOrigin: "50% 50%" });
gsap.set("#SCENEID-band-label", { opacity: 0 });

// C1 1.0-4.8 "activations spread wide," — the scatter lands, the scale opens under it.
tl.to(dots, { scale: 1, duration: 0.45, ease: "back.out(2)", stagger: 0.06 }, 1.0);
tl.to("#SCENEID-axis", { drawSVG: "0% 100%", duration: 1.1, ease: "power3.out" }, 2.4);
tl.to(["#SCENEID-lo", "#SCENEID-mid", "#SCENEID-hi"], { opacity: 1, duration: 0.4 }, 2.9);
tl.to(["#SCENEID-sigma", "#SCENEID-sigma-n"], { opacity: 1, duration: 0.4 }, 3.1);
tl.to(dots, { y: -8, duration: 0.5, yoyo: true, repeat: 1, ease: "sine.inOut", stagger: 0.03 }, 3.6);

// C2 4.8-9.0 "a few outliers dominate every update." — focus: rings draw on the four, the rest dim.
tl.to(rings, { opacity: 1, duration: 0.01, stagger: 0.2 }, 4.9);
tl.to(rings, { drawSVG: "0% 100%", duration: 0.6, ease: "power2.out", stagger: 0.2 }, 4.9);
tl.to("#SCENEID-outlier-label", { opacity: 1, duration: 0.4 }, 5.6);
tl.to(rest, { opacity: 0.3, duration: 0.5 }, 6.0);
tl.to(rings, { scale: 1.15, transformOrigin: "50% 50%", duration: 0.4, yoyo: true, repeat: 3, ease: "sine.inOut" }, 6.8);

// C3 9.0-13.4 "Normalizing reshapes them onto one standard scale," — every dot travels into the bell.
tl.to(rings.concat(["#SCENEID-outlier-label"]), { opacity: 0, duration: 0.4 }, 9.05);
tl.to(rest, { opacity: 1, duration: 0.4 }, 9.1);
tl.to("#SCENEID-norm-label", { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, 9.2);
for (var n = 0; n < 24; n++) {
  tl.to(dots[n], { x: to[n][0] - from[n][0], y: to[n][1] - from[n][1], attr: { r: 30 }, fill: "{{accent}}", duration: 1.2, ease: "power3.inOut" }, 9.5 + n * 0.07);
}

// C4 13.4-17.6 "cutting the spread from three point two to one." — the band opens, the number follows it.
tl.to("#SCENEID-band-fill", { scaleX: 1, duration: 0.9, ease: "power3.out" }, 13.5);
tl.to("#SCENEID-band-label", { opacity: 1, duration: 0.4 }, 14.1);
tl.to("#SCENEID-sigma-n", { textContent: 1, snap: { textContent: 0.1 }, fill: "{{accent}}", duration: 1.4, ease: "power3.inOut" }, 13.6);
tl.to(dots, { scale: 1.12, duration: 0.35, yoyo: true, repeat: 3, ease: "sine.inOut", stagger: 0.02 }, 15.3);`,
  },
};

/* ------------------------------------------------- 5. illustrated, camera */

/**
 * Round 3's reference: a scene BUILT AROUND THE BEAT'S ILLUSTRATION. The
 * picture is revealed by a masked wipe, drifts under the overlays (parallax),
 * and the shell's camera (`#SCENEID-cam`) pushes into one part while a callout
 * draws on around it, pans to the next part where vector nodes and flowing
 * links are drawn OVER the picture, and comes home for the summary. Every label
 * sits on a plate. Shown only to a beat that has an illustration; it uses
 * whatever picture that beat has, so its coordinates are a layout, not a map
 * of any particular picture.
 *
 * Camera arithmetic, written out in the script: to frame the box region
 * (x0, y0, w, h), scale s = min(W/w, H/h, 2.2), x = (W - w*s)/2 - x0*s,
 * y = (H - h*s)/2 - y0*s, with the wrapper's transform-origin at 0 0.
 */
const illustrated: Reference = {
  name: "illustrated",
  shows:
    "a scene built on the beat's ILLUSTRATION: a masked wipe reveals the picture, it drifts under the overlays (parallax), the CAMERA pushes into one part as a SPOTLIGHT (a shade with a soft hole) dims the rest and a callout ring draws around it, the hole and the camera pan to the next part where vector nodes and flowing links are drawn over the picture, and both return home for a counter that lands the point — every label on a plate, everything lit at the end",
  fits: [],
  cues: [
    { t0: 1.0, t1: 4.6, text: "A robot looks around the room." },
    { t0: 4.6, t1: 9.0, text: "Everything it sees" },
    { t0: 9.0, t1: 13.4, text: "becomes a graph of objects and relations," },
    { t0: 13.4, t1: 17.8, text: "which the language model reads in one pass." },
  ],
  duration: 19,
  fragment: {
    markup: `<svg id="SCENEID-svg" width="1700" height="732" viewBox="0 0 1700 732" style="position:absolute;left:0;top:0;overflow:hidden">
  <defs>
    <linearGradient id="SCENEID-fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.05" stop-color="#ffffff"/>
      <stop offset="0.95" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <mask id="SCENEID-feather"><rect x="-40" y="-40" width="1780" height="812" fill="url(#SCENEID-fade)"/></mask>
    <clipPath id="SCENEID-wipe"><rect id="SCENEID-wipe-bar" x="-40" y="-40" width="0" height="812"/></clipPath>
    <radialGradient id="SCENEID-soft"><stop offset="0.7" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></radialGradient>
    <mask id="SCENEID-hole"><rect x="-40" y="-40" width="1780" height="812" fill="#ffffff"/><circle id="SCENEID-hole-c" cx="400" cy="420" r="230" fill="url(#SCENEID-soft)"/></mask>
  </defs>
  <g id="SCENEID-art" data-cue="1" clip-path="url(#SCENEID-wipe)" mask="url(#SCENEID-feather)">
    <image id="SCENEID-pic" data-art="1" x="-30" y="-20" width="1760" height="772" preserveAspectRatio="xMidYMid slice"/>
    <rect id="SCENEID-shade" x="-40" y="-40" width="1780" height="812" fill="{{bg}}" mask="url(#SCENEID-hole)"/>
  </g>
  <g id="SCENEID-fg">
    <g id="SCENEID-spot" data-cue="2">
      <circle id="SCENEID-ring" cx="400" cy="420" r="180" fill="none" stroke="{{accent}}" stroke-width="8" stroke-linecap="round"/>
      <rect id="SCENEID-view-plate" x="435" y="82" width="320" height="96" rx="22" fill="{{panel}}" stroke="{{accent}}" stroke-width="5"/>
      <text id="SCENEID-view" x="595" y="130" font-size="60" font-weight="700" fill="{{fg}}" text-anchor="middle" dominant-baseline="middle">the view</text>
    </g>
    <g id="SCENEID-graph" data-cue="3">
      <line id="SCENEID-e12" x1="1000" y1="290" x2="1460" y2="290" stroke="{{accent}}" stroke-width="7" stroke-linecap="round"/>
      <line id="SCENEID-e13" x1="1000" y1="290" x2="1230" y2="540" stroke="{{accent}}" stroke-width="7" stroke-linecap="round"/>
      <line id="SCENEID-e23" x1="1460" y1="290" x2="1230" y2="540" stroke="{{accent}}" stroke-width="7" stroke-linecap="round"/>
      <circle id="SCENEID-p12" cx="1000" cy="290" r="13" fill="{{fg}}"/>
      <circle id="SCENEID-p13" cx="1000" cy="290" r="13" fill="{{fg}}"/>
      <circle id="SCENEID-p23" cx="1460" cy="290" r="13" fill="{{fg}}"/>
      <circle id="SCENEID-n1" cx="1000" cy="290" r="52" fill="{{a}}" stroke="{{bg}}" stroke-width="6"/>
      <circle id="SCENEID-n2" cx="1460" cy="290" r="52" fill="{{b}}" stroke="{{bg}}" stroke-width="6"/>
      <circle id="SCENEID-n3" cx="1230" cy="540" r="52" fill="{{c}}" stroke="{{bg}}" stroke-width="6"/>
      <rect id="SCENEID-graph-plate" x="1040" y="88" width="370" height="84" rx="22" fill="{{panel}}" stroke="{{rule}}" stroke-width="5"/>
      <text id="SCENEID-graph-label" x="1225" y="130" font-size="56" font-weight="700" fill="{{fg}}" text-anchor="middle" dominant-baseline="middle">a graph</text>
    </g>
    <g id="SCENEID-sum" data-cue="4">
      <rect id="SCENEID-sum-plate" x="640" y="598" width="590" height="128" rx="30" fill="{{panel}}" stroke="{{accent}}" stroke-width="5"/>
      <text id="SCENEID-n" x="712" y="662" font-size="96" font-weight="700" fill="{{accent}}" text-anchor="middle" dominant-baseline="middle">0</text>
      <text id="SCENEID-sum-label" x="770" y="662" font-size="52" fill="{{fg}}" dominant-baseline="middle">objects, one pass</text>
    </g>
  </g>
</svg>`,
    css: "",
    script: `// Layout (box 1700x732): the picture full-bleed under everything (masked edges) ·
// "the view" plate x 435-755, y 82-178 over the callout ring (cx 400, cy 420, r 180:
// x 220-580, y 240-600) · nodes at (1000,290) (1460,290) (1230,540), r 52, "a graph"
// plate x 1040-1410, y 88-172 · summary plate x 640-1230, y 598-726 (the 96px count is 120px
// tall: the plate is taller than that, and the pulse is the plate's, not the number's).
// Camera (wrapper, origin 0 0): part 1 = region x 130-770, y 90-630 -> s = 732/540 =
// 1.356, x = (1700 - 640*1.356)/2 - 130*1.356 = 240, y = -90*1.356 = -122. Part 2 =
// region x 880-1640, y 90-650 -> s = 732/560 = 1.307, x = (1700 - 760*1.307)/2 - 880*1.307
// = -797, y = -90*1.307 = -118. Home = scale 1, x 0, y 0.
var nodes = ["#SCENEID-n1", "#SCENEID-n2", "#SCENEID-n3"];
var edges = ["#SCENEID-e12", "#SCENEID-e13", "#SCENEID-e23"];
var dots = ["#SCENEID-p12", "#SCENEID-p13", "#SCENEID-p23"];

gsap.set("#SCENEID-cam", { scale: 1, x: 0, y: 0, transformOrigin: "0 0" });
gsap.set("#SCENEID-wipe-bar", { attr: { width: 0 } });
gsap.set("#SCENEID-pic", { opacity: 0, x: 0 });
gsap.set("#SCENEID-fg", { x: 0 });
gsap.set("#SCENEID-ring", { drawSVG: "0% 0%" });
gsap.set(["#SCENEID-view-plate", "#SCENEID-view"], { opacity: 0 });
gsap.set(nodes, { scale: 0, transformOrigin: "50% 50%" });
gsap.set(edges, { drawSVG: "0% 0%" });
gsap.set(dots, { opacity: 0 });
gsap.set(["#SCENEID-graph-plate", "#SCENEID-graph-label"], { opacity: 0 });
gsap.set(["#SCENEID-sum-plate", "#SCENEID-n", "#SCENEID-sum-label"], { opacity: 0 });
gsap.set("#SCENEID-shade", { opacity: 0 });
gsap.set("#SCENEID-hole-c", { attr: { cx: 400, cy: 420, r: 230 } });

// C1 1.0-4.6 "A robot looks around the room." — the picture wipes in left to right, then drifts (parallax).
tl.to("#SCENEID-pic", { opacity: 1, duration: 0.3 }, 1.0);
tl.to("#SCENEID-wipe-bar", { attr: { width: 1780 }, duration: 1.4, ease: "power2.inOut" }, 1.05);
tl.to("#SCENEID-pic", { x: -24, duration: 16.5, ease: "none" }, 1.0);
tl.to("#SCENEID-fg", { x: -40, duration: 16.5, ease: "none" }, 1.0);

// C2 4.6-9.0 "Everything it sees" — the camera pushes into part 1; the callout ring draws on; its label lands.
tl.to("#SCENEID-cam", { scale: 1.356, x: 240, y: -122, duration: 1.3, ease: "power3.inOut" }, 4.65);
// The SPOTLIGHT: a shade over the picture with a soft hole where the voice is — the
// picture's other subjects step back without being cut out of it.
tl.to("#SCENEID-shade", { opacity: 0.6, duration: 0.6 }, 5.0);
tl.to("#SCENEID-ring", { drawSVG: "0% 100%", duration: 1.1, ease: "power2.out" }, 5.4);
tl.to(["#SCENEID-view-plate", "#SCENEID-view"], { opacity: 1, duration: 0.4 }, 6.3);
tl.to("#SCENEID-ring", { scale: 1.06, transformOrigin: "50% 50%", duration: 0.5, yoyo: true, repeat: 3, ease: "sine.inOut" }, 6.9);

// C3 9.0-13.4 "becomes a graph of objects and relations," — pan to part 2; the spotlight follows;
// nodes pop in a stagger, links draw, and dots flow along them.
tl.to("#SCENEID-cam", { scale: 1.307, x: -797, y: -118, duration: 1.4, ease: "power3.inOut" }, 9.05);
tl.to("#SCENEID-hole-c", { attr: { cx: 1230, cy: 400, r: 330 }, duration: 1.4, ease: "power3.inOut" }, 9.05);
// A label the pan would crop at the box edge steps out for the move, and back with the pull-out.
tl.to(["#SCENEID-view-plate", "#SCENEID-view"], { opacity: 0, duration: 0.3 }, 9.05);
tl.to(nodes, { scale: 1, duration: 0.5, ease: "back.out(2)", stagger: 0.18 }, 9.7);
tl.to(edges, { drawSVG: "0% 100%", duration: 0.7, ease: "power2.out", stagger: 0.15 }, 10.3);
tl.to(["#SCENEID-graph-plate", "#SCENEID-graph-label"], { opacity: 1, duration: 0.4 }, 10.6);
tl.to(dots, { opacity: 1, duration: 0.2 }, 11.0);
tl.to("#SCENEID-p12", { attr: { cx: 1460 }, duration: 1.1, repeat: 5, ease: "none" }, 11.0);
tl.to("#SCENEID-p13", { attr: { cx: 1230, cy: 540 }, duration: 1.1, repeat: 5, ease: "none" }, 11.15);
tl.to("#SCENEID-p23", { attr: { cx: 1230, cy: 540 }, duration: 1.1, repeat: 5, ease: "none" }, 11.3);

// C4 13.4-17.8 "which the language model reads in one pass." — home; the shade lifts;
// the count lands on its plate. The end frame is the whole scene, lit.
tl.to("#SCENEID-cam", { scale: 1, x: 0, y: 0, duration: 1.3, ease: "power3.inOut" }, 13.45);
tl.to("#SCENEID-shade", { opacity: 0, duration: 0.6 }, 13.6);
tl.to(["#SCENEID-view-plate", "#SCENEID-view"], { opacity: 1, duration: 0.4 }, 14.2);
tl.to(["#SCENEID-sum-plate", "#SCENEID-n", "#SCENEID-sum-label"], { opacity: 1, duration: 0.4 }, 14.6);
tl.to("#SCENEID-n", { textContent: 3, snap: { textContent: 1 }, duration: 1.0, ease: "power2.out" }, 14.7);
tl.to("#SCENEID-sum-plate", { strokeWidth: 10, duration: 0.35, yoyo: true, repeat: 3, ease: "sine.inOut" }, 15.9);`,
  },
};

export const REFERENCES: readonly Reference[] = [route, zoom, growth, gather, illustrated];

/** Whether a reference places the beat's illustration (and so needs a beat that has one). */
export function placesArt(r: Reference): boolean {
  return /\sdata-art=/.test(r.fragment.markup);
}

/** The palette tokens a reference may use. */
type PaintKey = "bg" | "fg" | "muted" | "dim" | "rule" | "panel" | "accent" | "a" | "b" | "c" | "d";

/** A reference with its `{{token}}` colours filled from `theme`. */
export function paint(f: Fragment, theme: Theme): Fragment {
  const colour: Record<PaintKey, string> = {
    bg: theme.bg,
    fg: theme.fg,
    muted: theme.muted,
    dim: theme.dim,
    rule: theme.rule,
    panel: theme.panel,
    accent: theme.accent,
    ...theme.tones,
  };
  const fill = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in colour ? colour[k as PaintKey] : m));
  return { markup: fill(f.markup), css: fill(f.css), script: fill(f.script) };
}

/**
 * The two references a beat is shown: the best fit for its archetype first,
 * then the best fit that teaches a DIFFERENT motion, so every prompt carries
 * at least two verbs beyond fade-and-draw.
 */
export function pickReferences(archetype: string, n = 2, art = false): Reference[] {
  const rank = (r: Reference) => {
    const i = r.fits.indexOf(archetype);
    return i < 0 ? 99 : i;
  };
  const plain = REFERENCES.filter((r) => !placesArt(r));
  const sorted = [...plain].sort(
    (a, b) => rank(a) - rank(b) || plain.indexOf(a) - plain.indexOf(b),
  );
  // A beat with an illustration is shown how to build on one first.
  const lead = art ? REFERENCES.filter(placesArt) : [];
  return [...lead, ...sorted].slice(0, n);
}
