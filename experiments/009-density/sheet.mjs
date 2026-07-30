/** Before/after contact sheet: twelve pairs, one PNG, no external assets. */
import { readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const SHELL = "/Users/neo/.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-152.0.7928.2/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const dir = "/Users/neo/Developer/Projects/DeckSmith/experiments/009-density";
const before = JSON.parse(readFileSync(`${dir}/before.json`, "utf8"));
const after = JSON.parse(readFileSync(`${dir}/after.json`, "utf8"));
const NAMES = ["title","pipeline","annotated-figure","grid","equation-walk","stack","split-compare","bar-compare","data-table","line-chart","claim-figure","callout"];
const uri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const rows = NAMES.map((name, i) => {
  const sid = `s${i + 1}`;
  const b = before[i], a = after[i];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  return `<tr>
    <th>${name}</th>
    <td><img src="${uri(`${dir}/before/${sid}.png`)}"><div class="m">fill ${pct(b.fill)} · ink ${pct(b.inkFill)} · biggest hole ${pct(b.gap.frac)}</div></td>
    <td><img src="${uri(`${dir}/after/${sid}.png`)}"><div class="m ok">fill ${pct(a.fill)} · ink ${pct(a.inkFill)} · biggest hole ${pct(a.gap.frac)}</div></td>
  </tr>`;
}).join("");

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;color:#ddd;font:16px/1.4 -apple-system,system-ui,sans-serif;width:2560px}
h1{margin:28px 32px 6px;font-size:30px;color:#fff}
p.sub{margin:0 32px 22px;color:#8b96a3;font-size:18px}
table{border-collapse:collapse;width:100%}
th{width:210px;text-align:left;padding:0 20px;font-size:19px;color:#fff;vertical-align:middle}
td{padding:9px 12px;width:1160px}
img{width:1160px;display:block;border:1px solid #2a2f36}
.m{font-size:15px;color:#8b96a3;padding-top:6px;font-variant-numeric:tabular-nums}
.m.ok{color:#7cc4ff}
thead td{color:#fff;font-size:21px;padding-bottom:0}
</style>
<h1>slide-density — twelve archetypes, before and after</h1>
<p class="sub">Demo deck at 1920&times;1080, every scene seeked to its settled frame. "fill" is the content bounding box over the canvas; "ink" is the union area of the painted marks; "biggest hole" is the largest empty rectangle.</p>
<table><thead><tr><th></th><td>BEFORE</td><td>AFTER</td></tr></thead><tbody>${rows}</tbody></table>`;

writeFileSync(`${dir}/sheet.html`, html);
const browser = await puppeteer.launch({ executablePath: SHELL, args: ["--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 2560, height: 1400, deviceScaleFactor: 1 });
await page.goto(`file://${dir}/sheet.html`, { waitUntil: "load" });
await page.screenshot({ path: `${dir}/before-after.png`, fullPage: true });
await browser.close();
console.log("wrote before-after.png");
