/**
 * A target duration, a slide count and a narration density, turned into the
 * numbers the rest of the pipeline needs.
 *
 * WHY THIS IS NOT A SPEED SLIDER. `beatSeconds` (src/emit/composition.ts) is
 * `max(authored, lastHold + spoken)`, and on the narrated demo the spoken term
 * wins by a mile: 195.9s of speech across 37 stops. Multiplying every tween by
 * `animationSpeed` scales the two terms it does not need to and leaves the one
 * that decides the length untouched, so a duration control built on that knob
 * alone would quietly do nothing. Measured, not reasoned: the demo is 246.5s at
 * `animationSpeed: 1` and 208.6s at 0.25 — a 4× faster animation buys 15%.
 *
 * WHY THE BUDGET DIVIDES BY STOPS. `planSegments` cuts a beat's narration one
 * sentence per stop, and the demo has 12 beats and 37 stops. A 60-second target
 * spread over 37 stops is 1.6s each — 24 characters, four words. That is not
 * narration, which is why low density means FEWER NARRATED STOPS rather than
 * shorter sentences: one sentence per beat gives 12 stops and 5 seconds each.
 *
 * WHY BOTH KNOBS ARE STILL NEEDED. Once only one stop per beat speaks, the
 * binding term flips: the demo drops to 116.9s, and what holds it there is
 * `lastHold` — a six-stage pipeline reveals its last stage at 7.8s no matter how
 * short its sentence is. `lastHold` scales with `animationSpeed` and nothing
 * else, so hitting 60s over 12 slides needs a shorter sentence AND a faster
 * animation. Neither alone gets there; that is the whole content of this file.
 *
 * WHICH SLIDE COUNT THE BUDGET IS STRUCK AT. `prefs.slides` is what was ASKED
 * FOR and `beats` is what the planner came back with, and they are routinely not
 * the same number — four of the last five real plans came back short. Every
 * derived number here is `duration / count`, so striking the budget at the
 * request while the deck has fewer beats paces each scene for a slide shorter
 * than the one it is: eight beats against a sixty-second target were paced for
 * five-second beats that are really seven and a half, and the video came in
 * under its target with every gate green and nothing anywhere saying so. So
 * every caller holding a storyboard passes its `beats.length`. The two that
 * cannot are `systemPrompt`, which builds the prompt before a plan exists, and
 * the MCP `estimate`, which is a pre-flight with no plan at all; they get the
 * request, which is the only number they have. The SHORTFALL itself is not this
 * file's to report — `scanBeatCount` in src/verify/index.ts reports it, because
 * a beat count is arithmetic rather than a judgement and a prompt rule alone can
 * always be met cosmetically.
 *
 * Everything here is pure arithmetic over preferences, so it is testable with no
 * planner, no TTS and no ffmpeg.
 */
import type { Prefs } from "../prefs.js";

/**
 * Characters of text per second of speech.
 *
 * `latin` is MEASURED on demo/audio/narration.json: 2829 characters over 195.9
 * seconds is 14.44, and the per-cue mean is 15.03. `cjk` is a GUESS — a Korean
 * or Japanese character carries several times the Latin one, and no narrated CJK
 * deck exists in this repo to measure. It is here so a Korean deck's budget is
 * wrong by a little rather than by 2×; replace it with a measurement the first
 * time one is narrated.
 */
export const SPEECH_CPS = { latin: 14.4, cjk: 6.5 } as const;

/**
 * Seconds from a scene's start to its LAST hold, at `animationSpeed: 1`.
 *
 * MEASURED as the mean over the demo's twelve beats (50.5s / 12), from
 * `emitScene(beat).holds` rather than from anything authored. It is the floor a
 * beat cannot go under without cutting off its own final reveal, and it is why
 * the speech budget below is `beat − lastHold`, not `beat`.
 *
 * ponytail: one mean over twelve beats, not a per-archetype table. The spread is
 * real (1.9s for a title, 7.8s for a six-stage pipeline), so a deck of nothing
 * but pipelines will overshoot — which the bounded playback retime then closes.
 * Predict per-beat from `REVEALS` if that stops being good enough.
 */
export const LAST_HOLD_SECONDS = 4.2;

/** Stops per beat, measured: 37 stops over the demo's 12 beats. */
export const STOPS_PER_BEAT = 3.1;

/**
 * How much of a beat is reserved for its reveal schedule rather than its speech.
 *
 * ponytail: one tuned constant. Today's narrated demo sits at 0.20 (50.5s of
 * holds in 246.5s of deck) because speech dominates; at one sentence per beat it
 * sits at 0.43. 0.35 splits the difference and leaves speech the majority, which
 * is the right way round for a narrated deck. Lower it if the animation reads as
 * rushed, raise it if the voice sounds crammed.
 */
export const MOTION_SHARE = 0.35;

/** Below this a "sentence" is a fragment. About five words of English. */
export const MIN_SENTENCE_CHARS = 30;

/**
 * The scene chrome's settle time at `animationSpeed: 1`, in seconds.
 *
 * The eyebrow runs at 0.15s over 0.5s and the headline at 0.3s over 0.6s, so the
 * headline lands at 0.9s and that is when the voice may start. `openSeconds` in
 * src/emit/composition.ts reads the real number off the real scene; this is the
 * same number in closed form, because the budget has to be struck before any
 * scene exists to measure. They agree by construction on every archetype that
 * uses the shared chrome, and the emitter's measured value is what the deck is
 * actually built with.
 */
