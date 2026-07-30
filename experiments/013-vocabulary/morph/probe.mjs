/**
 * Measure the morph. Nothing here reasons; everything here counts.
 *
 *   node probe.mjs
 *
 * Serves the spike over http (file:// changes font loading), drives
 * chrome-headless-shell through puppeteer-core, and reports:
 *   - match statistics per case
 *   - seek purity: same t reached cold / walked up from 0 / walked down from the end
 *   - render determinism: three renders in three separate browser PROCESSES,
 *     pixel-diffed rather than hash-compared, so a difference has a size
 *   - the font race: the plan built at parse time vs after document.fonts.ready
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const CHROME =
  "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const path = join(HERE, decodeURIComponent(req.url.split("?")[0]));
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("no");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

const LAUNCH = {
  executablePath: CHROME,
  args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
};

const CASES = ["swap", "swapKeyed", "fraction", "fractionKeyed", "sum", "sumKeyed", "derivative"];
const AT = 1.0;
const DUR = 1.4;
const TS = [0.5, AT + DUR * 0.25, AT + DUR * 0.5, AT + DUR * 0.75, AT + DUR - 0.02, AT + DUR + 0.5];

async function open(browser, caseName, gate = "fonts") {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/page.html?case=${caseName}&gate=${gate}`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__built === true", { timeout: 20000 });
  return page;
}

/** The whole visual state, as the browser computes it. */
const FINGERPRINT = `(() => {
  const r = n => Math.round(n * 1e4) / 1e4;
  return [...document.querySelectorAll('.ds-morph-layer > *')].map(e => {
    const cs = getComputedStyle(e);
    const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
    return [e.textContent.trim(), r(m.a), r(m.d), r(m.e), r(m.f), r(parseFloat(cs.opacity))].join(',');
  }).join('|');
})()`;

async function shot(page, file) {
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  if (file) await writeFile(join(OUT, file), buf);
  return buf;
}
const hash = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

/** Pixel diff, done in the browser so a difference has a magnitude. */
async function diff(page, a, b) {
  return page.evaluate(async (a, b) => {
    const load = (d) =>
      new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.src = "data:image/png;base64," + d;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const px = (img) => {
      const c = new OffscreenCanvas(img.width, img.height);
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, img.width, img.height).data;
    };
    const pa = px(ia);
    const pb = px(ib);
    let n = 0;
    let max = 0;
    let sum = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(
        Math.abs(pa[i] - pb[i]),
        Math.abs(pa[i + 1] - pb[i + 1]),
        Math.abs(pa[i + 2] - pb[i + 2]),
      );
      if (d > 0) { n++; sum += d; max = Math.max(max, d); }
    }
    return { pixels: n, maxChannelDelta: max, meanDeltaOverChanged: n ? Math.round((sum / n) * 10) / 10 : 0 };
  }, a.toString("base64"), b.toString("base64"));
}

const report = { cases: {}, seek: {}, determinism: {}, fontRace: {}, notes: {} };

/* ------------------------------------------------------------------ setup */
const main = await puppeteer.launch(LAUNCH);
const differ = await main.newPage();
await differ.goto("about:blank");

/* ---------------------------------------------------- 1. match statistics */
for (const c of CASES) {
  const p = await open(main, c);
  report.cases[c] = await p.evaluate("window.__stats");
  report.cases[c].tweens = (await p.evaluate("window.__steps")).length;
  await p.close();
}

/* ------------------------------------------------------------ 2. seek purity */
for (const c of CASES) {
  const rows = [];
  const walker = await open(main, c);
  for (const t of TS) {
    const cold = await open(main, c);
    await cold.evaluate((t) => window.__seek(t), t);
    const fCold = await cold.evaluate(FINGERPRINT);
    const iCold = await shot(cold);
    await cold.close();

    await walker.evaluate((t) => {
      for (let u = 0; u < t - 1e-9; u = Math.round((u + 0.1) * 1e6) / 1e6) window.__seek(u);
      window.__seek(t);
    }, t);
    const fUp = await walker.evaluate(FINGERPRINT);
    const iUp = await shot(walker);

    await walker.evaluate((t) => {
      for (let u = 4; u > t + 1e-9; u = Math.round((u - 0.1) * 1e6) / 1e6) window.__seek(u);
      window.__seek(t);
    }, t);
    const fDown = await walker.evaluate(FINGERPRINT);
    const iDown = await shot(walker);

    rows.push({
      t: Math.round(t * 1000) / 1000,
      stateIdentical: fCold === fUp && fCold === fDown,
      pixelIdentical: hash(iCold) === hash(iUp) && hash(iCold) === hash(iDown),
      diffColdVsUp: hash(iCold) === hash(iUp) ? null : await diff(differ, iCold, iUp),
      diffColdVsDown: hash(iCold) === hash(iDown) ? null : await diff(differ, iCold, iDown),
    });
  }
  await walker.close();
  report.seek[c] = rows;
}

