/**
 * Duration control, checked against the deck it was measured on.
 *
 * The point of this file is the arithmetic test at the bottom. `durationPlan`
 * hands out a character budget and an animation speed, and whether those two
 * numbers actually produce a 60-second video is not something the type system,
 * the linter or `check` can tell you — it is `Σ max(authored·s, lastHold·s +
 * spoken)`, and it is the one thing that can be wrong while every gate is green.
 * So the demo's REAL per-beat holds are pinned here and the sum is recomputed
 * from the budget, with no planner, no TTS and no ffmpeg in the way.
 *
 * The holds come from `emitScene` on demo/storyboard.json and are asserted
 * against it in `test/prompt.test.ts`'s sibling check — they are pinned rather
 * than recomputed because this file is about the arithmetic over them, and a
 * table that drifts should fail loudly here rather than quietly re-derive.
 */
import { describe, expect, it } from "vitest";
import { planSegments } from "../src/narrate/narrate.js";
import {
  COMFORTABLE_CPS,
  durationPlan,
  EXPLAINING_CHARS,
  LAST_HOLD_SECONDS,
  MIN_SENTENCE_CHARS,
  p95CueRate,
  playbackFactor,
  playbackWarning,
  RATE_STEPS,
  SPEAKING_STOPS,
  SPEECH_CPS,
  tempoChain,
} from "../src/plan/duration.js";
import { systemPrompt } from "../src/plan/prompt.js";
import { respeedArgs } from "../src/render/ffmpeg.js";
import { prefsSchema } from "../src/types.js";

const prefs = (over: Record<string, unknown> = {}) => prefsSchema.parse(over);

/** demo/storyboard.json's authored `seconds`, in beat order. */
const AUTHORED = [6, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8];
/** The LAST usable hold each of those beats emits, at `animationSpeed: 1`. */
const LAST_HOLD = [1.9, 7.8, 4.7, 4.8, 4.3, 3.9, 3.6, 4.5, 5.5, 3.8, 2.4, 3.3];

/** `beatSeconds`, summed: what the composition's `data-duration` will say. */
function deckSeconds(speed: number, spokenPerBeat: number): number {
  return AUTHORED.reduce(
    (total, authored, i) =>
      total + Math.max(authored * speed, (LAST_HOLD[i] as number) * speed + spokenPerBeat),
    0,
  );
}

