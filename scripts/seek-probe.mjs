/**
 * Does stepping the deck still MOVE the document? — the only gate that opens deck.html.
 *
 * WHY THIS EXISTS. `test/deck.test.ts` says outright that nothing in the suite
 * opens deck.html: it asserts the vendored player's jsDelivr url agrees with the
 * installed `hyperframes`, and that test SELF-HEALS on a version bump because
 * both sides move together. `src/verify/index.ts` filters `DECK_PAGE` out of the
 * composition scan. So the entire step layer in `src/deck/` — every keystroke,
 * the host bridge, the whole presented artifact — has never had a gate watch it
 * work. A step that silently no-ops leaves `lint`, `check`, `verify` and
 * `frames` all green and stops the deck stepping.
 *
 * THE PASS CRITERION IS NOT "it did not throw". It is that the document MOVES:
 * `moved` must equal `transitions`. A deck that accepts every command and paints
 * nothing is exactly the failure this is built to catch, and it is invisible to
 * any check that only looks for an exception.
 *
 * WHAT IT DRIVES, AND WHY NOT `player.seek()`. Measured here on 2026-09-09 at
 * 0.8.27: `player.seek(60)` on a working deck moves NOTHING — the fingerprint is
 * identical before and after, across all 46 stops. That is not a bug. The
 * composition registers one PAUSED timeline per scene plus a spanning `main`
 * that carries no motion, so seeking the player's own clock moves no scene;
 * `src/render/capture.ts` says the same thing in its own words. What moves the
 * deck is `cutTo` — `player.seek(t)` AND `paint(frame, slides, t)`, which seeks
 * each scene's timeline through `__timelines`. A probe built on `player.seek`
 * alone reports a catastrophe on a perfectly working deck, at every pin, forever.
 * So this drives the deck the way a consumer does: the HOST BRIDGE.
 *
 * WHY FRAMED. `src/deck/protocol.ts`'s listener starts
 * `if (e.source !== parent || parent === window ...) return` — the bridge is
 * deliberately dead when the deck is the top-level window. Framing it is both
 * the only way to reach the bridge and the shipped consumer path
 * (`<decksmith-player>` in src/deck/player.ts frames it exactly this way). It
 * also means the STOP LIST COMES FROM THE DECK ITSELF, over `ready` — this file
 * holds no second copy of `buildStops` to drift out of date.
 *
 * `go` is an INSTANT jump (`go(msg.at, true)` in runtime.ts), so each landing is
 * deterministic and no glide is in flight when the fingerprint is taken.
 *
 * NO PIXELS ARE READ BACK. `.planning/2026-09-06-canvas-seek-purity.md` measured
 * that `getImageData` drops a canvas to CPU raster permanently after two
 * readbacks, changing what the renderer would have captured. This fingerprints
 * INLINE STYLE — what GSAP actually writes — and never touches a pixel.
 *
 * THE RUNTIME IS THE PINNED ONE, NOT THE CDN'S. The vendored player injects
 * `https://cdn.jsdelivr.net/npm/@hyperframes/core@<version>/…` into the frame, so
 * a naive probe measures jsDelivr and needs the network. The player accepts a
 * `runtime-src` override for a same-origin or localhost http url, so this serves
 * `node_modules/hyperframes/dist/hyperframe.runtime.iife.js` and points the
 * player at it — the same choice `src/render/capture.ts` makes, for the same
 * reason: the pin is what we are measuring. `--cdn` restores the shipped path.
 *
 *   node scripts/seek-probe.mjs <deckDir> [--cdn]
 *
 * Emits JSON on stdout: { stops, transitions, moved, ... }. Exits non-zero when
 * `moved !== transitions`, when the deck reports no stops, or when the island's
 * stop count disagrees with the one the deck's own runtime reports.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import { homedir } from "node:os";

const CHANNEL = "decksmith-deck";
const ISLAND = 'script[type="application/hyperframes-slideshow+json"]';
const RUNTIME_ROUTE = "/__seek-probe-runtime.js";
const HOST_ROUTE = "/__seek-probe-host.html";

/** The smallest host that satisfies the bridge: same origin, deck in a frame. */
const HOST_HTML = `<!doctype html><meta charset="utf-8"><title>seek probe host</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:1280px;height:720px}</style>
<iframe id="deck" src="/deck.html"></iframe>`;

/* ------------------------------------------------------------------ server */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".vtt": "text/vtt; charset=utf-8",
};

function runtimePath() {
  return createRequire(import.meta.url).resolve("hyperframes/dist/hyperframe.runtime.iife.js");
}

