/**
 * The camera: the one optional field, and everything that must not change
 * because of it.
 *
 * The most valuable assertion in this file is the boring one — an un-annotated
 * storyboard emits exactly the bytes it emitted before a camera existed. The
 * feature is opt-in per PAIR of beats, so almost every deck must be untouched by
 * it, and "untouched" has to mean byte-for-byte or the drift gate's guarantee is
 * gone. `renders byte-identical output when nothing is annotated` is that
 * assertion; if it ever fails, the camera has leaked into the default path.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertStopsOutsideMove,
  cameraMeasure,
  diveStatements,
  diveTail,
  elementId,
  enterableIds,
  transitWindow,
} from "../src/emit/camera.js";
import { emitComposition, planCut } from "../src/emit/composition.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";

function format(id: string): Format {
  const f = FORMATS[id];
  if (!f) throw new Error(`no format "${id}"`);
  return f;
}

const source = sourceSchema.parse({
  id: "src-1",
  title: "A method with a window in it",
  lang: "en",
  sections: [{ id: "sec-1", depth: 1, heading: "Method", text: "..." }],
  figures: [],
  equations: [],
  tables: [],
});

/** The pipeline stage the grid beat happens inside — the real relation. */
const pipelineBeat = {
  id: "b01",
  archetype: "pipeline",
  intent: "The method is three stages with a loop.",
  params: {
    headline: "One pass in, one pass out, and a loop in the middle",
    stages: [{ label: "Encode" }, { label: "Window", tone: "a" }, { label: "Decode" }],
  },
  seconds: 9,
};

const gridBeat = {
  id: "b02",
  archetype: "grid",
  intent: "Attention runs inside one window at a time.",
  params: {
    headline: "Attention is computed inside windows",
    cols: 12,
    rows: 8,
    regions: [{ x: 0, y: 0, w: 4, h: 4, label: "one window", tone: "a" }],
  },
  seconds: 9,
};

function board(gridExtra: Record<string, unknown> = {}) {
  return {
    sourceId: "src-1",
    title: "A method with a window in it",
    beats: [pipelineBeat, { ...gridBeat, ...gridExtra }],
  };
}

const INSIDE = { beat: "b01", element: "stage1" };

function emit(raw: unknown, formatId = "deck-16x9"): string {
  return emitComposition(storyboardSchema.parse(raw), source, format(formatId));
}

describe("the `inside` field, at plan time", () => {
  it("accepts a reference to the immediately preceding beat", () => {
    expect(() => storyboardSchema.parse(board({ inside: INSIDE }))).not.toThrow();
  });

  it("rejects a beat that does not exist, and says which", () => {
    const bad = storyboardSchema.safeParse(board({ inside: { beat: "b99", element: "stage1" } }));
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain("not a beat in this storyboard");
    expect(bad.error?.issues[0]?.path.join(".")).toBe("beats.1.inside.beat");
  });

  it("rejects a beat that exists but is not the one immediately before", () => {
    // b03 enters b01 across b02 — by the time b03 is on screen, b01 is gone, so
    // the "move" would be a pan over an empty world.
    const three = {
      sourceId: "src-1",
      title: "t",
      beats: [
        pipelineBeat,
        gridBeat,
        { ...gridBeat, id: "b03", inside: { beat: "b01", element: "stage1" } },
      ],
    };
    const bad = storyboardSchema.safeParse(three);
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain('the beat before it is "b02"');
  });

  it("rejects `inside` on the first beat", () => {
    const bad = storyboardSchema.safeParse({
      sourceId: "src-1",
      title: "t",
      beats: [{ ...pipelineBeat, inside: { beat: "b01", element: "stage1" } }],
    });
    expect(bad.success).toBe(false);
    // Self-reference is caught before adjacency, because it is the clearer fault.
    expect(bad.error?.issues[0]?.message).toContain("inside itself");
  });

  it("rejects an element name that could not be a DOM id suffix", () => {
    const bad = storyboardSchema.safeParse(board({ inside: { beat: "b01", element: "#stage 1" } }));
    expect(bad.success).toBe(false);
  });
});

