import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAYER_MARKER } from "../src/deck/playback.js";
import {
  buildStops,
  dwellMs,
  findStop,
  formatHash,
  frameOf,
  mountVoice,
  paint,
  parseClips,
  parseHash,
  planTransition,
  refused,
  SILENT_HOLD,
  type SlideSpec,
  type Stop,
  showingAt,
} from "../src/deck/runtime.js";
import type { Narration } from "../src/deck/subtitles.js";
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
      "playback.ts",
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
    // hardcodes a jsDelivr url for `@hyperframes/core`, and it is a FALLBACK: the
    // bundle polls the composition every 200ms and injects that `<script>` only
    // once it has seen timelines but resolved no playback adapter for five ticks
    // (`shouldInjectRuntime` in hyperframes-player.global.js). A deck of ours
    // registers a GSAP timeline per scene plus `main`, which resolves on the tick
    // the timelines appear, so the fetch does not happen — measured across ~20
    // page loads in test/deck-page.test.ts, which asserts a presented deck makes
    // no request off its own origin at all. An earlier version of this note said
    // the injection happens whenever a presented deck opens; that is stronger
    // than the bundle does.
    //
    // The pin still has to agree, because the fallback is one slow composition
    // away: it would fetch at the VIEWER's machine, over the network, long after
    // every gate here has passed. `check`, `verify`, `drift` and `render` all
    // work on `index.html`, and test/deck-page.test.ts — the only thing that
    // opens `deck.html` — is offline by assertion, so a pin that left decks
    // fetching a different core than the one this repo tested against would be
    // invisible until a presenter's laptop found out.
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

  it("plays at the viewer's speed, so the reveal keeps pace with the narration", () => {
    expect(planTransition(16.03, 16.73, { rate: 2 }).durationMs).toBeCloseTo(350);
    expect(planTransition(16.03, 16.73, { rate: 0.75 }).durationMs).toBeCloseTo(933.333, 2);
    expect(planTransition(16.03, 16.73, { rate: 1 }).durationMs).toBeCloseTo(700);
  });

  it("decides what to cut in composition seconds, whatever the speed", () => {
    // 3s is a slide's hold at any speed; halving its watch time does not make it a reveal.
    expect(planTransition(17.93, 20.93, { rate: 2 })).toEqual(cut);
  });

  it("treats a rate it cannot use as 1x rather than dividing by it", () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planTransition(16.03, 16.73, { rate }).durationMs).toBeCloseTo(700);
    }
  });
});

describe("showingAt", () => {
  // The seam that blinked, as `build` wrote it: s2's slide is [3, 7) and its
  // clip 4.4 long; s3 opens at 7 on nothing but background for 0.15s.
  const out: SlideSpec = { sceneId: "s2", startTime: 3, endTime: 7 };
  const inc: SlideSpec = { sceneId: "s3", startTime: 7, endTime: 17.8 };

  it("keeps the outgoing scene up through its handoff, over the incoming one's empty opening", () => {
    // Taking the island's `endTime` hid s2 at 7.0 and a glide showed eleven
    // ticks of flat background. The engine keeps it until 3 + 4.4.
    for (const t of [7, 7.05, 7.167, 7.399]) {
      expect(showingAt(out, 4.4, t), `s2 at ${t}`).toBe(true);
      expect(showingAt(inc, 11.2, t), `s3 at ${t}`).toBe(true);
    }
  });

  it("uses the engine's half-open window: gone at its clip's end, absent before its start", () => {
    expect(showingAt(out, 4.4, 7.4)).toBe(false);
    expect(showingAt(inc, 11.2, 6.999)).toBe(false);
    expect(showingAt(inc, 11.2, 18.199)).toBe(true);
    expect(showingAt(inc, 11.2, 18.2)).toBe(false);
  });

  it("falls back to the island's window when the clip cannot be read", () => {
    // A scene div with no `data-duration` (NaN, as `paint` reads it), an empty
    // one (0), or nonsense: none of them may shorten or unbound the slide.
    for (const clip of [Number.NaN, 0, -1]) {
      expect(showingAt(out, clip, 6.999)).toBe(true);
      expect(showingAt(out, clip, 7)).toBe(false);
    }
  });
});