export const OPEN_SECONDS_AT_SPEED = 0.9;

/** Stillness after the last word, before the cut. `HANDOFF_SECONDS`. */
export const SETTLE_SECONDS = 0.4;

/**
 * The sentence length this deck aims for: what "explains something" measures.
 *
 * MEASURED on `demo/storyboard.json`, the deck every other number in this file
 * is measured against: 39 narration sentences, mean 72.1 characters, median 74,
 * first quartile 59.
 *
 * IT WAS 60 — the first quartile — and that was the wrong number twice over. It
 * was picked as a FLOOR, "below this a slide captions rather than explains", and
 * the owner then rejected two decks that cleared it, both times in the same
 * words: too short to explain the paper. A floor is what a deck must not go
 * under; a target is what it should hit. `fastEnough` reads this as a target, so
 * a bar set at the worst quarter of the deck that works produced decks at the
 * worst quarter of the deck that works.
 *
 * So it is the MEAN of the deck that works. At a 60-second target over twelve
 * slides that is reached at a `+10%` speaking rate, against the `+30%` the
 * first-quartile bar demanded — more words AND more readable captions, because
 * the seconds came from overlapping speech with motion rather than from speed.
 *
 * Distinct from `MIN_SENTENCE_CHARS`, which is where a sentence stops being a
 * sentence at all. Between the two the deck is perfectly buildable and thin,
 * and that is a thing to be TOLD rather than prevented — the arithmetic is not
 * wrong, it is just what the requested slide count costs, and only the author
 * can decide whether to spend slides or seconds to buy it back.
 *
 * RAISE THIS to make every deck say more, at the cost of the subtitle: the
 * physical ceiling is the speech time a target has (`duration - slides * quiet`)
 * times the fastest rate `RATE_STEPS` allows, which at 60s over twelve slides is
 * about 94 characters a slide.
 */
export const EXPLAINING_CHARS = 72;

/**
 * Sentences a beat needs before its narration can be a story rather than a label.
 *
 * TWO, and it is the demo that says so rather than taste. `demo/storyboard.json`
 * writes 39 sentences over 12 beats — 3.25 each — and every bit of its
 * storytelling lives in the second and third: "Then the field is cut into
 * windows...", "Only at the very end does the decoder upsample...", "That loop is
 * a single tick...", "So this is not the cheap option, and the paper never claims
 * it is." The flow is INSIDE a beat, between its own sentences.
 *
 * Reduce that same deck to its FIRST sentence per beat — which is literally what
 * a 60-second target over twelve slides buys — and the deck that works reads like
 * this:
 *
 *     The encoder does the heavy lifting first.
 *     The encoder turns the low-resolution image into a dense feature field.
 *     The first tick is worth almost a full decibel.
 *
 * Twelve disconnected statements. So one sentence per beat cannot flow no matter
 * who writes it, and the owner's complaint — "they don't have a flow, just
 * sentence by sentence" — is arithmetic, not prose quality.
 *
 * THAT CONCLUSION IS TRUE OF A LECTURE AND FALSE OF A TEASER, which is why this
 * only governs beats longer than `FF_BEAT_SECONDS`. A conference fast-forward
 * talk runs one sentence a slide across a dozen slides and flows perfectly well,
 * because its flow comes from the SCRIPT being continuous — the prompt's "the
 * deck is one script, not N captions" — rather than from paragraphs inside each
 * beat. The demo is a four-minute deck, and reading its shape onto a
 * sixty-second teaser is what produced five slides and 133 words a minute.
 *
 * WHY THIS IS A COUNT AND NOT A COHESION SCORE. The obvious check is to measure
 * connectives and anaphora in the finished narration. It was built and then
 * defeated: prefixing one discourse marker to each of the twelve rejected
 * sentences — changing no content, no claim, no relation — moved the score from
 * 42% to 92%, ABOVE the hand-written demo's 74%. That is §9's lesson exactly, so
 * the thing measured here is the BUDGET, which is not a judgement and cannot be
 * written around.
 */
export const SENTENCES_PER_BEAT = 2;

/**
 * Beat length below which a deck is a fast-forward talk rather than a lecture.
 *
 * The conference teaser: sixty seconds, a dozen slides, the voice never stopping.
 * A beat this short cannot afford a leisurely delivery, so `fastEnough` stops
 * asking for the SLOWEST rate that clears a sentence and takes the FASTEST the
 * captions can carry — which is the difference between 133 words a minute and
 * 180, on the same seconds.
 */
export const FF_BEAT_SECONDS = 8;

/**
 * The shortest a slide may be and still be seen.
 *
 * A fast-forward talk runs four to six seconds a slide; under four the deck is
 * flicking rather than presenting, and the build has no room to read. This is the
 * floor `slidesFor` clamps the beat length to, distinct from `FF_BEAT_SECONDS`,
 * which is the threshold that decides how fast the voice goes — using one number
 * for both put 60 seconds at eight slides when the reference is twelve.
 */
export const MIN_BEAT_SECONDS = 4;