/* ------------------------------------------------- 3. render determinism */
// Three separate browser PROCESSES, because the drift this project has actually
// seen lived between whole render runs, not between two seeks in one page.
const DTS = [AT + DUR * 0.5, AT + DUR - 0.02, AT + DUR + 0.5];
for (const c of CASES) {
  const rows = [];
  for (const t of DTS) {
    const shots = [];
    for (let run = 0; run < 3; run++) {
      const b = await puppeteer.launch(LAUNCH);
      const p = await open(b, c);
      await p.evaluate((t) => window.__seek(t), t);
      shots.push(await shot(p));
      await b.close();
    }
    const same = hash(shots[0]) === hash(shots[1]) && hash(shots[1]) === hash(shots[2]);
    rows.push({
      t: Math.round(t * 1000) / 1000,
      byteIdentical: same,
      diff01: same ? null : await diff(differ, shots[0], shots[1]),
      diff02: same ? null : await diff(differ, shots[0], shots[2]),
    });
  }
  report.determinism[c] = rows;
}

/* ----------------------------------------------------------- 4. font race */
for (const c of CASES) {
  const a = await open(main, c, "parse");
  const b = await open(main, c, "fonts");
  const trav = (p) => p.filter((s) => "x" in s.to && "scale" in s.to).map((s) => s.to);
  const ta = trav(await a.evaluate("window.__steps"));
  const tb = trav(await b.evaluate("window.__steps"));
  let maxD = 0;
  let maxS = 0;
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    maxD = Math.max(maxD, Math.abs(ta[i].x - tb[i].x));
    maxS = Math.max(maxS, Math.abs(ta[i].scale - tb[i].scale));
  }
  const ia = await shot(a);
  const ib = await shot(b);
  report.fontRace[c] = {
    travellersParse: ta.length,
    travellersFonts: tb.length,
    maxTravelDeltaPx: Math.round(maxD * 100) / 100,
    maxScaleDelta: Math.round(maxS * 1000) / 1000,
    restFrameDiff: hash(ia) === hash(ib) ? null : await diff(differ, ia, ib),
  };
  await a.close();
  await b.close();
}

/* -------------------------------------------------------------- 5. eyeballs */
for (const c of CASES) {
  for (const [label, t] of [
    ["0-rest-a", 0.5],
    ["1-q25", AT + DUR * 0.25],
    ["2-mid", AT + DUR * 0.5],
    ["3-q75", AT + DUR * 0.75],
    ["4-rest-b", AT + DUR + 0.5],
  ]) {
    const p = await open(main, c);
    await p.evaluate((t) => window.__seek(t), t);
    await shot(p, `${c}-${label}.png`);
    await p.close();
  }
}

/* ------------------- 6. is the lifted overlay a faithful copy of the source? */
for (const c of CASES) {
  const row = {};
  for (const [side, t] of [["a", 0.5], ["b", AT + DUR + 0.5]]) {
    const ctl = await main.newPage();
    await ctl.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await ctl.goto(`${BASE}/page.html?case=${c}&control=${side}`, { waitUntil: "networkidle0" });
    await ctl.waitForFunction("window.__built === true");
    const ictl = await shot(ctl, `control-${c}-${side}.png`);
    await ctl.close();
    const p = await open(main, c);
    await p.evaluate((t) => window.__seek(t), t);
    const im = await shot(p);
    await p.close();
    row["rest" + side.toUpperCase()] =
      hash(ictl) === hash(im) ? "byte-identical" : await diff(differ, ictl, im);
  }
  report.notes[c] = row;
}

/* ------------------------------ 7. what a straight-line no-key morph costs */
{
  const p = await open(main, "swap");
  await p.evaluate(() => window.__seek(1.7));
  await shot(p, "compare-swap-unkeyed-mid.png");
  await p.close();
  const q = await main.newPage();
  await q.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await q.goto(`${BASE}/page.html?case=swapKeyed&arc=0`, { waitUntil: "networkidle0" });
  await q.waitForFunction("window.__built === true");
  await q.evaluate(() => window.__seek(1.7));
  await shot(q, "compare-swap-keyed-noarc-mid.png");
  await q.close();
}

await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await main.close();
server.close();