describe("durationPlan", () => {
  it("leaves a deck with no target exactly as it was", () => {
    const plan = durationPlan(prefs());
    expect(plan.speed).toBe(1);
    expect(plan.chars).toBeUndefined();
    expect(plan.warnings).toEqual([]);

    // The invariant `pace` exists for: identity at 1, so the bytes do not move.
    expect(durationPlan(prefs({ animationSpeed: 0.5 })).speed).toBe(0.5);
  });

  it("lets the target outrank animationSpeed, and says so", () => {
    const plan = durationPlan(prefs({ duration: 60, animationSpeed: 2 }));
    expect(plan.speed).toBeLessThan(1);
    expect(plan.warnings.join(" ")).toContain("animation speed was ignored");
  });

  it("divides the budget by STOPS, so high density at 60s is refused in words", () => {
    const high = durationPlan(prefs({ duration: 60, slides: 12 }));
    // 3.25s of speech across 3.1 stops is ~15 characters. That is the trap the
    // whole feature exists to avoid, and it must be said, not silently clamped.
    expect(high.warnings.join(" ")).toContain("fragment");
    expect(high.chars).toBe(MIN_SENTENCE_CHARS);

    // Low density buys a real sentence out of the same 60 seconds — that is the
    // whole trade this feature exists to make, and it still holds.
    const low = durationPlan(prefs({ duration: 60, slides: 12, narration: { density: "low" } }));
    expect(low.chars).toBeGreaterThan(MIN_SENTENCE_CHARS);
    expect(low.warnings.join(" ")).not.toContain("fragment");
  });

  /**
   * THE CONFIGURATION THAT SHIPPED THE COMPLAINT, and the knob that answers it.
   *
   * 60s over twelve slides at low density was the one case this file declared
   * clean — `expect(low.warnings).toEqual([])` — and it is the exact deck the
   * owner watched and called "too short sentences with lack of explanation".
   * 47 characters clears `MIN_SENTENCE_CHARS` by seventeen, so nothing fired.
   *
   * The first answer written here was an advisory saying "use 9 slides", which
   * is the wrong answer to a request that begins "keep all twelve". The right
   * one was in §1 of the handoff all along, in the DERIVED column: "the number
   * of words and narration speed is automatically decided by the logic". The
   * seconds a beat can spend on speech are fixed by the target; how many words
   * fit in them is not.
   */
  it("speaks faster to buy words, rather than asking for fewer slides", () => {
    const short = durationPlan(prefs({ duration: 60, slides: 12, narration: { density: "low" } }));

    // All twelve slides, still 60 seconds, and a sentence that explains.
    expect(short.rate).not.toBe("+0%");
    expect(short.chars).toBeGreaterThanOrEqual(EXPLAINING_CHARS);

    // The words are bought by SPEED, not by stealing from the animation or by
    // lengthening the deck: the seconds of speech per beat are what they were.
    const slow = durationPlan(prefs({ duration: 60, slides: 12, narration: { density: "high" } }));
    expect(short.speechSeconds).toBe(slow.speechSeconds);

    // And the cost is stated in the units it lands in — the subtitle.
    expect(short.warnings.join(" ")).toContain("characters per second");
  });

  it("uses the SLOWEST rate that clears the bar, and none at all when it can", () => {
    // Never faster than the shortfall needs. A target that already affords a
    // real sentence is spoken normally, so its deck does not move a byte.
    for (const duration of [90, 120, 180]) {
      const roomy = durationPlan(prefs({ duration, slides: 12, narration: { density: "low" } }));
      expect(roomy.rate, `${duration}s`).toBe("+0%");
      expect(roomy.chars, `${duration}s`).toBeGreaterThanOrEqual(EXPLAINING_CHARS);
      expect(roomy.warnings, `${duration}s`).toEqual([]);
    }

    // Monotone in the direction that matters: a tighter target never speaks
    // slower than a looser one.
    const rateOf = (d: number) =>
      RATE_STEPS.findIndex(
        ([r]) =>
          r ===
          durationPlan(prefs({ duration: d, slides: 12, narration: { density: "low" } })).rate,
      );
    expect(rateOf(60)).toBeGreaterThan(rateOf(90));
  });

  it("still says so when even the fastest rate cannot buy a real sentence", () => {
    // Speed has a ceiling — `RATE_STEPS` stops where the captions do. Past it
    // the advisory is the honest answer, and it names a slide count rather than
    // saying "use fewer".
    const thin = durationPlan(
      prefs({ duration: 60, slides: 12, narration: { density: "medium" } }),
    );
    expect(thin.rate).toBe(RATE_STEPS[RATE_STEPS.length - 1]?.[0]);

    const said = thin.warnings.join(" ");
    expect(said).toContain("caption rather than explain");
    const named = said.match(/(\d+) slides at the same target/);
    expect(named, `no slide count named in: ${said}`).toBeTruthy();
    // Whatever it names must actually clear the bar it is recommending.
    const roomier = durationPlan(
      prefs({ duration: 60, slides: Number(named?.[1]), narration: { density: "medium" } }),
    );
    expect(roomier.chars).toBeGreaterThanOrEqual(EXPLAINING_CHARS);
    expect(roomier.warnings.join(" ")).not.toContain("caption rather than explain");
  });

  it("leaves a deck with no duration target speaking at its own rate", () => {
    expect(durationPlan(prefs()).rate).toBe("+0%");
    expect(durationPlan(prefs({ narration: { rate: "-10%" } })).rate).toBe("-10%");
    // With a target, the target owns it — same rule as `animationSpeed`, and
    // said out loud rather than silently.
    const overridden = durationPlan(
      prefs({ duration: 60, slides: 12, narration: { density: "low", rate: "-10%" } }),
    );
    expect(overridden.rate).not.toBe("-10%");
    expect(overridden.warnings.join(" ")).toContain("narration rate was ignored");
  });

  it("reads CJK far slower than Latin, so a Korean deck gets a shorter sentence", () => {
    const en = durationPlan(prefs({ duration: 120, narration: { density: "low" } }));
    const ko = durationPlan(prefs({ duration: 120, lang: "ko", narration: { density: "low" } }));
    expect(en.chars).toBeGreaterThan(ko.chars as number);
    expect((en.chars as number) / (ko.chars as number)).toBeCloseTo(
      SPEECH_CPS.latin / SPEECH_CPS.cjk,
      1,
    );
  });

  /**
   * THE ONE THAT MATTERS. Feed the budget back through `beatSeconds` over the
   * demo's own holds and check the deck lands where it was asked to — inside the
   * 1.25× playback ceiling, which is what §6's acceptance criterion reduces to
   * once the planner is taken out of the loop.
   *
   * `spokenSeconds` DIVIDES BY THE RATE, and that is the whole point of the
   * knob rather than an adjustment to make a test pass: 66 characters spoken at
   * `+30%` takes 3.29s, where 47 at `+0%` took 3.26s. The extra words are free
   * in seconds, which is why the deck still lands at 60 with all twelve slides.
   * Divide by the base cps here and this test measures a deck nobody renders.
   */
  const spokenSeconds = (plan: { chars?: number; rate: string }, cps = SPEECH_CPS.latin) => {
    const step = RATE_STEPS.find(([rate]) => rate === plan.rate);
    return (plan.chars as number) / (cps * (step?.[1] ?? 1));
  };

  it("produces a 12-slide 60s target the playback ceiling can close", () => {
    const plan = durationPlan(prefs({ duration: 60, slides: 12, narration: { density: "low" } }));
    const seconds = deckSeconds(plan.speed, spokenSeconds(plan));

    // Not 60 on its own — the per-archetype hold spread guarantees an overshoot,
    // which is exactly what the retime is for. What must hold is that the gap is
    // inside 1.25×, because past that the captions stop being readable.
    expect(playbackFactor(seconds, 60)).toBeLessThanOrEqual(1.25);
  });

  it("buys the extra words in seconds it already had", () => {
    // The guarantee the rate knob rests on. Speaking faster must not lengthen
    // the deck — if it did, the retime would have to claw it back and the
    // captions would pay twice.
    const plan = durationPlan(prefs({ duration: 60, slides: 12, narration: { density: "low" } }));
    expect(spokenSeconds(plan)).toBeCloseTo(plan.speechSeconds as number, 1);
  });

  it("holds at 120s and 180s too, at the density each target can afford", () => {
    for (const [duration, density] of [
      [120, "low"],
      [180, "medium"],
      [240, "high"],
    ] as const) {
      const plan = durationPlan(prefs({ duration, slides: 12, narration: { density } }));
      const perStop = spokenSeconds(plan);
      const stops = Math.min(SPEAKING_STOPS[density], 3.1);
      const seconds = deckSeconds(plan.speed, perStop * stops);
      expect(playbackFactor(seconds, duration), `${duration}s at ${density}`).toBeLessThanOrEqual(
        1.25,
      );
    }
  });

  it("never derives a speed that outruns the schema's floor", () => {
    const plan = durationPlan(prefs({ duration: 10, slides: 40 }));
    expect(plan.speed).toBe(0.25);
    expect(plan.warnings.join(" ")).toContain("4× floor");
  });

  it("reserves the reveal schedule out of every beat", () => {
    const plan = durationPlan(prefs({ duration: 120, slides: 12 }));
    expect(plan.beatSeconds).toBe(10);
    expect(plan.speechSeconds).toBeCloseTo(10 - LAST_HOLD_SECONDS * plan.speed, 3);
  });
});

