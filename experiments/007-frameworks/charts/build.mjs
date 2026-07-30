// Build three 1920x1080 slides of the SAME beat (demo/storyboard.json b10):
//   A. hand-rolled  — DeckSmith's real lineChart emitter, imported unmodified
//   B. plot         — Observable Plot geometry + DeckSmith choreography
//   C. vega-lite    — Vega-Lite geometry + DeckSmith choreography
// All three are driven by the same paused GSAP timeline and seeked, never played.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { lineChart, baseCss, resolveTheme } from "./out/emitter.mjs";

const BEAT = JSON.parse(readFileSync("../../../demo/storyboard.json", "utf8")).beats.find(
  (b) => b.archetype === "line-chart",
);
const P = BEAT.params;
const FORMAT = { width: 1920, height: 1080, fps: 60 };
const theme = resolveTheme("ink");
mkdirSync("out", { recursive: true });

// ---------------------------------------------------------------- A. ours
const ours = lineChart(BEAT, { sid: "sA", theme, format: FORMAT, source: {} });

// -------------------------------------------------- shared chrome + choreo
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const chrome = (sid) =>
  `<div class="eyebrow" id="${sid}-e">${esc(P.eyebrow)}</div>\n<h2 class="headline" id="${sid}-h">${esc(P.headline)}</h2>`;
const tween = (t, f, to, at) => `tl.fromTo("${t}", ${f}, ${to}, ${at});`;

/** Byte-for-byte the same reveal schedule the real emitter writes, retargeted. */
function choreography(sid, length) {
  const draw = 0.8;
  const step = Math.min(0.45, 1.8 / P.points.length);
  const drawn = draw + step * P.points.length + 0.4;
  return {
    drawn,
    tl: [
      tween(`#${sid}-e`, "{ opacity: 0, y: 14 }", "{ opacity: 1, y: 0, duration: 0.5 }", 0.15),
      tween(`#${sid}-h`, "{ opacity: 0, y: 22 }", "{ opacity: 1, y: 0, duration: 0.6 }", 0.3),
      tween(
        `#${sid}-line`,
        `{ strokeDasharray: ${length}, strokeDashoffset: ${length} }`,
        '{ strokeDashoffset: 0, duration: 1.8, ease: "none" }',
        draw,
      ),
      tween(
        `#${sid} .dot`,
        '{ opacity: 0, scale: 0, transformOrigin: "center" }',
        `{ opacity: 1, scale: 1, transformOrigin: "center", duration: 0.3, stagger: ${step} }`,
        draw,
      ),
      tween(`#${sid} .pv`, "{ opacity: 0 }", `{ opacity: 1, duration: 0.3, stagger: ${step} }`, draw + 0.2),
      tween(
        `#${sid} .dv`,
        "{ opacity: 0, y: -10 }",
        `{ opacity: 1, y: 0, duration: 0.35, stagger: ${step} }`,
        draw + 0.6,
      ),
      tween(`#${sid}-read`, "{ opacity: 0, x: 24 }", "{ opacity: 1, x: 0, duration: 0.7 }", drawn),
    ],
  };
}

/** Polyline length — same closed-form the emitter uses, no getTotalLength(). */
const polyLen = (pts) =>
  pts.reduce((t, p, i) => (i === 0 ? 0 : t + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])), 0);

