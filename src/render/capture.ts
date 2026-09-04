/**
 * The capture path, as a thing other code can drive.
 *
 * "Look at the artifact" is this project's strongest gate — six of its bugs
 * shipped past green gates and every one was caught by a human looking at a
 * frame. So the frame a human looks at has to be the frame the renderer would
 * produce, and `hyperframes snapshot` is NOT that frame: it calls
 * `player.renderSeek(t)` with no options, so `suppressEvents` is falsy and a
 * GSAP `onUpdate` FIRES. Invariant 11 says the capture path suppresses events,
 * so callback-driven motion plays under snapshot and renders frozen. Snapshot is
 * permissive in exactly the direction that hides the project's most dangerous
 * failure shape, and it was measured lying about CSS 3D as well — at t=3.9s it
 * produced a flat, un-rotated frame where the render produced correct
 * perspective (see `.planning/2026-09-04-css-3d-spike.md`).
 *
 * `fidelity` already drove the right path privately, and was measured doing so:
 * against `experiments/015-decision/out/vocab-18.mp4`, a real render, at all
 * twelve of its holds, it agreed to a worst case of 0.11 and a mean of 0.03
 * percentage points — the residual being H.264 quantisation. This module is that
 * code lifted out from under the ink arithmetic so the gate and a person asking
 * for a PNG go through the same three calls: inject the pinned runtime,
 * `renderSeek(t, { suppressEvents: true })`, then `Page.captureScreenshot` with
 * the renderer's own clip.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The browser `render` already uses.
 *
 * `@puppeteer/browsers` and `puppeteer-core` are DIRECT dependencies of this
 * package. They arrive with hyperframes too — a hard dependency of any verb that
 * opens a browser — but relying on that made module imports resolve through
 * somebody else's dependency tree, and the day hyperframes swaps its automation
 * library those verbs break for a reason nothing in this repo mentions. They are
 * still imported DYNAMICALLY, which is a different concern: a machine that
 * cannot supply a browser must degrade rather than throw after the capture has
 * already run.
 *
 * `need` completes the error message, because the three callers want different
 * advice from it — captions can fall back to a sidecar, `frames` cannot. This
 * was two copies until `frames` became the third caller the older of them said
 * to promote it on.
 */
export async function chromePath(need = "open the deck with"): Promise<string> {
  const explicit = process.env.DECKSMITH_CHROME || process.env.CHROME_PATH;
  if (explicit) return explicit;

  const { getInstalledBrowsers } = await import("@puppeteer/browsers");
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir }).catch(() => []);
  // headless-shell first: it is the smaller download hyperframes prefers, and
  // for a screenshot of a static page the two render identically.
  const found =
    installed.find((b) => b.browser === "chrome-headless-shell") ??
    installed.find((b) => b.browser === "chrome");
  if (found) return found.executablePath;

  throw new Error(
    `no Chrome to ${need} — run \`npx puppeteer browsers install chrome\`, ` +
      "or set DECKSMITH_CHROME to a Chrome binary.",
  );
}

/**
 * The pinned runtime, from node_modules rather than the CDN the player would
 * reach for. Invariant 4 is about the composition, but a gate that fetches
 * anything is a gate that fails on a train.
 */
function runtimePath(): string {
  return createRequire(import.meta.url).resolve("hyperframes/dist/hyperframe.runtime.iife.js");
}

/**
 * Serialised into the page: INVARIANT 1 AND 11, in one line.
 *
 * `renderSeek` sets an absolute time and commits the frame; `suppressEvents: true`
 * is what stops a GSAP `onUpdate` from firing, so what comes back is what the
 * renderer would capture and not what a browser would play. Drop the option and
 * every caller goes blind to a frame that looks right here and renders frozen.
 */
function renderSeek(t: number): void {
  const player = (
    window as unknown as {
      __player: { renderSeek: (t: number, opts: { suppressEvents: boolean }) => void };
    }
  ).__player;
  player.renderSeek(t, { suppressEvents: true });
}

type Browser = Awaited<ReturnType<typeof import("puppeteer-core").launch>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

/** An open deck, seekable and photographable. Close it. */
export interface DeckPage {
  /** The canvas the deck declares, which is also the screenshot's clip. */
  width: number;
  height: number;
  /** Commit the frame at an absolute time, events suppressed. */
  seek(t: number): Promise<void>;
  /** PNG bytes of the frame currently committed. */
  shoot(): Promise<Buffer>;
  /** For callers that need to read the DOM at a stop, as `fidelity` does. */
  page: Page;
  close(): Promise<void>;
}