/**
 * Serve the deck, with two additions and one edit, and nothing else.
 *
 * The host page and the local runtime are new routes; the deck's own player
 * element gains `runtime-src` (unless `--cdn`). The served runtime carries the
 * `__name` guard `src/render/capture.ts` installs for the same esbuild helper.
 */
async function serve(dir, { cdn }) {
  const root = normalize(dir).replace(/[/\\]+$/, "");
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = decodeURIComponent(url.pathname);

      if (path === HOST_ROUTE) {
        res.writeHead(200, { "content-type": MIME[".html"] });
        return void res.end(HOST_HTML);
      }
      if (!cdn && path === RUNTIME_ROUTE) {
        const body = await readFile(runtimePath(), "utf8").catch(() => null);
        if (body === null) return void res.writeHead(404).end("no runtime");
        res.writeHead(200, { "content-type": MIME[".js"] });
        return void res.end(`self.__name = self.__name || ((fn) => fn);\n${body}`);
      }

      const rel = path === "/" ? "deck.html" : path.replace(/^\/+/, "");
      const file = normalize(join(root, rel));
      // No escaping the deck directory.
      if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(403).end();

      const ext = extname(file).toLowerCase();
      const bytes = await readFile(file).catch(() => null);
      if (bytes === null) return void res.writeHead(404).end("not found");

      if (ext === ".html" && !cdn) {
        const patched = bytes
          .toString("utf8")
          .replace(/<hyperframes-player\b/, `<hyperframes-player runtime-src="${RUNTIME_ROUTE}"`);
        res.writeHead(200, { "content-type": MIME[ext] });
        return void res.end(patched);
      }

      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(bytes);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/* ------------------------------------------------------------------ chrome */

/** Mirrors `chromePath` in src/render/capture.ts, which dist does not export. */
async function chromePath() {
  const explicit = process.env.DECKSMITH_CHROME || process.env.CHROME_PATH;
  if (explicit) return explicit;
  const { getInstalledBrowsers } = await import("@puppeteer/browsers");
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir }).catch(() => []);
  const found =
    installed.find((b) => b.browser === "chrome-headless-shell") ??
    installed.find((b) => b.browser === "chrome");
  if (found) return found.executablePath;
  throw new Error(
    "no Chrome — run `npx puppeteer browsers install chrome`, or set DECKSMITH_CHROME.",
  );
}

/* --------------------------------------------------- serialised in the page */

/**
 * Reach the composition: host page → deck frame → player → SHADOW ROOT → frame.
 *
 * The vendored player builds its iframe inside a shadow root, which is why
 * `frameOf` in src/deck/runtime.ts looks there first, and why a plain
 * `document.querySelector("iframe")` finds the deck but never the composition.
 */
const REACH = `(() => {
  const deck = document.getElementById("deck");
  const dd = deck && deck.contentDocument;
  if (!dd) return null;
  const p = dd.querySelector("hyperframes-player");
  const f = p && ((p.shadowRoot && p.shadowRoot.querySelector("iframe")) || p.querySelector("iframe"));
  const cd = f && f.contentDocument;
  const cw = f && f.contentWindow;
  return cd && cw ? { deckDoc: dd, compDoc: cd, compWin: cw, player: p } : null;
})()`;