/**
 * Subtitle rate a short-form viewer will take, as against broadcast television.
 *
 * `COMFORTABLE_CPS` is 17 and comes from broadcast practice, where the viewer is
 * across a room and did not choose the subtitle. A one-minute research teaser is
 * neither. The anchor is this project's own artifact: `demo/audio/narration.json`
 * — the deck every other number here is measured against — runs a p95 of 18.41
 * cps, already past the broadcast bar, and nobody has ever complained about it.
 *
 * 22 is that with the headroom a fast-forward talk needs, and it is the ceiling
 * rather than a target: `fastEnough` only goes as fast as the beat requires.
 */
export const SHORT_FORM_CPS = 22;

/**
 * How much faster a CUE reads, at its p95, than the deck's mean spoken rate.
 *
 * TWO things at once, deliberately, because `fastEnough` has only one number to
 * multiply: a cue spans the words and not the breath around them, and the CUE
 * that decides whether captions are readable is the fastest one, not the average.
 * So this converts a mean spoken cps into a p95 CUE cps — the quantity
 * `SHORT_FORM_CPS` is a ceiling on.
 *
 * MEASURED on `demo/audio/narration.json`, this project's anchor deck, whose 37
 * segments carry 39 cues. Its mean segment rate is 14.440 cps — `SPEECH_CPS.latin`
 * to three figures, which is where that constant comes from — and its p95 cue
 * rate is 18.409. That is a ratio of 1.278, and 1.28 rounds AWAY from admitting a
 * step, which is the safe direction for a ceiling.
 *
 * IT SAID 1.17 UNTIL NOW, and 1.17 was never reconcilable with the file it lives
 * in: `SHORT_FORM_CPS` two constants above already quotes the same deck's p95 at
 * 18.41, and 18.41/14.4 is 1.28, not 1.17. The old table paired a `.srt` against
 * an arithmetic speech rate and got 16.6 cps at `+0%` where the anchor artifact
 * reads 18.41 — a measurement of something that is not this. What shipped from it
 * was a fast-forward deck at `+20%` (speedup 1.252), whose captions land at
 * 14.4 x 1.252 x 1.278 = 23.0 cps against a ceiling of 22. At 1.28 the same deck
 * takes `+10%` and lands at 21.9. Wrong in the OUTPUT, not in a gate — no gate
 * looks at this, which is why it survived.
 *
 * SCALE-INVARIANCE IS MEASURED, and it holds. The ratio is taken at `+0%` and
 * applied at every step, on the reasoning that speeding the voice up shrinks the
 * cue windows and the breaths between them together. `scripts/measure-cue-rate.mjs`
 * re-synthesised all 37 segments at all five steps — `+0%` included, in one
 * session, because edge-tts does not repeat itself and a fresh rate judged
 * against a stored baseline measures the drift instead:
 *
 * ```
 *   rate    meanCps   p95 cue   p95/mean   median/mean
 *   +0%      14.509    18.089     1.2467        1.0601
 *   +10%     15.752    20.392     1.2945        1.0653
 *   +20%     17.148    21.321     1.2434        1.0567
 *   +30%     18.540    23.263     1.2548        1.0572
 *   +40%     20.205    25.515     1.2628        1.0663
 * ```
 *
 * No trend in rate — so this stays a constant rather than becoming a function of
 * the step. The p95 column wobbles because p95 over 39 cues IS THE SECOND-HIGHEST
 * CUE, one window wide; `median/mean` is flat to within a percent, and it is the
 * honest read on whether the distribution's shape moves. It does not.
 *
 * IT AND `RATE_STEPS` ARE ONE UNIT, and they moved together — 2026-08-02, from
 * the run above. Read that table's `speedup` note before changing either.
 *
 * WHY 1.30 AND NOT 1.2945. It has to sit above EVERY ratio the run observed,
 * because the number it feeds is a ceiling on caption readability and being
 * under it means shipping captions faster than `SHORT_FORM_CPS`. The old 1.28
 * was below the `+10%` reading and got away with it only because the speedups
 * beside it were inflated by more — two errors cancelling, which is not a margin
 * anyone can reason about. Correcting the speedups removed that cover, so this
 * had to rise with them.
 *
 * IT COSTS A STEP, KNOWINGLY. The demo's real p95 cue at `+20%` is 21.321,
 * inside the ceiling of 22 — but this predicts 22.13 for that step and refuses
 * it, so the deck takes `+10%` and speaks slower than the artifact proves it
 * could. It also costs the 60-second case its full sentence: twelve slides at
 * low density plan 66 characters against the 72 of `EXPLAINING_CHARS`, where
 * ~1.26 would plan exactly 72.
 *
 * 1.26 IS NOT AVAILABLE, THOUGH, and it is worth writing down why because the
 * arithmetic above makes it look free. **The floor is 1.2784**, which is this
 * deck's own `DEMO_P95_CUE_CPS / SPEECH_CPS.latin` — 18.409 / 14.4 — and
 * `test/duration.test.ts` fails anything under it, one-sided and on purpose.
 * A constant below the anchor's measured ratio admits a step whose captions are
 * over the ceiling, which is exactly the 1.17 bug this replaced.
 *
 * The five ratios in the table above centre on 1.2604 and tempt you under that
 * floor. They are a DIFFERENT synthesis of the same text: edge-tts does not
 * repeat itself, and the `+0%` re-run came back at 1.2467 where the artifact in
 * `demo/audio` sits at 1.2784. The shipped artifact wins — it is the deck that
 * actually exists. So the honest range is [1.2784, 1.2945], the second number
 * being the highest ratio the re-run saw, and 1.30 clears both.
 *
 * The 60-second sentence is therefore not bought back by tuning this. It is
 * bought with seconds or with slides, which is what the rest of this file has
 * said all along, and 90s plans 102.
 *
 * `test/duration.test.ts` pins the `+0%` end against the artifact.
 */
