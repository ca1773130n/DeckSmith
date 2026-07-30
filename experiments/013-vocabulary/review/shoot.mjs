/**
 * Seek a built deck the way capture does and grab frames.
 *
 *   node shoot.mjs <deckDir> <tag> t1 t2 t3 ...
 *
 * Mirrors hyperframes' gsap adapter: pause, totalTime(t + eps, true),
 * totalTime(t, true) — suppressEvents on, absolute time, no play.
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const [deckDir, tag, ...times] = process.argv.slice(2);
const ROOT = resolve(HERE, deckDir);
const OUT = join(HERE, "shots");
await mkdir(OUT, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".webp": "image/webp",
};
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  try {
    const body = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("no");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath:
    "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0" });
await page.waitForFunction("window.__hfTimelinesBuilding === false", { timeout: 30000 });

for (const raw of times) {
  const t = Number(raw);
  await page.evaluate((t) => {
    for (const el of document.querySelectorAll("[data-composition-id]")) {
      const id = el.getAttribute("data-composition-id");
      const tl = window.__timelines[id];
      if (!tl) continue;
      const start = Number(el.getAttribute("data-start") || 0);
      const dur = Number(el.getAttribute("data-duration") || 0);
      const local = Math.max(0, Math.min(dur, t - start));
      tl.pause();
      tl.totalTime(local + 0.001, true);
      tl.totalTime(local, true);
    }
  }, t);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  await writeFile(join(OUT, `${tag}-t${raw}.png`), buf);
  console.log("wrote", `${tag}-t${raw}.png`);
}
await browser.close();
server.close();
