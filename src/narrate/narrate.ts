/**
 * Storyboard plus preferences, spoken.
 *
 * The unit of narration is the STOP, not the beat. A beat's stops are where a
 * presenter pauses — its landing, then each reveal the emitter recorded a hold
 * for — and giving each one its own audio file is what lets the deck advance on
 * speech rather than on a number somebody guessed into `beat.seconds`. Arrive at
 * a stop, play its segment, step when it ends.
 *
 * Which means the stop count is not ours to decide: it belongs to the emitter
 * that draws the scene. So this asks — it calls `emitScene` and counts the holds
 * exactly the way `buildStops` will at playback — rather than assuming a beat has
 * as many stops as it has sentences, which would silently desynchronise every
 * archetype whose reveal count depends on its params.
 */
import type { z } from "zod";
import { emitScene } from "../emit/archetypes/index.js";
import type { EmitContext, Theme } from "../emit/kit.js";
import { deckLook, ink } from "../emit/theme.js";
import { durationPlan } from "../plan/duration.js";
import type { Source, Storyboard } from "../types.js";
import {
  type Beat,
  FORMATS,
  type Format,
  type NarrationCanvas,
  type prefsSchema,
  type segmentSchema,
} from "../types.js";
import { type Runner, synthesize } from "./tts.js";
import { pickVoice } from "./voices.js";

type Prefs = z.infer<typeof prefsSchema>;
type Segment = z.infer<typeof segmentSchema>;
type Narration = {
  voice: string;
  canvas: NarrationCanvas;
  stops: Record<string, number>;
  speakingStops?: number;
  beats: Record<string, Segment[]>;
};

/* ------------------------------------------------------------------- Stops */

/**
 * How many stops a beat has.
 *
 * Mirrors `buildStops`: the holds are deduplicated, a hold at the scene's own
 * start is dropped (seeking there shows the frame before the entrance, i.e.
 * nothing), the first survivor is the landing and the rest are steps. A scene
 * with no holds at all is one stop — the slide itself.
 */
export function stopCount(holds: readonly number[]): number {
  const usable = new Set(holds.filter((h) => Number.isFinite(h) && h > 0));
  return Math.max(1, usable.size);
}

/**
 * Ask the emitter how the beat is staged. Cheap: emitters build strings.
 *
 * A beat the emitter REFUSES answers one stop rather than throwing. Narration
 * runs before the build and is not the stage that gets to decide a deck is dead:
 * `planCut` emits every beat again and drops the refused ones through
 * `onBeatError`, which is where a missing slide is reported and where a caller
 * without that hook still gets the error. Throwing here instead killed the whole
 * job one stage early, with the hook the caller had passed never reached.
 *
 * `theme` must be the one the build stages with, `deckLook(storyboard).theme`,
 * which is what `narrate` passes: the font face it names decides whether a beat
 * fits. The `ink` default is for a caller that has no storyboard and no
 * CJK-language beat.
 */
export function stopsFor(
  beat: Beat,
  source: Source,
  format: Format,
  sid = "s1",
  theme: Theme = ink,
): number {
  // `start: 0` because this counts STOPS and throws the scene away — the clock
  // a clip would be seeked on is not consulted and not published.
  const ctx: EmitContext = { source, format, theme, sid, start: 0 };
  try {
    return stopCount(emitScene(beat, ctx).holds);
  } catch {
    return 1;
  }
}

/* --------------------------------------------------------------- Sentences */

/**
 * Split narration into sentences.
 *
 * The Latin terminators need whitespace or the end after them, so "0.5" and a
 * trailing "et al." mid-clause stay whole; the CJK ones do not, because Chinese
 * and Japanese put no space after 。 and a rule that waited for one would never
 * split at all. Abbreviations like "e.g. " will still split — the cost is one
 * clause landing on the wrong stop, which is a beat of drift, not a broken deck.
 */
export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  const re = /[。！？]+|[.!?…]+(?=\s|$)/gu;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    const s = text.slice(at, end).trim();
    if (s) parts.push(s);
    at = end;
  }
  const tail = text.slice(at).trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * Lay sentences over stops, one each, in order.
 *
 * Two mismatches, two rules. Fewer sentences than stops: hand out what there is
 * and leave the later stops SILENT — a deck that invents a sentence to fill a
 * reveal is a deck that says something the author did not. More sentences than
 * stops: the surplus joins the last one, so the tail is spoken over the beat's
 * final state instead of being dropped.
 *
 * Returns one entry per stop; `""` means nothing is said there.
 */
export function planSegments(text: string, stops: number): string[] {
  const n = Math.max(1, stops);
  const out = new Array<string>(n).fill("");
  const sentences = splitSentences(text);
  for (let i = 0; i < Math.min(sentences.length, n - 1); i++) out[i] = sentences[i] as string;
  out[n - 1] = sentences.slice(n - 1).join(" ");
  return out;
}

