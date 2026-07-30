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
import type { EmitContext } from "../emit/kit.js";
import { ink } from "../emit/theme.js";
import { SPEAKING_STOPS } from "../plan/duration.js";
import type { Source, Storyboard } from "../types.js";
import { type Beat, FORMATS, type Format, type prefsSchema, type segmentSchema } from "../types.js";
import { type Runner, synthesize } from "./tts.js";
import { pickVoice } from "./voices.js";

type Prefs = z.infer<typeof prefsSchema>;
type Segment = z.infer<typeof segmentSchema>;
type Narration = { voice: string; beats: Record<string, Segment[]> };

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

/** Ask the emitter how the beat is staged. Cheap: emitters build strings. */
export function stopsFor(beat: Beat, source: Source, format: Format, sid = "s1"): number {
  const ctx: EmitContext = { source, format, theme: ink, sid };
  return stopCount(emitScene(beat, ctx).holds);
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

/* --------------------------------------------------------------- Narration */

export interface NarrateOpts {
  /** Directory the audio is written into. Returned paths are relative to it. */
  dir: string;
  /** Injected in tests so no test reaches the network. */
  runner?: Runner;
  /** Staging differs by canvas, so the stop count does too. */
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
  const { rate, pitch } = prefs.narration;
  const beats: Record<string, Segment[]> = {};

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
    const stops = Math.min(
      stopsFor(beat, source, format, `s${i + 1}`),
      SPEAKING_STOPS[prefs.narration.density],
    );
    const plan = planSegments(text, stops);
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
    if (segments.length > 0) beats[beat.id] = segments;
  }

  return { voice, beats };
}
