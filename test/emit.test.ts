/**
 * The renderer invariants, asserted on real output.
 *
 * Every one of these was a silent failure first: a deck that lints clean, serves,
 * renders, and does not navigate. They are checked on the emitted string because
 * that is the only place they are observable without a browser.
 */
import { describe, expect, it } from "vitest";
import { emitComposition, planCut } from "../src/emit/composition.js";
import { DIM, spotlighter, type Tween, tweenText, words } from "../src/emit/kit.js";
import { travel } from "../src/emit/svg.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";

/** `FORMATS` is keyed by string, so every lookup is `Format | undefined`. */
function format(id: string): Format {
  const f = FORMATS[id];
  if (!f) throw new Error(`no format "${id}"`);
  return f;
}

const source = sourceSchema.parse({
  id: "src-1",
  title: "Attention Is All You Need",
  lang: "en",
  sections: [{ id: "sec-1", depth: 1, heading: "Scaled dot-product attention", text: "..." }],
  figures: [],
  equations: [
    {
      id: "eq-attn",
      tex: String.raw`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V`,
      display: true,
    },
  ],
  tables: [],
});

const storyboard = storyboardSchema.parse({
  sourceId: "src-1",
  title: "Attention Is All You Need",
  beats: [
    {
      id: "b1",
      intent: "Name the paper and the one idea it contributes.",
      archetype: "title",
      seconds: 6,
      params: { eyebrow: "Paper analysis", headline: "Attention is all you need", sub: "2017" },
    },
    {
      id: "b2",
      intent: "Read the attention equation term by term.",
      narration: "Walk Q against K first, then the scaling, then the value mix.",
      archetype: "equation-walk",
      seconds: 11,
      params: {
        headline: "Similarity, scaled, then mixed",
        equationId: "eq-attn",
        terms: [
          { tex: "QK^{\\top}", label: "query–key similarity", tone: "a" },
          { tex: "\\sqrt{d_k}", label: "scale, to keep softmax out of saturation", tone: "b" },
        ],
      },
    },
  ],
});

const html = emitComposition(storyboard, source, format("deck-16x9"));

/** `<div id="sN" … data-start="X" data-duration="Y">` — the scene wrappers only. */
function sceneWindows(doc: string): { sid: string; start: number; end: number }[] {
  const re = /<div\s+id="(s\d+)"[^>]*?data-start="([\d.]+)"[^>]*?data-duration="([\d.]+)"/g;
  return [...doc.matchAll(re)].map(([, sid = "", start = "", duration = ""]) => ({
    sid,
    start: Number(start),
    end: Number(start) + Number(duration),
  }));
}

