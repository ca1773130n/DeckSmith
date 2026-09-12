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

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
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
    const stream = createReadStream(file);
    stream.once("error", () => {
      missing.push(path);
      res.writeHead(404).end();
    });
    stream.once("open", () => {
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      stream.pipe(res);
    });
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
    page.on("requestfailed", (r) => loud.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
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
    return { page, loud, offsite, close: () => page.close() };
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
