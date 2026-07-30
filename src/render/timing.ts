/**
 * Where the words go.
 *
 * A narrated deck used to render SILENT: thirty-seven mp3s sat beside a deck
 * whose mp4 had one stream. This module is the arithmetic that puts them back,
 * and it is arithmetic rather than an ffmpeg incantation because the thing that
 * can be wrong here is a number, not a codec. Audio that drifts from the
 * animation is worse than no audio at all, so every offset below is derived
 * from the composition the emitter actually wrote, not from a second guess at
 * what it must have written.
 *
 * THE TIMING MODEL, and the one thing to understand before changing anything:
 *
 * A narration segment belongs to a STOP, and a stop is a hold — a settled time
 * inside a scene where a presenter pauses. In the PRESENTED deck the runtime
 * seeks to that hold and waits for the sentence to finish. A linear render has
 * no waiting: the GSAP timeline runs straight through, so on the demo deck a
 * six-reveal pipeline fires every reveal inside 7.75 seconds and then sits
 * motionless for the 31 seconds of speech that follow. Placing the audio at the
 * holds would overlap five-second sentences into 1.4-second gaps; placing it
 * sequentially would leave the last sentence nineteen seconds behind the reveal
 * it describes. Both are the drift this feature exists to avoid.
 *
 * So the renderer does what the presenter does: it FREEZES the video at each
 * hold for exactly as long as that stop's audio, and drops the dead tail the
 * composition parked at the end of the scene. That is not a liberty — it is
 * what `beatSeconds` in src/emit/composition.ts already budgeted for. It makes
 * a narrated scene `lastHold + sum(segment.seconds)` long, which is precisely
 * `motion + freezes`, so the retimed scene comes out the same length as the
 * scene the composition claims and the whole video keeps its duration to the
 * frame. Measured on the demo deck: all twelve narrated scenes satisfy
 * `D == lastHold + spoken` exactly.
 *
 * `assertFits` is the loud failure the brief asks for. If a scene's speech does
 * not fit inside its window we stop, because the alternatives are truncating a
 * sentence or stretching the video, and both are silent lies.
 *
 * WHY THIS LIVES HERE AND NOT IN `layout()`. `layout` is the only function that
 * knows a scene's absolute start and its holds in the same breath, and that is
 * where this manifest ideally comes from. This workstream does not own
 * src/emit/composition.ts, so instead: scene windows are READ BACK from the
 * composition that was just emitted — authoritative, no arithmetic repeated —
 * and holds are obtained the way `narrate` already obtains them, by asking the
 * emitter to stage the beat and reading `scene.holds`. When the format is
 * navigable the composition also carries the slideshow island, and
 * `assertHoldsAgree` cross-checks the derived holds against the fragments the
 * emitter itself wrote. If those two ever disagree, this throws rather than
 * rendering a deck whose audio is aimed at the wrong frames.
 */
import type { z } from "zod";
import { CUE_MAX_CHARS, type Cue, splitCue } from "../deck/subtitles.js";
import { emitScene } from "../emit/archetypes/index.js";
import { type DeckNarration, speechPlan, stageScene } from "../emit/composition.js";
import type { EmitContext } from "../emit/kit.js";
import { resolveTheme } from "../emit/theme.js";
import type { DeckTheme } from "../emit/themes/index.js";
import { familyFor } from "../source/fonts.js";
import type { Beat, Format, Source, Storyboard, segmentSchema } from "../types.js";

type Segment = z.infer<typeof segmentSchema>;

/** Written beside `index.html` by `build`; read by `render`. */
export const TIMING_FILE = "timing.json";

/** Times are compared, not accumulated, so a hair of float slop is enough. */
/**
 * Half a millisecond, which is the QUANTISATION and not a tolerance for a bug.
 *
 * `scene.duration` is read from the composition, where it was rounded to three
 * decimals (invariant 10), so the exact length it stands for can be up to half a
 * millisecond longer than the number. Comparing a full-precision `need` against
 * it at 1e-6 therefore failed on arithmetic that was correct: at `--speed 0.417`
 * the demo's s6 needed 22.4190s against a published 22.4185s and `planTiming`
 * threw, so no timing.json was written and `render` refused — with `build` still
 * reporting PASS. Nothing downstream can resolve half a millisecond anyway:
 * `framePlan` works in whole frames, and one frame is 33ms.
 */
