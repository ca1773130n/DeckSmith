import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStops,
  findStop,
  formatHash,
  parseHash,
  planTransition,
  type SlideSpec,
} from "../src/deck/runtime.js";
import { PLAYER_FILE } from "../src/emit/composition.js";

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
    for (const file of ["runtime.ts", "subtitles.ts"]) {
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
