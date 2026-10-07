/**
 * v2 motion in the PRESENTED deck — deck.html in the renderer's own Chrome.
 *
 * The pure halves are in test/motion.test.ts. This file exists because both
 * behaviours are invisible to every other test: a slide change in deck.html cut
 * straight to the next slide's first stop (so no seam and no entrance was ever
 * seen outside the mp4), and a stop held still while its audio played (so no
 * emphasis could run). Each assertion below watches the composition frame by
 * frame and compares a v2 deck against the same storyboard built classic, and
 * against v2 under `prefers-reduced-motion`, which must behave like classic.
 *
 * THE AUDIO IS REAL — silent PCM, written here, because the hold motion follows
 * `audio.currentTime` and a file that cannot play has no clock. It is named
 * `.wav` and served as such; the narration manifest names whatever file it is
 * given. Chrome is launched with `--autoplay-policy=no-user-gesture-required`
 * so a deep-linked stop speaks without a click.
 */
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, KeyInput } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStops, type SlideSpec, type Stop } from "../src/deck/runtime.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import { DECK_PAGE, type DeckNarration } from "../src/emit/composition.js";
import { resolveTheme } from "../src/emit/theme.js";
import { stopCount } from "../src/narrate/narrate.js";
import { chromePath } from "../src/render/capture.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const chrome = await chromePath("open the deck page with").catch(() => null);

const demo = storyboardSchema.parse(
  JSON.parse(await readFile(repo("demo/storyboard.json"), "utf8")),
);
const source = sourceSchema.parse(JSON.parse(await readFile(repo("demo/source.json"), "utf8")));
/** Title, callout, pipeline: three slides, a seam between each. */
const board = { ...demo, beats: demo.beats.slice(0, 3) };
const deck16 = FORMATS["deck-16x9"] as Format;
const SECONDS = 4;

/** `seconds` of 8kHz mono silence as a WAV. */
function silence(seconds: number): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(n, 40);
  b.fill(128, 44); // 8-bit PCM silence is the midpoint
  return b;
}

