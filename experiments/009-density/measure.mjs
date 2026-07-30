/**
 * Density measurement over a built deck's index.html.
 *
 * Serves the deck over http (file:// blocks the KaTeX font fetch and the
 * composition's own asset paths), opens it in the same headless shell the
 * renderer uses, seeks every scene timeline to its own settled state, forces
 * one scene visible at a time, and reads geometry out of the DOM.
 *
 * Reported per scene:
 *   bbox      union of every leaf element's client rect, clipped to the canvas
 *   fill      bbox area / (1920*1080)
 *   inkFill   union AREA of the leaf rects themselves (overlap counted once),
 *             which is the honest "how much of the slide has something on it"
 *   gap       largest empty axis-aligned rectangle not touching any leaf rect
 *   optical   bbox centre minus true canvas centre
 *   minText   smallest rendered font-size on a text-bearing element
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const SHELL =
  process.env.HYPERFRAMES_BROWSER_PATH ??
  "/Users/neo/.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-152.0.7928.2/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const deckDir = resolve(process.argv[2] ?? "demo/deck");
const shotDir = process.argv[3] ?? null;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  try {
    const buf = await readFile(join(deckDir, path === "/" ? "/index.html" : path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("nope");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: SHELL,
  args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);

// Seek every scene to its settled state: the last hold, which is the frame the
// audience actually sits on. Holds are not in the DOM, so the timeline's own
// duration less a hair is the closest honest proxy — every reveal has landed.
const sids = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".scene")).map((el) => el.id),
);

const MEASURE = (sid) => {
  const W = 1920;
  const H = 1080;
  const scene = document.getElementById(sid);
  const rects = [];
  let minText = Infinity;
  // An <svg> element's own rect is the box it was authored at, not the box its
  // marks occupy — the grid's field svg is 1700 wide with an 800px field in it.
  // Counting the element would have scored a half-empty diagram as full.
  const SVG_LEAF = new Set([
    "rect",
    "circle",
    "ellipse",
    "line",
    "path",
    "polygon",
    "polyline",
    "text",
    "image",
    "use",
    "foreignobject",
  ]);
  const SVG_SKIP = new Set(["defs", "clippath", "mask", "marker", "pattern", "symbol", "title"]);

  const push = (el, rect) => {
    const r = rect ?? el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return;
    rects.push({
      x: Math.max(0, r.left),
      y: Math.max(0, r.top),
      r: Math.min(W, r.right),
      b: Math.min(H, r.bottom),
    });
  };

  const walkSvg = (el) => {
    const tag = el.tagName.toLowerCase();
    if (SVG_SKIP.has(tag)) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    if (Number.parseFloat(cs.opacity) < 0.02) return;
    if (SVG_LEAF.has(tag)) {
      if (tag === "text") {
        const fs = Number.parseFloat(cs.fontSize);
        if (fs > 0 && el.textContent.trim()) minText = Math.min(minText, fs);
      }
      // A shape with neither paint is a hit target, not a mark.
      const inked = cs.fill !== "none" || cs.stroke !== "none";
      if (inked) push(el);
      return;
    }
    for (const k of el.children) walkSvg(k);
  };

  const walk = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    if (Number.parseFloat(cs.opacity) < 0.02) return;
    if (el.tagName.toLowerCase() === "svg") {
      for (const k of el.children) walkSvg(k);
      return;
    }
    const kids = Array.from(el.children);
    const hasText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    // KaTeX builds its layout out of 1px struts and zero-width rules; they are
    // not audience text and would report a 1px floor on every equation slide.
    if (hasText && !el.closest(".katex")) {
      const fs = Number.parseFloat(cs.fontSize);
      if (fs > 0) minText = Math.min(minText, fs);
    }
    const bg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    if (bg || el.tagName.toLowerCase() === "img") push(el);
    // A left-aligned line in a full-width block paints the glyphs, not the block.
    // Measuring the block scored every headline as 1700px of ink.
    if (hasText) {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) push(el, r);
    }
    for (const k of kids) walk(k);
  };
  walk(scene);
  const live = rects.filter((r) => r.r > r.x && r.b > r.y);
  if (live.length === 0) return null;

  const bbox = live.reduce(
    (a, r) => ({
      x: Math.min(a.x, r.x),
      y: Math.min(a.y, r.y),
      r: Math.max(a.r, r.r),
      b: Math.max(a.b, r.b),
    }),
    { x: W, y: H, r: 0, b: 0 },
  );

  // Ink area by coordinate compression — exact, and 1000 rects is nothing.
  const xs = [...new Set(live.flatMap((r) => [r.x, r.r]))].sort((a, b) => a - b);
  const ys = [...new Set(live.flatMap((r) => [r.y, r.b]))].sort((a, b) => a - b);
  const occupied = [];
  let ink = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    occupied.push([]);
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const hit = live.some((r) => r.x <= cx && cx <= r.r && r.y <= cy && cy <= r.b);
      occupied[i].push(hit);
      if (hit) ink += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }

  // Largest empty rectangle over the compressed grid, spanning the whole canvas.
  const gxs = [0, ...xs.filter((v) => v > 0 && v < W), W];
  const gys = [0, ...ys.filter((v) => v > 0 && v < H), H];
  const free = [];
  for (let i = 0; i < gxs.length - 1; i++) {
    free.push([]);
    for (let j = 0; j < gys.length - 1; j++) {
      const cx = (gxs[i] + gxs[i + 1]) / 2;
      const cy = (gys[j] + gys[j + 1]) / 2;
      free[i].push(!live.some((r) => r.x <= cx && cx <= r.r && r.y <= cy && cy <= r.b));
    }
  }
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  for (let i = 0; i < free.length; i++) {
    for (let j = 0; j < free[i].length; j++) {
      if (!free[i][j]) continue;
      let maxJ = free[i].length - 1;
      for (let k = i; k < free.length; k++) {
        let jj = j;
        while (jj <= maxJ && free[k][jj]) jj++;
        maxJ = jj - 1;
        if (maxJ < j) break;
        const w = gxs[k + 1] - gxs[i];
        const h = gys[maxJ + 1] - gys[j];
        if (w * h > best.area) best = { area: w * h, x: gxs[i], y: gys[j], w, h };
      }
    }
  }

  return {
    bbox: {
      x: Math.round(bbox.x),
      y: Math.round(bbox.y),
      w: Math.round(bbox.r - bbox.x),
      h: Math.round(bbox.b - bbox.y),
    },
    fill: ((bbox.r - bbox.x) * (bbox.b - bbox.y)) / (W * H),
    inkFill: ink / (W * H),
    gap: { x: Math.round(best.x), y: Math.round(best.y), w: Math.round(best.w), h: Math.round(best.h), frac: best.area / (W * H) },
    optical: {
      dx: Math.round((bbox.x + bbox.r) / 2 - W / 2),
      dy: Math.round((bbox.y + bbox.b) / 2 - H / 2),
    },
    minText: minText === Infinity ? null : Math.round(minText * 10) / 10,
    leaves: live.length,
  };
};

const out = [];
for (const sid of sids) {
  const label = await page.evaluate((s) => {
    const el = document.getElementById(s);
    for (const o of document.querySelectorAll(".scene")) o.style.display = "none";
    el.style.display = "flex";
    const tl = window.__timelines?.[s];
    if (tl) tl.seek(Math.max(0, tl.duration() - 0.001));
    return el.dataset.label ?? s;
  }, sid);
  await new Promise((r) => setTimeout(r, 120));
  const m = await page.evaluate(MEASURE, sid);
  if (shotDir) {
    await page.screenshot({ path: join(resolve(shotDir), `${sid}.png`), captureBeyondViewport: false });
  }
  out.push({ sid, label, ...m });
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