function island(doc: string): { slides: { sceneId: string; fragments?: number[] }[] } {
  const m = doc.match(
    /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error("no slideshow island");
  return JSON.parse(m[1] ?? "");
}

describe("emitComposition", () => {
  it("gives scenes exactly the attributes the reference deck has", () => {
    // data-track-index and per-scene data-width/height are what the generic docs
    // ask for, and they make the deck silently non-navigable (EXPERIMENT-003).
    expect(html).not.toContain("data-track-index");
    // s1's CLIP runs to 6.4 while its SLIDE ends at 6, which is where s2 starts:
    // the outgoing scene is still painted, and dissolving, over the incoming
    // scene's first HANDOFF_SECONDS. Without that the deck cuts to flat
    // background at every seam, because every archetype opens through
    // `chromeIn` and has no ink at all before 0.15s.
    expect(sceneWindows(html)).toEqual([
      { sid: "s1", start: 0, end: 6.4 },
      { sid: "s2", start: 6, end: 17 },
    ]);
    expect(html).toMatch(/id="root"[\s\S]*?data-duration="17"[\s\S]*?data-width="1920"/);
    // The only data-width/height in the document belongs to the root.
    expect(html.match(/data-width=/g)).toHaveLength(1);
  });

  it("registers one paused timeline per scene, plus main", () => {
    const ids = [...html.matchAll(/window\.__timelines\["([^"]+)"\] = tl;/g)].map((m) => m[1]);
    expect(ids).toEqual(["s1", "s2", "main"]);
    expect(html.match(/gsap\.timeline\(\{ paused: true \}\)/g)).toHaveLength(3);
  });

  it("registers them DURING PARSE when no scene measures anything", () => {
    // Seam B is opt-in per scene, and this is the assertion that keeps it so.
    // A deck whose scenes measure nothing must emit the bytes it always did:
    // no builder array, no extra link in the ready gate's chain, the timeline
    // still registered as the document parses. If this fails, deferral has
    // leaked into the default path and every shipped deck's bytes have moved —
    // which voids the drift gate, the strongest regression test we have.
    expect(html).not.toContain("__dsBuilders");
    expect(html).toMatch(
      /\),\n {8}\)\.then\(function \(\) \{\n {10}window\.__hfTimelinesBuilding = false;/,
    );
  });

  it("never uses from()", () => {
    // from() records its end state at construction, so it is wrong under the
    // arbitrary seeking deck navigation performs.
    expect(html).not.toContain(".from(");
  });

  it("places every fragment inside its own slide's window", () => {
    const windows = new Map(sceneWindows(html).map((w) => [w.sid, w]));
    for (const slide of island(html).slides) {
      const w = windows.get(slide.sceneId);
      if (!w) throw new Error(`island names ${slide.sceneId}, which is not a scene`);
      for (const f of slide.fragments ?? []) {
        expect(f).toBeGreaterThanOrEqual(w.start);
        expect(f).toBeLessThan(w.end);
      }
    }
  });

  it("drops the island when the format is not navigable", () => {
    const video = emitComposition(storyboard, source, format("video-16x9"));
    expect(video).not.toContain("hyperframes-slideshow+json");
  });

  it("cuts beats below the format's minWeight", () => {
    const short = storyboardSchema.parse({
      ...storyboard,
      beats: storyboard.beats.map((b, i) => ({ ...b, weight: i === 0 ? 0.9 : 0.2 })),
    });
    const html916 = emitComposition(short, source, format("short-9x16"));
    expect(sceneWindows(html916)).toEqual([{ sid: "s1", start: 0, end: 6 }]);
  });

  it("reports the beats it kept, which is what the composition draws", () => {
    // `build` logs this count. It read `storyboard.beats.length` until
    // `--min-weight` made the two differ, and then announced twelve beats over an
    // eight-beat deck — a silent cut hiding in the one line that should reveal it.
    const short = storyboardSchema.parse({
      ...storyboard,
      beats: storyboard.beats.map((b, i) => ({ ...b, weight: i === 0 ? 0.9 : 0.2 })),
    });
    const cut = format("short-9x16");
    expect(planCut(short, source, cut).kept).toHaveLength(1);
    expect(sceneWindows(emitComposition(short, source, cut))).toHaveLength(1);
    // An override is just a different Format, so the same rule answers for it.
    expect(planCut(short, source, { ...cut, minWeight: 0 }).kept).toHaveLength(
      storyboard.beats.length,
    );
  });

  it("cuts the deck to the format's own length, and says why each beat went", () => {
    // WIRING THE SELECTION. `selectBeats` was a pure function nobody called: the
    // deck was cut by the flat weight threshold alone, and the budget gate could
    // only fail the over-long short AFTER it had been written. Now `planCut`
    // fits the deck to `maxSeconds` before a byte is emitted.
    // Six 40-second beats is 4m00s against short-9x16's 3m00s ceiling.
    const long = storyboardSchema.parse({
      ...storyboard,
      beats: [0, 1, 2, 3, 4, 5].map((n) => {
        const b = storyboard.beats[n % 2];
        return { ...b, id: `x${n}`, weight: 0.9, seconds: 40 };
      }),
    });
    const kept = planCut(long, source, format("short-9x16"));
    expect(kept.kept.length).toBeLessThan(long.beats.length);
    expect(kept.seconds).toBeLessThanOrEqual(180);
    expect(sceneWindows(emitComposition(long, source, format("short-9x16")))).toHaveLength(
      kept.kept.length,
    );
    // A drop with no explanation is the silent trim this was not allowed to be.
    for (const d of kept.dropped) expect(d.reason).toMatch(/\S/);
    // The ends are never the casualties, whatever the arithmetic says.
    expect(kept.kept[0]?.id).toBe(long.beats[0]?.id);
    expect(kept.kept[kept.kept.length - 1]?.id).toBe(long.beats[long.beats.length - 1]?.id);
  });

  it("leaves an unbudgeted format exactly as it was", () => {
    // 16:9 is what ships. Both 16:9 profiles have no destination and so no cap
    // (`DESTINATIONS`), which must mean the selection is a no-op on them rather
    // than a cut nobody asked for.
    const cut = planCut(storyboard, source, format("deck-16x9"));
    expect(cut.kept).toHaveLength(storyboard.beats.length);
    expect(cut.dropped).toHaveLength(0);
  });

  /**
   * A REFUSED BEAT MUST NOT KILL THE DECK.
   *
   * Six archetypes now refuse a beat they cannot fit rather than overflowing it,
   * and `onBeatError` is the whole answer to what that costs: one slide, not
   * twelve. It did not work. `layout` caught the throw on its SECOND pass over
   * the beats, and `planCut` — the first pass, which emits every beat to measure
   * it — did not catch anything, so a deterministic refusal (the only kind
   * `emitScene` has: no clock, no randomness) took the build down before the
   * filter that was supposed to see it ever ran. Nothing tested the hook, so a
   * green suite said this worked for as long as it existed.
   */
  const overfull = {
    id: "bad",
    intent: "A callout nothing can fit.",
    archetype: "callout",
    seconds: 8,
    weight: 0.9,
    params: {
      headline: "A headline of moderate length",
      panels: [1, 2, 3].map((n) => ({
        label: `panel ${n}`,
        lines: Array.from(
          { length: 8 },
          () => "The source defines windowing over the dense field and never says what happens",
        ),
      })),
    },
  };
  const mixed = storyboardSchema.parse({ ...storyboard, beats: [...storyboard.beats, overfull] });

  it("still propagates a refusal when no one is listening", () => {
    // The library contract, unchanged: without the hook the error is the answer.
    expect(() => planCut(mixed, source, format("deck-16x9"))).toThrow(/panel/);
    expect(() => emitComposition(mixed, source, format("deck-16x9"))).toThrow(/panel/);
  });

  it("costs the refused beat its own slide and no more", () => {
    const seen: [string, string][] = [];
    const onBeatError = (id: string, err: Error) => seen.push([id, err.message]);
    const cut = planCut(mixed, source, format("deck-16x9"), { onBeatError });
    expect(seen.map(([id]) => id)).toEqual(["bad"]);
    expect(seen[0]?.[1]).toMatch(/panel/);
    // Reported AND absent from the cut. A `kept` naming a beat the deck does not
    // draw is what the old filter left behind — it dropped the beat after the
    // cut had been decided, so the timing manifest and the budget gate were both
    // handed a beat list the composition disagreed with.
    expect(cut.kept.map((b) => b.id)).toEqual(storyboard.beats.map((b) => b.id));
    const html = emitComposition(mixed, source, format("deck-16x9"), { onBeatError });
    expect(sceneWindows(html)).toHaveLength(storyboard.beats.length);
  });

  it("says there is no deck when every beat is refused", () => {
    const allBad = storyboardSchema.parse({ ...storyboard, beats: [overfull] });
    expect(() => planCut(allBad, source, format("deck-16x9"), { onBeatError: () => {} })).toThrow(
      /failed to draw/,
    );
  });

  it("charges no camera tail for a dive out of a beat that was refused", () => {
    // A tail is 1.8s of deck (`MOVE_SECONDS + FADE_SECONDS`) charged to the beat
    // a camera leaves FROM. `layout` only creates one when the next SURVIVING
    // beat dives in, so a tail owed to a beat an emitter has just refused is a
    // tail the deck will never draw — and `planCut` was reading the relation off
    // the pre-refusal list, so it billed 1.8s for a dive into a slide that is not
    // there. Under a tight budget that pays for itself by cutting somebody else.
    const withDive = storyboardSchema.parse({
      ...storyboard,
      beats: [
        storyboard.beats[0],
        { ...overfull, inside: { beat: "b1", element: "eyebrow" } },
        storyboard.beats[1],
      ],
    });
    const noDive = storyboardSchema.parse({
      ...storyboard,
      beats: [storyboard.beats[0], overfull, storyboard.beats[1]],
    });
    const seconds = (sb: typeof withDive) =>
      planCut(sb, source, format("deck-16x9"), { onBeatError: () => {} }).seconds;
    // Same two surviving beats either way, so the same total. It differed by
    // exactly MOVE_SECONDS + FADE_SECONDS before.
    expect(seconds(withDive)).toBe(seconds(noDive));
  });

  it("carries each scene across the seam instead of cutting to background", () => {
    // THE BLACKOUT. Scenes are absolutely positioned clips laid back to back, and
    // every archetype opens through `chromeIn` — nothing on screen before 0.15s,
    // headline at 0.3s. A clip that ends where the next one starts therefore
    // hands off to flat background: measured at five consecutive frames of
    // luma 27, min == max, at every one of the vertical demo's seven seams.
    // So the outgoing clip outlasts its own slide and dissolves into the
    // incoming one, which the engine paints because its visibility pass is per
    // element and has no notion of one scene at a time.
    expect(html).toContain(
      `tl.fromTo("#s1", { opacity: 1 }, { opacity: 0, duration: 0.4, ease: "power2.in", immediateRender: false }, 6);`,
    );
    // The LAST scene has nothing to hand off to: it must not outlast the deck.
    expect(html).not.toContain(`tl.fromTo("#s2", { opacity: 1 }`);
    const last = sceneWindows(html).at(-1);
    expect(last?.end).toBe(17);
    expect(html).toMatch(/id="root"[\s\S]*?data-duration="17"/);
  });

  it("keeps the island on slides, never on clips", () => {
    // `hyperframes lint` rejects overlapping main-line slides outright
    // (`slideshow_unresolved_ref`), and a slide window that moved would move
    // every stop's narration with it. Only the clip overlaps.
    const slides = island(html).slides as { startTime?: number; endTime?: number }[];
    expect(slides.map((s) => [s.startTime, s.endTime])).toEqual([
      [0, 6],
      [6, 17],
    ]);
  });

  it("never lets a handoff outlast the scene it hands off to", () => {
    // A 0.2s beat after a long one would otherwise leave the outgoing scene lit
    // over the whole of its successor and past its successor's own handoff.
    const brief = storyboardSchema.parse({
      ...storyboard,
      beats: [
        { ...storyboard.beats[0], seconds: 6 },
        { ...storyboard.beats[1], seconds: 0.25 },
      ],
    });
    const windows = sceneWindows(emitComposition(brief, source, format("deck-16x9")));
    expect(windows[0]?.end).toBe(6.25);
    expect(windows[1]?.start).toBe(6);
  });

  it("ships a font bundle only for languages outside the auto-resolve allowlist", () => {
    expect(html).not.toContain("assets/fonts/fonts.css");
    const ko = emitComposition(
      storyboardSchema.parse({ ...storyboard, lang: "ko" }),
      source,
      format("deck-16x9"),
    );
    expect(ko).toContain('<link rel="stylesheet" href="assets/fonts/fonts.css" />');
    expect(ko).toContain('"Noto Sans KR"');
  });

  it("names the family ingest actually subsets, script variants included", () => {
    // Two copies of the lang→family mapping is invariant 9's silent failure: the
    // stack asks for SC, the bundle declares TC, every glyph falls back and every
    // gate passes. `source/fonts.ts` owns the mapping; this asserts the deck uses it.
    const tw = emitComposition(
      storyboardSchema.parse({ ...storyboard, lang: "zh-Hant-TW" }),
      source,
      format("deck-16x9"),
    );
    expect(tw).toContain('"Noto Sans TC"');
  });
});

/**
 * The reveal verbs. Each rule here is a failure the gate stack cannot see: a
 * part on screen before its reveal, a blink where a part already at 0.62 is
 * told to start from 1, a route that jumps between legs. They are checked on
 * the `Tween` objects, which is where the promise is made.
 */
describe("the DrawSVG seam", () => {
  it("loads the plugin and registers it before any scene script runs", () => {
    // Order is the whole of it. A scene's IIFE builds its timeline inline, so a
    // `drawSVG` tween created before `registerPlugin` runs is a tween GSAP does
    // not understand — it would silently animate nothing, and every gate would
    // stay green because the DOM still contains the path.
    const gsapAt = html.indexOf("vendor/gsap.min.js");
    const pluginAt = html.indexOf("vendor/DrawSVGPlugin.min.js");
    const registerAt = html.indexOf("registerPlugin(DrawSVGPlugin)");
    const firstScene = html.indexOf("__timelines");
    expect(gsapAt).toBeGreaterThan(-1);
    expect(pluginAt).toBeGreaterThan(gsapAt);
    expect(registerAt).toBeGreaterThan(pluginAt);
    expect(firstScene).toBeGreaterThan(registerAt);
  });

  it("loads the morph runtime only for a deck that morphs, and before any scene script", () => {
    // The base fixture has no morph, so it pays nothing — not a script tag, not
    // a byte. That is what keeps every shipped deck byte-identical across this.
    expect(html).not.toContain("ds-morph");
    const two = sourceSchema.parse({
      ...source,
      equations: [
        ...source.equations,
        { id: "eq-two", tex: String.raw`\mathrm{softmax}(QK^{\top})V`, display: true },
      ],
    });
    const morphed = storyboardSchema.parse({
      ...storyboard,
      beats: [
        ...storyboard.beats,
        {
          id: "b3",
          intent: "Drop the scaling and see what is left.",
          archetype: "equation-morph",
          seconds: 9,
          params: {
            headline: "Without the scale",
            fromId: "eq-attn",
            toId: "eq-two",
            terms: [{ tex: "QK^{\\top}", label: "query–key similarity", tone: "a" }],
          },
        },
      ],
    });
    const out = emitComposition(morphed, two, format("deck-16x9"));
    const gsapAt = out.indexOf("vendor/gsap.min.js");
    const runtimeAt = out.indexOf("vendor/ds-morph.js");
    const registerAt = out.indexOf("registerPlugin(DSMorphPlugin)");
    const firstScene = out.indexOf("__timelines");
    expect(runtimeAt).toBeGreaterThan(gsapAt);
    expect(registerAt).toBeGreaterThan(runtimeAt);
    expect(firstScene).toBeGreaterThan(registerAt);
    // And the scene is DEFERRED: its plan is browser geometry, so its timeline
    // is registered by a builder the ready gate awaits, not during parse.
    expect(out).toContain("__dsBuilders");
    expect(out).toMatch(/DSMorph\.build\(document\.getElementById\("s3-morph"\)\)/);
  });

  it("never feeds a stroke a length the emitter computed", () => {
    // The point of the seam: no archetype should be summing segment lengths or
    // computing a rounded-rect perimeter to feed `strokeDasharray` any more. If
    // one comes back, it is measuring a shape the browser measures anyway and
    // keeping it in step by hand. The positive case — that a drawing archetype
    // emits `drawSVG` — is pinned in archetypes.test.ts, where one exists; this
    // fixture's two scenes draw no strokes, which is what makes it the right
    // place for the negative.
    expect(html).not.toMatch(/strokeDasharray:\s*\d/);
  });
});

describe("the reveal verbs", () => {
  const sid = "s3";
  const scoped = (tweens: Tween[]) => {
    for (const t of tweens) expect(t.target.startsWith(`#${sid}`)).toBe(true);
  };

  describe("spotlighter", () => {
    it("dims to exactly DIM, never renders immediately, and rounds its position", () => {
      const [dim, ...rest] = spotlighter(sid, ".term").lit("t0", 0.1 + 0.2);
      expect(rest).toHaveLength(0);
      // The complement selector: everything in scope but the kept part.
      expect(tweenText(dim as Tween)).toBe(
        `tl.fromTo("#s3 .term:not(#s3-t0)", { opacity: 1 }, { opacity: ${DIM}, duration: 0.45, ease: "power2.out", immediateRender: false }, 0.3);`,
      );
      expect(DIM).toBe(0.62);
    });

    it("moves the light: the old keep dims from 1, the new keep returns from DIM", () => {
      const spot = spotlighter(sid, ".term");
      const first = spot.lit("t0", 1);
      const second = spot.lit("t1", 2);
      expect(second.map((t) => [t.target, t.from.opacity, t.to.opacity])).toEqual([
        ["#s3-t0", 1, DIM],
        ["#s3-t1", DIM, 1],
      ]);
      for (const t of [...first, ...second]) expect(t.to.immediateRender).toBe(false);
      scoped([...first, ...second]);
      // Keeping the same part again is not a change, so it is not a tween.
      expect(spot.lit("t1", 3)).toEqual([]);
    });

    it("keeps a set, and only tweens the difference between sets", () => {
      const spot = spotlighter(sid, ".row");
      const [dim] = spot.lit(["row2", "row4"], 1);
      expect(dim?.target).toBe("#s3 .row:not(#s3-row2):not(#s3-row4)");
      const swap = spot.lit(["row4", "row5"], 2);
      expect(swap.map((t) => t.target)).toEqual(["#s3-row2", "#s3-row5"]);
    });

    it("restores the scope minus what is lit, from DIM, over 0.4s", () => {
      const spot = spotlighter(sid, ".term");
      spot.lit("t0", 1);
      spot.lit("t1", 2);
      const [back, ...rest] = spot.restore(3.005);
      expect(rest).toHaveLength(0);
      expect(back?.target).toBe("#s3 .term:not(#s3-t1)");
      expect(back?.from).toEqual({ opacity: DIM });
      expect(back?.to).toEqual({
        opacity: 1,
        duration: 0.4,
        ease: "power2.out",
        immediateRender: false,
      });
      expect(back?.at).toBe(3.01);
      // Everything is lit again, so there is nothing a second restore could do.
      expect(() => spot.restore(4)).toThrow(/nothing is dim/);
    });

    it("dims arriving parts one at a time and restores exactly those", () => {
      const spot = spotlighter(sid);
      const a = spot.dim("stage0", 1);
      const b = spot.dim("stage1", 2);
      const c = spot.dim("#s3 .cell:not(.in)", 3);
      expect([...a, ...b, ...c].map((t) => t.target)).toEqual([
        "#s3-stage0",
        "#s3-stage1",
        "#s3 .cell:not(.in)",
      ]);
      for (const t of [...a, ...b, ...c]) {
        expect(t.from).toEqual({ opacity: 1 });
        expect(t.to.opacity).toBe(DIM);
        expect(t.to.immediateRender).toBe(false);
      }
      const [back] = spot.restore(4);
      expect(back?.target).toBe("#s3-stage0, #s3-stage1, #s3 .cell:not(.in)");
      expect(back?.from).toEqual({ opacity: DIM });
    });

    it("refuses the histories that would blink or leak", () => {
      // Dimming twice would start the second tween from 1 over a part at DIM.
      const twice = spotlighter(sid);
      twice.dim("stage0", 1);
      expect(() => twice.dim("stage0", 2)).toThrow(/already dim/);
      // A selector outside the scene is invariant 3's failure.
      expect(() => spotlighter(sid).dim("#s4-stage0", 1)).toThrow(/not inside the scene/);
      // The two idioms keep different histories; one object cannot keep both.
      const mixed = spotlighter(sid, ".stage");
      mixed.lit("stage0", 1);
      expect(() => mixed.dim("stage1", 2)).toThrow(/lit\(\) and dim\(\)/);
      // `lit` needs a scope to take the complement of.
      expect(() => spotlighter(sid).lit("t0", 1)).toThrow(/needs a scope/);
      // `:not()` takes one compound selector, so a keep is one part or one id.
      expect(() => spotlighter(sid, ".term").lit("#s3 .term.a", 1)).toThrow(/one part or one id/);
    });
  });

  describe("travel", () => {
    const o = { x: 0, y: 0 };
    const corner = { x: 300, y: 0 };
    const down = { x: 300, y: 100 };
    const elbow = [o, corner, down];

    /** Legs abut, or the earlier one rests for the one hundredth it gave up. */
    const abutting = (route: Tween[]) => {
      for (let i = 1; i < route.length; i++) {
        const prev = route[i - 1];
        const leg = route[i];
        const gap = (leg?.at ?? 0) - ((prev?.at ?? 0) + Number(prev?.to.duration));
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(0.01 + 1e-9);
      }
    };

    it("is one x/y leg per segment, timed by length, none then power2.out", () => {
      const legs = travel("#s3-pulse", elbow, 0, 0.8);
      expect(legs).toHaveLength(2);
      scoped(legs);
      expect(legs.map((t) => [t.at, t.to.duration, t.to.ease])).toEqual([
        [0, 0.6, "none"],
        [0.6, 0.2, "power2.out"],
      ]);
      expect(legs[0]?.from).toEqual({ x: 0, y: 0 });
      expect(legs[0]?.to).toMatchObject({ x: 300, y: 0 });
      expect(legs[1]?.to).toMatchObject({ x: 300, y: 100 });
      // Arrival is `at + seconds`, so a pop can be scheduled against it.
      expect((legs[1]?.at ?? 0) + Number(legs[1]?.to.duration)).toBeCloseTo(0.8, 12);
    });

    it("renders the first leg immediately and no other, each from where the last ended", () => {
      const legs = travel("#s3-ring", [...elbow, { x: 500, y: 100 }], 2, 1);
      expect(legs).toHaveLength(3);
      expect(legs[0]?.to.immediateRender).toBeUndefined();
      for (let i = 1; i < legs.length; i++) {
        const prev = legs[i - 1];
        const leg = legs[i];
        expect(leg?.to.immediateRender).toBe(false);
        expect([leg?.from.x, leg?.from.y]).toEqual([prev?.to.x, prev?.to.y]);
      }
      abutting(legs);
    });

    it("never lets a leg's float end overshoot the next leg's start", () => {
      // 0.1 + 0.2 is 0.30000000000000004, which lint reads as an overlap with
      // the leg at 0.3 (`overlapping_gsap_tweens`, 0.7.90). The corner and the
      // arrival stay put; the leg before the corner gives up one hundredth.
      const square = travel("#s3-pulse", [o, corner, { x: 300, y: 300 }], 0.1, 0.4);
      abutting(square);
      expect(square.map((t) => [t.at, t.to.duration])).toEqual([
        [0.1, 0.19],
        [0.3, 0.2],
      ]);
      abutting(travel("#s3-pulse", elbow, 0.1, 0.4 / 3));
    });

    it("drops a repeated corner and refuses a route that goes nowhere", () => {
      const legs = travel("#s3-pulse", [o, corner, corner, down], 0, 1);
      expect(legs).toHaveLength(2);
      expect(() => travel("#s3-pulse", [o, o], 0, 1)).toThrow(/two distinct points/);
      expect(() => travel("#s3-pulse", elbow, 0, 0)).toThrow(/no time/);
    });
  });

  describe("words", () => {
    it("wraps each word in a span, escaped, rejoined with single spaces", () => {
      expect(words("Attention  <is>\nall you\tneed ")).toBe(
        '<span class="w">Attention</span> <span class="w">&lt;is&gt;</span> <span class="w">all</span> <span class="w">you</span> <span class="w">need</span>',
      );
      expect(words("Q & A", "cw")).toBe(
        '<span class="cw">Q</span> <span class="cw">&amp;</span> <span class="cw">A</span>',
      );
      expect(words("   ")).toBe("");
    });
  });
});