async function narration(audioDir: string): Promise<DeckNarration> {
  await mkdir(audioDir, { recursive: true });
  const wav = silence(SECONDS);
  const beats: DeckNarration["beats"] = {};
  for (const [i, beat] of board.beats.entries()) {
    const ink = resolveTheme("ink");
    const holds = emitScene(beat, {
      source,
      format: deck16,
      theme: ink,
      sid: `s${i + 1}`,
      start: 0,
    }).holds;
    beats[beat.id] = [];
    for (let stop = 0; stop < stopCount(holds); stop++) {
      const audio = `${beat.id}-${stop}.wav`;
      await writeFile(join(audioDir, audio), wav);
      beats[beat.id]?.push({
        stop,
        text: `Sentence ${stop}.`,
        audio,
        seconds: SECONDS,
        cues: [
          { start: 0, end: 1.8, text: "First half," },
          { start: 2, end: SECONDS, text: "second half." },
        ],
      });
    }
  }
  return { voice: "test", dir: "audio", beats };
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function serve(root: string): Server {
  return createServer((req, res) => {
    const path = normalize((req.url ?? "/").split("?")[0] ?? "/");
    if (path.includes("..")) {
      res.writeHead(403).end();
      return;
    }
    const stream = createReadStream(join(root, path === "/" ? DECK_PAGE : path));
    stream.once("error", () => res.writeHead(404).end());
    stream.once("open", () => {
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      stream.pipe(res);
    });
  });
}

interface Sample {
  /** Scene ids displayed in the composition this frame. */
  shown: string;
  /** Each scene timeline's own time. */
  times: Record<string, number>;
}

describe.skipIf(chrome === null)("v2 motion in deck.html, in the renderer's own browser", () => {
  let dir = "";
  let browser: Browser;
  const decks: Record<string, { base: string; server: Server; stops: Stop[] }> = {};

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-motion-page-"));
    // The BUILT library, as `decksmith build` is: the deck page inlines
    // dist/deck-runtime.js, which only exists after `npm run build`.
    const { buildDeck } = (await import(repo("dist/index.js"))) as typeof import("../src/index.js");
    const audioFrom = join(dir, "voice");
    const voice = await narration(audioFrom);
    for (const design of ["classic", "v2"] as const) {
      const out = join(dir, design);
      await buildDeck(board, source, out, { design, narration: voice, audioFrom });
      const page = await readFile(join(out, DECK_PAGE), "utf8");
      const json = /hyperframes-slideshow\+json">\s*([\s\S]*?)\s*<\/script>/.exec(page)?.[1];
      const slides = (JSON.parse(json ?? "{}") as { slides: SlideSpec[] }).slides;
      const server = serve(out);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      decks[design] = {
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        server,
        stops: buildStops(slides),
      };
    }
    const { default: puppeteer } = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: chrome as string,
      headless: true,
      args: [
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    for (const d of Object.values(decks)) await new Promise<void>((r) => d.server.close(() => r()));
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /**
   * Open `design` at `hash`, then record every frame for `ms` after `act` runs.
   * The composition is reached the way the runtime reaches it: the player's
   * same-origin iframe.
   */
  async function watch(
    design: "classic" | "v2",
    hash: string,
    reduced: boolean,
    ms: number,
    act: (press: (key: KeyInput) => Promise<void>) => Promise<void>,
  ): Promise<Sample[]> {
    const deck = decks[design];
    if (!deck) throw new Error(design);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 720 });
      await page.emulateMediaFeatures([
        { name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" },
      ]);
      await page.goto(`${deck.base}/${DECK_PAGE}${hash}`, { waitUntil: "load", timeout: 60_000 });
      await page.waitForFunction("document.querySelector('.ds-count')?.textContent", {
        timeout: 60_000,
      });
      await page.evaluate(() => {
        const w = window as unknown as { __log: unknown[] };
        w.__log = [];
        const tick = () => {
          const player = document.querySelector("hyperframes-player") as HTMLElement | null;
          const iframe = (player?.shadowRoot?.querySelector("iframe") ??
            player?.querySelector("iframe")) as HTMLIFrameElement | null;
          const doc = iframe?.contentDocument;
          const win = iframe?.contentWindow as
            | (Window & { __timelines?: Record<string, { time: () => number }> })
            | null;
          if (doc && win) {
            const ids = ["s1", "s2", "s3"];
            w.__log.push({
              shown: ids
                .filter(
                  (id) => (doc.getElementById(id) as HTMLElement | null)?.style.display !== "none",
                )
                .join("+"),
              times: Object.fromEntries(ids.map((id) => [id, win.__timelines?.[id]?.time() ?? -1])),
              audio: (() => {
                const a = document.querySelector("audio");
                return a
                  ? `${a.paused}@${a.currentTime.toFixed(2)} ${a.error?.code ?? ""} ${a.src.split("/").pop()}`
                  : "none";
              })(),
            });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // A v2 deck opens PAUSED and paused is silent (Enter is play/pause, the
      // founder's call), so it is played first; classic speaks on arrival.
      if (design === "v2") await page.keyboard.press("Enter");
      await act(async (key) => {
        await page.keyboard.press(key);
      });
      // The hold follows the audio clock, so measure only once there is one:
      // a segment still loading would read as "nothing moved" for any design.
      await page.waitForFunction(
        "(() => { const a = document.querySelector('audio'); return !!a && !a.paused && a.currentTime > 0.05; })()",
        { timeout: 15_000 },
      );
      await new Promise((r) => setTimeout(r, ms));
      return (await page.evaluate(
        () => (window as unknown as { __log: Sample[] }).__log,
      )) as Sample[];
    } finally {
      await page.close();
    }
  }

  /** `#N.f` for the last stop of slide N (1-based). */
  const lastStopOf = (stops: Stop[], slide: number) => {
    const s = stops.filter((x) => x.slide === slide - 1).at(-1) as Stop;
    return s.fragment > 0 ? `#${slide}.${s.fragment}` : `#${slide}`;
  };

  it("plays the seam into the next slide (two scenes on screen) where classic cuts", async () => {
    const overlap = async (design: "classic" | "v2", reduced: boolean) => {
      const stops = decks[design]?.stops ?? [];
      const log = await watch(design, lastStopOf(stops, 2), reduced, 3000, async (press) => {
        await press("ArrowRight");
      });
      return log.filter((s) => s.shown === "s2+s3").length;
    };
    expect(await overlap("classic", false)).toBe(0);
    expect(await overlap("v2", false)).toBeGreaterThan(5);
    expect(await overlap("v2", true)).toBe(0);
  }, 60_000);

  it("moves the scene through its quiet stretch while the stop's audio plays", async () => {
    const advance = async (design: "classic" | "v2", reduced: boolean) => {
      const stops = decks[design]?.stops ?? [];
      const hash = lastStopOf(stops, 2);
      const log = await watch(design, hash, reduced, 2500, async () => {});
      const times = log.map((s) => s.times.s2 ?? -1).filter((t) => t >= 0);
      return Math.max(...times) - Math.min(...times);
    };
    expect(await advance("classic", false)).toBeLessThan(0.01);
    expect(await advance("v2", false)).toBeGreaterThan(1);
    expect(await advance("v2", true)).toBeLessThan(0.01);
  }, 60_000);
});
