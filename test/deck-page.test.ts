/**
 * THE GATE THAT OPENS deck.html.
 *
 * Nothing did. `src/verify/index.ts` filters `DECK_PAGE` out of the composition
 * scan on purpose — the wrapper is a PRESENTED page whose rAF loop legitimately
 * reads a clock, so the render-time rules cannot apply to it — and the exclusion
 * was read, for the whole 0.4 deck-player workstream, as "this file has no gate".
 * `.planning/2026-09-09-0.4-integration.md` records the consequence under NOT
 * MEASURED ON THE MERGED BRANCH, and `.planning/EXPERIMENT-010-reconcile.md`
 * says the navigation was never once clicked through in a browser. Every
 * sentence in src/deck/runtime.ts that begins "nothing in the gate stack opens
 * deck.html" is about this file's absence.
 *
 * So this one builds a deck WITH THE CLI — `node dist/cli.js build`, the command
 * a reader can run, not a directory assembled here out of the emitter's parts —
 * serves it over http, opens it in THE RENDERER'S OWN CHROME (`chromePath`, so
 * PR #79's two-caches split cannot come back through a second resolver), and
 * drives it.
 *
 * WHY HTTP AND NOT file://. `frameOf` reaches the composition through the
 * player's iframe, and a `file://` parent gives that iframe an opaque origin:
 * `contentDocument` throws, `frame` is null, and the deck navigates perfectly
 * while painting nothing. That is the failure this gate exists to catch, so it
 * must be run from the side of the origin check where the deck is supposed to
 * work.
 *
 * WHAT IT ASSERTS, and each one is a failure no other gate here can see:
 *
 *  1. The chrome mounts and the composition is REACHED — `.ds-live` on the inner
 *     document (invariant 6 leaves every ambient rule inert without it) and a
 *     registered timeline for every scene the island names.
 *  2. A step MOVES THE COMPOSITION, not just the counter. `paint` toggles
 *     `display` and seeks the scene's own timeline; a deck that steps its
 *     counter while every timeline no-ops is the exact shape `frameOf`'s header
 *     describes, and it has nothing in any log.
 *  3. The browser's stop list agrees with `buildStops` — the pure function the
 *     rest of the suite tests — so the two cannot drift.
 *  4. A narrated stop whose audio cannot be played SAYS SO. `refused` splits
 *     that rejection from the autoplay policy and src/deck/runtime.ts's own note
 *     says "no gate here can see any of it — nothing in the suite opens deck.html
 *     or plays a sound". This does.
 *  5. Nothing throws, nothing 404s, and nothing is fetched off the fixture
 *     origin — the README's offline claim, measured rather than repeated.
 *  6. Invariant 7, on the ARTIFACT. test/deck.test.ts asserts the five source
 *     files never name `data-composition-id`; this asserts the file they are
 *     inlined into does not either, which is what the invariant is actually
 *     about.
 *
 * WHAT IT DOES NOT ASSERT, deliberately: nothing about the picture. The frame a
 * human looks at belongs to `decksmith frames` and the fidelity gate, which go
 * through `openDeck` and the capture path. This drives the presented deck, which
 * is a different artifact opened a different way, and the two must not be
 * confused — see src/render/capture.ts's header for why snapshot-style playback
 * and a suppressed seek disagree.
 */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Browser, KeyInput, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStops, formatHash, type SlideSpec, type Stop } from "../src/deck/runtime.js";
import { DECK_PAGE } from "../src/emit/composition.js";
import { chromePath } from "../src/render/capture.js";
import { storyboardSchema } from "../src/types.js";

const run = promisify(execFile);
const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

/**
 * No Chrome, no pass — and no pretending otherwise, exactly as
 * test/harvest.test.ts, test/readability.test.ts and test/server.test.ts do it.
 * CI installs no browser, so this is skipped there and runs on the machine of
 * whoever is about to believe the deck works.
 */
const chrome = await chromePath("open the deck page with").catch(() => null);

/* ------------------------------------------------------------- the fixture */

/** The island `emitIsland` writes into deck.html, as the runtime reads it. */
function islandOf(page: string): SlideSpec[] {
  const json = /hyperframes-slideshow\+json">\s*([\s\S]*?)\s*<\/script>/.exec(page)?.[1];
  const parsed: unknown = JSON.parse(json ?? "{}");
  return ((parsed as { slides?: SlideSpec[] }).slides ?? []) as SlideSpec[];
}

/**
 * A narration manifest for whatever beats the fixture storyboard actually has.
 *
 * Derived from the storyboard rather than written out, because narration.json is
 * keyed by beat id and carries no link to the plan it was made for — the very
 * drift `scanNarrationDrift` exists to catch. A hand-written fixture would stop
 * matching the day a beat is renamed, the narration island would silently not be
 * emitted, and the sound-state assertion below would fail for a reason that has
 * nothing to do with sound.
 *
 * THE MP3s ARE DELIBERATELY NOT MP3s. The assertion they serve is about what the
 * deck SAYS when a segment cannot be played, which is the branch `refused`
 * splits out and the one nothing has ever watched in a browser. A real recording
 * would test the other branch and would have to be a binary in the repository.
 */
async function narrationFor(dir: string, storyboardPath: string): Promise<string> {
  const storyboard = storyboardSchema.parse(JSON.parse(await readFile(storyboardPath, "utf8")));
  const beats: Record<string, unknown[]> = {};
  for (const beat of storyboard.beats) {
    const audio = `${beat.id}-0.mp3`;
    beats[beat.id] = [
      {
        stop: 0,
        text: `The line for ${beat.id}.`,
        audio,
        seconds: 3,
        cues: [{ start: 0, end: 3, text: `The line for ${beat.id}.` }],
      },
    ];
    await writeFile(join(dir, audio), "deliberately not playable audio");
  }
  const path = join(dir, "narration.json");
  await writeFile(path, `${JSON.stringify({ voice: "test", beats }, null, 2)}\n`);
  return path;
}

/** What the fixture server was asked for and could not produce. */
const missing: string[] = [];
/** Milliseconds the fixture server sits on every narration file before sending it. */
let slowAudioMs = 0;

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function serve(root: string): Server {
  return createServer((req, res) => {
    const path = normalize((req.url ?? "/").split("?")[0] ?? "/");
    // A deck is a directory of static files and nothing here escapes it; the
    // check is cheap and keeps a fixture server from being the one place a
    // traversal is allowed.
    if (path.includes("..")) {
      res.writeHead(403).end();
      return;
    }
    const file = join(root, path === "/" ? DECK_PAGE : path);
    const send = () => {
      const stream = createReadStream(file);
      stream.once("error", () => {
        missing.push(path);
        res.writeHead(404).end();
      });
      stream.once("open", () => {
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
        stream.pipe(res);
      });
    };
    if (slowAudioMs > 0 && /\.(mp3|wav)$/.test(path)) setTimeout(send, slowAudioMs);
    else send();
  });
}