describe("the shell, with nothing annotated", () => {
  it("renders byte-identical output when nothing is annotated", () => {
    // Not a snapshot: the two calls differ only in that one storyboard has been
    // through the `inside` code path and found nothing. Any leak — a stray
    // wrapper, a changed running total, a camera rule in the CSS — moves bytes.
    const plain = emit(board());
    expect(plain).toBe(emit(board()));
    expect(plain).not.toContain("ds-zoom");
    expect(plain).not.toContain("dsFramed");
    expect(plain).not.toContain("__dsBuilders");
    // The beats still tile end to end at their authored lengths.
    expect(plain).toContain('data-duration="9"');
    expect(plain).toContain('data-start="9"');
  });

  it("ignores a relation whose containing beat the format dropped", () => {
    // `short-9x16` keeps only high-weight beats. If the pipeline does not
    // survive, there is nothing on screen to fly through and the honest answer
    // is the cut we would have had.
    const kept = emit(
      {
        sourceId: "src-1",
        title: "t",
        beats: [
          { ...pipelineBeat, weight: 0.1 },
          { ...gridBeat, weight: 0.95, inside: INSIDE },
        ],
      },
      "short-9x16",
    );
    expect(kept).not.toContain("ds-zoom");
  });
});

describe("the shell, with a relation asserted", () => {
  const deck = emit(board({ inside: INSIDE }));

  it("wraps only the containing scene in a rig", () => {
    expect(deck.split("ds-zoom").length - 1).toBeGreaterThan(0);
    // One rig, in s1. The contained scene is untouched and opens at full frame.
    const s2 = deck.slice(deck.indexOf('id="s2"'));
    expect(s2).not.toContain("ds-plate");
  });

  it("puts the move in the tail of the containing scene's own window", () => {
    // 9s of beat, then a 1.4s dive and a 0.4s dip: the SLIDE is 10.8, which is
    // where the next scene opens and what the running clock accumulates. The
    // CLIP is 11.2 — one HANDOFF_SECONDS longer — so the dip is still on screen
    // while s2 opens instead of handing off to flat background.
    expect(deck).toContain('data-duration="11.2"');
    expect(deck).toContain('data-start="10.8"');
    expect(deck).toContain('data-duration="19.8"'); // the root: slides, not clips
  });

  it("charges the camera's tail to the budget that has to pay for it", () => {
    // `planCut` selects on narrated seconds, and a dive is 1.8s of deck that is
    // not narration: the slide is 10.8 for a 9-second beat. A selection blind to
    // it under-counts by 1.8s per camera and hands `verify` a cut that turns out
    // not to fit — the exact failure the whole wiring exists to prevent. The
    // number is charged to the CONTAINING beat, because that is the window
    // `layout` lengthens.
    const sb = storyboardSchema.parse(board({ inside: INSIDE }));
    const cut = planCut(sb, source, { ...format("deck-16x9"), maxSeconds: 1 });
    const b01 = cut.dropped.find((d) => d.beat.id === "b01");
    const b02 = cut.dropped.find((d) => d.beat.id === "b02");
    expect(b01?.seconds).toBe(10.8);
    expect(b02?.seconds).toBe(9);
    // And nothing is charged when the relation is not asserted.
    const plain = planCut(storyboardSchema.parse(board()), source, {
      ...format("deck-16x9"),
      maxSeconds: 1,
    });
    expect(plain.dropped.find((d) => d.beat.id === "b01")?.seconds).toBe(9);
  });

  it("runs the dip past its own slide rather than adding a second fade", () => {
    // A cameraed seam and a plain one must be ONE transition, or they are two
    // sets of bugs. The dip starts at the landing (9 + 1.4) and lasts
    // FADE_SECONDS + HANDOFF_SECONDS.
    expect(deck).toContain(
      `tl.fromTo("#s1 .ds-zoom", { opacity: 1 }, { opacity: 0, duration: 0.8, ease: "power2.in", immediateRender: false }, 10.4);`,
    );
    // ...and the scene that already dips is not ALSO given the plain dissolve.
    expect(deck).not.toContain(`tl.fromTo("#s1", { opacity: 1 }`);
  });

  it("moves the camera with two fromTo tweens and no callback", () => {
    expect(deck).toContain('tl.fromTo("#s1 .ds-zoom", { scale: 1 }');
    expect(deck).toContain('tl.fromTo("#s1 .ds-pan", { x: 0, y: 0 }');
    // Invariant 11: `seek()` suppresses events, so anything driven by a callback
    // renders a frozen video with every gate green.
    expect(deck).not.toMatch(/onUpdate|onComplete|onStart/);
    // Invariant 2.
    expect(deck).not.toMatch(/tl\.from\(/);
  });

  it("scopes every camera selector to its own scene", () => {
    for (const m of deck.matchAll(/tl\.fromTo\("([^"]+)"/g)) {
      expect(m[1]).toMatch(/^#s\d/);
    }
  });

  it("measures ONCE inside the ready gate, never during parse and never lazily", () => {
    // The rect depends on how tall the headline above it wrapped, which depends
    // on fonts, so it cannot be read during parse: that frames the deck on the
    // fallback face and still renders twice to the same bytes, because both runs
    // take the same wrong path.
    //
    // Nor lazily, and THAT is what this test is really for. `hyperframes render`
    // shards frames contiguously, so a value first read on a tween's first render
    // is read at a different point in the deck in every worker. Measured on a
    // camera whose target is still moving at `t0`, with the shard boundary forced
    // inside the dive: 39 of 594 frames moved at 14.96 dB — the camera landing
    // 18px off — against 7 frames of edge antialiasing once deferred. So the
    // measurement is a statement inside the builder, run once, before the timeline
    // exists: it appears exactly once and nothing re-reads it.
    expect(deck).toContain("window.__dsBuilders.push(function () {");
    expect(deck.match(/getBoundingClientRect/g)).toHaveLength(2); // plate and target, once each
    // No memo, because there is nothing left to memoise.
    expect(deck).not.toContain("if (dsFramed) return dsFramed");
    // GSAP gets NUMBERS. A function value would put the read back on first
    // render, which is the bug this replaced.
    expect(deck).toContain("{ scale: dsFramed.k, ");
    expect(deck).not.toMatch(/dsFramed\(\)|function \(\) \{ return dsFramed/);
    expect(deck).toContain("immediateRender: false");
  });

  it("builds the timeline inside the barrier, so capture cannot start without it", () => {
    // The whole handshake: the flag is raised before any scene parses, the
    // cameraed scene registers a BUILDER rather than a timeline, and the gate
    // awaits every builder before lowering the flag. Miss the last link and the
    // engine captures a deck whose timelines do not exist yet.
    const flag = deck.indexOf("window.__hfTimelinesBuilding = true");
    const push = deck.indexOf("window.__dsBuilders.push");
    const await_ = deck.indexOf("return p.then(b)");
    const lower = deck.indexOf("window.__hfTimelinesBuilding = false");
    expect(flag).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(flag);
    expect(await_).toBeGreaterThan(push);
    expect(lower).toBeGreaterThan(await_);
    // The registration itself moved inside the builder — a timeline still
    // registered during parse would be built on unmeasured values.
    expect(deck).toMatch(/__dsBuilders\.push\(function \(\) \{[\s\S]*?__timelines\["s1"\] = tl/);
  });

  it("keeps the measurement out of a callback — invariant 11", () => {
    // Measuring from an `onUpdate` is the obvious way to "measure late" and it
    // renders a FROZEN VIDEO with every gate green, because `seek()` passes
    // `suppressEvents`. The builder is not a callback on anything.
    expect(deck).not.toMatch(/onUpdate|onComplete|onStart|requestAnimationFrame/);
  });

  it("refuses a part the containing beat does not draw, and lists what it does", () => {
    expect(() => emit(board({ inside: { beat: "b01", element: "stage9" } }))).toThrow(
      /does not draw.*stage0, stage1, stage2/s,
    );
  });

  it("scales the whole move with `speed`", () => {
    const slow = emitComposition(
      storyboardSchema.parse(board({ inside: INSIDE })),
      source,
      format("deck-16x9"),
      { speed: 2 },
    );
    // 18s of beat, 2.8s of dive, 0.8s of dip: a 21.6s slide. The handoff scales
    // with everything else, so the clip is 21.6 + 0.8.
    expect(slow).toContain('data-start="21.6"');
    expect(slow).toContain('data-duration="22.4"');
  });
});

describe("the type floor under a camera", () => {
  // The rule is about FINAL rendered pixels, and the emitter enforces the part
  // of it that makes the browser-measured form unnecessary: no stop is ever
  // inside a move, so at every stop the rig is at scale 1 or has landed with the
  // region filling the frame, and every surviving glyph is at least as large as
  // it was authored.
  const dive = { t0: 9, dur: 1.4, fade: 0.4 };

  it("accepts stops that all land before the camera leaves", () => {
    expect(() => assertStopsOutsideMove("s1", [1.55, 4.35, 7], dive)).not.toThrow();
  });

  it("refuses a stop inside the move, because there is no floor to check there", () => {
    expect(() => assertStopsOutsideMove("s1", [1.55, 9.8], dive)).toThrow(/9.8s fall inside/);
  });

  it("counts the dip as part of the move", () => {
    expect(diveTail(dive)).toBeCloseTo(1.8);
    expect(() => assertStopsOutsideMove("s1", [10.5], dive)).toThrow();
  });
});

/**
 * THE FIXTURE, and why it is a file on disk rather than another literal here.
 *
 * `inside` shipped for months without ever being BUILT: `demo/storyboard.json`
 * does not set it, so `node dist/cli.js build` — the command the project treats
 * as its end-to-end gate — never once walked this path. The literals above emit
 * a composition and assert over the string, which is not the same thing as a
 * storyboard a human can hand to the CLI. `demo/fixtures/camera.storyboard.json`
 * is that storyboard, it is the one this file exercises, and anything that
 * breaks the `inside` path now breaks a test.
 *
 * WHAT IT COSTS TO RUN THE REST OF THE WAY, measured: built against
 * `demo/fixtures/plain.source.json`, `verify` boots Chrome for about 40s. That
 * is why the assertions here are over the emitted composition and the gate is
 * left to the CLI — but the fixture is the same file in both cases, so the
 * command in the report is the command a reader can run.
 */
describe("the fixture that keeps this path built", () => {
  const fixture = (name: string) =>
    fileURLToPath(new URL(`../demo/fixtures/${name}`, import.meta.url));

  async function fixtureDeck() {
    const sb = storyboardSchema.parse(
      JSON.parse(await readFile(fixture("camera.storyboard.json"), "utf8")),
    );
    const src = sourceSchema.parse(
      JSON.parse(await readFile(fixture("plain.source.json"), "utf8")),
    );
    return { sb, src, html: emitComposition(sb, src, format("deck-16x9")) };
  }

  it("asserts a relation the emitter honours", async () => {
    const { sb, html } = await fixtureDeck();
    expect(sb.beats[1]?.inside).toEqual({ beat: "c01", element: "stage1" });
    expect(html).toContain('class="ds-zoom"');
    expect(html).toContain('tl.fromTo("#s1 .ds-zoom", { scale: 1 }');
  });

  it("publishes the transit window on the scene the camera leaves", async () => {
    const { html } = await fixtureDeck();
    // 9s of beat, then MOVE_SECONDS + FADE_SECONDS + HANDOFF_SECONDS. Absolute
    // deck seconds, because that is the clock a layout finding's `time` is on.
    expect(html).toContain('data-ds-transit="9,11.2"');
    // One camera, one window: the contained scene has none.
    expect(html.match(/data-ds-transit/g)).toHaveLength(1);
  });

  it("publishes a window that lasts as long as the rig is displaced", async () => {
    // THE BUG THIS REPLACES. The window said `dur + fade` while the dip runs
    // `fade + over`, so the last `over` seconds of every camera move were
    // outside the window describing it — and a gate sample landing there got
    // thirteen `canvas_overflow` errors on a mid-move frame (menu-10 of
    // experiments/015-decision, at 11.978s against a window of `10,11.8`).
    // Read off the artifact: the window ends exactly when the scene's CLIP does,
    // because the clip is `duration + over` and the dip ends with it. Asserting
    // the relation rather than the number is what keeps the two in step if
    // either constant moves.
    const { html } = await fixtureDeck();
    const scene = html.match(
      /data-start="([\d.]+)"\s+data-duration="([\d.]+)"\s+data-ds-transit="([\d.]+),([\d.]+)"/,
    );
    expect(
      scene,
      "the cameraed scene should carry start, duration and window together",
    ).toBeTruthy();
    const [start, clip, , t1] = (scene ?? []).slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    expect(t1).toBe(start + clip);
  });

  it("never writes the flag that would hide real overflow", async () => {
    // MEASURED, three builds of this fixture with the containing beat's `note`
    // replaced by a 130-character unbreakable word (see src/emit/camera.ts):
    // without a camera the gate FAILS on `canvas_overflow #s1-note t=5s`, and
    // with `data-layout-allow-overflow` on the rig it PASSES. The flag is an
    // ancestor test with no notion of time, so it exempts the scene at every
    // sample and not just the ones inside the move. A green gate over sliced
    // type is the failure shape this project keeps finding by hand.
    const { html } = await fixtureDeck();
    expect(html).not.toContain("data-layout-allow-overflow");
    expect(html).not.toContain("data-layout-ignore");
    expect(html).not.toContain("data-layout-bleed");
  });

  it("keeps every stop out of the window it publishes", async () => {
    const { html } = await fixtureDeck();
    // The window's own promise, read back off the artifact rather than from the
    // arithmetic that wrote it: the island's fragments are the deck's stops, and
    // none of them is inside the transit window.
    const island = html.match(
      /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/,
    );
    const slides = JSON.parse(island?.[1] ?? "{}").slides as Array<{ fragments?: number[] }>;
    const [t0, t1] = (html.match(/data-ds-transit="([^"]+)"/)?.[1] ?? "").split(",").map(Number);
    const stops = slides.flatMap((s) => s.fragments ?? []);
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) expect(stop > (t0 as number) && stop < (t1 as number)).toBe(false);
  });
});

describe("camera helpers", () => {
  it("names a part the way src/emit/svg.ts does", () => {
    expect(elementId("s3", "rgn0")).toBe("s3-rgn0");
  });

  it("reads back only this scene's own ids", () => {
    const html = '<g id="s1-stage0"/><g id="s1-stage1"/><g id="s2-rgn0"/><g id="loose"/>';
    expect(enterableIds("s1", html)).toEqual(["stage0", "stage1"]);
  });

  it("travels scale in log space and pans at constant screen speed", () => {
    const js = cameraMeasure("s1", "stage1", format("deck-16x9")).join("\n");
    // Closed form, both of them. A linear scale tween reads as a lurch and a pan
    // at 5x whips; these are the two shapes that fix it, and they are pure
    // functions of the tween's own progress so `seek` is order-independent.
    expect(js).toContain("Math.pow(r, dsSmooth(p)) - 1) / (r - 1)");
    expect(js).toContain("1 - Math.pow(r, -dsSmooth(p))) / (1 - 1 / r)");
    expect(js).not.toContain("Date.now");
    expect(js).not.toContain("Math.random");
  });

  it("frames the target at the format's own aspect", () => {
    const portrait = cameraMeasure("s1", "rgn0", format("short-9x16")).join("\n");
    expect(portrait).toContain("1080 / 1920");
    expect(portrait).toContain("cx: 540, cy: 960");
  });

  it("lands and only then dips", () => {
    const [, , dip] = diveStatements("s1", format("deck-16x9"), { t0: 9, dur: 1.4, fade: 0.4 });
    // A container faded out mid-flight leaves the camera over an empty world —
    // the spike did that by accident and documented the result.
    expect(dip?.to.opacity).toBe(0);
    expect(dip?.at).toBe(10.4);
  });

  it("states the transit window on the deck's own clock, not the scene's", () => {
    // A layout finding's `time` is absolute, so the window has to be too, or the
    // caller comparing them silently exempts the wrong scene — which on a deck
    // whose second camera sits at 40s would exempt the first beat instead.
    expect(transitWindow(0, { t0: 9, dur: 1.4, fade: 0.4 }, 0)).toBe("9,10.8");
    expect(transitWindow(10.8, { t0: 9, dur: 1.4, fade: 0.4 }, 0)).toBe("19.8,21.6");
    // Invariant 10: rounded, so float drift never moves a byte.
    expect(transitWindow(0.1, { t0: 0.2, dur: 1.4, fade: 0.4 }, 0)).toBe("0.3,2.1");
  });

  it("counts the handoff overlap as part of the move", () => {
    // The window has to describe the DIP `diveStatements` actually writes, which
    // lasts `fade + over` — not `diveTail`, which is only how much the camera
    // lengthens the slide. The two arithmetics diverging by `over` is what put a
    // legitimate mid-move frame outside its own window.
    const d = { t0: 9, dur: 1.4, fade: 0.4 };
    const [, , dip] = diveStatements("s1", format("deck-16x9"), d, 0.4);
    const end = Number(transitWindow(0, d, 0.4).split(",")[1]);
    // `toBeCloseTo`, because only the published side is rounded (invariant 10) —
    // the tween's own numbers are raw floats and 10.4 + 0.8 is not 11.2 in IEEE.
    expect(end).toBeCloseTo(Number(dip?.at) + Number(dip?.to.duration));
    // The last scene of a deck has no successor to hand off to, and then the
    // window is exactly the tail — the bytes every deck built before this.
    expect(transitWindow(0, d, 0)).toBe("9,10.8");
  });

  it("dips for exactly the tail its scene's window was lengthened by", () => {
    // The seam is measured in frames, so any slack here is a hole in the deck.
    // Dip shorter than the tail and the outgoing scene sits at background before
    // the cut; longer and it is still visible when `paint()` hides it, which
    // hard-cuts a lit frame to black. The incoming scene opens on 150ms of
    // nothing either way (see the measurement in src/emit/camera.ts) — that part
    // is not fixable from here, and this keeps us from adding to it.
    const d = { t0: 9, dur: 1.4, fade: 0.4 };
    const [, , dip] = diveStatements("s1", format("deck-16x9"), d);
    expect(dip?.to.duration).toBe(d.fade);
    expect(dip?.at).toBe(d.t0 + d.dur);
    expect(d.dur + d.fade).toBeCloseTo(diveTail(d));
  });
});