// ---------------------------------------------------------------- B. Plot
async function buildPlot(sid) {
  const Plot = await import("@observablehq/plot");
  const { parseHTML } = await import("linkedom");
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const data = P.points.map((p, i) => ({ ...p, i }));
  const fig = Plot.plot({
    document,
    width: 1120,
    height: 600,
    marginLeft: 150,
    marginRight: 60,
    marginTop: 96,
    marginBottom: 140,
    style: { fontSize: "40px", background: "none", color: theme.dim, overflow: "visible" },
    x: { label: P.xLabel, domain: data.map((d) => d.x), padding: 0, labelOffset: 90, tickSize: 0 },
    y: { label: `↑ ${P.yLabel}`.slice(2), grid: true, nice: true, labelOffset: 130, labelAnchor: "top", ticks: 3, tickSize: 0, labelArrow: "none" },
    marks: [
      Plot.line(data, { x: "x", y: "y", stroke: theme.accent, strokeWidth: 5, curve: "linear" }),
      Plot.dot(data, {
        x: "x",
        y: "y",
        fill: (d) => (d.i === data.length - 1 ? theme.tones.b : theme.accent),
        r: 9,
        symbol: "circle",
      }),
      Plot.text(data, { x: "x", y: "y", text: (d) => String(d.y), dy: -32, fontSize: 40, fill: theme.fg, fontWeight: 600 }),
    ],
  });
  // --- glue an emitter would have to carry: make Plot's output GSAP-addressable
  const svg = /^svg$/i.test(fig.tagName) ? fig : fig.querySelector("svg");
  if (!svg) throw new Error(`Plot returned <${fig.tagName}> with no <svg>`);
  svg.setAttribute("id", `${sid}-svg`);
  const lineG = svg.querySelector('[aria-label="line"]');
  const linePath = lineG.querySelector("path");
  linePath.setAttribute("id", `${sid}-line`);
  const pts = [...linePath.getAttribute("d").matchAll(/([-\d.]+),([-\d.]+)/g)].map((m) => [
    +m[1],
    +m[2],
  ]);
  for (const c of svg.querySelectorAll('[aria-label="dot"] > *')) c.setAttribute("class", "dot");
  for (const t of svg.querySelectorAll('[aria-label="text"] text')) t.setAttribute("class", "pv");
  // Plot has no delta-annotation mark: hand-place them from the line's own geometry.
  const deltaG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  deltaG.setAttribute("class", "deltag");
  deltaG.setAttribute("text-anchor", "middle");
  deltaG.innerHTML = P.deltas
    .map((d, i) => {
      const a = pts[i];
      const b = pts[i + 1];
      return `<text class="dv" x="${(a[0] + b[0]) / 2}" y="${Math.max(44, (a[1] + b[1]) / 2 - 28)}">${esc(d)}</text>`;
    })
    .join("");
  svg.appendChild(deltaG);
  const html = `${chrome(sid)}
<div class="chartwrap">${svg.outerHTML}<div class="readout" id="${sid}-read">${esc(P.readout)}</div></div>`;
  return { html, ...choreography(sid, polyLen(pts)) };
}

// ------------------------------------------------------------ C. Vega-Lite
async function buildVega(sid) {
  const vl = await import("vega-lite");
  const vega = await import("vega");
  const enc = {
    x: { field: "x", type: "ordinal", title: P.xLabel, axis: { labelAngle: 0 } },
    y: { field: "y", type: "quantitative", scale: { zero: false, nice: true }, title: P.yLabel, axis: { tickCount: 3, titleAngle: 0, titleAlign: "left", titleX: -150, titleY: -46, grid: true } },
  };
  const spec = vl.compile({
    width: 830,
    height: 364,
    padding: 5,
    data: { values: P.points },
    config: {
      background: null,
      view: { stroke: null },
      axis: {
        labelFontSize: 40,
        titleFontSize: 40,
        labelColor: theme.dim,
        titleColor: theme.muted,
        gridColor: theme.rule,
        domainColor: theme.rule,
        tickColor: theme.rule,
        labelPadding: 14,
        titlePadding: 34,
      },
    },
    layer: [
      { mark: { type: "line", strokeWidth: 5, color: theme.accent }, encoding: enc },
      { mark: { type: "point", filled: true, size: 220, color: theme.accent }, encoding: enc },
      {
        mark: { type: "text", dy: -36, fontSize: 40, color: theme.fg, fontWeight: 600 },
        encoding: { ...enc, text: { field: "y", type: "nominal" } },
      },
    ],
  }).spec;
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  let svg = await view.toSVG();
  // --- glue: Vega's own class names are semantic, but nothing is id'd or
  //     positioned in page coordinates, so deltas still need the raw points.
  svg = svg
    .replace(/class="mark-line role-mark[^"]*"/, 'class="mark-line role-mark vline"')
    .replace(/class="mark-symbol role-mark[^"]*"/, 'class="mark-symbol role-mark vdots"')
    .replace(/class="mark-text role-mark[^"]*"/, 'class="mark-text role-mark vvals"');
  const m = svg.match(/class="mark-line role-mark vline"[\s\S]*?<path [^>]*\bd="([^"]+)"/);
  const linePts = [...m[1].matchAll(/([-\d.]+),([-\d.]+)/g)].map((q) => [+q[1], +q[2]]);
  svg = svg.replace(/(class="mark-line role-mark vline"[\s\S]*?)<path /, `$1<path id="${sid}-line" `);
  svg = svg.replace(/<svg /, `<svg id="${sid}-svg" `);
  // dots / values get their GSAP classes via CSS-descendant selectors instead.
  const html = `${chrome(sid)}
<div class="chartwrap">${svg}<div class="readout" id="${sid}-read">${esc(P.readout)}</div></div>`;
  const c = choreography(sid, polyLen(linePts));
  // retarget .dot/.pv onto vega's own groups; deltas do not exist in the spec.
  c.tl = c.tl
    .map((s) => s.replace(`#${sid} .dot`, `#${sid} .vdots path`).replace(`#${sid} .pv`, `#${sid} .vvals text`))
    .filter((s) => !s.includes(".dv"));
  return { html, ...c };
}

