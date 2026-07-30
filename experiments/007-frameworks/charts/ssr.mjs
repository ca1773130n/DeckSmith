// SSR spike: can each candidate emit SVG in Node, offline, deterministically?
// Data = the five-point PSNR sweep from demo/storyboard.json beat b10.
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

export const DATA = [
  { x: "T=0", y: 28.91 },
  { x: "T=1", y: 29.88 },
  { x: "T=2", y: 30.18 },
  { x: "T=3", y: 30.38 },
  { x: "T=4", y: 30.47 },
];
const W = 1120;
const H = 600;

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
const out = (name, s) => {
  writeFileSync(new URL(`./out/${name}`, import.meta.url), s);
  return s;
};
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const results = [];
const time = async (name, fn) => {
  const t0 = process.hrtime.bigint();
  let svg, err = null;
  try {
    svg = await fn();
  } catch (e) {
    err = e;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (err) {
    results.push({ name, ok: false, note: err.message.slice(0, 120) });
    return;
  }
  // second render for determinism
  const t1 = process.hrtime.bigint();
  const svg2 = await fn();
  const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;
  out(`${name}.svg`, svg);
  results.push({
    name,
    ok: true,
    bytes: Buffer.byteLength(svg),
    ms: +ms.toFixed(1),
    ms2: +ms2.toFixed(1),
    sha: sha(svg),
    identical: sha(svg) === sha(svg2),
    texts: (svg.match(/<text/g) || []).length,
    paths: (svg.match(/<path/g) || []).length,
    hasStyleBlock: /<style/.test(svg),
    inlineFontSize: (svg.match(/font-size/g) || []).length,
    hasAnimate: /<animate|@keyframes|animation:/.test(svg),
  });
};

// ---------- 1. Observable Plot (needs a DOM) ----------
await time("plot", async () => {
  const Plot = await import("@observablehq/plot");
  const { parseHTML } = await import("linkedom");
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const fig = Plot.plot({
    document,
    width: W,
    height: H,
    marginLeft: 150,
    marginBottom: 140,
    marginTop: 96,
    marginRight: 60,
    style: { fontSize: "40px", background: "transparent", color: "#e8e8ea" },
    x: { label: "thought ticks", domain: DATA.map((d) => d.x) },
    y: { label: "PSNR-Y (dB)", grid: true, nice: true },
    marks: [
      Plot.line(DATA, { x: "x", y: "y", stroke: "#7c9cff", strokeWidth: 5, curve: "linear" }),
      Plot.dot(DATA, { x: "x", y: "y", fill: "#7c9cff", r: 9 }),
      Plot.text(DATA, { x: "x", y: "y", text: (d) => String(d.y), dy: -30, fontSize: 40 }),
    ],
  });
  return fig.outerHTML;
});

// ---------- 2. Vega-Lite -> Vega -> SVG ----------
await time("vega-lite", async () => {
  const vl = await import("vega-lite");
  const vega = await import("vega");
  const spec = vl.compile({
    width: W - 210,
    height: H - 236,
    data: { values: DATA },
    config: {
      background: null,
      axis: { labelFontSize: 40, titleFontSize: 40, labelColor: "#9aa0aa", titleColor: "#c8ccd4" },
      view: { stroke: null },
    },
    layer: [
      {
        mark: { type: "line", strokeWidth: 5, color: "#7c9cff", point: { size: 300, filled: true } },
        encoding: {
          x: { field: "x", type: "ordinal", title: "thought ticks" },
          y: { field: "y", type: "quantitative", scale: { zero: false }, title: "PSNR-Y (dB)" },
        },
      },
      {
        mark: { type: "text", dy: -34, fontSize: 40, color: "#e8e8ea", fontWeight: 600 },
        encoding: {
          x: { field: "x", type: "ordinal" },
          y: { field: "y", type: "quantitative" },
          text: { field: "y", type: "nominal" },
        },
      },
    ],
  }).spec;
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  return await view.toSVG();
});

// ---------- 3. ECharts SSR ----------
await time("echarts", async () => {
  const echarts = await import("echarts");
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: W, height: H });
  chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 150, right: 60, top: 96, bottom: 140 },
    xAxis: {
      type: "category",
      data: DATA.map((d) => d.x),
      name: "thought ticks",
      nameLocation: "middle",
      nameGap: 80,
      axisLabel: { fontSize: 40, color: "#9aa0aa" },
      nameTextStyle: { fontSize: 40, color: "#c8ccd4" },
    },
    yAxis: {
      type: "value",
      scale: true,
      name: "PSNR-Y (dB)",
      axisLabel: { fontSize: 40, color: "#9aa0aa" },
      nameTextStyle: { fontSize: 40, color: "#c8ccd4" },
      splitLine: { lineStyle: { color: "#2a2d34" } },
    },
    series: [
      {
        type: "line",
        data: DATA.map((d) => d.y),
        lineStyle: { width: 5, color: "#7c9cff" },
        itemStyle: { color: "#7c9cff" },
        symbolSize: 18,
        label: { show: true, fontSize: 40, color: "#e8e8ea", position: "top", distance: 14 },
      },
    ],
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
});

// ---------- 4. D3 primitives only (scale + shape, no DOM, no d3-selection) ----------
await time("d3-primitives", async () => {
  const { scalePoint, scaleLinear } = await import("d3-scale");
  const { line } = await import("d3-shape");
  const x = scalePoint()
    .domain(DATA.map((d) => d.x))
    .range([150, W - 60]);
  const y = scaleLinear()
    .domain([28.5, 30.5])
    .nice()
    .range([H - 140, 96]);
  const path = line()
    .x((d) => x(d.x))
    .y((d) => y(d.y))(DATA);
  const ticks = y.ticks(5);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<g class="grid">${ticks.map((t) => `<line x1="150" y1="${y(t)}" x2="${W - 60}" y2="${y(t)}"/>`).join("")}</g>
<g class="axlab" text-anchor="end">${ticks.map((t) => `<text x="128" y="${y(t) + 13}">${t.toFixed(1)}</text>`).join("")}</g>
<path class="chartline" d="${path}" fill="none" stroke="#7c9cff"/>
${DATA.map((d) => `<circle class="dot" cx="${x(d.x)}" cy="${y(d.y)}" r="9"/>`).join("")}
</svg>`;
});

console.table(results);
writeFileSync(new URL("./out/ssr-results.json", import.meta.url), JSON.stringify(results, null, 2));
