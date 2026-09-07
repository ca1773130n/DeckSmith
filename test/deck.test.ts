import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStops,
  findStop,
  formatHash,
  frameOf,
  parseClips,
  parseHash,
  planTransition,
  type SlideSpec,
} from "../src/deck/runtime.js";
import { emitDeck, PLAYER_FILE } from "../src/emit/composition.js";
import { EMBED_ORIGINS } from "../src/pack/media.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";

/** Two placed slides, exactly as `emitIsland` writes them. */
const s1: SlideSpec = { sceneId: "s1", startTime: 0, endTime: 6 };
const s2: SlideSpec = { sceneId: "s2", startTime: 6, endTime: 16 };

describe("the bundle deck.html inlines", () => {
  it("never names the attribute that would make deck.html a second root composition", async () => {
    // This module is inlined verbatim into deck.html, so reaching into the
    // composition via `[data-composition-id]` — the obvious way to find a scene,
    // or to hang `.ds-live` off the root — would put that literal in a
    // root-level HTML file and trip lint's multiple_root_compositions
    // (invariant 9). Scenes are addressed by the ids the island already carries.
    for (const file of [
      "runtime.ts",
      "subtitles.ts",
      "protocol.ts",
      "player.ts",
      "player-element.ts",
    ]) {
      const src = await readFile(new URL(`../src/deck/${file}`, import.meta.url), "utf8");
      expect(src).not.toContain("data-composition-id");
    }
  });

  it("ships a player whose CDN url names the hyperframes we pinned", async () => {
    // THE ONE THING A PIN BUMP CHANGES THAT NO OTHER GATE SEES. The player bundle
    // hardcodes a jsDelivr url for `@hyperframes/core` and injects it as a
    // `<script>` when a PRESENTED deck opens — at the viewer's machine, over the
    // network, long after every gate here has passed. `check`, `verify`, `drift`
    // and `render` all work on `index.html`; NOTHING opens `deck.html`, so a pin
    // that leaves decks fetching a different core than the one this repo tested
    // against is invisible until a presenter's laptop finds out.
    //
    // Moving 0.7.71 -> 0.7.90 changed exactly two bytes of that bundle, and they
    // were the version in this url. This asserts the two agree; it deliberately
    // does NOT fetch, so the suite stays offline and deterministic.
    const dir = dirname(createRequire(import.meta.url).resolve("hyperframes/package.json"));
    const bundle = await readFile(join(dir, "dist", PLAYER_FILE), "utf8");
    const url = bundle.match(/@hyperframes\/core@([0-9]+\.[0-9]+\.[0-9]+)/);
    expect(url, "the player bundle no longer carries a @hyperframes/core url").not.toBeNull();
    const installed = JSON.parse(await readFile(join(dir, "package.json"), "utf8")).version;
    expect(url?.[1]).toBe(installed);
  });
});

