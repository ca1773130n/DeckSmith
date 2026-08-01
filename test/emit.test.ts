/**
 * The renderer invariants, asserted on real output.
 *
 * Every one of these was a silent failure first: a deck that lints clean, serves,
 * renders, and does not navigate. They are checked on the emitted string because
 * that is the only place they are observable without a browser.
 */
import { describe, expect, it } from "vitest";
import { emitComposition, planCut } from "../src/emit/composition.js";
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