export interface OpenOptions {
  timeoutMs?: number;
}

/**
 * Open `dir`'s deck in the renderer's own browser, ready to seek.
 *
 * Throws for every environmental reason — no Chrome, no `index.html`, no canvas
 * size. Callers that must not fail a build over the environment (the `fidelity`
 * gate) catch it; callers a person invoked directly (`frames`) let it surface,
 * because a person who asked for a PNG and got nothing needs to hear why.
 */
export async function openDeck(dir: string, opts: OpenOptions = {}): Promise<DeckPage> {
  const index = join(dir, "index.html");
  const html = await readFile(index, "utf8").catch(() => null);
  if (html === null) throw new Error(`no index.html in ${dir}`);

  const width = Number(/data-width="(\d+)"/.exec(html)?.[1] ?? 0);
  const height = Number(/data-height="(\d+)"/.exec(html)?.[1] ?? 0);
  if (!width || !height) throw new Error("index.html declares no canvas size");

  const timeout = opts.timeoutMs ?? 60_000;
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    // A retina host would otherwise hand back a 2x frame, whose clip is not the
    // renderer's.
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  });

  try {
    const page = await browser.newPage();
    // The runtime bundle is minified with esbuild's `__name` helper, which is not
    // defined when the bundle is injected instead of served. Same guard the
    // renderer installs.
    await page.evaluateOnNewDocument("self.__name = self.__name || ((fn) => fn);");
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(index).href, { waitUntil: "load", timeout });
    await page.addScriptTag({ path: runtimePath() });
    await page.waitForFunction(
      // The composition registers a paused timeline per scene and a spanning
      // `main` that carries no motion, so seeking `main` directly moves nothing.
      // Only the runtime knows the per-scene offsets; wait for it.
      "typeof window.__player?.renderSeek === 'function'",
      { timeout },
    );
    // Without this the first frames are drawn in the fallback face, which is a
    // different picture — and for `fidelity` a different amount of ink.
    await page.evaluate(() => document.fonts.ready);

    const cdp = await page.createCDPSession();
    return {
      width,
      height,
      page,
      seek: (t) => page.evaluate(renderSeek, t),
      shoot: async () => {
        const shot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        });
        return Buffer.from(shot.data, "base64");
      },
      close: () => browser.close(),
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/** One written frame. */
export interface CapturedFrame {
  t: number;
  path: string;
  bytes: number;
}

/**
 * What one frame is called.
 *
 * The index leads, zero-padded to the width of the largest, because a directory
 * listing is how these actually get looked at and lexical order is what a file
 * browser gives you: `t10.000s` sorts before `t3.900s`, so the reader opens the
 * wrong frame and believes it. Padding the INDEX rather than the time keeps the
 * two orders — asked-for and on-disk — identical without deciding how many
 * digits a deck's duration might need.
 *
 * The time is still in the name, to 3 decimals, because that is the thing a
 * reader is checking against and invariant 10 says 3 decimals is what the
 * renderer rounds to. A frame whose filename disagreed with the timeline would
 * be worse than one with no time in it at all.
 */
export function frameName(index: number, t: number, total: number): string {
  const pad = String(total).length;
  return `${String(index + 1).padStart(pad, "0")}-t${t.toFixed(3)}s.png`;
}

/**
 * Write a PNG per requested time into `outDir`.
 *
 * Times are rounded to 3 decimals to match invariant 10, so a filename names
 * exactly the instant the renderer would.
 */
export async function captureFrames(
  dir: string,
  times: readonly number[],
  outDir: string,
  opts: OpenOptions = {},
): Promise<CapturedFrame[]> {
  if (times.length === 0) return [];
  await mkdir(outDir, { recursive: true });
  const deck = await openDeck(dir, opts);
  try {
    const out: CapturedFrame[] = [];
    for (const [i, raw] of times.entries()) {
      const t = Math.round(raw * 1000) / 1000;
      await deck.seek(t);
      const png = await deck.shoot();
      const path = join(outDir, frameName(i, t, times.length));
      await writeFile(path, png);
      out.push({ t, path, bytes: png.length });
    }
    return out;
  } finally {
    await deck.close().catch(() => {});
  }
}