/* ------------------------------------------------------------------ the pass */

describe.skipIf(chrome === null)("deck.html, opened in the renderer's own browser", () => {
  let dir = "";
  let base = "";
  let server: Server;
  let browser: Browser;
  let slides: SlideSpec[] = [];
  let stops: Stop[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-deck-page-"));
    const out = join(dir, "deck");
    const storyboard = repo("demo/fixtures/plain.storyboard.json");
    const cli = repo("dist/cli.js");
    const narration = await narrationFor(dir, storyboard);
    // `--no-fidelity` because the frame check opens a SECOND browser to do what
    // test/fidelity.test.ts and `decksmith frames` already own. This gate's
    // subject is the presented page, and paying for a capture pass here would
    // double the cost of the suite's slowest file to re-measure someone else's
    // assertion.
    await run(process.execPath, [
      cli,
      "build",
      storyboard,
      "--source",
      repo("demo/fixtures/plain.source.json"),
      "--narration",
      narration,
      "-o",
      out,
      "--no-fidelity",
    ]).catch((err: unknown) => {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      throw new Error(
        `could not build the fixture deck — ${e.message}\n${e.stdout ?? ""}${e.stderr ?? ""}\n` +
          `If ${cli} is missing, run \`npm run build\`: \`npm run check\` does not build.`,
      );
    });

    slides = islandOf(await readFile(join(out, DECK_PAGE), "utf8"));
    stops = buildStops(slides);
    server = serve(out);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { default: puppeteer } = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: chrome as string,
      headless: true,
      args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
    });
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    await new Promise<void>((r) => server?.close(() => r()));
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** One open deck page, with everything it complained about on the way in. */
  interface Open {
    page: Page;
    /** Uncaught errors, console errors, and requests the browser could not make. */
    loud: string[];
    /** Narration fetches a step abandoned. Expected; see `present`. */
    aborted: string[];
    /** Every request that did not go to the fixture server. */
    offsite: string[];
    close: () => Promise<void>;
  }

  async function present(): Promise<Open> {
    const page = await browser.newPage();
    const loud: string[] = [];
    const offsite: string[] = [];
    page.on("pageerror", (e: unknown) =>
      loud.push(`uncaught: ${e instanceof Error ? e.message : String(e)}`),
    );
    page.on("console", (m) => {
      // `warn` is upstream's sandbox notice, which the player's own iframe
      // attributes earn and nothing here can turn off. Errors and assertion
      // failures are ours.
      if (m.type() === "error") loud.push(`console.error: ${m.text()}`);
    });
    const aborted: string[] = [];
    page.on("requestfailed", (r) => {
      const why = r.failure()?.errorText;
      // ONE FAILURE IS THE DECK DOING ITS JOB, and only one. A step silences the
      // stop it leaves by dropping the <audio> source (`silence` in runtime.ts),
      // and Chrome reports a narration fetch still in flight at that moment as
      // net::ERR_ABORTED. Whether a fetch is still in flight is a race against
      // the machine's load: 0 of 10 isolated runs on v0.8.0 and on this branch
      // hit it, and the full suite — with more browser tests running beside it —
      // hit it 1 time in 3. v0.8.0 does it too, every time, once the file is slow
      // (the "drops a narration fetch" test below makes it slow on purpose). Kept
      // apart rather than ignored: any other failure, on any other URL, is loud.
      if (
        why === "net::ERR_ABORTED" &&
        /\/audio\/[^/]+\.(mp3|wav)$/.test(new URL(r.url()).pathname)
      ) {
        aborted.push(r.url());
        return;
      }
      loud.push(`failed: ${r.url()} ${why}`);
    });
    page.on("request", (r) => {
      if (!r.url().startsWith(base) && !r.url().startsWith("data:")) offsite.push(r.url());
    });
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`${base}/${DECK_PAGE}`, { waitUntil: "load", timeout: 60_000 });
    // The runtime installs the chrome, then waits on the player's one-shot
    // `ready` event for up to five seconds before it paints the opening stop.
    // The counter is the first thing `go` writes, so it is the readiness signal
    // that does not need a hook of its own.
    await page.waitForFunction("document.querySelector('.ds-count')?.textContent", {
      timeout: 60_000,
    });
    return { page, loud, aborted, offsite, close: () => page.close() };
  }

  /** Where the composition should be when the deck has settled on `i`. */
  function landing(i: number): { sceneId: string; local: number } {
    const stop = stops[i] as Stop;
    const slide = slides.find((s) => s.sceneId === stop.sceneId) as SlideSpec;
    return { sceneId: stop.sceneId, local: stop.t - (slide.startTime ?? 0) };
  }

  /**
   * Wait for the deck to have ARRIVED at stop `i` — the hash, the scene that is
   * displayed, the seeked time on that scene's own timeline, AND the player's
   * own clock.
   *
   * The two clocks are checked separately because `cutTo` moves them separately
   * and they fail separately. `player.seek(t)` is the player's, and under the
   * render engine it is enough on its own; the standalone bundle drives neither
   * the per-scene timelines nor clip visibility, which is why `paint` exists and
   * why a deck can seek perfectly while showing every scene at its `from` state.
   * Asserting only one of them would leave exactly one of those two failures
   * invisible, and the second one is the one that shipped.
   *
   * CLAMPED, because `seek` past a paused timeline's end lands on its end: `s2`
   * here runs 3.1s and its last stop is at 3.2 into the scene, so the honest
   * expectation is `min(local, duration)`. `duration > 0` is what keeps that
   * from being vacuous — a scene whose script never ran registers nothing, and
   * one that registered an empty timeline would otherwise satisfy `0 === min(t, 0)`.
   *
   * 1e-3 of tolerance because invariant 10 rounds times to three decimals and
   * nothing here should need more.
   */
  async function arrived(open: Open, i: number): Promise<void> {
    const want = landing(i);
    await open.page
      .waitForFunction(
        (hash: string, sceneId: string, local: number, absolute: number, ids: string[]) => {
          if (location.hash !== hash) return false;
          const el = document.querySelector("hyperframes-player");
          const iframe = el?.shadowRoot?.querySelector("iframe") ?? el?.querySelector("iframe");
          const doc = (iframe as HTMLIFrameElement | null)?.contentDocument;
          const win = (iframe as HTMLIFrameElement | null)?.contentWindow as
            | (Window & {
                __timelines?: Record<
                  string,
                  { time: () => number; duration: () => number } | undefined
                >;
              })
            | null;
          if (!doc || !win) return false;
          // EXCLUSIVELY displayed. "the right scene is visible" passes on a deck
          // that never hides anything, which is every scene stacked on every other
          // — so the assertion has to be over the whole set.
          for (const id of ids) {
            const scene = doc.getElementById(id) as HTMLElement | null;
            if (!scene) return false;
            if ((scene.style.display === "none") === (id === sceneId)) return false;
          }
          const at = (id: string, t: number) => {
            const tl = win.__timelines?.[id];
            if (!tl) return false;
            const d = tl.duration();
            return d > 0 && Math.abs(tl.time() - Math.min(t, d)) < 1e-3;
          };
          return at(sceneId, local) && at("main", absolute);
        },
        { timeout: 30_000 },
        formatHash(stops[i] as Stop),
        want.sceneId,
        want.local,
        (stops[i] as Stop).t,
        slides.map((s) => s.sceneId),
      )
      .catch(async (err: unknown) => {
        // A bare "Waiting failed: 30000ms exceeded" names neither the stop nor
        // which half of the arrival never happened, and every failure this gate is
        // for arrives as that timeout. Say what was wanted and what the deck was
        // actually showing instead.
        const got = await probe(open).catch(() => null);
        throw new Error(
          `the deck never arrived at stop ${i} of ${stops.length} ` +
            `(${formatHash(stops[i] as Stop)}, ${want.sceneId} at ${want.local.toFixed(3)}s, ` +
            `player clock ${(stops[i] as Stop).t.toFixed(3)}s)\n` +
            `it was showing: ${JSON.stringify(got)}\n${(err as Error).message}`,
        );
      });
  }

  /** Everything the presenter chrome is showing, in one round trip. */
  const probe = (open: Open) =>
    open.page.evaluate(
      (sceneIds: string[]) => {
        const el = document.querySelector("hyperframes-player");
        const iframe = el?.shadowRoot?.querySelector("iframe") ?? el?.querySelector("iframe");
        const doc = (iframe as HTMLIFrameElement | null)?.contentDocument;
        const win = (iframe as HTMLIFrameElement | null)?.contentWindow as
          | (Window & { __timelines?: Record<string, unknown> })
          | null;
        const audio = document.querySelector("audio");
        return {
          hash: location.hash,
          chrome: !!document.querySelector(".ds-chrome"),
          count: document.querySelector(".ds-count")?.textContent ?? "",
          fill:
            (document.querySelector(".ds-bar > i") as HTMLElement | null)?.style.transform ?? "",
          flags: document.querySelector(".ds-flags")?.textContent ?? "",
          cap: document.documentElement.classList.contains("ds-cap"),
          audioSrc: audio?.getAttribute("src") ?? null,
          live: doc?.documentElement.classList.contains("ds-live") ?? false,
          // The SLIDES only. The composition's root carries a
          // `data-composition-id` of its own and is displayed throughout, so
          // selecting on the attribute rather than on the island's ids would make
          // "which slide is up" always answer "the root, and a slide".
          displayed: doc
            ? sceneIds.filter((id) => {
                const el = doc.getElementById(id) as HTMLElement | null;
                return !!el && el.style.display !== "none";
              })
            : null,
          timelines: Object.keys(win?.__timelines ?? {}).sort(),
        };
      },
      slides.map((s) => s.sceneId),
    );

  it("presents the deck it was built from, and reaches the composition", async () => {
    const open = await present();
    try {
      await arrived(open, 0);
      const got = await probe(open);
      expect(got.chrome, "the presenter chrome never mounted").toBe(true);
      // The counter names SLIDES; the island is the manifest it has to agree with.
      const lastSlide = (stops[stops.length - 1] as Stop).slide + 1;
      expect(lastSlide).toBe(slides.filter((s) => s.startTime !== undefined).length);
      expect(got.count).toBe(`1 / ${lastSlide}`);
      // `.ds-live` is set on the INNER document and only by a presented deck.
      // Without it every ambient rule in the composition is inert (invariant 6),
      // and its absence is also how a deck says it never reached the frame.
      expect(got.live, "the composition was never reached — .ds-live is not on it").toBe(true);
      // A timeline per scene, read through the window rather than a snapshot of
      // it. An empty map here is the deck that navigates and paints nothing.
      expect(got.timelines).toEqual([...slides.map((s) => s.sceneId), "main"].sort());
      expect(got.displayed).toEqual([(stops[0] as Stop).sceneId]);
      expect(open.loud).toEqual([]);
    } finally {
      await open.close();
    }
  }, 120_000);

  it("draws its text in the Inter it ships, not the viewer's fallback", async () => {
    // Every theme's stack opens with "Inter", and until `build` shipped the face
    // the deck declared none. HyperFrames' compiler supplies Inter only inside a
    // render, so the presented deck drew SF on a Mac and DejaVu on Linux, and so
    // did the page every build gate measures. A face is `loaded` only once text
    // in the document asked for it, so this also fails on a face declared and
    // never used.
    const open = await present();
    try {
      await arrived(open, 0);
      const loaded = await open.page.evaluate(async () => {
        const el = document.querySelector("hyperframes-player");
        const iframe = el?.shadowRoot?.querySelector("iframe") ?? el?.querySelector("iframe");
        const doc = (iframe as HTMLIFrameElement | null)?.contentDocument;
        if (!doc) return -1;
        await doc.fonts.ready;
        return [...doc.fonts].filter(
          (f) => f.family.replace(/["']/g, "") === "Inter" && f.status === "loaded",
        ).length;
      });
      expect(loaded, "the composition was never reached").not.toBe(-1);
      expect(
        loaded,
        "no Inter face loaded: the deck is drawn in the host's fallback",
      ).toBeGreaterThan(0);
      expect(open.loud).toEqual([]);
    } finally {
      await open.close();
    }
  }, 120_000);

  it("advances and goes back, by key and by click, and the composition follows", async () => {
    const open = await present();
    try {
      await arrived(open, 0);

      await open.page.keyboard.press("ArrowRight");
      await arrived(open, 1);
      await open.page.keyboard.press("ArrowLeft");
      await arrived(open, 0);

      // Click-to-advance: the outer thirds of the page, which is the only
      // pointer navigation the deck ships. The chrome swallows its own clicks,
      // so this must land on the slide itself.
      await open.page.mouse.click(1200, 300);
      await arrived(open, 1);
      await open.page.mouse.click(60, 300);
      await arrived(open, 0);

      // Home/End are jumps rather than steps, and End is the one that proves the
      // browser and `buildStops` counted the same stops.
      await open.page.keyboard.press("End");
      await arrived(open, stops.length - 1);
      const end = await probe(open);
      expect(end.hash).toBe(formatHash(stops[stops.length - 1] as Stop));
      expect(end.fill).toBe("scaleX(1)");

      await open.page.keyboard.press("Home");
      await arrived(open, 0);
      expect(open.loud).toEqual([]);
    } finally {
      await open.close();
    }
  }, 120_000);

  it("counts the same stops the pure function does", async () => {
    // The progress bar is `(at + 1) / stops.length`, so the opening stop states
    // the browser's own total. Reading it back is the only place the runtime's
    // idea of how many stops a deck has is compared with `buildStops` — the
    // function every other test in test/deck.test.ts exercises without a page.
    const open = await present();
    try {
      await arrived(open, 0);
      const got = await probe(open);
      const scale = Number(/scaleX\(([\d.]+)\)/.exec(got.fill)?.[1] ?? "0");
      expect(scale).toBeGreaterThan(0);
      expect(Math.round(1 / scale)).toBe(stops.length);
      expect(open.loud).toEqual([]);
    } finally {
      await open.close();
    }
  }, 120_000);

  it("says a narrated stop has no sound it can play, instead of going quiet", async () => {
    const open = await present();
    try {
      await arrived(open, 0);
      // The segment for this stop, named by the island and mounted on an <audio>
      // the runtime appends. If this is null the narration island never parsed
      // and nothing below is measuring what it says it is.
      const first = await probe(open);
      expect(first.audioSrc, "no segment was mounted for the opening stop").toMatch(/\.mp3$/);
      // Subtitles are on by default, and turning them on is what RESERVES the
      // caption strip — the class that shrinks the slide to make room for it.
      expect(first.cap, "the caption strip was never reserved").toBe(true);

      // THE ASSERTION. `play()` rejects for a file that is not audio, and the
      // deck must name a state rather than fall silent. Either honest answer
      // passes: `refused` fails SAFE to the autoplay policy on a rejection name
      // it does not know, and which name a given engine produces is exactly the
      // thing src/deck/runtime.ts refuses to claim across engines.
      await open.page
        .waitForFunction(
          () =>
            /narration unavailable|press any key for sound/.test(
              document.querySelector(".ds-flags")?.textContent ?? "",
            ),
          { timeout: 30_000 },
        )
        .catch(async () => {
          const flags = await open.page
            .evaluate(() => document.querySelector(".ds-flags")?.textContent ?? "")
            .catch(() => "<unreadable>");
          throw new Error(
            "a segment that cannot be played was never reported: the flag strip reads " +
              `${JSON.stringify(flags)}. A deck that goes quiet without saying why is the ` +
              "failure `refused` and the flags() calls around it exist to prevent.",
          );
        });

      // And the segment follows the stop rather than the deck: one audio track,
      // re-pointed on arrival.
      await open.page.keyboard.press("ArrowRight");
      await arrived(open, 1);
      const next = await probe(open);
      expect(next.audioSrc).toMatch(/\.mp3$/);
      expect(next.audioSrc).not.toBe(first.audioSrc);

      // `s` is the subtitle toggle, and the strip it reserves goes with it. This
      // is the flag that is appended whatever the audio did, so it is the one
      // that can be asserted exactly.
      await open.page.keyboard.press("s");
      await open.page.waitForFunction(
        () =>
          !document.documentElement.classList.contains("ds-cap") &&
          /subtitles off/.test(document.querySelector(".ds-flags")?.textContent ?? ""),
        { timeout: 15_000 },
      );
      await open.page.keyboard.press("s");
      await open.page.waitForFunction(() => document.documentElement.classList.contains("ds-cap"), {
        timeout: 15_000,
      });
      expect(open.loud).toEqual([]);
    } finally {
      await open.close();
    }
  }, 120_000);

  it("drops a narration fetch it no longer needs, and calls nothing else a failure", async () => {
    // The mechanism behind the one failure `present` keeps apart, made
    // deterministic: every narration file takes 1.5s, so the step lands while
    // the fetch for the stop it leaves is still in flight.
    slowAudioMs = 1500;
    const open = await present();
    try {
      await arrived(open, 0);
      await open.page.keyboard.press("ArrowRight");
      await arrived(open, 1);
      await open.page.keyboard.press("ArrowLeft");
      await arrived(open, 0);
      await new Promise((r) => setTimeout(r, 1_800));
      expect(open.aborted.length, "the step did not abandon the slow fetch").toBeGreaterThan(0);
      expect(open.aborted.every((u) => /\/audio\//.test(u))).toBe(true);
      expect(open.loud).toEqual([]);
    } finally {
      slowAudioMs = 0;
      await open.close();
    }
  }, 120_000);

  it("navigates a whole pass without throwing, 404ing, or leaving the machine", async () => {
    missing.length = 0;
    const open = await present();
    try {
      await arrived(open, 0);
      for (let i = 1; i < stops.length; i++) {
        await open.page.keyboard.press("ArrowRight");
        await arrived(open, i);
      }
      for (let i = stops.length - 2; i >= 0; i--) {
        await open.page.keyboard.press("ArrowLeft");
        await arrived(open, i);
      }
      // `n` shows the speaker notes, `m` mutes, `v` is the clip toggle on a deck
      // with no clip: every one of them is a handler that can throw and nothing
      // else here presses them.
      const keys: KeyInput[] = ["n", "m", "v", "n"];
      for (const key of keys) await open.page.keyboard.press(key);

      // `p` is autoplay, and it is toggled with an assertion between the two
      // presses rather than smoked through. Left on, `settleDwell` arms a
      // timeout that steps the deck on its own after `MIN_DWELL`, so a second
      // press that silently did nothing would turn every later assertion in
      // this test into a race against a deck walking away by itself. Waiting on
      // the button's own state is what makes the mode provably off again.
      await open.page.keyboard.press("p");
      await open.page.waitForFunction(
        () => document.querySelector<HTMLElement>(".ds-play")?.dataset.on === "1",
        { timeout: 15_000 },
      );
      await open.page.keyboard.press("p");
      await open.page.waitForFunction(
        () => document.querySelector<HTMLElement>(".ds-play")?.dataset.on === "0",
        { timeout: 15_000 },
      );

      await open.page.keyboard.press("Home");
      await arrived(open, 0);

      expect(open.loud, "the deck threw, or the browser could not fetch something").toEqual([]);
      expect(missing, "the deck asked for a file the build did not write").toEqual([]);
      // THE OFFLINE CLAIM, MEASURED. A built deck is supposed to need no network
      // to navigate — which is why the player bundle ships beside it and the
      // scripts are vendored rather than left to a CDN. Nothing in the suite has
      // ever watched a presented deck to find out.
      expect(open.offsite, "a presented deck reached off its own origin").toEqual([]);
    } finally {
      await open.close();
    }
  }, 180_000);

  it("never names the attribute that would make deck.html a second root composition", async () => {
    // INVARIANT 7, on the artifact rather than on its parts. test/deck.test.ts
    // asserts the five inlined source files never write the literal; this is the
    // file they are inlined INTO, which is the one lint would fail on.
    const page = await readFile(join(dir, "deck", DECK_PAGE), "utf8");
    expect(page).not.toContain("data-composition-id");
  });
});

/* ------------------------------------------------------------- the v2 player */

/**
 * A WAV of silence, built here rather than committed: the speed assertions need
 * a narration the browser will ACTUALLY play, so its clock moves and its rate
 * can be measured against the wall clock. Silence plays like anything else.
 */
function silentWav(seconds: number, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  return b;
}

/**
 * A narration that plays: twelve seconds a stop, one long real cue each. The
 * FIRST stop speaks a Japanese cue with no space in it — the one `splitCue`
 * cannot cut — so what the runtime shows there says which split it used.
 */
async function playableNarration(
  dir: string,
  storyboardPath: string,
  name = "narration-v2.json",
): Promise<string> {
  const storyboard = storyboardSchema.parse(JSON.parse(await readFile(storyboardPath, "utf8")));
  const real = JSON.parse(await readFile(repo("test/fixtures/real-cues.json"), "utf8")) as {
    cues: Record<string, string[]>;
  };
  const beats: Record<string, unknown[]> = {};
  const unspaced = (real.cues.ja ?? []).find((t) => !/\s/.test(t) && t.length > 60);
  for (const [i, beat] of storyboard.beats.entries()) {
    const audio = `${beat.id}-0.wav`;
    // A beat that carries its own narration must be said as written: `build`
    // refuses audio that says something else (`scanNarrationDrift`).
    const text =
      beat.narration?.trim() ||
      ((i === 0 ? unspaced : real.cues.en?.[i]) ?? `The line for ${beat.id}.`);
    beats[beat.id] = [{ stop: 0, text, audio, seconds: 12, cues: [{ start: 0, end: 12, text }] }];
    await writeFile(join(dir, audio), silentWav(12));
  }
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify({ voice: "test", beats }, null, 2)}\n`);
  return path;
}

describe.skipIf(chrome === null)("the v2 player, in the renderer's own browser", () => {
  let dir = "";
  let base = "";
  let server: Server;
  let browser: Browser;
  let stops: Stop[] = [];
  let demoStops: Stop[] = [];
  /** Every real cue, en/ko/ja/zh, uncut: each viewport cuts them to its own strip. */
  let realCues: string[] = [];

  const VIEWPORTS: [number, number][] = [
    [1920, 1080],
    [1280, 720],
    [960, 540],
    [800, 450],
    [390, 844],
    [358, 201],
  ];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-deck-v2-"));
    const storyboard = repo("demo/fixtures/plain.storyboard.json");
    const cli = repo("dist/cli.js");
    const narration = await playableNarration(dir, storyboard);
    const build = (out: string, extra: string[]) =>
      run(process.execPath, [
        cli,
        "build",
        storyboard,
        "--source",
        repo("demo/fixtures/plain.source.json"),
        "--narration",
        narration,
        "-o",
        out,
        "--no-fidelity",
        ...extra,
      ]);
    // One build with the flag; and the SAME deck built classic and then
    // repacked, which is how every deck already on a CDN gets the v2 player.
    // `--no-bespoke`: v2 now draws every narrated beat with Codex by default,
    // and this test is about the page, not about generated scenes.
    await build(join(dir, "v2"), ["--design", "v2", "--no-bespoke"]);
    await build(join(dir, "classic"), []);
    await run(process.execPath, [cli, "repack", join(dir, "classic")]);
    // The demo under v2, pinned to a pack whose Director picks foot and rail
    // headlines (test/look-page.test.ts): the slides whose text reaches lowest,
    // which is where a control bar used to land on it.
    const demo = repo("demo/storyboard.json");
    await run(process.execPath, [
      cli,
      "build",
      demo,
      "--source",
      repo("demo/source.json"),
      "--narration",
      await playableNarration(join(dir), demo, "narration-demo.json"),
      "-o",
      join(dir, "demo"),
      "--no-fidelity",
      "--design",
      "v2",
      "--no-bespoke",
      "--theme",
      "signal",
    ]);
    demoStops = buildStops(islandOf(await readFile(join(dir, "demo", DECK_PAGE), "utf8")));

    stops = buildStops(islandOf(await readFile(join(dir, "v2", DECK_PAGE), "utf8")));
    const real = JSON.parse(await readFile(repo("test/fixtures/real-cues.json"), "utf8")) as {
      cues: Record<string, string[]>;
    };
    realCues = Object.values(real.cues).flat();

    server = serve(dir);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { default: puppeteer } = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: chrome as string,
      headless: true,
      // The speed test needs the narration to start without a gesture.
      args: [
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
  }, 300_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    await new Promise<void>((r) => server?.close(() => r()));
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /**
   * One page of the v2 deck. Storage is cleared first unless `keep`: every page
   * shares the fixture origin, so one test's saved preference would otherwise
   * become the next test's starting state.
   */
  async function open(path: string, w = 1280, h = 720, keep = false): Promise<Open2> {
    const page = await browser.newPage();
    if (!keep) await page.evaluateOnNewDocument(() => localStorage.clear());
    const loud: string[] = [];
    const offsite: string[] = [];
    page.on("pageerror", (e: unknown) => loud.push(`uncaught: ${String(e)}`));
    page.on("console", (m) => {
      if (m.type() === "error") loud.push(`console.error: ${m.text()}`);
    });
    page.on("request", (r) => {
      if (!r.url().startsWith(base) && !r.url().startsWith("data:")) offsite.push(r.url());
    });
    await page.setViewport({ width: w, height: h });
    await page.goto(`${base}/${path}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction("document.querySelector('.ds-count')?.textContent", {
      timeout: 60_000,
    });
    return { page, loud, offsite, close: () => page.close() };
  }
  interface Open2 {
    page: Page;
    loud: string[];
    offsite: string[];
    close: () => Promise<void>;
  }

  const at = (open: Open2, i: number) =>
    open.page.waitForFunction(
      (h: string) => location.hash === h,
      { timeout: 30_000 },
      formatHash(stops[i] as Stop),
    );

  /**
   * Everything the layout promises about, in one round trip: the slide's box,
   * every visible control's box, the caption's TEXT boxes (not the strip's: the
   * strip is shared with the controls on purpose, its text never is), and every
   * glyph run the composition is showing, mapped from the slide's 1920x1080
   * into the page.
   */
  const rects = (open: Open2) =>
    open.page.evaluate(() => {
      type R = { x: number; y: number; w: number; h: number };
      const box = (el: Element | null): R | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const shown = (el: Element) => {
        const cs = getComputedStyle(el);
        return (
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          (el as HTMLElement).offsetParent !== null
        );
      };
      const controls = [...document.querySelectorAll(".ds-controls button")]
        .filter((b) => !b.closest(".ds-menu") && shown(b))
        .map((b) => box(b) as R);
      const textOf = (root: Node, doc: Document, map: (q: DOMRect) => R | null) => {
        const out: R[] = [];
        const walk = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.textContent?.trim()) continue;
          let visible = true;
          for (let e = n.parentElement; e; e = e.parentElement) {
            const cs = doc.defaultView?.getComputedStyle(e);
            if (
              !cs ||
              cs.display === "none" ||
              cs.visibility === "hidden" ||
              Number(cs.opacity) < 0.05
            )
              visible = false;
          }
          if (!visible) continue;
          const range = doc.createRange();
          range.selectNodeContents(n);
          for (const q of range.getClientRects()) {
            const r = q.width >= 1 && q.height >= 1 ? map(q) : null;
            if (r) out.push(r);
          }
        }
        return out;
      };
      const subs = document.querySelector(".ds-subs") as HTMLElement;
      const caption = subs.hidden
        ? []
        : textOf(subs, document, (q) => ({ x: q.x, y: q.y, w: q.width, h: q.height }));
      const player = document.querySelector("hyperframes-player");
      const iframe = player?.shadowRoot?.querySelector("iframe");
      const slide = box(player);
      let slideText: R[] = [];
      if (iframe?.contentDocument?.body && slide) {
        const ir = iframe.getBoundingClientRect();
        const d = iframe.contentDocument;
        const sx = ir.width / d.documentElement.clientWidth;
        const sy = ir.height / d.documentElement.clientHeight;
        slideText = textOf(d.body, d, (q) => {
          const r = { x: ir.x + q.x * sx, y: ir.y + q.y * sy, w: q.width * sx, h: q.height * sy };
          // Off the canvas is not on screen: scenes not showing sit outside it.
          const on = r.x < ir.right && r.y < ir.bottom && r.x + r.w > ir.x && r.y + r.h > ir.y;
          return on ? r : null;
        });
      }
      return {
        vw: innerWidth,
        vh: innerHeight,
        dock: document.documentElement.dataset.dock ?? "",
        budget: Number(document.documentElement.dataset.dsCueEm),
        slide,
        controls,
        caption,
        slideText,
        menu: box(document.querySelector(".ds-menu:not([hidden])")),
        smallest: Math.min(...controls.map((r) => Math.min(r.w, r.h))),
      };
    });

  type Rect = { x: number; y: number; w: number; h: number } | null;
  const overlaps = (a: Rect, b: Rect) =>
    !!a &&
    !!b &&
    a.x < b.x + b.w - 0.5 &&
    b.x < a.x + a.w - 0.5 &&
    a.y < b.y + b.h - 0.5 &&
    b.y < a.y + a.h - 0.5;
  /** Every control that lands on any of `texts`. Empty is the promise. */
  const covering = (controls: Rect[], texts: Rect[]) =>
    controls.flatMap((c) => texts.filter((t) => overlaps(c, t)).map((t) => ({ c, t })));
  const inside = (a: Rect, b: Rect) =>
    !!a &&
    !!b &&
    a.x >= b.x - 0.5 &&
    a.y >= b.y - 0.5 &&
    a.x + a.w <= b.x + b.w + 0.5 &&
    a.y + a.h <= b.y + b.h + 0.5;
  /** Slide area over the largest 16:9 box the viewport holds — 1 is "the captions cost nothing". */
  const share = (r: Awaited<ReturnType<typeof rects>>) => {
    const full = Math.min(r.vw, (r.vh * 16) / 9) * Math.min(r.vh, (r.vw * 9) / 16);
    return ((r.slide?.w ?? 0) * (r.slide?.h ?? 0)) / full;
  };
  /** The longest real cue piece at this page's budget, put up in the strip. */
  const longestCaption = async (o: Open2) => {
    const { splitForScreen, cueEm } = await import("../src/deck/subtitles.js");
    const budget = await o.page.evaluate(() => Number(document.documentElement.dataset.dsCueEm));
    const pieces = realCues.flatMap((text) =>
      splitForScreen({ start: 0, end: 1, text }, budget).map((c) => c.text),
    );
    const longest = pieces.reduce((a, b) => (cueEm(b) > cueEm(a) ? b : a), "");
    await o.page.evaluate((t: string) => {
      const s = document.querySelector<HTMLElement>(".ds-subs") as HTMLElement;
      s.textContent = t;
      s.hidden = false;
    }, longest);
    return pieces;
  };

  it("marks the page it was built with --design v2, and the repacked one, and not the classic one", async () => {
    const { PLAYER_MARKER } = await import("../src/deck/playback.js");
    expect(await readFile(join(dir, "v2", DECK_PAGE), "utf8")).toContain(PLAYER_MARKER);
    expect(await readFile(join(dir, "classic", "deck2.html"), "utf8")).toContain(PLAYER_MARKER);
    expect(await readFile(join(dir, "classic", DECK_PAGE), "utf8")).not.toContain(PLAYER_MARKER);
  });

  it("gives the slide its space back and never puts a control over a caption, at six viewports", async () => {
    // Targets from the plan (QW3 + critic 7, 8): ≥83% with CC on at 1080p and in
    // the 800x450 embed (v0.8.0: 76.9% and 68.7%), the letterbox free on a
    // portrait phone, and the phone embed above the 64% the strip alone left.
    const floor: Record<string, number> = {
      "1920x1080": 0.83,
      "1280x720": 0.83,
      "960x540": 0.83,
      "800x450": 0.83,
      "390x844": 0.999,
      "358x201": 0.64,
    };
    for (const [w, h] of VIEWPORTS) {
      const o = await open(`v2/${DECK_PAGE}`, w, h);
      try {
        await at(o, 0);
        await longestCaption(o);
        const on = await rects(o);
        const label = `${w}x${h} (${on.dock})`;
        expect(share(on), label).toBeGreaterThanOrEqual(floor[`${w}x${h}`] as number);
        expect(on.caption.length, `${label}: no caption on screen to measure`).toBeGreaterThan(0);
        expect(covering(on.controls, on.caption), `${label}: a control over a caption`).toEqual([]);
        expect(covering(on.controls, on.slideText), `${label}: a control over slide text`).toEqual(
          [],
        );
        expect(on.smallest, `${label}: a target under 40px`).toBeGreaterThanOrEqual(40);

        // A menu is a viewer's momentary, explicit choice: it may sit over the
        // slide while open, but never leaves the window.
        for (const button of [".ds-speed", ".ds-size", ".ds-more"]) {
          if (!(await o.page.$eval(button, (b) => (b as HTMLElement).offsetParent !== null)))
            continue;
          await o.page.click(button);
          const m = await rects(o);
          const win = { x: 0, y: 0, w: m.vw, h: m.vh };
          expect(inside(m.menu, win), `${label}: ${button} menu leaves the window`).toBe(true);
          await o.page.keyboard.press("Escape");
        }

        await o.page.keyboard.press("c");
        const off = await rects(o);
        // Off, the slide never gets smaller; where the bar costs nothing it gets all of it.
        expect(share(off), `${label} with CC off`).toBeGreaterThanOrEqual(share(on) - 1e-9);
        if (off.dock !== "band") expect(share(off), `${label} with CC off`).toBeGreaterThan(0.999);
        expect(covering(off.controls, off.slideText), `${label} CC off: slide text`).toEqual([]);
        expect(o.loud).toEqual([]);
      } finally {
        await o.close();
      }
    }
  }, 300_000);

  it("never puts a control over the slide's text on a deck with foot and rail headlines, at six viewports", async () => {
    // The review's blocker (2026-10-08): with the bar inside the slide, foot
    // headlines lost 15-36px to it at 390x844 and 3-26px at 800x450. Every
    // stop of the demo, at every viewport, with the bar up.
    const looks = JSON.parse(await readFile(join(dir, "demo", "look.json"), "utf8")) as {
      beats: { placement: string }[];
    };
    expect(looks.beats.some((b) => b.placement === "foot")).toBe(true);
    for (const [w, h] of VIEWPORTS) {
      const o = await open(`demo/${DECK_PAGE}`, w, h);
      try {
        for (const stop of demoStops) {
          await o.page.evaluate((hash: string) => {
            location.hash = hash;
          }, formatHash(stop));
          await o.page.waitForFunction(
            (hsh: string) => location.hash === hsh,
            {},
            formatHash(stop),
          );
          // Let the cut land and the composition paint.
          await new Promise((r) => setTimeout(r, 120));
          await o.page.mouse.move(w / 2, h / 2);
          const r = await rects(o);
          expect(
            r.slideText.length,
            `${w}x${h} ${formatHash(stop)}: nothing measured`,
          ).toBeGreaterThan(0);
          expect(
            covering(r.controls, r.slideText),
            `${w}x${h} (${r.dock}) ${formatHash(stop)}: a control over slide text`,
          ).toEqual([]);
        }
        expect(o.loud).toEqual([]);
      } finally {
        await o.close();
      }
    }
  }, 600_000);

  it("fits every real caption, en/ko/ja/zh, on two lines at every viewport and size", async () => {
    const { splitForScreen } = await import("../src/deck/subtitles.js");
    for (const [w, h] of VIEWPORTS) {
      for (const size of ["s", "m", "l", "xl"]) {
        const o = await open(`v2/${DECK_PAGE}?ccsize=${size}`, w, h);
        try {
          // Cut as this page cuts them: to its own strip's width at this size.
          const budget = await o.page.evaluate(() =>
            Number(document.documentElement.dataset.dsCueEm),
          );
          expect(budget, `${w}x${h} ${size}: no budget`).toBeGreaterThan(8);
          const pieces = realCues.flatMap((text) =>
            splitForScreen({ start: 0, end: 1, text }, budget).map((c) => c.text),
          );
          const over = await o.page.evaluate((texts: string[]) => {
            const s = document.querySelector<HTMLElement>(".ds-subs") as HTMLElement;
            s.hidden = false;
            return texts.filter((t) => {
              s.textContent = t;
              return s.scrollHeight > s.clientHeight + 1;
            });
          }, pieces);
          expect(over, `${w}x${h} ${size}`).toEqual([]);
        } finally {
          await o.close();
        }
      }
    }
  }, 300_000);

  it("makes each caption size step visible, even on the phone embed", async () => {
    // Review 2026-10-08: at 358x201 every size clamped to the 13px floor, so the
    // size control did nothing on HypePaper's mobile iframe.
    for (const [w, h] of [
      [358, 201],
      [800, 450],
    ] as const) {
      const fonts: number[] = [];
      for (const size of ["m", "l", "xl"]) {
        const o = await open(`v2/${DECK_PAGE}?ccsize=${size}`, w, h);
        try {
          fonts.push(
            await o.page.$eval(".ds-subs", (s) => Number.parseFloat(getComputedStyle(s).fontSize)),
          );
        } finally {
          await o.close();
        }
      }
      expect(fonts[1], `${w}x${h} L over M`).toBeGreaterThan(fonts[0] as number);
      expect(fonts[2], `${w}x${h} XL over L`).toBeGreaterThan(fonts[1] as number);
    }
  }, 120_000);

  it("shows the caption the screen split made for this strip, not the 84-character one", async () => {
    const { cueEm } = await import("../src/deck/subtitles.js");
    const o = await open(`v2/${DECK_PAGE}`, 358, 201);
    try {
      await at(o, 0);
      await o.page.keyboard.press("Enter");
      await o.page.waitForFunction("document.querySelector('.ds-subs')?.textContent", {
        timeout: 30_000,
      });
      const shown = await o.page.$eval(".ds-subs", (s) => ({
        text: s.textContent ?? "",
        over: s.scrollHeight > s.clientHeight + 1,
        budget: Number(document.documentElement.dataset.dsCueEm),
      }));
      expect(cueEm(shown.text)).toBeLessThanOrEqual(shown.budget);
      expect(shown.over).toBe(false);
    } finally {
      await o.close();
    }
  }, 120_000);

  it("steps on Space, plays and PAUSES on Enter, toggles captions on c, and leaves Cmd+F to the browser", async () => {
    const o = await open(`v2/${DECK_PAGE}`);
    try {
      await at(o, 0);
      await o.page.keyboard.press("Space");
      await at(o, 1);
      expect(await o.page.$eval(".ds-play", (b) => (b as HTMLElement).dataset.on)).not.toBe("1");
      // Paused is paused: arriving by Space said nothing.
      const audio = () =>
        o.page.evaluate(() => {
          const a = document.querySelector("audio") as HTMLAudioElement;
          return { t: a.currentTime, paused: a.paused, src: a.getAttribute("src") ?? "" };
        });
      expect((await audio()).paused).toBe(true);

      await o.page.keyboard.press("Enter");
      await o.page.waitForFunction("document.querySelector('.ds-play').dataset.on === '1'");
      await o.page.waitForFunction("document.querySelector('audio').currentTime > 0.8", {
        timeout: 30_000,
      });
      // Enter again PAUSES THE VOICE, not just the auto-advance (review 2026-10-08:
      // the sentence went on talking under a paused button).
      await o.page.keyboard.press("Enter");
      await o.page.waitForFunction("document.querySelector('.ds-play').dataset.on === '0'");
      const p0 = await audio();
      expect(p0.paused).toBe(true);
      await new Promise((r) => setTimeout(r, 700));
      const p1 = await audio();
      expect(p1.paused).toBe(true);
      expect(p1.t).toBeCloseTo(p0.t, 3);
      // And Enter RESUMES from that word rather than starting the sentence over.
      await o.page.keyboard.press("Enter");
      await o.page.waitForFunction(
        (t: number) => (document.querySelector("audio") as HTMLAudioElement).currentTime > t + 0.3,
        { timeout: 15_000 },
        p1.t,
      );
      const r = await audio();
      expect(r.src).toBe(p1.src);
      expect(r.t).toBeGreaterThan(p1.t);
      await o.page.keyboard.press("Enter");
      await o.page.waitForFunction("document.querySelector('.ds-play').dataset.on === '0'");

      const cc = () => o.page.$eval(".ds-cc", (b) => b.getAttribute("aria-pressed"));
      expect(await cc()).toBe("true");
      await o.page.keyboard.press("c");
      expect(await cc()).toBe("false");
      // The button, by pointer, is the same switch.
      await o.page.click(".ds-cc");
      expect(await cc()).toBe("true");

      // Cmd+F is find. v0.8.0 took it for fullscreen and swallowed the event.
      await o.page.evaluate(() => {
        (window as unknown as { swallowed: boolean }).swallowed = false;
        addEventListener("keydown", (e) => {
          if (e.key === "f" && e.metaKey)
            (window as unknown as { swallowed: boolean }).swallowed = e.defaultPrevented;
        });
      });
      await o.page.keyboard.down("Meta");
      await o.page.keyboard.press("f");
      await o.page.keyboard.up("Meta");
      expect(
        await o.page.evaluate(() => (window as unknown as { swallowed: boolean }).swallowed),
      ).toBe(false);
      expect(await o.page.evaluate(() => document.fullscreenElement === null)).toBe(true);
      expect(o.loud).toEqual([]);
    } finally {
      await o.close();
    }
  }, 120_000);

  it("plays the narration at the chosen speed — the sentence already playing, and every one after", async () => {
    const o = await open(`v2/${DECK_PAGE}`);
    try {
      await at(o, 0);
      const audio = () =>
        o.page.evaluate(() => {
          const a = document.querySelector("audio") as HTMLAudioElement;
          return {
            src: a.src,
            t: a.currentTime,
            rate: a.playbackRate,
            def: a.defaultPlaybackRate,
            paused: a.paused,
          };
        });
      await o.page.keyboard.press("Enter");
      await o.page.waitForFunction("document.querySelector('audio')?.currentTime > 0.2", {
        timeout: 30_000,
      });
      const before = await audio();
      expect(before.rate).toBe(1);

      // Mid-sentence: no reload, same source, new rate — and the clock agrees.
      await o.page.keyboard.press(">");
      await o.page.keyboard.press(">");
      const a0 = await audio();
      expect(a0.src).toBe(before.src);
      expect(a0.rate).toBe(1.5);
      expect(a0.def).toBe(1.5);
      const wall0 = Date.now();
      await new Promise((r) => setTimeout(r, 1500));
      const a1 = await audio();
      const ratio = (a1.t - a0.t) / ((Date.now() - wall0) / 1000);
      expect(ratio).toBeGreaterThan(1.3);
      expect(ratio).toBeLessThan(1.7);

      // The next stop reloads the element, which resets playbackRate to its default.
      await o.page.keyboard.press("ArrowRight");
      await at(o, 1);
      await o.page.waitForFunction(
        (src: string) => document.querySelector("audio")?.src !== src,
        {},
        before.src,
      );
      const next = await audio();
      expect(next.rate).toBe(1.5);
      expect(await o.page.$eval(".ds-speed", (b) => b.textContent)).toBe("1.5×");
      expect(o.loud).toEqual([]);
    } finally {
      await o.close();
    }
  }, 120_000);

  it("remembers the viewer's choices, lets the URL override them, and tells the host page", async () => {
    // A host page framing the deck, recording what the deck tells it.
    await writeFile(
      join(dir, "host.html"),
      `<!doctype html><body><iframe id="f" src="v2/${DECK_PAGE}?speed=1.25" style="width:800px;height:450px;border:0"></iframe>` +
        `<script>window.got=[];addEventListener("message",e=>{if(e.data&&e.data.type==="decksmith:prefs")got.push(e.data)})</script>`,
    );
    const page = await browser.newPage();
    // Every frame, the deck's included: this test is about what gets saved.
    await page.evaluateOnNewDocument(() => localStorage.clear());
    try {
      await page.setViewport({ width: 900, height: 500 });
      await page.goto(`${base}/host.html`, { waitUntil: "load" });
      const frame = await (await page.$("#f"))?.contentFrame();
      if (!frame) throw new Error("no frame");
      await frame.waitForFunction("document.querySelector('.ds-count')?.textContent", {
        timeout: 60_000,
      });
      // The URL's speed, applied and NOT saved: it is for this visit.
      expect(await frame.$eval(".ds-speed", (b) => b.textContent)).toBe("1.25×");
      expect(await frame.evaluate(() => localStorage.getItem("decksmith.prefs.v1"))).toBeNull();

      // A viewer's change: saved, and posted up so the host can keep it per user.
      await frame.click(".ds-size");
      await frame.click('.ds-sz[data-value="l"]');
      // postMessage is delivered as a task, not during the click.
      await page.waitForFunction("window.got.length > 0", { timeout: 5_000 });
      const got = (await page.evaluate(
        () => (window as unknown as { got: unknown[] }).got,
      )) as unknown[];
      expect(got).toEqual([{ type: "decksmith:prefs", speed: 1.25, cc: true, ccsize: "l" }]);
      expect(
        JSON.parse(
          (await frame.evaluate(() => localStorage.getItem("decksmith.prefs.v1"))) ?? "{}",
        ),
      ).toEqual({
        speed: 1.25,
        cc: true,
        ccsize: "l",
      });

      // The host restoring a user's saved choice: applied, saved, never echoed.
      await page.evaluate(() =>
        (document.getElementById("f") as HTMLIFrameElement).contentWindow?.postMessage(
          { type: "decksmith:prefs", speed: 2, cc: false },
          "*",
        ),
      );
      await frame.waitForFunction("document.querySelector('.ds-speed').textContent === '2×'");
      expect(await frame.$eval(".ds-cc", (b) => b.getAttribute("aria-pressed"))).toBe("false");
      expect(
        await frame.evaluate(
          () => (document.querySelector("audio") as HTMLAudioElement).defaultPlaybackRate,
        ),
      ).toBe(2);
      expect(await page.evaluate(() => (window as unknown as { got: unknown[] }).got.length)).toBe(
        1,
      );
    } finally {
      await page.close();
    }

    // A later visit, same origin, no URL: what was saved.
    const o = await open(`v2/${DECK_PAGE}`, 1280, 720, true);
    try {
      expect(await o.page.$eval(".ds-speed", (b) => b.textContent)).toBe("2×");
      expect(await o.page.$eval(".ds-cc", (b) => b.getAttribute("aria-pressed"))).toBe("false");
      await o.page.evaluate(() => localStorage.clear());
    } finally {
      await o.close();
    }
  }, 120_000);

  it("runs a repacked classic deck on that deck's own vendored player, offline and quietly", async () => {
    const o = await open("classic/deck2.html");
    try {
      await at(o, 0);
      expect(await o.page.$(".ds-controls")).not.toBeNull();
      await o.page.keyboard.press("Space");
      await at(o, 1);
      // The composition was reached and painted, not merely the counter moved.
      expect(
        await o.page.evaluate(() => {
          const f = document
            .querySelector("hyperframes-player")
            ?.shadowRoot?.querySelector("iframe");
          return f?.contentDocument?.documentElement.classList.contains("ds-live") ?? false;
        }),
      ).toBe(true);
      expect(o.loud).toEqual([]);
      expect(o.offsite).toEqual([]);
    } finally {
      await o.close();
    }
  }, 120_000);

  it("leaves a classic deck on the v0.8.0 player", async () => {
    const o = await open(`classic/${DECK_PAGE}`);
    try {
      expect(await o.page.$(".ds-controls")).toBeNull();
      expect(
        await o.page.evaluate(() => document.documentElement.classList.contains("ds-v2")),
      ).toBe(false);
    } finally {
      await o.close();
    }
  }, 120_000);
});
