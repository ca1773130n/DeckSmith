/**
 * Does a three.js scene driven by a paused GSAP timeline seek frame-exactly?
 *
 * The test is not "does it animate". It is: reach the same timeline position by
 * three different routes — forward, backward, and cold — and check the WebGL
 * framebuffer is bit-identical each time. Anything that carries state across
 * seeks (a velocity, an accumulated rotation, a rAF delta) shows up here as a
 * hash mismatch and nowhere else.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const CHROME =
  "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const dir = join(fileURLToPath(new URL(".", import.meta.url)), "../out");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

const server = createServer((req, res) => {
  const p = join(dir, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  let body;
  try {
    body = readFileSync(p);
  } catch {
    res.writeHead(404).end("nope");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1", "--disable-lcd-text"],
});

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Seek one scene's timeline and hash its canvas. Nothing else touches the page. */
async function frames(page, sid, times, suppressEvents) {
  return await page.evaluate(
    async (sid, times, suppressEvents) => {
      const out = [];
      const tl = window.__timelines[sid];
      const canvas = document.querySelector(`#${sid} canvas.ds3d`);
      for (const t of times) {
        tl.seek(t, suppressEvents);
        out.push(canvas.toDataURL("image/png"));
      }
      return out;
    },
    sid,
    times,
    suppressEvents,
  );
}

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(base, { waitUntil: "networkidle0" });

const SCENES = { s1: [0, 0.8, 1.6, 2.4, 3.2, 4.0, 5.2, 6.4], s2: [0, 1, 2, 3, 4, 5, 6], s3: [0, 1.5, 3, 4.5, 6, 7.5] };
const report = {};

for (const [sid, times] of Object.entries(SCENES)) {
  const fwd = (await frames(page, sid, times, true)).map(sha);
  const back = (await frames(page, sid, [...times].reverse(), true)).map(sha).reverse();
  // random order, fixed permutation so this script is itself deterministic
  const perm = times.map((_, i) => i).sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
  const shuf = await frames(page, sid, perm.map((i) => times[i]), true);
  const rnd = times.map((_, i) => sha(shuf[perm.indexOf(i)]));

  // cold: a brand-new page that only ever sees this one time
  const cold = [];
  for (const t of times) {
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await p2.goto(base, { waitUntil: "networkidle0" });
    cold.push(sha((await frames(p2, sid, [t], true))[0]));
    await p2.close();
  }

  // and once more with suppressEvents=false, the other way HyperFrames seeks
  const evts = (await frames(page, sid, times, false)).map(sha);

  report[sid] = times.map((t, i) => ({
    t,
    fwd: fwd[i],
    backSame: back[i] === fwd[i],
    randomSame: rnd[i] === fwd[i],
    coldSame: cold[i] === fwd[i],
    eventsSame: evts[i] === fwd[i],
  }));
}

// Does GSAP's onUpdate survive a suppressed seek? This decides whether the
// setter trick is necessary or merely tidy.
const onUpdateProbe = await page.evaluate(() => {
  let viaCallback = 0;
  let viaSetter = 0;
  const raw = { a: 0 };
  const target = {};
  Object.defineProperty(target, "a", {
    get: () => raw.a,
    set: (v) => {
      raw.a = v;
      viaSetter++;
    },
  });
  const tl = gsap.timeline({ paused: true });
  tl.fromTo(target, { a: 0 }, { a: 1, duration: 2, onUpdate: () => viaCallback++ });
  for (const t of [0.2, 0.5, 0.9, 1.4]) tl.seek(t, true); // suppressEvents: true
  const suppressed = { viaCallback, viaSetter };
  viaCallback = 0;
  viaSetter = 0;
  for (const t of [0.3, 0.6, 1.0, 1.5]) tl.seek(t, false);
  return { suppressed, unsuppressed: { viaCallback, viaSetter } };
});

// Cost of a repaint, since the setter fires once per tweened property per frame.
const timing = await page.evaluate(() => {
  const out = {};
  for (const sid of Object.keys(window.__3d)) {
    const h = window.__3d[sid];
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) h.render();
    out[sid] = Number(((performance.now() - t0) / 60).toFixed(3));
  }
  return out;
});

const gl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const g = c.getContext("webgl2");
  const d = g.getExtension("WEBGL_debug_renderer_info");
  return { vendor: g.getParameter(d.UNMASKED_VENDOR_WEBGL), renderer: g.getParameter(d.UNMASKED_RENDERER_WEBGL) };
});

console.log(JSON.stringify({ gl, onUpdateProbe, msPerRender: timing, report }, null, 2));
await browser.close();
server.close();