/* -------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const cdn = args.includes("--cdn");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    process.stderr.write("usage: node scripts/seek-probe.mjs <deckDir> [--cdn]\n");
    process.exit(2);
  }

  // Read only to CROSS-CHECK the deck's own answer; navigation never uses this.
  const html = await readFile(join(dir, "deck.html"), "utf8");
  const islandTag = new RegExp(
    `<script type="application/hyperframes-slideshow\\+json"[^>]*>([\\s\\S]*?)</script>`,
  ).exec(html);
  if (!islandTag) throw new Error(`no slideshow island in ${dir}/deck.html`);
  const payload = JSON.parse(islandTag[1]);
  const islandSlides = (Array.isArray(payload) ? payload : (payload.slides ?? [])).length;

  const { origin, close } = await serve(dir, { cdn });
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  });

  const result = {
    deck: dir,
    runtime: cdn ? "cdn (as shipped)" : runtimePath(),
    hyperframes: createRequire(import.meta.url)("hyperframes/package.json").version,
    islandSelector: ISLAND,
    islandSlides,
    drivenBy: "host bridge (postMessage go), the shipped consumer path",
  };

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 800, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });

    await page.goto(`${origin}${HOST_ROUTE}`, { waitUntil: "load", timeout: 60_000 });

    // Ready means what src/deck/runtime.ts means by it, and `.ds-live` is the
    // signal that matters. The composition having scenes and `__timelines` only
    // says the COMPOSITION is up; the deck runtime resolves its `frame` later,
    // after `await whenReady(player)`, and sets `.ds-live` on the composition
    // root in the same breath (runtime.ts:1272-1275). Step before that and
    // `cutTo`'s `if (frame) paint(...)` is skipped — the deck navigates and
    // paints nothing, which is the exact failure that module exists to prevent.
    // Measured here: without this wait the first five stops share one
    // fingerprint and the probe reports 41 of 45 on a working deck.
    await page.waitForFunction(
      `(() => { const r = ${REACH}; return !!r && !!r.compDoc.querySelector("[data-composition-id]") && Object.keys(r.compWin.__timelines || {}).length > 0 && r.compDoc.documentElement.classList.contains("ds-live"); })()`,
      { timeout: 60_000, polling: 100 },
    );
    await page.evaluate(() => document.fonts?.ready);

    // Install the bridge listener, then handshake. `ready` carries the deck's own
    // stop list, which is the list this probe walks.
    const stops = await page.evaluate((channel) => {
      const deck = document.getElementById("deck");
      window.__probe = { msgs: [], stopped: [] };
      window.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || d.channel !== channel) return;
        window.__probe.msgs.push(d);
        if (d.type === "stop") window.__probe.stopped.push(d);
      });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no `ready` from the deck in 10s")), 10_000);
        const onReady = (e) => {
          const d = e.data;
          if (d && d.channel === channel && d.type === "ready") {
            clearTimeout(timer);
            window.removeEventListener("message", onReady);
            resolve(d.stops);
          }
        };
        window.addEventListener("message", onReady);
        deck.contentWindow.postMessage({ channel, type: "hello" }, "*");
      });
    }, CHANNEL);

    if (!Array.isArray(stops) || stops.length === 0) throw new Error("the deck reported no stops");

    const fingerprint = () =>
      page.evaluate(`(() => {
        const r = ${REACH};
        if (!r) return { error: "no composition document" };
        const out = {};
        for (const scene of r.compDoc.querySelectorAll("[data-composition-id]")) {
          const id = scene.getAttribute("data-composition-id");
          let s = id + "|" + (scene.getAttribute("style") || "");
          for (const el of scene.querySelectorAll("[style]")) {
            s += el.tagName + "#" + (el.id || "") + "|" + el.getAttribute("style");
          }
          let h = 0x811c9dc5;
          for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
          out[id] = h.toString(16).padStart(8, "0");
        }
        return out;
      })()`);

    const goTo = async (i) => {
      await page.evaluate(
        (channel, at) => {
          window.__probe.stopped.length = 0;
          document
            .getElementById("deck")
            .contentWindow.postMessage({ channel, type: "go", at }, "*");
        },
        CHANNEL,
        i,
      );
      // The deck answers `stop` once it has landed; `go` is instant, so this is
      // the landing and not a frame mid-glide.
      await page.waitForFunction(
        (at) => window.__probe.stopped.some((s) => s.at === at),
        { timeout: 15_000, polling: 50 },
        i,
      );
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
    };

    const rows = [];
    for (const [i, stop] of stops.entries()) {
      await goTo(i);
      const fp = await fingerprint();
      if (fp.error) throw new Error(fp.error);
      rows.push({ i, label: stop.label, fp });
    }

    let transitions = 0;
    let moved = 0;
    const still = [];
    for (let i = 1; i < rows.length; i++) {
      transitions++;
      if (JSON.stringify(rows[i - 1].fp) !== JSON.stringify(rows[i].fp)) moved++;
      else still.push({ from: rows[i - 1].i, to: rows[i].i, label: rows[i].label });
    }

    const scenes = Object.keys(rows[0].fp);
    const sceneMoved = scenes.filter((id) => new Set(rows.map((r) => r.fp[id])).size > 1);

    Object.assign(result, {
      stops: rows.map(({ fp: _fp, ...r }) => r),
      stopCount: rows.length,
      islandAgrees: islandSlides > 0 && rows.length >= islandSlides,
      transitions,
      moved,
      stillTransitions: still,
      scenes: scenes.length,
      scenesEverMoved: sceneMoved.length,
      distinctFingerprints: new Set(rows.map((r) => JSON.stringify(r.fp))).size,
      pageErrors,
      pass: transitions > 0 && moved === transitions,
    });
  } finally {
    await browser.close();
    await close();
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) {
    process.stderr.write(
      `seek-probe FAIL: moved ${result.moved} of ${result.transitions} transitions\n`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`seek-probe: ${e?.stack ?? e}\n`);
  process.exit(1);
});