// ------------------------------------------------------------------ page
const CHROME_CSS = [
  `.eyebrow{font-size:40px;line-height:1.2;letter-spacing:.14em;text-transform:uppercase;color:${theme.muted};font-weight:500;margin-bottom:22px}`,
  `.headline{font-size:66px;line-height:1.15;font-weight:700;letter-spacing:-.015em;color:${theme.fg}}`,
  ".chartwrap{display:flex;gap:60px;align-items:center;margin-top:24px}",
  `.readout{font-size:40px;line-height:1.35;color:${theme.muted};max-width:520px}`,
  `.dv,.deltag text{font-size:40px;fill:${theme.tones.b};font-weight:600}`,
].join("\n");

const scenes = { A: { ...ours, sid: "sA", label: "hand-rolled (DeckSmith today)" } };
const plot = await buildPlot("sB");
scenes.B = { ...plot, sid: "sB", label: "Observable Plot geometry" };
const veg = await buildVega("sC");
scenes.C = { ...veg, sid: "sC", label: "Vega-Lite geometry" };

for (const [k, s] of Object.entries(scenes)) {
  const page = `<!doctype html><html><head><meta charset="utf-8">
<script src="../gsap.min.js"></script>
<style>
${baseCss(theme, FORMAT)}
${ours.css}
${CHROME_CSS}
.tag{position:absolute;right:40px;bottom:24px;font-size:28px;color:${theme.dim};letter-spacing:.08em}
</style></head><body>
<div class="scene clip" id="${s.sid}" style="padding:90px 110px">
${s.html}
<div class="tag">${s.label}</div>
</div>
<script>
var tl = gsap.timeline({ paused: true });
${s.tl.join("\n")}
window.__timelines = window.__timelines || {};
window.__timelines["${s.sid}"] = tl;
window.__seek = function(t){ tl.pause(); tl.time(t); };
window.__dur = tl.duration();
</script></body></html>`;
  writeFileSync(`out/slide-${k}.html`, page);
}

writeFileSync(
  "out/meta.json",
  JSON.stringify(
    Object.fromEntries(
      Object.entries(scenes).map(([k, s]) => [
        k,
        {
          label: s.label,
          sid: s.sid,
          htmlBytes: Buffer.byteLength(s.html),
          tlStatements: s.tl.length,
          sha: createHash("sha256").update(s.html).digest("hex").slice(0, 16),
        },
      ]),
    ),
    null,
    2,
  ),
);
console.log(readFileSync("out/meta.json", "utf8"));