/**
 * How many stops `planSegments` gives words to, for a beat staged with `stops`
 * stops under a density cap of `cap`.
 *
 * Two stagings that answer the same number split `text` identically, sentence
 * for sentence and stop for stop: the first n-1 speaking stops get one sentence
 * each and the last gets the rest. So this, not the raw stop count, is what has
 * to agree between `narrate` and a build. A beat with three sentences reads the
 * same over four stops as over five; the extra stop is silent either way.
 */
export function speakingStopCount(
  text: string,
  stops: number,
  cap = Number.POSITIVE_INFINITY,
): number {
  return Math.min(Math.max(1, Math.min(stops, cap)), splitSentences(text).length);
}

/* --------------------------------------------------------------- Narration */

export interface NarrateOpts {
  /** Directory the audio is written into. Returned paths are relative to it. */
  dir: string;
  /** Injected in tests so no test reaches the network. */
  runner?: Runner;
  /**
   * Staging differs by canvas, so the stop count does too. Recorded in the
   * result as `canvas`, which is what lets `build` refuse another one.
   */
  format?: Format;
}

/**
 * Narrate every beat that has something to say.
 *
 * Beats below a format's `minWeight` are narrated too: narration is stored in
 * the pack, one storyboard renders as several formats, and re-synthesising the
 * same sentence because a short dropped it is the one cost the cache exists to
 * avoid. A beat with no `narration` text produces no segments at all rather than
 * an empty array, so `Object.keys(narration.beats)` is the list of beats that
 * actually speak.
 */
export async function narrate(
  storyboard: Storyboard,
  source: Source,
  prefs: Prefs,
  opts: NarrateOpts,
): Promise<Narration> {
  const voice = pickVoice(prefs);
  const format = opts.format ?? (FORMATS["deck-16x9"] as Format);
  // ONE SOURCE FOR THE DERIVED KNOBS. `rate` and the speaking-stop cap are both
  // functions of the duration target, and reading one from `durationPlan` while
  // looking the other up directly is how they drift apart. Without a target this
  // returns the preferences untouched, so an untargeted deck is unchanged.
  //
  // STRUCK AT THE BEATS IN HAND, the same count `build` uses, because these are
  // the words spoken over the scenes that count paces. A rate derived from the
  // REQUESTED count and an animation speed derived from the returned one is the
  // three-stages-disagree failure `lengthFlags` in src/cli.ts was written for.
  //
  // It is not free: `rate` is part of the TTS cache key (text, voice, rate,
  // pitch), so a plan that came back short re-synthesises every segment — about
  // 25-30s for a twelve-beat deck. Paid once, and only on the runs where the
  // count moved.
  const paced = durationPlan(prefs, storyboard.beats.length);
  const { pitch } = prefs.narration;
  const rate = paced.rate;
  // The build's look, not a default one: the font face decides what fits.
  const { theme } = deckLook(storyboard);
  const beats: Record<string, Segment[]> = {};
  /** Recorded so a build can check its own staging against it. */
  const staged: Record<string, number> = {};

  for (const [i, beat] of storyboard.beats.entries()) {
    const text = beat.narration?.trim();
    if (!text) continue;

    const segments: Segment[] = [];
    // Narration density caps how many stops may SPEAK; the emitter still decides
    // how many there are. Capping here rather than dropping sentences means a
    // planner that wrote four when the density asked for one still has all four
    // words spoken — `planSegments` joins the surplus onto the last speaking stop
    // — so the deck can come out long, but never comes out having silently
    // deleted what the author wrote.
    const count = stopsFor(beat, source, format, `s${i + 1}`, theme);
    const plan = planSegments(text, Math.min(count, paced.speakingStops));
    for (const [stop, line] of plan.entries()) {
      if (!line) continue; // a silent stop holds on the animation alone
      const speech = await synthesize(line, {
        voice,
        rate,
        pitch,
        dir: opts.dir,
        runner: opts.runner,
      });
      segments.push({
        stop,
        text: line,
        // Content-addressed and flat, so the path is the filename and the deck
        // can be moved anywhere its audio directory travels with it.
        audio: speech.file,
        seconds: speech.seconds,
        cues: speech.cues,
      });
    }
    if (segments.length > 0) {
      beats[beat.id] = segments;
      staged[beat.id] = count;
    }
  }

  return {
    voice,
    canvas: narrationCanvas(format),
    stops: staged,
    ...(Number.isFinite(paced.speakingStops) ? { speakingStops: paced.speakingStops } : {}),
    beats,
  };
}

/* ------------------------------------------------- Narration against a build */

/** The part of a narration a build checks, as `narrate` wrote it. */
export interface NarrationStaging {
  canvas?: NarrationCanvas | undefined;
  stops?: Readonly<Record<string, number>> | undefined;
  speakingStops?: number | undefined;
  beats: Readonly<Record<string, readonly { text: string }[]>>;
}

/** What `narrate` records about the format it staged against. */
export function narrationCanvas(format: Format): NarrationCanvas {
  return {
    format: format.id,
    width: format.width,
    height: format.height,
    captionReserve: format.captionReserve ?? 0,
  };
}