describe("buildStops", () => {
  it("lands a slide on its first settled fragment, not its raw start", () => {
    // The regression that shipped a blank deck: seeking to `startTime` shows the
    // frame before the entrance runs, with every element still at its `from`.
    const stops = buildStops([{ ...s2, fragments: [9, 7.5] }]);
    expect(stops.map((s) => [s.slide, s.fragment, s.t])).toEqual([
      [0, 0, 7.5],
      [0, 1, 9],
    ]);
  });

  it("falls back to the start only for a slide with no reveals", () => {
    expect(buildStops([{ ...s1, notes: "hi" }]).map((s) => [s.t, s.notes])).toEqual([[0, "hi"]]);
  });

  it("numbers slides in order and keeps their fragments together", () => {
    const stops = buildStops([s1, { ...s2, fragments: [9, 7.5] }]);
    expect(stops.map((s) => [s.slide, s.fragment, s.t])).toEqual([
      [0, 0, 0],
      [1, 0, 7.5],
      [1, 1, 9],
    ]);
  });

  it("drops fragments outside the slide's window, and the duplicate at its start", () => {
    // 6 duplicates the start; 3 belongs to s1; 99 to nothing at all.
    const stops = buildStops([{ ...s2, fragments: [3, 6, 12, 99] }]);
    expect(stops.map((s) => s.t)).toEqual([12]);
  });

  it("carries the scene id onto every stop, so narration can be looked up", () => {
    // `slide` is a position over the slides we could place and shifts when one
    // of them cannot be; the scene id is the stable join with the narration
    // island, which is keyed the same way the slideshow island is.
    const stops = buildStops([{ sceneId: "ghost" }, s1, { ...s2, fragments: [7.5, 9] }]);
    expect(stops.map((s) => [s.sceneId, s.slide, s.fragment])).toEqual([
      ["s1", 0, 0],
      ["s2", 1, 0],
      ["s2", 1, 1],
    ]);
  });

  it("skips unplaceable slides without shifting the numbering of the rest", () => {
    // No startTime means no seek target; seeking 0 would silently mean "slide 1".
    const stops = buildStops([{ sceneId: "ghost" }, s1, s2]);
    expect(stops.map((s) => [s.slide, s.t])).toEqual([
      [0, 0],
      [1, 6],
    ]);
  });
});

describe("planTransition", () => {
  const cut = { animate: false, durationMs: 0 };

  it("plays a short forward step at 1x", () => {
    // The real numbers from EXPERIMENT-004's within-slide steps.
    expect(planTransition(16.03, 16.73).animate).toBe(true);
    expect(planTransition(16.03, 16.73).durationMs).toBeCloseTo(700);
    expect(planTransition(16.73, 17.93).durationMs).toBeCloseTo(1200);
  });

  it("cuts backwards — reversed entrance tweens read as elements un-drawing", () => {
    expect(planTransition(16.73, 16.03)).toEqual(cut);
  });

  it("cuts a span too long to be a reveal", () => {
    // A slide boundary: mostly the outgoing slide's hold, so nothing to watch.
    expect(planTransition(17.93, 23)).toEqual(cut);
  });

  it("cuts under prefers-reduced-motion, however short the step", () => {
    expect(planTransition(16.03, 16.73, { reducedMotion: true })).toEqual(cut);
  });

  it("makes a zero-length span a no-op", () => {
    expect(planTransition(7.5, 7.5)).toEqual(cut);
  });
});

describe("hash", () => {
  it("round-trips every stop", () => {
    const stops = buildStops([s1, { ...s2, fragments: [7.5, 9] }]);
    for (const stop of stops) {
      expect(parseHash(formatHash(stop))).toEqual({ slide: stop.slide, fragment: stop.fragment });
    }
    expect(stops.map(formatHash)).toEqual(["#1", "#2", "#2.1"]);
  });

  it("rejects what is not a step", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#notes")).toBeNull();
    expect(parseHash("#0")).toBeNull();
    expect(parseHash("#1.2.3")).toBeNull();
  });

  it("falls back to the slide when a deep-linked fragment is gone", () => {
    const stops = buildStops([s1, { ...s2, fragments: [7.5] }]);
    expect(findStop(stops, { slide: 1, fragment: 0 })).toBe(1);
    expect(findStop(stops, { slide: 1, fragment: 7 })).toBe(1);
    expect(findStop(stops, { slide: 9, fragment: 0 })).toBe(-1);
  });
});