describe("paint puts the scene up for as long as its clip runs", () => {
  /**
   * `showingAt` alone does not pin the fix: `paint` could stop reading the
   * clip, or stop calling it, and every other deck test would still pass. Put
   * main's slide-window rule back in `paint` and the Chrome suite in
   * test/deck-page.test.ts passes too, because it only checks resting stops and
   * no stop falls inside a handoff. So this drives `paint` itself, through a
   * frame shaped like the one `frameOf` returns: scene divs answering
   * `getAttribute("data-duration")` with what `build` writes, and timelines that
   * record their seeks.
   */
  const slides: SlideSpec[] = [
    { sceneId: "s1", startTime: 0, endTime: 3 },
    { sceneId: "s2", startTime: 3, endTime: 7 },
    { sceneId: "s3", startTime: 7, endTime: 17.8 },
  ];
  /** Clip lengths by scene id; a missing entry is a div with no `data-duration`. */
  const fakeFrame = (clips: Record<string, string>) => {
    const scenes: Record<
      string,
      { style: { display: string }; getAttribute: (n: string) => string | null }
    > = {};
    const seeks: Record<string, number[]> = {};
    for (const { sceneId } of slides) {
      // Starts hidden, so a scene reading "" was put up by this paint.
      scenes[sceneId] = {
        style: { display: "none" },
        getAttribute: (n) => (n === "data-duration" ? (clips[sceneId] ?? null) : null),
      };
      seeks[sceneId] = [];
    }
    const timelines = Object.fromEntries(
      slides.map(({ sceneId }) => [sceneId, { seek: (t: number) => seeks[sceneId]?.push(t) }]),
    );
    const frame = {
      doc: { getElementById: (id: string) => scenes[id] ?? null },
      timelines,
    } as unknown as Parameters<typeof paint>[0];
    const shown = () =>
      slides.map((s) => s.sceneId).filter((id) => scenes[id]?.style.display === "");
    return { frame, seeks, shown };
  };
  // What `build` writes for this deck: every clip but the last outlasts its
  // slide by one 0.4s handoff.
  const built = { s1: "3.4", s2: "4.4", s3: "10.8" };

  it("keeps the outgoing scene displayed and seeked on every 60Hz tick of the handoff", () => {
    // The glide that blinked stepped 7.000s through 7.167s with s2 hidden.
    for (let k = 0; k < 24; k++) {
      const t = 7 + k / 60;
      const { frame, seeks, shown } = fakeFrame(built);
      paint(frame, slides, t);
      expect(shown(), `displayed at ${t.toFixed(3)}`).toEqual(["s2", "s3"]);
      expect(seeks.s2?.[0], `s2 seek at ${t.toFixed(3)}`).toBeCloseTo(t - 3, 9);
      expect(seeks.s3?.[0], `s3 seek at ${t.toFixed(3)}`).toBeCloseTo(t - 7, 9);
      expect(seeks.s1).toEqual([]);
    }
  });

  it("takes the outgoing scene down at its clip's end, not before", () => {
    const at = (t: number) => {
      const f = fakeFrame(built);
      paint(f.frame, slides, t);
      return f;
    };
    expect(at(6.999).shown()).toEqual(["s2"]);
    expect(at(7.399).shown()).toEqual(["s2", "s3"]);
    const gone = at(7.4);
    expect(gone.shown()).toEqual(["s3"]);
    expect(gone.seeks.s2).toEqual([]);
  });

  it("reads the clip off the scene div, and falls back to the slide without one", () => {
    // No `data-duration` on s2: the island's window is all there is to go on.
    const { frame, shown } = fakeFrame({ s1: "3.4", s3: "10.8" });
    paint(frame, slides, 7.2);
    expect(shown()).toEqual(["s3"]);
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

describe("a play() rejection says which of two failures it was", () => {
  /**
   * The deck used to treat EVERY rejection as the autoplay policy. A deck whose
   * audio directory did not get copied therefore told the viewer "press any key
   * for sound" forever, and every keypress ran `unlock` -> `speak` against the
   * same missing file and failed identically. The message was not just unhelpful,
   * it blamed the wrong thing — and every gate was green, because nothing in this
   * suite opened deck.html or played a sound. test/deck-page.test.ts opens it now
   * and asserts the flag strip names one of the two honest states; it still plays
   * no sound, so the split below remains the only thing that decides WHICH.
   */
  it("reads the autoplay policy as blocked", () => {
    expect(refused(new DOMException("play() failed", "NotAllowedError"))).toBe(true);
  });

  it("does not read a file it can never play as blocked", () => {
    // What a missing segment did when someone ran one, rather than what the spec
    // says: an unfetchable source rejects with this name and leaves
    // `audio.error.code` at 4. One run, on one machine, in a headless browser
    // whose engine and version were not recorded, and it never produced the
    // other failure to compare against — see `refused` for why a record that
    // thin is still safe to build on, and for what it does not license claiming.
    expect(refused(new DOMException("no supported source", "NotSupportedError"))).toBe(false);
  });

  it("fails SAFE on a name no engine here has produced", () => {
    // Rejection names vary by engine. An unknown one degrades to what shipped
    // before this split, which still recovers on the first gesture; guessing the
    // other way would leave a recoverable deck permanently silent.
    for (const err of [
      new DOMException("who knows", "AbortError"),
      { name: 42 },
      {},
      null,
      undefined,
      "not an error at all",
    ]) {
      expect(refused(err)).toBe(true);
    }
  });
});

/* ------------------------------------------------- a segment that will not play */

/**
 * The smallest `<audio>` `mountVoice` actually uses, with `play()` deliberately
 * left open: every failure this describes is decided AFTER the call returns, and
 * that gap is the bug. Hand-rolled rather than pulled from a DOM library because
 * this suite runs on bare node and adding one for six tests is the larger change.
 */
class FakeAudio {
  preload = "";
  muted = false;
  /**
   * The HTML load algorithm resets `playbackRate` to `defaultPlaybackRate`, and
   * `silence()` calls `load()` on every stop. Modelled, because it is exactly
   * the trap that sends a chosen speed back to 1x on the next slide.
   */
  defaultPlaybackRate = 1;
  playbackRate = 1;
  #src = "";
  get src() {
    return this.#src;
  }
  set src(v: string) {
    this.#src = v;
    this.load();
  }
  currentTime = 0;
  ended = false;
  paused = true;
  /** One entry per `play()`, settled by the test whenever it likes. */
  readonly plays: { ok: () => void; fail: (err: unknown) => void }[] = [];
  play(): Promise<void> {
    this.paused = false;
    return new Promise<void>((resolve, reject) => {
      this.plays.push({ ok: () => resolve(), fail: reject });
    });
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.playbackRate = this.defaultPlaybackRate;
  }
  removeAttribute() {
    this.#src = "";
  }
  getAttribute(name: string): string | null {
    return name === "src" && this.#src !== "" ? this.#src : null;
  }
  addEventListener() {}
}

const NARRATED: Narration = {
  voice: "test",
  dir: "audio",
  scenes: { s1: [{ stop: 0, audio: "s1-0.mp3", cues: [] }] },
};

const STOP: Stop = { t: 0, slide: 0, fragment: 0, notes: "", sceneId: "s1" };

function mountFakeVoice() {
  const audio = new FakeAudio();
  const flags = { textContent: "" };
  const subs = { textContent: "", hidden: false };
  const doc = {
    createElement: () => audio,
    body: { append: () => {} },
    documentElement: { classList: { toggle: () => {} } },
  } as unknown as Document;
  const ui = { subs: subs as unknown as HTMLElement, flags: flags as unknown as HTMLElement };
  return { audio, flags, voice: mountVoice(doc, NARRATED, ui) };
}

/** `play()`'s handlers are microtasks; a macrotask is after all of them. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("a stop whose sound never arrives", () => {
  beforeAll(() => {
    // `mountVoice` follows the audio clock on rAF, which bare node does not have.
    // The loop is not what these tests are about: give it an id, never call back.
    globalThis.requestAnimationFrame = (() => 1) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  });
  afterAll(() => {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  });

  it("says so, and never claims a key will fix it", async () => {
    const { audio, flags, voice } = mountFakeVoice();
    expect(voice.at(STOP)).toBe(true);
    audio.plays[0]?.fail(new DOMException("no supported source", "NotSupportedError"));
    await settle();
    expect(flags.textContent).toBe("narration unavailable");
  });

  it("is retried by a gesture, so a connection that dropped for a moment recovers", async () => {
    // The case this is for is not the missing file — it is the missing file's
    // twin. A two-second wifi drop and a one-off 503 reject `play()` with the
    // same `NotSupportedError`, and the deck had no way back from either:
    // `unlock` looked only at `blocked`, so one bad moment left the narration
    // silent for the rest of the session.
    const { audio, flags, voice } = mountFakeVoice();
    voice.at(STOP);
    audio.plays[0]?.fail(new DOMException("no supported source", "NotSupportedError"));
    await settle();
    // Nothing retries unasked — an absent file must not be re-requested forever.
    expect(audio.plays).toHaveLength(1);
    voice.unlock();
    expect(audio.plays).toHaveLength(2);
    audio.plays[1]?.ok();
    await settle();
    expect(flags.textContent).toBe("");
  });

  it("stays honest when the retry fails the same way", async () => {
    const { audio, flags, voice } = mountFakeVoice();
    voice.at(STOP);
    audio.plays[0]?.fail(new DOMException("no supported source", "NotSupportedError"));
    await settle();
    voice.unlock();
    expect(audio.plays).toHaveLength(2);
    audio.plays[1]?.fail(new DOMException("still not there", "NotSupportedError"));
    await settle();
    expect(flags.textContent).toBe("narration unavailable");
  });

  it("leaves a segment that IS playing alone, so ordinary keys stay ordinary", async () => {
    // `unlock` runs on every keydown and every click. Widening it past `blocked`
    // is only safe while a stop that is speaking is untouched — otherwise
    // pressing `n` for the notes would start the sentence over.
    const { audio, voice } = mountFakeVoice();
    voice.at(STOP);
    audio.plays[0]?.ok();
    await settle();
    voice.unlock();
    voice.unlock();
    expect(audio.plays).toHaveLength(1);
  });

  it("tells autoplay, which is otherwise waiting for an `ended` that cannot come", async () => {
    // `at` answers synchronously about whether a segment EXISTS, and `play()`
    // rejects a beat later. So `go` armed no dwell timer for this stop, and a
    // source that failed to load fires no `ended`: autoplay stopped dead on that
    // slide, forever, with the play button still lit.
    const { audio, voice } = mountFakeVoice();
    let unheard = 0;
    voice.onSettled((heard) => {
      if (!heard) unheard += 1;
    });
    expect(voice.at(STOP)).toBe(true);
    expect(unheard).toBe(0);
    audio.plays[0]?.fail(new DOMException("no supported source", "NotSupportedError"));
    await settle();
    expect(unheard).toBe(1);
  });

  it("hands the clock back when the retry works, so it cannot cut its own sentence", async () => {
    // The hazard of the two fixes together. The dwell timer armed while this
    // stop was silent is still pending when a gesture gets the segment playing,
    // and left alone it would advance the deck a second and a half into a
    // sentence that had only just started.
    const { audio, voice } = mountFakeVoice();
    const said: boolean[] = [];
    voice.onSettled((heard) => said.push(heard));
    voice.at(STOP);
    audio.plays[0]?.fail(new DOMException("no supported source", "NotSupportedError"));
    await settle();
    voice.unlock();
    audio.plays[1]?.ok();
    await settle();
    expect(said).toEqual([false, true]);
  });

  it("tells it for a refusal too, because a refused deck is exactly as silent", async () => {
    const { audio, voice } = mountFakeVoice();
    let unheard = 0;
    voice.onSettled((heard) => {
      if (!heard) unheard += 1;
    });
    voice.at(STOP);
    audio.plays[0]?.fail(new DOMException("play() failed", "NotAllowedError"));
    await settle();
    expect(unheard).toBe(1);
  });
});

/* ------------------------------------------- and what autoplay does about it */

/**
 * The other half of the same fix. Above, `mountVoice` learns that the segment
 * never played and says so; here is what hearing that is supposed to change.
 * Split out as a pure decision for the reason `refused` was: the code that acts
 * on it lives in `start`, which needs a browser.
 */
describe("autoplay's dwell clock", () => {
  it("waits out the gap the author left when the stop has nothing to say", () => {
    expect(dwellMs({ playing: true, heard: false, gapMs: 3000 })).toBe(3000);
  });

  it("sets no timer for a stop that is speaking, because `ended` is its clock", () => {
    expect(dwellMs({ playing: true, heard: true, gapMs: 3000 })).toBeNull();
  });

  it("sets none at all unless the deck is playing itself", () => {
    // Autoplay is a mode. Someone standing in front of the deck talking over it
    // must never have a slide move under them.
    expect(dwellMs({ playing: false, heard: false, gapMs: 3000 })).toBeNull();
    expect(dwellMs({ playing: false, heard: true, gapMs: 3000 })).toBeNull();
  });

  it("holds a floor, so back-to-back fragments do not flick past unread", () => {
    expect(dwellMs({ playing: true, heard: false, gapMs: 0 })).toBe(1500);
    expect(dwellMs({ playing: true, heard: false, gapMs: 200 })).toBe(1500);
  });

  it("caps a long hold, which is the author pausing rather than a wait to sit out", () => {
    expect(dwellMs({ playing: true, heard: false, gapMs: 30_000 })).toBe(8000);
  });

  it("divides every wait by the viewer's speed, after clamping it", () => {
    expect(dwellMs({ playing: true, heard: false, gapMs: 4000, rate: 2 })).toBe(2000);
    // The floor is a reading time at 1x; a viewer at 2x reads at 2x too.
    expect(dwellMs({ playing: true, heard: false, gapMs: 2000, rate: 2 })).toBe(1000);
    expect(dwellMs({ playing: true, heard: false, gapMs: 4000, rate: 0.75 })).toBeCloseTo(
      5333.33,
      1,
    );
    expect(dwellMs({ playing: true, heard: true, gapMs: 4000, rate: 2 })).toBeNull();
  });

  it("lets the chosen speed shorten even the longest hold", () => {
    // Review 2026-10-08: the cap was applied after the division, so a 15s gap
    // held 8s at 1x AND at 2x — the speed never reached the deck's longest waits.
    expect(dwellMs({ playing: true, heard: false, gapMs: 15_000, rate: 1 })).toBe(8000);
    expect(dwellMs({ playing: true, heard: false, gapMs: 15_000, rate: 2 })).toBe(4000);
  });

  it("v2: holds a stop with no narration only for its reveal and a beat, not the author's gap", () => {
    // 5-9 such stops a deck, each up to 8s of silence: 15-22% of a deck at 1x.
    expect(
      dwellMs({ playing: true, heard: false, gapMs: 15_000, silent: true, revealMs: 1200 }),
    ).toBe(1200 + SILENT_HOLD);
    expect(
      dwellMs({ playing: true, heard: false, gapMs: 15_000, silent: true, revealMs: 600, rate: 2 }),
    ).toBe(600 + SILENT_HOLD / 2);
    // Never longer than the old wait would have been.
    expect(
      dwellMs({ playing: true, heard: false, gapMs: 1000, silent: true, revealMs: 2000 }),
    ).toBe(1500);
    // A stop whose segment exists but failed is not silent by design: it keeps the gap.
    expect(dwellMs({ playing: true, heard: false, gapMs: 15_000, silent: false })).toBe(8000);
  });

  it("turns on the clock for a stop that claimed a segment and then could not play it", () => {
    // The dead-lock. `voice.at` answers synchronously about whether a segment
    // EXISTS, so arrival passes `heard: true` and no timer is set; `play()`
    // rejects a beat later; a source that never loaded fires no `ended`. Asking
    // again with the settled answer is the only thing that gets a self-playing
    // deck off that slide, and the flip has to work in both directions — a
    // segment retried by a gesture is speaking now, and the timer armed while it
    // was silent would cut the sentence it has just started.
    expect(dwellMs({ playing: true, heard: true, gapMs: 4000 })).toBeNull();
    expect(dwellMs({ playing: true, heard: false, gapMs: 4000 })).toBe(4000);
    expect(dwellMs({ playing: true, heard: true, gapMs: 4000 })).toBeNull();
  });

  it("is reached from both callers, and from nowhere else", async () => {
    // Read off the source, in the pattern the video-frame test below uses and
    // for the same reason: this wiring is inside `start`, which builds chrome,
    // reads islands and talks to `<hyperframes-player>` — a browser, in the one
    // file no gate in this project opens. The decision above is pure and proves
    // the policy; nothing but this proves the policy is ever consulted.
    //
    // Which is not hypothetical. A review of the previous commit no-op'd BOTH of
    // these call sites and all thirty-five tests passed, because every one of
    // them stopped at the signal and none reached its consumer. Text matching is
    // brittle against a rename, and that is the price of the only check there is.
    const text = await readFile(new URL("../src/deck/runtime.ts", import.meta.url), "utf8");
    // Arrival, with what `voice.at` said; then again, with what `play()` did.
    expect(text).toMatch(/settleDwell\(speaking\)/);
    expect(text).toMatch(/voice\.onSettled\(settleDwell\)/);
    // And both of those land on the decision, not on a timer of their own.
    expect(text).toMatch(/const settleDwell = \(heard: boolean\)/);
    expect(text).toMatch(/dwellMs\(\{[^}]*\bheard\b[^}]*\}\)/);
    expect(text).toMatch(/setTimeout\(advance, ms\)/);
    expect(text.match(/setTimeout\(advance/g)).toHaveLength(1);
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

  it("offers the same player on a stage, which draws the clip's poster full-bleed", () => {
    // `stage` draws a clip through the same `plate()`, so an href clip there is
    // a poster too, and the viewer is owed the same click-to-play.
    const staged = storyboardSchema.parse({
      sourceId: "src-v",
      title: "The method, running",
      beats: [
        { id: "b0", intent: "Open.", archetype: "title", params: { headline: "A title beat" } },
        {
          id: "b1",
          intent: "Show the method running.",
          archetype: "stage",
          params: { headline: "The method runs", figureId: "f-tube", placement: "bottom-left" },
        },
      ],
    });
    const built = emitDeck(staged, source, FORMATS["deck-16x9"] as Format, "/*runtime*/");
    const island = JSON.parse(
      /decksmith-video\+json">\s*([\s\S]*?)\s*<\/script>/.exec(built.page ?? "")?.[1] ?? "{}",
    ) as { scenes?: Record<string, { url: string }> };
    expect(island.scenes?.s2?.url).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(built.composition).not.toContain("youtube");
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

/* ------------------------------------------------------------ narration speed */

describe("the narration speed", () => {
  beforeAll(() => {
    globalThis.requestAnimationFrame = (() => 1) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  });
  afterAll(() => {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  });

  const TWO: Narration = {
    voice: "test",
    dir: "audio",
    scenes: {
      s1: [{ stop: 0, audio: "s1-0.mp3", cues: [] }],
      s2: [{ stop: 0, audio: "s2-0.mp3", cues: [] }],
    },
  };
  const second: Stop = { t: 6, slide: 1, fragment: 0, notes: "", sceneId: "s2" };

  function mount(v2 = true) {
    const audio = new FakeAudio();
    const doc = {
      createElement: () => audio,
      body: { append: () => {} },
      documentElement: { classList: { toggle: () => {} } },
    } as unknown as Document;
    const ui = {
      subs: { textContent: "", hidden: false } as unknown as HTMLElement,
      flags: { textContent: "" } as unknown as HTMLElement,
    };
    return { audio, voice: mountVoice(doc, TWO, ui, { v2 }) };
  }

  it("leaves a classic deck's element exactly as v0.8.0 did: no rate, no pitch flag", () => {
    // The classic player has no speed. Review 2026-10-08 asked that its voice
    // be v0.8.0's call for call, so no rate is written to it at all.
    const { audio, voice } = mount(false);
    voice.at(STOP);
    voice.setRate(2);
    voice.at(second);
    expect(audio.playbackRate).toBe(1);
    expect(audio.defaultPlaybackRate).toBe(1);
    expect((audio as unknown as { preservesPitch?: boolean }).preservesPitch).toBeUndefined();
  });

  it("pauses a sentence where it is and resumes it from there (v2's Enter)", () => {
    const { audio, voice } = mount();
    voice.at(STOP);
    expect(audio.plays).toHaveLength(1);
    audio.currentTime = 2.4;
    voice.pause();
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(2.4);
    expect(voice.resume()).toBe(true);
    // The same element, the same source, from the same second: not a restart.
    expect(audio.plays).toHaveLength(2);
    expect(audio.src).toContain("s1-0.mp3");
    expect(audio.currentTime).toBe(2.4);
    expect(audio.paused).toBe(false);
  });

  it("has nothing to resume after a step dropped the sentence, or after it ended", () => {
    const { audio, voice } = mount();
    voice.at(STOP);
    voice.pause();
    voice.hush();
    expect(voice.resume()).toBe(false);
    voice.at(STOP);
    audio.ended = true;
    voice.pause();
    expect(voice.resume()).toBe(false);
    // And nothing to resume that was never paused.
    audio.ended = false;
    voice.at(second);
    expect(voice.resume()).toBe(false);
  });

  it("changes the sentence that is playing, not only the next one", () => {
    const { audio, voice } = mount();
    voice.at(STOP);
    expect(audio.src).toContain("s1-0.mp3");
    voice.setRate(1.5);
    // Same element, same source, mid-segment: the change is live.
    expect(audio.src).toContain("s1-0.mp3");
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.defaultPlaybackRate).toBe(1.5);
  });

  it("survives the reload every stop does, which resets playbackRate to its default", () => {
    const { audio, voice } = mount();
    voice.setRate(2);
    voice.at(STOP);
    voice.at(second);
    expect(audio.src).toContain("s2-0.mp3");
    expect(audio.playbackRate).toBe(2);
  });

  it("keeps the voice's pitch", () => {
    const { audio, voice } = mount();
    voice.setRate(1.75);
    expect((audio as unknown as { preservesPitch?: boolean }).preservesPitch).toBe(true);
  });

  it("falls back to 1x for a rate it cannot use", () => {
    const { audio, voice } = mount();
    voice.setRate(0);
    expect(audio.playbackRate).toBe(1);
  });
});

/* ----------------------------------------------------------------- v2 marker */

describe("--design v2 on the deck page", () => {
  const source = sourceSchema.parse({
    id: "src-d",
    title: "T",
    lang: "en",
    sections: [],
    figures: [],
    equations: [],
    tables: [],
  });
  const board = storyboardSchema.parse({
    sourceId: "src-d",
    title: "T",
    beats: [{ id: "b0", intent: "Open.", archetype: "title", params: { headline: "A title" } }],
  });
  const format = FORMATS["deck-16x9"] as Format;

  it("marks a v2 page for the v2 player, once, in its head — and a classic page never", () => {
    const classic = emitDeck(board, source, format, "/*runtime*/");
    const v2 = emitDeck(board, source, format, "/*runtime*/", { design: "v2" });
    expect(classic.page).not.toContain(PLAYER_MARKER);
    const page = v2.page ?? "";
    expect(page.split(PLAYER_MARKER).length - 1).toBe(1);
    expect(page.indexOf(PLAYER_MARKER)).toBeLessThan(page.indexOf("</head>"));
  });

  // v2 is the whole redesign now (fit, packs, looks, motion), so its
  // composition differs by design. What must hold is the other direction: an
  // explicit `classic` is the unstated deck, byte for byte, page and all.
  it("builds an explicit classic exactly as an unstated design", () => {
    const unstated = emitDeck(board, source, format, "/*runtime*/");
    const classic = emitDeck(board, source, format, "/*runtime*/", { design: "classic" });
    expect(classic.composition).toBe(unstated.composition);
    expect(classic.page).toBe(unstated.page);
  });

  it("is what an explicit classic produces when nothing is said", () => {
    const unsaid = emitDeck(board, source, format, "/*runtime*/");
    const said = emitDeck(board, source, format, "/*runtime*/", { design: "classic" });
    expect(said.page).toBe(unsaid.page);
  });

  it("reads the storyboard's own design when the caller says nothing", () => {
    const planned = storyboardSchema.parse({ ...board, design: "v2" });
    expect(emitDeck(planned, source, format, "/*runtime*/").page).toContain(PLAYER_MARKER);
  });
});