function describeCanvas(c: NarrationCanvas): string {
  const size = `${c.width}×${c.height}`;
  const named = c.format in FORMATS ? `${c.format} at ${size}` : size;
  return c.captionReserve > 0 ? `${named} with ${c.captionReserve}px kept for captions` : named;
}

/**
 * The `narrate` flags that stage at this canvas. A custom canvas is named by its
 * size alone: `--width/--height` over the default profile give the same box as
 * over any other.
 */
function canvasFlags(c: NarrationCanvas): string {
  const size =
    c.format in FORMATS ? `--format ${c.format}` : `--width ${c.width} --height ${c.height}`;
  return c.captionReserve > 0 ? `${size} --reserve-captions` : size;
}

/**
 * The warning for narration that records no stop counts, or undefined.
 *
 * ACCEPTED, NOT REFUSED. That is every `narration.json` and every pack written
 * before `narrate` recorded them. Refusing would make each of those decks
 * unbuildable until re-narrated, and a pack carries the mp3s but not the TTS
 * cache sidecars, so for an unpacked deck that is every sentence synthesised
 * again. The cost is that an old file staged differently still builds wrong,
 * and this sentence is the only thing that says it was not checked. The library
 * has no channel for it; the CLI prints it.
 */
export function uncheckedNarration(
  narration: NarrationStaging,
  format: Format,
): string | undefined {
  if (narration.stops) return undefined;
  const built = narrationCanvas(format);
  return (
    `the narration records no stop counts, because it was written before \`narrate\` recorded them, so nothing checks that its sentences were split over the stops this deck stages at ${describeCanvas(built)}. ` +
    `Narration staged differently puts its sentences on the wrong reveals. Re-run \`decksmith narrate\` with ${canvasFlags(built)} to record them.`
  );
}

/**
 * Refuse narration whose sentences were split over stops this build does not
 * stage.
 *
 * `staged` is each beat THIS DECK DRAWS mapped to its stop count here: a beat
 * the build leaves out, by refusal or by budget, speaks nowhere and cannot be
 * wrong. For each one that has segments, the speaking-stop count `narrate` split
 * against is compared with the one this staging gives (`speakingStopCount`).
 *
 * COMPARED PER BEAT, NOT BY CANVAS. The canvas was the first version of this
 * check and it was wrong both ways: it refused `deck-16x9` narration built at
 * `short-9x16`, which stages every drawn demo beat identically, and it passed a
 * Korean deck whose font face made `narrate` and `build` stage one beat
 * differently at the same size. A beat's own stop count is the fact both sides
 * record, so it also catches a params edit that moves the count without
 * changing a word, which `scanNarrationDrift` cannot see.
 *
 * THROWN, NOT REPORTED, for the reason `scanNarrationDrift` is an error: the
 * two sides are recorded facts that must agree, and what gets through is a deck
 * whose voice describes reveals that are not on screen. `place` clamps a stop
 * past the end, `assertFits` skips a clamped one, and `build` printed PASS on
 * the measured case.
 */
export function assertNarrationStaging(
  narration: NarrationStaging,
  staged: ReadonlyMap<string, number>,
  format: Format,
): void {
  const recorded = narration.stops;
  if (!recorded) return;
  const cap = narration.speakingStops ?? Number.POSITIVE_INFINITY;
  const moved: string[] = [];
  for (const [id, here] of staged) {
    const segments = narration.beats[id];
    if (!segments?.length) continue;
    // The words as they were split, not `beat.narration`: this compares how they
    // were laid out, and `scanNarrationDrift` owns whether they are the words.
    const text = segments.map((s) => s.text).join(" ");
    const then = recorded[id];
    if (
      then !== undefined &&
      speakingStopCount(text, then, cap) === speakingStopCount(text, here, cap)
    ) {
      continue;
    }
    const was = then === undefined ? "no stop count recorded" : `narrated over ${then}`;
    moved.push(`${id} (${was}, ${here} here)`);
  }
  if (moved.length === 0) return;

  const built = narrationCanvas(format);
  const was = narration.canvas;
  const sameBox =
    was?.width === built.width &&
    was.height === built.height &&
    was.captionReserve === built.captionReserve;
  const why = !was
    ? ""
    : sameBox
      ? `It was narrated at this same canvas, ${describeCanvas(built)}, so the beats themselves stage differently now: a params edit, or a DeckSmith version that stages them another way. `
      : `It was staged for ${describeCanvas(was)}, and this deck is laid out at ${describeCanvas(built)}, where a beat can reveal a different number of things or not be drawn at all. `;
  throw new Error(
    `The narration splits its sentences over a different number of stops than this deck stages, for ${moved.length} beat(s): ${moved.join(", ")}. ` +
      why +
      `Built like this, those sentences would be spoken over reveals that are not there. ` +
      `Re-run \`decksmith narrate\` with ${canvasFlags(built)}, the canvas this build was given. ` +
      `In the directory the narration was made in, only sentences that now split differently are synthesised again, because audio is cached there by text, voice, rate and pitch. ` +
      `An unpacked .deck carries the audio but not that cache, so there every sentence is synthesised again.`,
  );
}