export const CUE_OVERHEAD = 1.3;

/** Broadcast subtitle practice. Past this the captions stop being readable. */
export const COMFORTABLE_CPS = 17;

/** How far playback may be sped up before the captions are the problem. */
export const MAX_PLAYBACK = 1.25;

/**
 * How many of a beat's stops may speak, by narration density.
 *
 * `high` is today's behaviour — one sentence per reveal, every stop narrated.
 * The lower two lean on `planSegments`'s existing rule: given fewer sentences
 * than stops it fills the early ones and leaves the rest SILENT, deliberately,
 * rather than inventing copy to fill a reveal.
 */
export const SPEAKING_STOPS: Record<Prefs["narration"]["density"], number> = {
  high: Number.POSITIVE_INFINITY,
  medium: 2,
  low: 1,
};

/**
 * What edge-tts's `--rate` actually buys, MEASURED — not what it says it buys.
 *
 * Synthesised on `en-US-AndrewMultilingualNeural` over a 72-character demo
 * sentence, which speaks in 4.416s at `+0%` (16.30 cps, within 1% of the
 * `SPEECH_CPS.latin` measured across the whole narrated demo):
 *
 * ```
 *   rate    seconds   chars/sec   speedup   p95 cue cps
 *   +0%       4.416       16.30     1.000          16.7
 *   +10%      3.720       19.35     1.187          19.9
 *   +20%      3.528       20.41     1.252          21.0
 *   +30%      3.168       22.73     1.394          23.6
 *   +40%      2.880       25.00     1.533          26.0
 *   +50%      2.904       24.79     1.521          25.7   <- SLOWER than +40%
 *   +60%      2.640       27.27     1.673          28.5
 * ```
 *
 * TWO THINGS THIS TABLE EXISTS TO SAY. The nominal percentage overshoots — the
 * first 10% buys 19% — so a linear model would under-speak every deck. And the
 * curve is not monotonic: `+50%` came back slower than `+40%`, so the prosody
 * rate is not a clean multiplier and interpolating between these points would be
 * inventing data. A table of what was observed is the honest shape.
 *
 * WHY IT STOPS AT +40%. The subtitle, not the ear. At `+40%` the p95 cue rate is
 * 26.0 cps, already half again over the `COMFORTABLE_CPS` broadcast practice; at
 * `+60%` it is 28.5 and the caption is gone before it is read. `+50%` is
 * excluded for measuring slower than the step below it.
 *
 * THE SPEEDUPS BELOW ARE NOT FROM THAT TABLE. They were, and they were too high
 * at every step. The table above times ONE 72-character sentence, and a short
 * sentence carries proportionally more silence at its ends, so dividing its
 * total duration overstates what the prosody rate does to speech itself.
 * Re-measured over the anchor deck's 37 segments and 196 seconds:
 *
 * ```
 *   step    was      is    from
 *   +10%  1.187   1.086    meanCps 15.752 / 14.509
 *   +20%  1.252   1.182    meanCps 17.148 / 14.509
 *   +30%  1.394   1.278    meanCps 18.540 / 14.509
 *   +40%  1.533   1.393    meanCps 20.205 / 14.509
 * ```
 *
 * `CUE_OVERHEAD` rose from 1.28 to 1.30 in the same commit and for this reason:
 * it was below the cue ratio measured at `+10%` and only safe because these
 * numbers were inflated by more. Neither is a safe edit alone — see the
 * paragraph there. One run of `scripts/measure-cue-rate.mjs` produces both.
 *
 * THE TABLE ABOVE STILL EARNS ITS PLACE, because it is the only measurement of
 * `+50%` and `+60%` anyone has taken, and what it says about them is why this
 * list stops at `+40%`. The re-measurement covered these five steps only.
 *
 * Latin-measured. A CJK deck gets the same steps, which is a guess of the same
 * kind `SPEECH_CPS.cjk` already is — replace it the first time one is narrated.
 */
export const RATE_STEPS: readonly (readonly [rate: string, speedup: number])[] = [
  ["+0%", 1.0],
  ["+10%", 1.086],
  ["+20%", 1.182],
  ["+30%", 1.278],
  ["+40%", 1.393],
];

export interface DurationPlan {
  /** Effective `animationSpeed`. Derived when `duration` is set, else the pref. */
  speed: number;
  /** Stops per beat allowed to speak. `Infinity` means every one. */
  speakingStops: number;
  /**
   * edge-tts `--rate` for the narration. Derived when `duration` is set — a
   * short target buys its words by speaking faster before it buys them by
   * saying less. `"+0%"` whenever the budget already affords a real sentence.
   */
  rate: string;
  /**
   * Sentences this beat's budget affords. 1 means the deck can only caption; see
   * `SENTENCES_PER_BEAT`. Absent when no duration was asked for.
   */
  sentences?: number;
  /** Characters per narration sentence. Absent when no duration was asked for. */
  chars?: number;
  /** Seconds of speech one beat can afford. Absent without a target. */
  speechSeconds?: number;
  /**
   * The per-beat length the target implies, at the count the plan was struck at.
   * Absent without a target.
   *
   * A BUDGET, NOT THE ANSWER, and the name collides with the thing that IS the
   * answer. `beatSeconds` in src/emit/composition.ts — `max(authored·speed,
   * lastHold + SETTLE, speechEnd + SETTLE)` — is what actually sizes a scene,
   * and it never sees this number. `speed` is the only value this file sends
   * into the emitted timeline; everything else here is advice to the planner.
   */
  beatSeconds?: number;
  /** Said, never fatal: what the target costs, or cannot buy. */
  warnings: string[];
}

