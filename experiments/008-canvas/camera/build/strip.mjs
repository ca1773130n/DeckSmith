/**
 * Compose a labelled filmstrip from captured frames, so a transition can be
 * judged as a sequence rather than as six files someone has to open in order.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HERE } from "./common.mjs";
import { open } from "./browser.mjs";

const shots = join(HERE, "..", "shots");

const STRIPS = [
  {
    out: "strip-move1.png",
    title: "Camera move 1 — the whole method → inside the Window stage (1.4s)",
    frames: [
      ["m1-9.png", "t=9.00  stop p1.5 (last reveal)"],
      ["m1-9_35.png", "t=9.35  push-in begins"],
      ["m1-9_7.png", "t=9.70  k=2.23"],
      ["m1-10_05.png", "t=10.05  k=3.94, plate A gone"],
      ["m1-10_4.png", "t=10.40  landed, k=4.994"],
      ["m1-11_3.png", "t=11.30  stop p2.0"],
    ],
  },
  {
    out: "strip-move2.png",
    title: "Camera move 2 — out of Window, across the method, into DQ-CTM (2.2s)",
    frames: [
      ["m2-18_7.png", "t=18.70  stop p2.3"],
      ["m2-19_15.png", "t=19.15  pulling back"],
      ["m2-19_6.png", "t=19.60  method reassembles"],
      ["m2-20_05.png", "t=20.05  overview k=1"],
      ["m2-20_5.png", "t=20.50  pushing into DQ-CTM"],
      ["m2-20_9.png", "t=20.90  landed, k=4.994"],
    ],
  },
  {
    out: "strip-baseline.png",
    title: "Baseline, same boundary — the whole transition is two adjacent frames",
    frames: [
      ["base-7_75.png", "t=7.75  stop s1.5"],
      ["base-8_99.png", "t=8.99  last frame of scene 1"],
      ["base-9_01.png", "t=9.01  first frame of scene 2"],
      ["base-10_6.png", "t=10.60  stop s2.0"],
    ],
  },
];

const { browser, page } = await open({ width: 1400, height: 1200 });

for (const strip of STRIPS) {
  const cells = [];
  for (const [file, label] of strip.frames) {
    const b64 = (await readFile(join(shots, file))).toString("base64");
    cells.push(
      `<figure><img src="data:image/png;base64,${b64}"><figcaption>${label}</figcaption></figure>`,
    );
  }
  const cols = strip.frames.length > 4 ? 2 : 2;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0b0d10;color:#dfe3e8;font:500 15px/1.4 ui-sans-serif,system-ui,sans-serif;padding:18px}
    h1{font-size:19px;font-weight:700;margin:0 0 14px;letter-spacing:-.01em}
    .g{display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px}
    figure{margin:0}
    img{width:100%;display:block;border:1px solid #232a31;border-radius:4px}
    figcaption{margin-top:5px;font-size:13px;color:#95a1ad;font-variant-numeric:tabular-nums}
  </style><h1>${strip.title}</h1><div class="g">${cells.join("")}</div>`;
  await page.setContent(html, { waitUntil: "load" });
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewport({ width: 1400, height: h, deviceScaleFactor: 1 });
  const buf = await page.screenshot({ fullPage: true });
  await writeFile(join(shots, strip.out), buf);
  console.log(strip.out, `${1400}x${h}`);
}
await browser.close();