describe("playback", () => {
  it("speeds up and never slows down", () => {
    expect(playbackFactor(120, 60)).toBe(2);
    expect(playbackFactor(50, 60)).toBe(1);
    expect(playbackFactor(60, 60)).toBe(1);
  });

  it("decomposes into atempo instances ffmpeg will accept", () => {
    for (const factor of [1.1, 1.25, 2, 2.9, 3.27, 8]) {
      const chain = tempoChain(factor);
      expect(chain.length).toBeGreaterThan(0);
      for (const t of chain) expect(t).toBeGreaterThanOrEqual(0.5);
      // The limit that forces the chain to exist at all.
      for (const t of chain) expect(t).toBeLessThanOrEqual(2);
      expect(chain.reduce((a, b) => a * b, 1)).toBeCloseTo(factor, 2);
    }
    expect(tempoChain(1)).toEqual([]);
  });

  it("computes the caption ceiling from the deck's own cues, not a constant", () => {
    // A deck already at 18.4 cps (the demo) has no headroom; one at 8 has plenty.
    const dense = playbackWarning(1.1, 18.41);
    expect(dense).toContain("characters per second");
    expect(playbackWarning(1.1, 8)).toBeUndefined();
    // Past the comfortable ceiling it is said even when the captions are sparse.
    expect(playbackWarning(1.5, 8)).toContain("1.25×");
    expect(playbackWarning(1, 18.41)).toBeUndefined();
  });

  it("measures p95 cue rate over a cue list", () => {
    const cues = [
      { start: 0, end: 1, text: "x".repeat(10) },
      { start: 1, end: 2, text: "x".repeat(20) },
      { start: 2, end: 3, text: "x".repeat(30) },
      // Zero-length and empty cues are not rates; they must not become Infinity.
      { start: 3, end: 3, text: "x" },
      { start: 4, end: 5, text: "" },
    ];
    expect(p95CueRate(cues)).toBe(30);
    expect(p95CueRate([])).toBe(0);
    expect(playbackWarning(1.2, p95CueRate(cues))).toContain(String(COMFORTABLE_CPS));
  });

  it("builds a filtergraph that maps both streams and chains atempo", () => {
    const args = respeedArgs("in.mp4", 2.9, tempoChain(2.9), 30, true, "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1] as string;
    expect(graph).toContain("setpts=PTS/2.9");
    expect(graph.match(/atempo=/g)).toHaveLength(2);
    expect(args).toContain("[a]");
    expect(args).toContain("-c:a");

    // A silent deck must not be handed `[0:a]`, which ffmpeg refuses outright.
    const silent = respeedArgs("in.mp4", 1.2, tempoChain(1.2), 30, false, "out.mp4");
    expect(silent[silent.indexOf("-filter_complex") + 1]).not.toContain("atempo");
    expect(silent).toContain("-an");
  });
});

describe("narration density", () => {
  it("silences the later stops instead of inventing or dropping copy", () => {
    const text = "One. Two. Three. Four.";
    // low: every word still spoken, all of it on the beat's own landing.
    const low = planSegments(text, Math.min(5, SPEAKING_STOPS.low));
    expect(low).toEqual(["One. Two. Three. Four."]);

    const medium = planSegments(text, Math.min(5, SPEAKING_STOPS.medium));
    expect(medium).toEqual(["One.", "Two. Three. Four."]);

    // high is untouched: one sentence per stop, the fifth silent.
    expect(planSegments(text, Math.min(5, SPEAKING_STOPS.high))).toEqual([
      "One.",
      "Two.",
      "Three.",
      "Four.",
      "",
    ]);
  });
});

describe("the prompt", () => {
  it("states each length constraint exactly once", () => {
    const dflt = systemPrompt(prefs());
    expect(dflt).toContain("ONE SENTENCE PER REVEAL");
    expect(dflt).toContain("about 25 words");
    expect(dflt).not.toContain("DURATION   ");

    const low = systemPrompt(prefs({ duration: 60, narration: { density: "low" } }));
    expect(low).toContain("ONE SENTENCE PER BEAT");
    // Two answers to one question is the failure this parameterisation prevents.
    expect(low).not.toContain("ONE SENTENCE PER REVEAL");
    expect(low).not.toContain("about 25 words");
    expect(low).toContain("DURATION   ");
    // The reveal-count table is only a constraint at high density.
    expect(low).not.toContain("annotated-figure  one per note");

    const high = systemPrompt(prefs({ duration: 240 }));
    expect(high).toContain("ONE SENTENCE PER REVEAL");
    expect(high).toContain("characters");
  });
});