const EPS = 5e-4;

/* ------------------------------------------------------------------- Shapes */

export interface TimedScene {
  /** Composition id — `s1`, `s2`. */
  id: string;
  /** Absolute seconds. Identical on the composition and output timelines. */
  start: number;
  duration: number;
  /** Absolute composition seconds: sorted, deduplicated, one per stop. */
  holds: number[];
  /**
   * Scene-relative seconds at which this scene may start speaking — when its
   * headline has landed. Read from the same emit the holds come from, so the two
   * cannot disagree. See `openSeconds`.
   */
  open: number;
}

export interface TimedSegment {
  /** `<scene>.<stop>` — stable, and unique because a stop speaks once. */
  id: string;
  scene: string;
  stop: number;
  /** mp3 filename, relative to `audioDir`. */
  audio: string;
  /** Absolute COMPOSITION seconds of the reveal this segment speaks over. */
  hold: number;
  /** Absolute OUTPUT seconds where the audio starts, once the freezes are in. */
  start: number;
  /** Measured length of the mp3. */
  duration: number;
  /** Seconds from the start of this segment's own audio. */
  cues: Cue[];
}

/**
 * The timing manifest. Small on purpose: everything a renderer needs and
 * nothing it could derive differently from the deck it is pointed at.
 */
export interface Timing {
  version: 1;
  width: number;
  height: number;
  /** Composition seconds. The rendered video is exactly this long. */
  duration: number;
  /** BCP-47 tag of the deck's copy. Picks the burn-in font; see `burnStyle`. */
  lang: string;
  /** Directory holding the mp3s, relative to the deck. `""` when silent. */
  audioDir: string;
  voice: string;
  scenes: TimedScene[];
  segments: TimedSegment[];
}

/* --------------------------------------------------- Reading the composition */

/**
 * The scene windows, out of the composition itself.
 *
 * The attribute set `sceneHtml` writes is exact and one-per-line, which is what
 * makes this honest rather than a guess: every scene div carries
 * `data-composition-id`, `data-start` and `data-duration` in that order, and
 * nothing else in the document does. Reading them back means the accumulated
 * `beatSeconds` arithmetic is never performed twice — this is the emitter's own
 * answer, whatever it decided.
 *
 * `data-duration` is the scene's CLIP, and since the handoff work it is longer
 * than the scene's SLIDE by `HANDOFF_SECONDS`: the outgoing scene stays painted
 * into the next one's window so the deck does not cut to background between
 * them (src/emit/camera.ts). Everything here — where a sentence starts, how many
 * frames a piece is — is measured in slides, and a slide ends where the next one
 * begins. Taking the clip instead makes the frame plan longer than the capture
 * by one handoff per scene, which `render` refuses outright rather than
 * silently mistiming; the last scene has no successor and no extension, so its
 * own number is already the slide.
 */
export function readSceneWindows(html: string): TimedScene[] {
  const re = /data-composition-id="(s\d+)"\s+data-start="([\d.]+)"\s+data-duration="([\d.]+)"/g;
  const scenes: TimedScene[] = [];
  for (let m = re.exec(html); m; m = re.exec(html)) {
    scenes.push({
      id: m[1] as string,
      start: Number(m[2]),
      duration: Number(m[3]),
      holds: [],
      open: 0,
    });
  }
  for (const [i, scene] of scenes.entries()) {
    const next = scenes[i + 1];
    if (next) scene.duration = round(next.start - scene.start);
  }
  return scenes;
}

/** The root's `data-duration` — the whole deck, in seconds. */
export function readDuration(html: string): number {
  const root = /id="root"[\s\S]*?data-duration="([\d.]+)"/.exec(html);
  if (!root) throw new Error("composition has no root data-duration; was it built by `decksmith`?");
  return Number(root[1]);
}

/**
 * The island's fragments, keyed by scene, or null when the format is linear and
 * carries no island. Only ever used to CHECK the holds, never to supply them —
 * a video format has no island and must take the same path.
 */