describe("frameOf reads the composition through the window", () => {
  /**
   * The frame used to SNAPSHOT `win.__timelines`, and the snapshot is taken once.
   * A composition whose scene scripts had not run by then handed back a frozen
   * empty map: `paint` goes on toggling `display` correctly while every
   * `seek()` no-ops, so the deck navigates perfectly and shows every scene at
   * its `from` state — with nothing in any log. Today's ordering saves it; that
   * is a race that has not fired, not one that cannot.
   */
  const fakePlayer = (win: Record<string, unknown>) => {
    const iframe = { contentDocument: { documentElement: {} }, contentWindow: win };
    return {
      querySelector: () => iframe,
      shadowRoot: null,
    } as unknown as Parameters<typeof frameOf>[0];
  };

  it("sees a timeline registered AFTER the frame was taken", () => {
    const win: Record<string, unknown> = {};
    const frame = frameOf(fakePlayer(win));
    expect(frame).not.toBeNull();
    expect(frame?.timelines).toEqual({});
    // The composition registers late — which is exactly the ordering the deck
    // relies on today and the one nothing enforces.
    const seekable = { seek: () => {} };
    win.__timelines = { s1: seekable };
    expect(frame?.timelines.s1).toBe(seekable);
  });

  it("still returns an empty map when the page never registers one", () => {
    expect(frameOf(fakePlayer({}))?.timelines).toEqual({});
  });

  it("is null when the frame cannot be reached at all", () => {
    const blind = { querySelector: () => null, shadowRoot: null } as unknown as Parameters<
      typeof frameOf
    >[0];
    expect(frameOf(blind)).toBeNull();
  });
});

/* ---------------------------------------------------------- player-page video */

/**
 * A clip whose bytes we could not fetch is a poster everywhere the deck is
 * RENDERED and the real player everywhere it is PRESENTED. These assert the
 * seam, from both sides.
 */