/**
 * The two derived numbers, from the three the user chose.
 *
 * `duration` unset returns the preferences untouched — `speed` is whatever
 * `animationSpeed` says and there is no character budget — so a deck built
 * without a target is byte-for-byte the deck this file did not exist for.
 *
 * `duration` set OVERRIDES `animationSpeed`: the target owns the pace, because
 * the two cannot both be honoured and the target is the one the user stated a
 * number for. Said in a warning rather than silently.
 *
 * `beats` is the count the budget is struck at, and it defaults to the count
 * that was asked for. Pass the storyboard's own `beats.length` wherever one is
 * in hand — see the header for why, and for the two callers that structurally
 * cannot. The default is not a convenience: it is the right answer for those
 * two, and it is what keeps a run where the planner hit its number identical.
 */
export function durationPlan(prefs: Prefs, beats: number = prefs.slides): DurationPlan {
  const speakingStops = SPEAKING_STOPS[prefs.narration.density];
  if (prefs.duration === undefined) {
    return {
      speed: prefs.animationSpeed,
      speakingStops,
      rate: prefs.narration.rate,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  if (prefs.animationSpeed !== 1) {
    warnings.push(
      `duration ${prefs.duration}s sets the pace, so the requested ${prefs.animationSpeed}× animation speed was ignored`,
    );
  }

  // The divisor is stops, not beats — and at low density the two are the same
  // number, which is the point.
  const stops = Math.min(speakingStops, STOPS_PER_BEAT);
  const cps = charsPerSecond(prefs.lang);
  const slow = budget(prefs.duration, beats, stops, cps);
  const { beatSeconds, speed, speechSeconds } = slow;

  // HOW THE ADVISORIES NAME THE COUNT THEY WERE STRUCK AT. It is the count the
  // deck ACTUALLY has, so quoting the requested one would price a deck nobody is
  // building. When the two differ the request is named alongside it, because
  // "60s over 8 slides" read off a run that asked for twelve is a sentence the
  // author will spend ten minutes disbelieving. Naming the shortfall as a
  // shortfall is `scanBeatCount`'s job, not this one's.
  const over =
    beats === prefs.slides
      ? `${beats} slides`
      : `the ${beats} slides the plan came back with (${prefs.slides} were asked for)`;

  // SPEAK FASTER BEFORE SAYING LESS. The seconds a beat can spend on speech are
  // fixed by the target; how many WORDS fit in them is not. So the smallest rate
  // step that lifts the sentence to something that explains is taken first, and
  // only what speed cannot buy is charged to the word count. Smallest, not
  // fastest — a deck whose budget already affords a real sentence is spoken at
  // `+0%` and comes out byte-for-byte as before.
  const [rate, speedup] = fastEnough(slow.chars, cps, slow.beatSeconds);
  const chars = Math.round(slow.chars * speedup);

  if (prefs.narration.rate !== "+0%" && rate !== prefs.narration.rate) {
    // Same treatment, and for the same reason, as `animationSpeed` above: the
    // target is the number the user stated, so it owns the pace. Said, not
    // silent.
    warnings.push(
      `duration ${prefs.duration}s sets the speaking rate, so the requested ${prefs.narration.rate} narration rate was ignored`,
    );
  }
  if (speedup > 1) {
    // THE CUE RATE, not the spoken one. This quoted `cps * speedup` — what the
    // VOICE does — under the word "subtitles", and a cue spans the words without
    // the breath around them, so it always reads faster. At `+10%` that is 17
    // reported against a caption that runs at 22: exactly at the broadcast bar by
    // the number printed, 29% over it in the artifact. Same `CUE_OVERHEAD` that
    // chooses the rate two lines up, so the sentence and the choice cannot
    // disagree.
    const cue = cps * speedup * CUE_OVERHEAD;
    warnings.push(
      `narration speaks at ${rate} to fit ${chars} characters a slide into ${speechSeconds.toFixed(1)}s — ${slow.chars} at normal speed. Subtitles run near ${cue.toFixed(0)} characters per second against the ${COMFORTABLE_CPS} cps broadcast practice, which is the cost of the extra words.`,
    );
  }

  // How many sentences this beat's budget buys, which is what decides whether the
  // narration can be a paragraph or only a label.
  //
  // THE BEAT'S budget, not one stop's. `chars` is divided by `stops`, so at
  // `medium` it is half the beat and at `high` a third — reading it as the beat's
  // total said a 60-second medium deck could not reach two sentences at ANY slide
  // count, which is false and made the advisory tell the author nothing.
  //
  // FLOOR, not round: a beat with 1.9 sentences' worth of room gets one sentence
  // and the slack, never a second one it has to clip.
  const beatChars = Math.round(speechSeconds * cps * speedup);
  const sentences = Math.max(1, Math.floor(beatChars / explainingChars(cps)));

  if (chars < MIN_SENTENCE_CHARS) {
    warnings.push(
      `${prefs.duration}s over ${over} at ${prefs.narration.density} narration density leaves ${chars} characters per sentence, which is a fragment, not narration. Lower the density, cut the slide count, or raise the target.`,
    );
  } else if (sentences < SENTENCES_PER_BEAT && beatSeconds > FF_BEAT_SECONDS) {
    // THE FINDING THE OWNER RAISED, in the units that cause it. A beat with room
    // for one sentence gets a caption, whoever writes it — the hand-written demo
    // reduced to one sentence a beat reads exactly like the deck he rejected.
    //
    // NAME THE SLIDE COUNT, not "use fewer slides". A specific alternative
    // changes a plan; a nudge does not — the same lesson `INSTEAD` in
    // src/verify/index.ts records. Searched rather than solved because `speed`
    // clamps at both ends and a closed form would be wrong exactly where the
    // clamp bites.
    const affords = (n: number) => {
      const b = budget(prefs.duration as number, n, stops, cps);
      const [, faster] = fastEnough(b.chars, cps, b.beatSeconds);
      return Math.floor(Math.round(b.speechSeconds * cps * faster) / explainingChars(cps));
    };
    let roomier = 0;
    for (let n = beats - 1; n >= 3; n--) {
      if (affords(n) >= SENTENCES_PER_BEAT) {
        roomier = n;
        break;
      }
    }
    // What target keeps every slide AND buys the second sentence: the per-beat
    // seconds have to cover the quiet plus two sentences of speech.
    const longer =
      Math.ceil(
        ((beats *
          (OPEN_SECONDS_AT_SPEED * speed +
            SETTLE_SECONDS +
            (SENTENCES_PER_BEAT * explainingChars(cps)) / (cps * speedup))) /
          10) *
          1.0,
      ) * 10;
    const advice = roomier
      ? `${roomier} slides at the same target gives each one ${affords(roomier)} sentences, or keep all ${beats} and raise the target to about ${longer}s.`
      : `no slide count at this target reaches two — raise the duration.`;
    warnings.push(
      `${prefs.duration}s over ${over} leaves ${beatChars} characters a slide, which is one sentence. A single sentence per slide cannot carry a story — the hand-written demo cut to one sentence a beat reads as captions too — so the deck will narrate slide by slide instead of explaining the paper: ${advice}`,
    );
  }
  if (speed === 0.25) {
    warnings.push(
      `the animation is at its 4× floor to fit ${beatSeconds.toFixed(1)}s per slide; reveals will be abrupt`,
    );
  }

  return {
    speed,
    speakingStops,
    rate,
    sentences,
    chars: Math.max(MIN_SENTENCE_CHARS, chars),
    speechSeconds: round3(speechSeconds),
    beatSeconds: round3(beatSeconds),
    warnings,
  };
}

/**
 * How many slides a target should have, by TEMPO.
 *
 * WHAT THIS REPLACED, and why it was wrong. It used to return the most slides a
 * target could carry while every beat still afforded two sentences, which gave
 * FIVE slides for a minute. The owner, watching it: "in auto mode the number of
 * slides is too conservative when it's 1 minute... in their fast-forward
 * presentation they never use stupidly small number of slides."
 *
 * He is describing the conference fast-forward talk — the one-minute teaser an
 * author gives before the session — and that is the right reference for a short
 * target. Those run ten to fifteen slides in sixty seconds, about five seconds
 * each, with the voice carrying straight over the cuts. The two-sentence floor
 * was derived from `demo/storyboard.json`, which is a FOUR-MINUTE deck at twenty
 * seconds a beat, and applying its shape to a teaser is what produced five
 * slides and 133 words per minute against a fast-forward talk's 160-190.
 *
 * So the anchor is the beat LENGTH, and the two references agree on twelve
 * slides: a fast-forward talk is 12 beats in 60s, the demo is 12 beats in 246s.
 * What changes with duration is how long each beat lasts, not how many there
 * are — until the beat would run past twenty seconds, where a deck stops being
 * one thought a slide and starts being a lecture.
 *
 *     30s ->  8    120s -> 12    600s -> 30
 *     60s -> 12    300s -> 15
 *
 * This is the DEFAULT, never an override. `slides` is one of the three knobs the
 * owner asked to hold — "user can give you the number of slides they want in the
 * video with duration of their choice" — so an explicit count is obeyed.
 */
export function slidesFor(prefs: Prefs): number {
  if (prefs.duration === undefined) return prefs.slides;
  const beat = clamp(prefs.duration / 12, MIN_BEAT_SECONDS, 20);
  return Math.round(clamp(prefs.duration / beat, 3, 40));
}

/**
 * How fast this deck speaks.
 *
 * TWO REGIMES, and which one applies is decided by the beat length.
 *
 * A LECTURE (`beatSeconds` over `FF_BEAT_SECONDS`) takes the SLOWEST step that
 * lifts a sentence to something which explains — speech is sped up only as far as
 * the shortfall needs, so a target with room to spare is spoken at `+0%` and its
 * deck does not move a byte.
 *
 * A FAST-FORWARD TALK takes the FASTEST step the captions can carry. Below eight
 * seconds a beat there is no such thing as spare room: every second not carrying
 * a word is information the viewer does not get, and the owner's whole complaint
 * — "you must utilize every single second" — is that this function was being
 * thrifty with seconds nobody wanted saved. The ceiling is `SHORT_FORM_CPS`
 * against the DECK'S OWN measured cue rate, not a constant, because how fast a
 * caption can run depends on how densely this deck happens to be written.
 *
 * Measured on the sixty-second target: the slow rule gave `+10%` and 133 words a
 * minute; the fast rule gives `+30%` and 180, which is conference teaser pace.
 */
export function fastEnough(
  chars: number,
  cps: number = SPEECH_CPS.latin,
  beatSeconds?: number,
): readonly [rate: string, speedup: number] {
  const last = RATE_STEPS[RATE_STEPS.length - 1] as readonly [string, number];
  if (beatSeconds !== undefined && beatSeconds <= FF_BEAT_SECONDS) {
    // Fastest whose captions still read. `cps * speedup` is the spoken rate, and
    // the cue rate tracks it within a few percent — measured across RATE_STEPS.
    const steps = [...RATE_STEPS].reverse();
    return (
      steps.find(([, s]) => cps * s * CUE_OVERHEAD <= SHORT_FORM_CPS) ??
      (RATE_STEPS[0] as typeof last)
    );
  }
  const bar = explainingChars(cps);
  return RATE_STEPS.find(([, speedup]) => chars * speedup >= bar) ?? last;
}

/**
 * `EXPLAINING_CHARS` in the script the deck is written in.
 *
 * The constant is measured on the demo's ENGLISH sentences, and a Hangul or
 * kana character carries several times what a Latin one does — which is the
 * whole reason `SPEECH_CPS.cjk` exists. Holding a Korean deck to sixty
 * CHARACTERS would demand a sentence two and a half times as long as the bar it
 * is meant to encode, and every Korean deck would be sped up to chase it. The
 * bar is really a length of SPEECH — about 4.2 seconds of it — so it converts
 * through the same cps the budget already uses.
 */
function explainingChars(cps: number): number {
  return (EXPLAINING_CHARS * cps) / SPEECH_CPS.latin;
}

/**
 * What the finished video must be sped up by to hit its target.
 *
 * Returns 1 when it is already at or under the target — a video is never
 * SLOWED to fill a duration, because padding a deck with dead air is worse than
 * a deck that is 8 seconds short.
 */
export function playbackFactor(actualSeconds: number, targetSeconds: number): number {
  if (!(actualSeconds > 0) || !(targetSeconds > 0)) return 1;
  return Math.max(1, round3(actualSeconds / targetSeconds));
}

/**
 * `atempo` is clamped to [0.5, 2.0] per instance, so anything past 2× is a
 * chain of equal factors whose product is the whole. Two at 1.7 make 2.89.
 */
export function tempoChain(factor: number): number[] {
  if (factor <= 1) return [];
  const n = Math.max(1, Math.ceil(Math.log2(factor)));
  return Array.from({ length: n }, () => round3(factor ** (1 / n)));
}

/**
 * The 95th percentile of characters per second across a deck's subtitle cues.
 *
 * The p95 rather than the mean, and the deck's OWN cues rather than a constant:
 * how much faster a video can safely play is a property of how densely this deck
 * happens to be written, and the worst few cues are what a viewer notices. The
 * demo measures 18.41 — already over broadcast practice, so it has no headroom
 * at all, which is a fact worth telling someone before they ask for 1.5×.
 */
export function p95CueRate(cues: readonly { start: number; end: number; text: string }[]): number {
  const rates: number[] = [];
  for (const cue of cues) {
    const span = cue.end - cue.start;
    if (span > 0 && cue.text.length > 0) rates.push(cue.text.length / span);
  }
  if (!rates.length) return 0;
  rates.sort((a, b) => a - b);
  return round3(rates[Math.min(rates.length - 1, Math.floor(0.95 * rates.length))] as number);
}

/**
 * What is wrong with speeding this deck up this much — everything that is.
 *
 * TWO CEILINGS, AND THEY ARE NOT THE SAME KIND OF THING. The caption one is
 * computed from the deck's MEASURED p95 cue rate against broadcast practice
 * rather than from a constant: a deck whose captions already run at 18 cps has
 * no headroom at all, one written in short lines has plenty. That one stays
 * pure advice — how readable a caption has to be is the user's call, and they
 * can only make it if they are told the number. `MAX_PLAYBACK` is the other,
 * and `playbackRefusal` below turns it into a refusal, because time-stretched
 * audio is not a matter of taste.
 *
 * BOTH CLAUSES, NOT THE FIRST ONE. This used to `return` out of the caption
 * branch, which meant a dense deck — every deck this tool plans is dense, by
 * construction — could only ever be told about the ceiling that is advisory,
 * and never about the one that is enforced. The measured shape: 2.14× on a
 * 19.6 cps deck printed "readable captions cap out near 0.87×" and suppressed
 * "past the 1.25× that reads comfortably", so the only line naming an
 * enforceable limit was the one the user did not get.
 */
export function playbackWarning(factor: number, p95: number): string | undefined {
  if (factor <= 1) return undefined;
  const parts: string[] = [];
  if (p95 > 0 && p95 * factor > COMFORTABLE_CPS) {
    parts.push(
      `at ${factor}× the subtitles run at ${(p95 * factor).toFixed(1)} characters per second (p95), over the ${COMFORTABLE_CPS} cps broadcast practice — readable captions cap out near ${(COMFORTABLE_CPS / p95).toFixed(2)}× on this deck`,
    );
  }
  if (factor > MAX_PLAYBACK) {
    parts.push(
      `${factor}× is past the ${MAX_PLAYBACK}× that reads comfortably; the audio is time-stretched, not re-spoken`,
    );
  }
  // `, and ` rather than `; `: the playback clause already carries a semicolon
  // of its own, and joining on one more put three at the same rank in a sentence
  // where two of them are subordinate.
  return parts.length > 0 ? parts.join(", and ") : undefined;
}

/**
 * Why this target cannot be reached from this deck, when it cannot.
 *
 * `MAX_PLAYBACK` IS THE ONE THAT CAN BE ENFORCED. The caption ceiling cannot
 * be, and the arithmetic is not close: `COMFORTABLE_CPS / DEMO_P95_CUE_CPS` is
 * 17/18.409 = 0.92 on this project's own anchor deck, so a caption-derived
 * limit is already breached at 1× and would refuse every speed-up there is —
 * `--duration` would be dead on arrival. Every deck DeckSmith plans is denser
 * than 17 cps by construction; see `CUE_OVERHEAD`. So the captions warn and
 * the playback factor refuses, and `test/duration.test.ts` pins the reason.
 *
 * REFUSING IS NOT NEW POLICY, it is the policy the planner already keeps.
 * `durationPlan` sizes a deck so the residual gap fits inside `MAX_PLAYBACK`,
 * and `test/duration.test.ts` asserts exactly that at 60s, 120s, 180s and
 * 240s. A 2.14× request is not a tight fit that slipped — it is 71% past a
 * bound the rest of the file treats as arithmetic. What was shipping instead
 * was a video nobody could follow, announced by a mid-render log line that 40
 * lines of capture progress scrolled away.
 *
 * Both remedies are named because the honest one is not the flag: the length
 * of a deck is decided at plan time by how much it says, so the fix is fewer
 * words or more seconds, and `--allow-fast-playback` is for the person who has
 * looked at the alternative and wants the fast video anyway.
 */
export function playbackRefusal(
  actualSeconds: number,
  targetSeconds: number,
  p95: number,
): string | undefined {
  const factor = playbackFactor(actualSeconds, targetSeconds);
  if (factor <= MAX_PLAYBACK) return undefined;
  const floor = Math.ceil(actualSeconds / MAX_PLAYBACK);
  const captions =
    p95 > 0
      ? `at ${factor}× the subtitles run at ${(p95 * factor).toFixed(1)} cps against the ${COMFORTABLE_CPS} cps broadcast practice, and the audio is time-stretched rather than re-spoken`
      : "the audio is time-stretched rather than re-spoken";
  return `--duration ${targetSeconds}s needs ${factor}× playback from this ${actualSeconds.toFixed(2)}s deck, past the ${MAX_PLAYBACK}× ceiling. The length of a deck is decided at plan time by how much it says: re-plan with \`plan --duration ${targetSeconds}\`, or ask render for ${floor}s or more. To override, pass --allow-fast-playback and watch the result: ${captions}.`;
}

/* ------------------------------------------------------------------ internals */

/**
 * The whole budget for one (duration, slide count), so the advisory can price a
 * slide count the user did not ask for using the same arithmetic that priced
 * the one they did.
 *
 * `speed` is ROUNDED HERE, before the speech budget is taken off it, because the
 * emitter is given the rounded number — deriving the budget from the exact one
 * would leave `speed` and `speechSeconds` describing two slightly different
 * decks. Fast enough that the reveals finish inside their share of the beat,
 * never faster than the schema's floor, never slower than authored.
 */
function budget(duration: number, slides: number, stops: number, cps: number) {
  const beatSeconds = duration / slides;
  const speed = round3(clamp((MOTION_SHARE * beatSeconds) / LAST_HOLD_SECONDS, 0.25, 1));
  // SPEECH AND MOTION OVERLAP, so the beat does not pay for both. It used to:
  // `beatSeconds - lastHold * speed` reserved the whole build before a word was
  // spoken, which is the arithmetic behind the 49%-silent video. The voice now
  // starts when the headline lands and runs to a settle at the end, so what it
  // cannot have is only those two — see `openSeconds` and `SETTLE_SECONDS` in
  // src/emit/composition.ts, whose sum at the speeds a short target derives is
  // about 0.75s against the 1.75s the old term took.
  const quiet = OPEN_SECONDS_AT_SPEED * speed + SETTLE_SECONDS;
  const speechSeconds = Math.max(0, beatSeconds - quiet);
  return { beatSeconds, speed, speechSeconds, chars: Math.round((speechSeconds * cps) / stops) };
}

/** CJK writes far more meaning per character, so it is read out far slower. */
function charsPerSecond(lang: string): number {
  return /^(zh|ja|ko|yue)\b/i.test(lang) ? SPEECH_CPS.cjk : SPEECH_CPS.latin;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Invariant 10: three decimals, so float drift never moves a byte. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
