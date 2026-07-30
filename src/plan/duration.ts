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
 * Latin-measured. A CJK deck gets the same steps, which is a guess of the same
 * kind `SPEECH_CPS.cjk` already is — replace it the first time one is narrated.
 */
export const RATE_STEPS: readonly (readonly [rate: string, speedup: number])[] = [
  ["+0%", 1.0],
  ["+10%", 1.187],
  ["+20%", 1.252],
  ["+30%", 1.394],
  ["+40%", 1.533],
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
  /** Characters per narration sentence. Absent when no duration was asked for. */
  chars?: number;
  /** Seconds of speech one beat can afford. Absent without a target. */
  speechSeconds?: number;
  /** The per-beat length the target implies. Absent without a target. */
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
 */
export function durationPlan(prefs: Prefs): DurationPlan {
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
  const slow = budget(prefs.duration, prefs.slides, stops, cps);
  const { beatSeconds, speed, speechSeconds } = slow;

  // SPEAK FASTER BEFORE SAYING LESS. The seconds a beat can spend on speech are
  // fixed by the target; how many WORDS fit in them is not. So the smallest rate
  // step that lifts the sentence to something that explains is taken first, and
  // only what speed cannot buy is charged to the word count. Smallest, not
  // fastest — a deck whose budget already affords a real sentence is spoken at
  // `+0%` and comes out byte-for-byte as before.
  const [rate, speedup] = fastEnough(slow.chars, cps);
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
    warnings.push(
      `narration speaks at ${rate} to fit ${chars} characters a slide into ${speechSeconds.toFixed(1)}s — ${slow.chars} at normal speed. Subtitles run near ${(cps * speedup).toFixed(0)} characters per second against the ${COMFORTABLE_CPS} cps broadcast practice, which is the cost of the extra words.`,
    );
  }

  if (chars < MIN_SENTENCE_CHARS) {
    warnings.push(
      `${prefs.duration}s over ${prefs.slides} slides at ${prefs.narration.density} narration density leaves ${chars} characters per sentence, which is a fragment, not narration. Lower the density, cut the slide count, or raise the target.`,
    );
  } else if (chars < explainingChars(cps)) {
    // NAME THE SLIDE COUNT, not "use fewer slides". The whole value of this
    // finding is the number the author would otherwise have to derive, and the
    // same lesson `INSTEAD` in src/verify/index.ts records: a specific
    // alternative changes a plan, a nudge does not. Searched rather than solved
    // because `speed` clamps at both ends and a closed form would be wrong
    // exactly where the clamp bites. Only reached once the rate is already at
    // its ceiling, so it is what SPEED COULD NOT BUY, not the first resort.
    let roomier = 0;
    for (let n = prefs.slides - 1; n >= 3; n--) {
      const [, faster] = fastEnough(budget(prefs.duration, n, stops, cps).chars, cps);
      if (budget(prefs.duration, n, stops, cps).chars * faster >= EXPLAINING_CHARS) {
        roomier = n;
        break;
      }
    }
    const advice = roomier
      ? `${roomier} slides at the same target would buy ${Math.round(budget(prefs.duration, roomier, stops, cps).chars * fastEnough(budget(prefs.duration, roomier, stops, cps).chars, cps)[1])}, or keep all ${prefs.slides} and raise the target to ${Math.ceil((prefs.slides * EXPLAINING_CHARS) / (chars / beatSeconds) / 10) * 10}s.`
      : `no slide count at this target reaches ${EXPLAINING_CHARS} — raise the duration.`;
    warnings.push(
      `even at ${rate}, ${prefs.duration}s over ${prefs.slides} slides leaves ${chars} characters a slide, about ${Math.round(chars / 5.5)} words. The shipped demo averages 72. Each slide will caption rather than explain: ${advice}`,
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
    chars: Math.max(MIN_SENTENCE_CHARS, chars),
    speechSeconds: round3(speechSeconds),
    beatSeconds: round3(beatSeconds),
    warnings,
  };
}

/**
 * The slowest rate that lifts `chars` to a sentence which explains something.
 *
 * SLOWEST, not fastest: speech is sped up only as far as the shortfall needs, so
 * a target that already affords a real sentence is spoken at `+0%` and its deck
 * does not move a byte. Falls back to the last step when even that cannot reach
 * the bar — the extra words are still worth having, and the caller then says
 * what speed could not buy.
 */
export function fastEnough(
  chars: number,
  cps: number = SPEECH_CPS.latin,
): readonly [rate: string, speedup: number] {
  const bar = explainingChars(cps);
  const enough = RATE_STEPS.find(([, speedup]) => chars * speedup >= bar);
  return enough ?? (RATE_STEPS[RATE_STEPS.length - 1] as readonly [string, number]);
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
 * Whether this deck's own captions survive being sped up this much.
 *
 * Computed from the deck's MEASURED p95 cue rate against broadcast practice, not
 * from a hardcoded ceiling: a deck whose captions already run at 18 cps has no
 * headroom at all, and one written in short lines has plenty. Warns, never
 * refuses — how readable a caption has to be is the user's call, and they can
 * only make it if they are told the number.
 */
export function playbackWarning(factor: number, p95: number): string | undefined {
  if (factor <= 1) return undefined;
  if (p95 > 0 && p95 * factor > COMFORTABLE_CPS) {
    return `at ${factor}× the subtitles run at ${(p95 * factor).toFixed(1)} characters per second (p95), over the ${COMFORTABLE_CPS} cps broadcast practice — readable captions cap out near ${(COMFORTABLE_CPS / p95).toFixed(2)}× on this deck`;
  }
  if (factor > MAX_PLAYBACK) {
    return `${factor}× is past the ${MAX_PLAYBACK}× that reads comfortably; the audio is time-stretched, not re-spoken`;
  }
  return undefined;
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