export function readFragments(html: string): Record<string, number[]> | null {
  const island =
    /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/.exec(html);
  if (!island) return null;
  let parsed: { slides?: { sceneId?: string; fragments?: number[] }[] };
  try {
    // The emitter escapes every `<` as <, so the first `</script>` really
    // is the island's own closing tag, and JSON.parse reads the escapes back.
    parsed = JSON.parse(island[1] as string) as typeof parsed;
  } catch {
    return null;
  }
  const out: Record<string, number[]> = {};
  for (const slide of parsed.slides ?? []) {
    if (typeof slide.sceneId === "string") out[slide.sceneId] = slide.fragments ?? [];
  }
  return out;
}

/* ------------------------------------------------------------------ Staging */

/**
 * A beat's holds, in seconds from its scene's start.
 *
 * Same question `stopsFor` asks in src/narrate/narrate.ts, and asked the same
 * way — emitters build strings, so this is cheap — with one addition: `pace`,
 * because a `--speed` deck scales its holds and an unscaled hold would aim the
 * audio at a frame that is no longer there. Deduplicated and sorted because
 * that is what `buildStops` does at playback and what `stopCount` counted when
 * `narrate` decided how many segments to cut. A hold at 0 is dropped: seeking
 * there shows the frame before the entrance runs.
 */
function holdsFor(
  beat: Storyboard["beats"][number],
  source: Source,
  format: Format,
  theme: DeckTheme,
  sid: string,
  speed: number,
  segments?: readonly Segment[],
): { holds: number[]; open: number } {
  const ctx: EmitContext = { source, format, theme, sid };
  // `stageScene` is the one place pacing and filling happen, shared with
  // `planCut` and `layout`. The narration has to be passed in: the fill factor is
  // computed from the sentence's length, so a manifest built without it would
  // describe reveals at different times from the ones the deck contains — and on
  // a linear format there is no island for `assertHoldsAgree` to catch it with.
  const { scene, open } = stageScene(emitScene(beat, ctx), speed, segments);
  return {
    holds: [...new Set(scene.holds.filter((h) => Number.isFinite(h) && h > 0))].sort(
      (a, b) => a - b,
    ),
    open,
  };
}

/**
 * The derived holds must be the ones the emitter wrote into the island.
 *
 * This is the check that makes reading the staging back out of `emitScene`
 * safe. It can only run for a navigable format — a linear one has no island —
 * but the code path either side of it is identical, so a divergence introduced
 * by an emitter change is caught on the deck format and never reaches a video.
 */
export function assertHoldsAgree(scenes: TimedScene[], fragments: Record<string, number[]>): void {
  for (const scene of scenes) {
    const want = [...new Set(fragments[scene.id] ?? [])].sort((a, b) => a - b);
    const got = scene.holds;
    const same =
      want.length === got.length && want.every((w, i) => Math.abs(w - (got[i] as number)) < 1e-3);
    if (!same) {
      throw new Error(
        `${scene.id}: staging disagrees with the composition — island fragments [${want.join(", ")}] but emitter holds [${got.join(", ")}]. The audio would be aimed at the wrong frames.`,
      );
    }
  }
}

/* ----------------------------------------------------------------- Placement */

/**
 * Lay the segments out on the output timeline.
 *
 * Per scene, walking the stops in order: the video plays to the hold, then
 * freezes for the whole of that stop's audio. So a segment's output start is
 * its hold plus every freeze already inserted in the same scene, and the
 * scene's own start needs no adjustment at all — the freezes it adds are
 * exactly the tail it drops, which is why `start` means the same thing on both
 * timelines and why the video keeps its length.
 *
 * A segment whose `stop` is past the end of the stop list is clamped onto the
 * last one. That only happens when a deck is narrated for one format and built
 * for another whose staging differs; speaking it late over the final state
 * beats dropping the sentence on the floor.
 */
