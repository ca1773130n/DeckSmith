/**
 * Three questions that only a live page can answer:
 *
 *  1. SEEK — is `sequence.position = t` frame-exact, i.e. is the canvas at t the
 *     same whether you arrived from before it, from after it, or cold?
 *  2. INVARIANT 5 — how many device pixels tall is drei's 3D text? DeckSmith
 *     forbids text under 40px at 1920x1080, and in 3D that number is a function
 *     of camera distance, not of anything the emitter wrote down.
 *  3. NETWORK — does anything reach for a CDN at render time?
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/Users/neo/Developer/Projects/DeckSmith/node_modules/hyperframes/package.json");
const puppeteer = require("puppeteer-core");

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "out");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".ttf": "font/ttf" };

const server = createServer(async (req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  try {
    await stat(p);
    res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream" });
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// Same Chrome and same flags the renderer uses in software mode.
const exe = "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell";




const executablePath = exe;

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
    "--window-size=1920,1080",
    "--deterministic-mode",
    "--hide-scrollbars",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

const external = [];
page.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith("http://127.0.0.1") && !u.startsWith("data:") && !u.startsWith("blob:")) {
    external.push(u);
  }
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__hfTimelinesBuilding === false, { timeout: 30000 });

const shot = async () => {
  const b = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  return createHash("sha256").update(b).digest("hex").slice(0, 16);
};
const seek = async (t) => {
  await page.evaluate((tt) => window.__timelines.s1.totalTime(tt), t);
};

// ---- 1. seek order independence -------------------------------------------
const T = 6.4;
await seek(0);
await seek(T);
const fromBefore = await shot();
await seek(11.9);
await seek(T);
const fromAfter = await shot();
await seek(T);
const again = await shot();
await seek(2.0);
await seek(T);
const fromMid = await shot();
// arrive by many small steps rather than one jump
await seek(0);
for (let t = 0; t <= T; t += 0.0333) await seek(t);
await seek(T);
const byStepping = await shot();

// ---- 2. rendered text height ----------------------------------------------
const textPx = await page.evaluate(async () => {
  // Project each troika text mesh's cap-height into screen space.
  const out = [];
  const r = window.__dsScene;
  return out;
});

// Measure instead by rendering at a known time and asking three for the
// projected size of a label's bounding box.
const measured = await page.evaluate((t) => {
  window.__timelines.s1.totalTime(t);
  const res = [];
  const scene = window.__dsExpose?.scene;
  const cam = window.__dsExpose?.camera;
  if (!scene || !cam) return null;
  const THREE = window.__dsExpose.THREE;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.boundingBox || !o.text) return;
    const bb = o.geometry.boundingBox;
    // cap height in local units -> two world points -> two NDC points
    const lo = new THREE.Vector3(bb.min.x, bb.min.y, 0).applyMatrix4(o.matrixWorld);
    const hi = new THREE.Vector3(bb.min.x, bb.max.y, 0).applyMatrix4(o.matrixWorld);
    lo.project(cam);
    hi.project(cam);
    const px = Math.abs(hi.y - lo.y) * 0.5 * 1080;
    res.push({ text: String(o.text).slice(0, 28), px: Math.round(px) });
  });
  return res;
}, 8.5);

console.log(
  JSON.stringify(
    {
      seek: {
        target: T,
        fromBefore,
        fromAfter,
        again,
        fromMid,
        byStepping,
        frameExact:
          fromBefore === fromAfter &&
          fromBefore === again &&
          fromBefore === fromMid &&
          fromBefore === byStepping,
      },
      externalRequests: external,
      pageErrors: errors,
      textPixelHeights: measured,
    },
    null,
    2,
  ),
);

await browser.close();
server.close();