describe("the player-page video", () => {
  const source = sourceSchema.parse({
    id: "src-v",
    title: "The method, running",
    lang: "en",
    sections: [],
    figures: [
      // A clip we hold no file for: `href` is the page it lives on, `poster` is
      // the only thing any format can draw.
      {
        id: "f-tube",
        kind: "clip",
        src: "clip_000.jpg",
        poster: "clip_000.jpg",
        href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        caption: "Video 1 — the method, running",
        width: 1280,
        height: 720,
      },
      // Same shape, on a host `embedUrl` refuses to guess at: Twitch needs a
      // `parent=` naming the page that frames it, which a built deck cannot know.
      {
        id: "f-twitch",
        kind: "clip",
        src: "clip_001.jpg",
        poster: "clip_001.jpg",
        href: "https://www.twitch.tv/videos/123456789",
        caption: "Video 2 — the baseline",
        width: 1280,
        height: 720,
      },
    ],
    equations: [],
    tables: [],
  });

  const board = (figureId: string) =>
    storyboardSchema.parse({
      sourceId: "src-v",
      title: "The method, running",
      beats: [
        { id: "b0", intent: "Open.", archetype: "title", params: { headline: "A title beat" } },
        {
          id: "b1",
          intent: "Show the method running.",
          archetype: "claim-figure",
          params: { headline: "The method runs", claim: "It runs in one pass.", figureId },
        },
      ],
    });

  const deck = (figureId: string) => {
    const format = FORMATS["deck-16x9"] as Format;
    return emitDeck(board(figureId), source, format, "/*runtime*/");
  };

  it("carries the embeddable URL into deck.html, keyed by the scene that draws the still", () => {
    const page = deck("f-tube").page ?? "";
    expect(page).toContain('<script type="application/decksmith-video+json">');
    const island = JSON.parse(
      /decksmith-video\+json">\s*([\s\S]*?)\s*<\/script>/.exec(page)?.[1] ?? "{}",
    ) as { scenes: Record<string, { url: string; title: string }> };
    // `s2`, not `b1`: scene ids are the only key the runtime ever sees, which is
    // the same translation the narration island performs.
    expect(Object.keys(island.scenes)).toEqual(["s2"]);
    expect(island.scenes.s2?.url).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(island.scenes.s2?.title).toBe("Video 1 — the method, running");
    // The watch URL never travels: an iframe pointed at it is refused by
    // YouTube's own X-Frame-Options and paints nothing.
    expect(page).not.toContain("youtube.com/watch");
  });

  it("says nothing at all about a host it cannot convert", () => {
    // The clip keeps its poster and the deck keeps quiet, which is the honest
    // degradation — better than a frame that 404s into a black rectangle.
    const built = deck("f-twitch");
    expect(built.page ?? "").not.toContain("decksmith-video+json");
    expect(built.page ?? "").not.toContain("twitch.tv");
  });

  /**
   * INVARIANT 4, IN SUBSTANCE, AND THE ASSERTION THAT MATTERS MOST HERE.
   *
   * `index.html` is what `render` captures. A third-party frame in it breaks the
   * render twice over with every gate green: capture propagates virtual time
   * only into same-origin frames, so the embed would play at wall-clock speed
   * under a deck being seeked frame by frame, and the compile-time localiser has
   * no pattern for an iframe's src, so every render would refetch it from the
   * network. `drift` is the only gate that could see it, on a render nobody
   * watched.
   *
   * Deliberately broader than `<iframe`: the URL must not be in the rendered
   * document AT ALL — not in an island, not in a comment, not in a data
   * attribute — because a self-contained document that names a third party is
   * one edit away from fetching it.
   */
  it("never puts a frame, or a third-party URL, in the document the renderer captures", () => {
    const { composition } = deck("f-tube");
    expect(composition).not.toMatch(/<iframe\b/i);
    expect(composition).not.toContain("decksmith-video+json");
    expect(composition).not.toContain("youtube");
    for (const origin of EMBED_ORIGINS) expect(composition).not.toContain(origin);
    // And the still is still drawn, so the rendered deck lost nothing.
    expect(composition).toContain('<img src="assets/clip_000.jpg"');
  });

  it("creates the frame on demand, and never asks for autoplay", async () => {
    // Read off the source, because the frame only exists after a click, in a
    // browser, in the one file no gate in this project opens. Three claims. The
    // tag is never markup: this module is inlined verbatim into deck.html, so a
    // literal here is a literal in a shipped HTML file — the same reasoning as
    // the composition-id scan at the top of this suite. The src is the island's
    // URL untouched, so nobody can quietly append a host's autoplay parameter.
    // And the feature list withholds autoplay, which is what makes "click to
    // play" structural rather than a promise.
    const text = await readFile(new URL("../src/deck/runtime.ts", import.meta.url), "utf8");
    expect(text).toContain('doc.createElement("iframe")');
    expect(text).not.toMatch(/<iframe\b/i);
    expect(text).toContain("frame.src = here.url;");
    const allow = /frame\.allow = "([^"]*)"/.exec(text)?.[1];
    expect(allow, "the frame no longer declares an allow list").toBeDefined();
    expect(allow).not.toContain("autoplay");
  });

  /** The island is read in a browser, from a file anyone may have edited by hand. */
  describe("parseClips", () => {
    it("keeps an https embed and drops everything else", () => {
      const clips = parseClips(
        JSON.stringify({
          scenes: {
            s1: { url: "https://www.youtube-nocookie.com/embed/abc", title: "One" },
            // A `javascript:` URL in a frame's src is script the deck runs.
            s2: { url: "javascript:alert(1)", title: "Two" },
            s3: { url: "http://insecure.example.com/embed/1", title: "Three" },
            s4: { title: "No url at all" },
          },
        }),
      );
      expect(Object.keys(clips)).toEqual(["s1"]);
      expect(clips.s1).toEqual({ url: "https://www.youtube-nocookie.com/embed/abc", title: "One" });
    });

    it("is empty for a deck with no island, and for one whose island is broken", () => {
      expect(parseClips(undefined)).toEqual({});
      expect(parseClips("")).toEqual({});
      expect(parseClips("{ not json")).toEqual({});
      expect(parseClips(JSON.stringify({ scenes: null }))).toEqual({});
    });
  });
});