export function place(scenes: TimedScene[], spoken: Record<string, Segment[]>): TimedSegment[] {
  const out: TimedSegment[] = [];
  for (const scene of scenes) {
    const segments = [...(spoken[scene.id] ?? [])].sort((a, b) => a.stop - b.stop);
    if (segments.length === 0) continue;
    if (scene.holds.length === 0) {
      throw new Error(
        `${scene.id}: narrated but has no hold to speak at. Re-run \`narrate\` for this format.`,
      );
    }
    // THE SPEECH CLOCK. Sentences run back to back from the moment the headline
    // lands, and the picture is NOT waited for. Anchoring each sentence to its own
    // hold is what put 93% of the deck's silence astride the cut: the voice sat
    // out the entrance of every scene and then stopped while the beat finished
    // building, so a viewer heard nothing for 1.0-3.4s at every slide change.
    //
    // `beatSeconds` reserved the room for this, so no freeze is needed to make it
    // fit and `hold` is now only a description of the picture — kept because
    // `assertFits` checks the sentence against the reveal it speaks over, and
    // because a manifest that could not say which reveal a sentence belongs to
    // could not be checked at all.
    const { starts } = speechPlan(scene.open, scene.holds, segments);
    for (const [i, segment] of segments.entries()) {
      const index = Math.min(segment.stop, scene.holds.length - 1);
      out.push({
        id: `${scene.id}.${segment.stop}`,
        scene: scene.id,
        stop: segment.stop,
        audio: segment.audio,
        hold: round(scene.start + (scene.holds[index] as number)),
        start: round(scene.start + (starts[i] as number)),
        duration: segment.seconds,
        cues: segment.cues.flatMap((c) => splitCue(c, cueMax(c.text))),
      });
    }
  }
  return out;
}

/**
 * Every scene's speech fits inside the window the composition gave it.
 *
 * `beatSeconds` already made a narrated scene `max(authored, lastHold + spoken)`
 * long, so this holds by construction today — which is exactly why it is worth
 * asserting. The failure it guards against is a deck built from a storyboard
 * whose narration was re-cut after the fact, or a `--speed` that shrank the
 * holds without shrinking the speech. The brief's rule: fail loudly rather than
 * truncate, and never stretch the video to fit.
 */
export function assertFits(scenes: TimedScene[], segments: TimedSegment[]): void {
  for (const scene of scenes) {
    const mine = segments.filter((s) => s.scene === scene.id);
    if (mine.length === 0) continue;

    // 1. THE SPEECH FITS. Everything is spoken inside the scene that owns it, so
    //    no sentence is still running when the deck has cut to the next slide.
    const spoken = mine.reduce((sum, s) => sum + s.duration, 0);
    const need = scene.open + spoken;
    if (need > scene.duration + EPS) {
      throw new Error(
        `${scene.id}: ${spoken.toFixed(2)}s of narration from ${scene.open.toFixed(2)}s needs ${need.toFixed(2)}s, but the scene is only ${scene.duration.toFixed(2)}s. Re-run \`build\` so \`beatSeconds\` can lengthen the beat; the video is not stretched to fit.`,
      );
    }

    // 2. THE MOTION FITS. `beatSeconds` reserves `lastHold + SETTLE`, so a reveal
    //    landing outside its own scene means the manifest and the composition were
    //    built from different numbers — the failure that puts every sentence of a
    //    deck on the wrong picture, and the one no gate downstream can see.
    const lastHold = Math.max(...mine.map((s) => s.hold)) - scene.start;
    if (lastHold > scene.duration + EPS) {
      throw new Error(
        `${scene.id}: a reveal at ${lastHold.toFixed(2)}s falls outside its own ${scene.duration.toFixed(2)}s scene. The manifest disagrees with the composition; rebuild the deck.`,
      );
    }

    // 3. THE SENTENCE IS HEARD OVER THE REVEAL IT DESCRIBES — the property the
    //    speech clock gives up, so it is the one that has to be asserted rather
    //    than assumed. This is NOT a restatement of the construction: `hold` comes
    //    from `emitScene` via `holdsFor` and `start` comes from the measured mp3
    //    lengths, so the two sides have no term in common and the comparison can
    //    genuinely fail. It is what catches narration re-cut after the fact, or a
    //    deck narrated for one format and built for another whose staging differs.
    //
    //    A CLAMPED stop is exempt, and only a clamped one: `place` maps a stop the
    //    staging does not have onto the final hold deliberately — speaking late
    //    over the finished picture beats dropping the sentence — so that
    //    documented degradation must not become a hard failure. "Clamped" is
    //    `stop >= holds.length`, which is a fact about the deck. Exempting "the
    //    last segment" instead would have been the same size of code and would
    //    have blinded the check to a real desync on the last sentence of every
    //    scene, which is where a beat's deepest reveal lives.
    for (const [i, seg] of mine.entries()) {
      if (seg.stop >= scene.holds.length) continue;
      const ends = mine[i + 1]?.start ?? seg.start + seg.duration;
      if (seg.hold > ends + EPS) {
        throw new Error(
          `${seg.id}: the reveal it speaks over lands at ${(seg.hold - scene.start).toFixed(2)}s, after the sentence has already finished at ${(ends - scene.start).toFixed(2)}s. The voice would describe a picture the viewer cannot see yet. Re-run \`narrate\` for this format.`,
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ Manifest */

export interface TimingInput {
  storyboard: Storyboard;
  source: Source;
  format: Format;
  /** `prefs.animationSpeed`. Scales holds exactly as `layout` scales them. */
  speed: number;
  /** The composition `emitDeck` just returned. Read, never re-derived. */
  composition: string;
  /**
   * The beats that composition actually drew, in order — `emitDeck`'s `cut.kept`.
   *
   * Absent, the list is re-derived with the format's flat weight threshold, which
   * is what this did before `planCut` could also cut a deck to the format's
   * LENGTH. That fallback is exact for an unbudgeted format and wrong for a
   * budgeted one, so it fails immediately below rather than mis-pairing scenes
   * with beats: a manifest that indexes audio by the wrong scene puts every
   * sentence on the wrong picture, which no gate here can see.
   */
  beats?: readonly Beat[];
  narration?: DeckNarration;
  theme?: string;
}

/**
 * One pass over the built deck, producing the manifest `render` consumes.
 *
 * The beat filter and the scene ids repeat `layout`'s two rules — a scene id is
 * a position over the beats a format KEPT — and the scene count is asserted
 * against the composition so a drift in either is a failure and not a
 * misalignment.
 */
export function planTiming(input: TimingInput): Timing {
  const { storyboard, source, format, speed, composition, narration } = input;
  const scenes = readSceneWindows(composition);
  const beats = input.beats ?? storyboard.beats.filter((b) => b.weight >= format.minWeight);
  if (beats.length !== scenes.length) {
    throw new Error(
      `composition has ${scenes.length} scenes but ${beats.length} beats were expected for ${format.id}. ` +
        `Pass \`beats\` from \`emitDeck\`'s cut — ${format.id} can drop beats to fit its own length, and the weight threshold alone no longer predicts which. Otherwise, rebuild the deck.`,
    );
  }

  // Same theme `layout` resolves, for faithfulness. Holds do not depend on it —
  // a theme is colour, type and spacing — but constructing a different one here
  // would be a difference nobody could later rule out.
  const base = resolveTheme(input.theme ?? storyboard.theme);
  const family = familyFor(storyboard.lang);
  const theme: DeckTheme = family ? { ...base, fontStack: `"${family}", ${base.fontStack}` } : base;

  const spoken: Record<string, Segment[]> = {};
  beats.forEach((beat, i) => {
    const scene = scenes[i] as TimedScene;
    const segments = narration?.beats[beat.id];
    const staging = holdsFor(beat, source, format, theme, scene.id, speed, segments);
    scene.holds = staging.holds;
    scene.open = staging.open;
    if (segments?.length) spoken[scene.id] = segments;
  });

  const fragments = readFragments(composition);
  if (fragments) {
    // The island's fragments are absolute; the holds are not.
    assertHoldsAgree(
      scenes.map((s) => ({ ...s, holds: s.holds.map((h) => round(s.start + h)) })),
      fragments,
    );
  }

  const segments = place(scenes, spoken);
  assertFits(scenes, segments);

  return {
    version: 1,
    width: format.width,
    height: format.height,
    duration: readDuration(composition),
    lang: storyboard.lang,
    audioDir: segments.length > 0 ? (narration?.dir ?? "") : "",
    voice: segments.length > 0 ? (narration?.voice ?? "") : "",
    scenes,
    segments,
  };
}

/* -------------------------------------------------------------- Frame plan */

/**
 * One stretch of the output video: `motion` frames copied from the source
 * starting at `from`, then `freeze` copies of the last of them.
 */
export interface Piece {
  /** Source frame index, inclusive. */
  from: number;
  /** Source frames played. Always at least 1. */
  motion: number;
  /** Frames of the last source frame, cloned. 0 outside a stop. */
  freeze: number;
}

export interface PlacedAudio {
  id: string;
  audio: string;
  /** Milliseconds from the start of the output. What ffmpeg's `adelay` takes. */
  delayMs: number;
  startFrame: number;
}

export interface FramePlan {
  fps: number;
  /** Output frames. Equal to the source's, by construction. */
  frames: number;
  pieces: Piece[];
  audio: PlacedAudio[];
  /** Absolute OUTPUT seconds, already split and wrapped for a screen. */
  cues: Cue[];
}

/**
 * The manifest, quantised to whole frames.
 *
 * Everything above is seconds, because seconds are what the composition and the
 * mp3s are measured in. ffmpeg cuts frames, and a trim expressed in seconds
 * lands wherever the nearest frame boundary happens to be — thirty-seven of
 * those rounding independently is a video that ends up a fraction of a second
 * away from its audio. So the cuts are computed as frame indices once, and the
 * audio delays are computed from the same indices, which keeps the two locked
 * together whatever the frame rate is.
 *
 * The tail piece is what makes a scene come out exactly as long as the
 * composition says: it absorbs whatever the motion and the freezes did not use,
 * taken from the static stretch after the last hold. Where narration exactly
 * fills the scene — the ordinary case, since `beatSeconds` sized it that way —
 * the tail is zero and the whole dead tail is dropped.
 */
export function framePlan(timing: Timing, fps: number): FramePlan {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`bad frame rate ${fps}`);
  const f = (seconds: number) => Math.round(seconds * fps);

  const pieces: Piece[] = [];
  const audio: PlacedAudio[] = [];
  const cues: Cue[] = [];

  for (const scene of timing.scenes) {
    const first = f(scene.start);
    const last = f(scene.start + scene.duration);
    const segments = timing.segments
      .filter((s) => s.scene === scene.id)
      .sort((a, b) => a.hold - b.hold || a.stop - b.stop);

    if (segments.length === 0) {
      pieces.push({ from: first, motion: last - first, freeze: 0 });
      continue;
    }

    // Where the scene stops talking, in absolute output frames. Every freeze
    // below is derived from a POSITION rather than from its own duration, and
    // that is not a stylistic choice: rounding six segment lengths
    // independently and adding them up put the demo's pipeline scene one frame
    // over its own window, because six roundings of at most half a frame each
    // do not cancel. Positions come from the exact seconds `place` computed,
    // which already sum correctly, so their rounded forms inherit the sum.
    const tail = segments[segments.length - 1] as TimedSegment;
    const silent = f(tail.start + tail.duration);
    if (silent > last) {
      throw new Error(
        `${scene.id}: the narration ends ${((silent - last) / fps).toFixed(2)}s after the scene does. The audio does not fit.`,
      );
    }

    // THE SCENE PLAYS STRAIGHT THROUGH, and the audio is dropped onto it where
    // `place` said. Nothing is frozen and nothing is dropped.
    //
    // It used to freeze the picture at each hold for the length of that stop's
    // audio, because speech and motion were CONSECUTIVE and the picture had to
    // wait. They overlap now — `beatSeconds` is `max(authored, lastHold + SETTLE,
    // speechEnd + SETTLE)`, so every scene is already long enough for all of its
    // motion AND all of its speech — which makes every freeze unnecessary, and an
    // unnecessary freeze is not free: per scene the output owes `last - first`
    // frames and `out = shown + freeze`, so `dropped == freeze`, always. Freezing
    // for four seconds threw away four seconds of this beat's own picture.
    //
    // THE BUG THIS FIXES, which is the one that matters. `place` computes where
    // each sentence starts on the speech clock, and this function then IGNORED
    // that and re-derived the position by playing the video to `segment.hold`.
    // The two disagreed on every scene of the shipped deck — the manifest said
    // the voice started at 0.375s and it actually started at 0.64-1.53s, for
    // 6.03s of silence the overlap work was supposed to have removed and had
    // not. It is also why the model predicted 16% silence and `silencedetect`
    // measured 30%. `place` is the one that decides; there is no second opinion.
    //
    // One consequence worth knowing: `retime` in src/render/render.ts skips the
    // whole re-encode when every piece has `freeze: 0`, so a narrated video is
    // now the capture itself with audio muxed onto it — no generation loss, and
    // the render is seconds rather than a minute.
    pieces.push({ from: first, motion: last - first, freeze: 0 });

    for (const segment of segments) {
      const at = f(segment.start);
      audio.push({
        id: segment.id,
        audio: segment.audio,
        startFrame: at,
        delayMs: Math.round((at / fps) * 1000),
      });
      for (const cue of segment.cues) {
        const start = at / fps + cue.start;
        const end = at / fps + cue.end;
        if (end > start) cues.push({ start, end, text: cue.text });
      }
    }
  }

  const frames = pieces.reduce((n, p) => n + p.motion + p.freeze, 0);
  return { fps, frames, pieces, audio, cues: cues.sort((a, b) => a.start - b.start) };
}

/* ------------------------------------------------------------------ Subtitles */

/**
 * Characters that occupy a full em: Hangul, kana, the CJK ideographs, and the
 * fullwidth forms. Everything else is treated as Latin-width.
 */
const WIDE = /[ᄀ-ᇿ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/u;

/**
 * A cue's character budget, scaled for the script it is written in.
 *
 * MEASURED at 40px bold in the caption band, against a usable width of 994px:
 * Latin caption prose advances 0.485em per character, Hangul 0.80em. The 84 of
 * `CUE_MAX_CHARS` is two lines of 42 at the LATIN number, and 42 Hangul
 * characters is 1,346px — half as much again as the band can hold. So a Korean
 * cue at the cap soft-wrapped to a THIRD line: measured at 64 characters the
 * band grew from 128px to 192px and covered the slide, while 60 characters
 * still came out on two. Korean is a first-class language for this product, so
 * the budget is a function of the text rather than a Latin constant.
 *
 * Scaling the budget rather than the font keeps the same headroom `burnStyle`
 * measured — the type stays 40px, which invariant 5 requires, and the cue gets
 * shorter instead.
 */
export function cueMax(text: string, max = CUE_MAX_CHARS): number {
  const chars = [...text];
  const wide = chars.filter((c) => WIDE.test(c)).length;
  if (wide === 0) return max;
  const em = 0.485 + (0.8 - 0.485) * (wide / chars.length);
  // Never below a floor: a budget small enough to orphan words would trade the
  // three-line band for the one-word flash `splitCue` exists to prevent.
  return Math.max(24, Math.round((max * 0.485) / em));
}

/**
 * A cue on two lines at most.
 *
 * `splitCue` has already capped the cue at its script's budget, which is two
 * lines of broadcast width; this only decides WHERE the break falls, so the two
 * lines come out even instead of one long and one orphaned word. Left to itself
 * the layout would wrap at whatever the box width happened to be, and a
 * burned-in caption that reflows between formats is a caption you cannot
 * art-direct.
 *
 * The default budget is derived from the text for the same reason `cueMax` is:
 * half of 84 is a Latin line, and half of a Korean cue is not.
 */
export function wrap(text: string, max = Math.floor(cueMax(text) / 2)): string {
  if (text.length <= max) return text;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return text;
  const middle = text.length / 2;
  let best = 1;
  let bestGap = Number.POSITIVE_INFINITY;
  let at = 0;
  for (let i = 0; i < words.length - 1; i++) {
    at += (words[i] as string).length + (i > 0 ? 1 : 0);
    const gap = Math.abs(at - middle);
    if (gap < bestGap) {
      bestGap = gap;
      best = i + 1;
    }
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

/** `01:02:03,456` — SubRip's clock, comma decimal and all. */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/**
 * The cues as a SubRip file.
 *
 * Overlaps are clipped rather than dropped: edge-tts has been seen to end a cue
 * a frame after the next one starts, and two captions on screen at once is the
 * one thing a burned-in band cannot survive. A cue left with nothing to show
 * after clipping is dropped instead.
 */
export function toSrt(cues: readonly Cue[]): string {
  const kept: Cue[] = [];
  for (const cue of cues) {
    const text = cue.text.trim();
    if (!text) continue;
    const previous = kept[kept.length - 1];
    const start = previous ? Math.max(cue.start, previous.end) : cue.start;
    if (cue.end - start < 0.05) continue;
    kept.push({ start, end: cue.end, text });
  }
  return kept
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${wrap(cue.text)}\n`)
    .join("\n");
}

/** Attribute-grade rounding, the same three decimals the emitter uses. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
