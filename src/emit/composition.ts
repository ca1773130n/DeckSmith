/**
 * Storyboard + Source + Format -> one HyperFrames composition.
 *
 * This module owns the deck's structure, and structure is where deck mode fails
 * silently: EXPERIMENT-002 produced a deck that passed `lint`, served, rendered,
 * and had zero navigable slides. Nothing in the gate stack said so. So the
 * renderer's structural rules live here as code rather than as prose an agent is
 * asked to remember, and every one of them is annotated with what breaks.
 *
 * The shell never learns what an archetype means — it lays beats out on a
 * timeline, wraps whatever the emitter returns, and closes the document.
 */
import type { z } from "zod";
import { type Cut, selectBeats } from "../plan/select.js";
import { familyFor } from "../source/fonts.js";
import type { Beat, Format, Inside, Source, Storyboard, segmentSchema } from "../types.js";
import { emitScene } from "./archetypes/index.js";
import {
  assertStopsOutsideMove,
  cameraCss,
  cameraMeasure,
  type Dive,
  diveStatements,
  diveTail,
  elementId,
  enterableIds,
  FADE_SECONDS,
  HANDOFF_SECONDS,
  handoffStatement,
  MOVE_SECONDS,
  partLabelProblem,
  rigHtml,
  transitWindow,
} from "./camera.js";
import { emitIsland, type SlideInput } from "./island.js";
import { type EmitContext, esc, type Scene, TEX_MARK, tweenText } from "./kit.js";
import {
  baseCss,
  type DeckTheme,
  FONT_BUNDLE_DIR,
  FONT_BUNDLE_HREF,
  pace,
  resolveTheme,
} from "./theme.js";

/** Pinned: a floating CDN version would break determinism between renders. */
/**
 * GSAP and KaTeX, from beside the deck rather than from a CDN.
 *
 * These were CDN URLs, on the reasoning that the HyperFrames compiler inlines
 * every `<script src>` before capture, so nothing is fetched at render time.
 * It does — and its failure branch only WARNS, leaving the live tag in place:
 *
 *     if (download.status === "fulfilled") { ...inline... }
 *     else { logger.warn("Failed to download CDN script") }
 *
 * So one flaky moment at compile time ships a composition that fetches at
 * capture, or does not get GSAP at all — in which case every timeline is
 * missing and the video is FROZEN. With every gate green, because a frozen deck
 * lints, checks and contrasts perfectly. Worse, `drift` passes it twice over:
 * both renders are equally frozen, so they are byte-identical.
 *
 * Vendoring removes the branch rather than trusting it, and makes a built deck
 * genuinely offline — which the README already claimed it was.
 */
const GSAP_SRC = "./vendor/gsap.min.js";
const KATEX_JS = "./vendor/katex.min.js";
const KATEX_CSS = "./katex/katex.min.css";

/** A built deck. `page` is present only for navigable formats. */
export interface Deck {
  composition: string;
  page?: string;
  /**
   * Which beats went in, which did not, and why each one did not.
   *
   * Returned rather than logged here because `emit` is a pure function and the
   * caller owns the terminal — but it is not optional to LOOK at: a cut nobody
   * prints is a third of the explanation missing from a deck that still says
   * PASS. `build` prints every casualty's reason; see src/cli.ts.
   */
  cut: Cut;
}

type Segment = z.infer<typeof segmentSchema>;

/**
 * Narration as the deck page needs it: the segments, keyed by BEAT id because
 * that is what `narrate` produced, plus where the audio sits relative to the
 * page. The beat→scene mapping is `layout`'s to make — a scene id is a position
 * over the beats a format kept, and no other layer knows which those are.
 */
export interface DeckNarration {
  voice: string;
  /** Directory holding the mp3s, relative to `deck.html`. */
  dir: string;
  beats: Record<string, Segment[]>;
}

/**
 * The look-and-pace decisions `prefs` owns, handed down rather than read here:
 * `emit` is a pure function of its arguments, and a module that loads a config
 * file is a module you cannot render twice and compare.
 */
export interface DeckOptions {
  /** Overrides `storyboard.theme`. Any name in the registry. */
  theme?: string;
  /** Multiplies every duration, hold, and beat length. 1 leaves bytes untouched. */
  speed?: number;
  narration?: DeckNarration;
  /**
   * What to do when one beat cannot be drawn.
   *
   * Absent, an emitter's error propagates and the build fails — right for a
   * library caller and for every test, and what this did for months. It is the
   * wrong answer for someone who uploaded a document: one beat the planner
   * over-filled took a whole twelve-slide deck with it, at the last stage, after
   * the planner had already been paid for.
   *
   * Dropped rather than repaired, deliberately. A missing slide is visibly
   * missing; a slide silently shrunk to fit is a slide that lies about what the
   * source said, and this project has spent a lot of its life on exactly that
   * failure shape.
   */
  onBeatError?: (beatId: string, err: Error) => void;
  /**
   * The subsetted bundle's `@font-face` CSS, INLINED rather than linked.
   *
   * The composition sets `font-family: "Noto Sans KR", …` for a CJK deck and
   * used to declare the face in a `<link rel=stylesheet>`. Two things read the
   * composition and neither follows that link: hyperframes' static guard, which
   * reported "Font family used without @font-face declaration … text will fall
   * back to a generic font, producing incorrect typography in the video" on
   * every Korean deck this project has built; and the compiler, which inlines
   * `<script src>` and not stylesheets — the same asymmetry the KaTeX note above
   * records. A face the renderer cannot see is invariant 9 exactly: a font stack
   * naming a family the bundle does not declare falls back silently.
   *
   * Passed in rather than read here because this function does no I/O. Absent,
   * the link is emitted as before, so a caller that has no bundle is unchanged
   * and every non-CJK deck is byte-identical either way.
   */
  fontCss?: string;
}

/**
 * Both artifacts from one layout pass.
 *
 * `composition` is the HyperFrames document — what `check`, `snapshot` and
 * `render` consume. `page` is the navigable wrapper: it hosts the composition in
 * a player, carries the same island, and inlines our step layer. Two files
 * because they are genuinely two things — one is rendered, one is presented —
 * and because HyperFrames' own navigation is dead at 0.7.71/0.7.72 and still
 * dead at 0.7.90 (EXPERIMENT-003), so the presented one has to be ours.
 */
export function emitDeck(
  storyboard: Storyboard,
  source: Source,
  format: Format,
  runtimeJs: string,
  opts: DeckOptions = {},
): Deck {
  // ONE layout pass for both artifacts. It used to run twice — once inside
  // `emitComposition` and once here for the slides — which was merely wasteful
  // while the pass was pure string-building, and stops being merely wasteful now
  // that it also emits every beat a second time to measure it.
  const laid = layout(storyboard, source, format, opts);
  const composition = renderComposition(storyboard, format, laid);
  const { cut } = laid;
  if (!format.navigable) return { composition, cut };
  return {
    composition,
    cut,
    page: emitDeckPage(
      storyboard,
      format,
      laid.slides,
      runtimeJs,
      narrationIsland(opts.narration, laid.spoken),
    ),
  };
}

/**
 * The beats this format actually draws, and why the rest are not there.
 *
 * TWO rules, and the second one is new here. The FLOOR — `format.minWeight`,
 * raised for one invocation by `--min-weight` — is the author's own statement
 * about what survives a shorter cut. The BUDGET is the format's: a `short-9x16`
 * that runs four minutes is not a short, it is a tall video nobody can post
 * (`DESTINATIONS` in src/types.ts). Until this call existed the budget could only
 * be REPORTED, by `verify`, after the over-long deck had already been written, so
 * one storyboard could not produce both a deck and a short without a human doing
 * the arithmetic and feeding a threshold back in. `selectBeats` picks a better
 * cut than a threshold can express — it protects the ends and one beat of every
 * archetype family, and weighs length against weight — and every beat it drops
 * arrives with a sentence saying why (src/plan/select.ts).
 *
 * WHY THIS MEASURES BEFORE IT SELECTS. A beat's real length is its NARRATED
 * length, `beatSeconds` below, which is only known once the scene has been
 * emitted and its holds are in hand. The measured scenes are then thrown away:
 * a scene id is a position over the beats that SURVIVE (`s1`, `s2`, …) and every
 * timeline selector is scoped by it (invariant 3), so a scene emitted before the
 * cut is known carries ids for a deck that is not the one being built. Holds are
 * times and do not depend on the id, which is what makes measuring with
 * provisional ids exact rather than approximate.
 *
 * ONLY THE FLOOR'S SURVIVORS ARE MEASURED. Emitting a beat the floor has already
 * dropped buys nothing and adds a way to fail: `emitScene` throws on a beat it
 * cannot draw, and a beat nobody was ever going to draw must not be able to fail
 * a build that never wanted it.
 *
 * AND THIS IS WHERE A BEAT THAT CANNOT BE DRAWN IS CAUGHT. It has to be: this is
 * the FIRST place every surviving beat is emitted, so a `layout` that only caught
 * the throw on its own second pass never saw one — `emitScene` is deterministic,
 * so a beat that throws here throws identically there, and the deck died in the
 * measuring pass with `onBeatError` never called. Dropping it here also keeps the
 * returned `Cut` honest: a beat that is not in the deck is not in `kept`.
 */
export function planCut(
  storyboard: Storyboard,
  source: Source,
  format: Format,
  opts: DeckOptions = {},
): Cut {
  const { theme } = deckLook(storyboard, opts);
  const speed = opts.speed ?? 1;
  const floor = storyboard.beats.filter((b) => b.weight >= format.minWeight);
  const seconds: Record<string, number> = {};
  /** Floor survivors an emitter refused. Empty unless `onBeatError` was given. */
  const undrawable = new Set<string>();
  floor.forEach((beat, i) => {
    const segments = opts.narration?.beats[beat.id];
    let scene: Scene;
    try {
      ({ scene } = stageScene(emitScene(beat, { source, format, theme, sid: `s${i + 1}` }), speed));
    } catch (err) {
      // Without a hook the error propagates exactly as it always has, which is
      // what every test and every library caller expects.
      if (!opts.onBeatError) throw err;
      opts.onBeatError(beat.id, err instanceof Error ? err : new Error(String(err)));
      undrawable.add(beat.id);
      return;
    }
    seconds[beat.id] = beatSeconds(beat.seconds * speed, scene, segments);
  });
  if (floor.length > 0 && undrawable.size === floor.length) {
    throw new Error(`every one of ${floor.length} beat(s) failed to draw — there is no deck`);
  }

  // A camera's travel-and-dip is part of what this beat costs the deck's TOTAL —
  // `layout` adds `diveTail` to this same beat's window — so a selection blind to
  // it under-counts by 1.8s per dive and hands `verify` a cut that turns out not
  // to fit.
  //
  // CHARGED OVER THE DRAWABLE LIST, which is why it is a second pass: a tail
  // exists only when the next beat that is actually in the deck dives into this
  // one, and `enteredParts` reads that off the SURVIVORS. Asked of the raw floor
  // it charged 1.8s for a dive out of a beat an emitter had just refused — a beat
  // that is not in the deck to be dived into — and a tight budget then cut
  // somebody else to pay for it. Still an upper bound against the final cut,
  // which is safe and deliberate: cutting beats can remove a tail, never add one.
  const drawable = floor.filter((b) => !undrawable.has(b.id));
  drawable.forEach((beat, i) => {
    const tail = drawable[i + 1]?.inside?.beat === beat.id ? MOVE_SECONDS + FADE_SECONDS : 0;
    seconds[beat.id] = rnd((seconds[beat.id] ?? 0) + tail * speed);
  });
  // A refused beat is taken out of the storyboard the selection sees, not out of
  // its result: `selectBeats` derives its own list from `storyboard.beats`, so a
  // beat merely missing from `seconds` would be selected anyway, on its authored
  // length, and then not be there.
  const board = undrawable.size
    ? { ...storyboard, beats: storyboard.beats.filter((b) => !undrawable.has(b.id)) }
    : storyboard;
  // `Format` satisfies `SelectionBudget` structurally: minWeight, maxSeconds, id.
  return selectBeats(board, format, seconds);
}

/**
 * Theme and font family, resolved the same way for the measuring pass and the
 * real one. Two resolutions that could disagree would put the cut on different
 * holds from the deck it is a cut of.
 */
function deckLook(storyboard: Storyboard, opts: DeckOptions) {
  const base = resolveTheme(opts.theme ?? storyboard.theme);
  // The deck's copy is written in the storyboard's language, so that — not the
  // source's — decides whether a font bundle has to ship. Same function `ingest`
  // subsets with: a stack naming a family the bundle does not declare falls back
  // silently, which is the whole of invariant 9.
  const family = familyFor(storyboard.lang);
  const theme: DeckTheme = family ? { ...base, fontStack: `"${family}", ${base.fontStack}` } : base;
  return { family, theme };
}

/** The one pass over the beats. Both artifacts are rendered from its result. */
function layout(storyboard: Storyboard, source: Source, format: Format, opts: DeckOptions = {}) {
  const cut = planCut(storyboard, source, format, opts);
  const beats = cut.kept;
  if (beats.length === 0) {
    // Every drop carries its own sentence, and an empty deck is exactly when the
    // caller needs all of them: "no beat survives" alone cannot tell a floor set
    // too high from a budget shorter than the shortest beat in the storyboard.
    throw new Error(
      `no beat survives ${format.id}. ${cut.dropped.map((d) => `${d.beat.id}: ${d.reason}`).join(" ")}`,
    );
  }

  const { family, theme } = deckLook(storyboard, opts);
  const speed = opts.speed ?? 1;

  const archetypeCss = new Set<string>();
  const scenes: string[] = [];
  const slides: SlideInput[] = [];
  /** The narration island's view of the same beats, keyed by scene id. */
  const spoken: Record<string, Segment[]> = {};
  const entered = enteredParts(beats);

  // Nothing filters for drawability here. `planCut` above has already emitted
  // every one of these beats to measure it, and dropped the ones that threw —
  // so a beat still in `cut.kept` has drawn once, and `emitScene` is
  // deterministic. A second filter over the same beats caught nothing and made
  // `onBeatError` look reachable from a build that had already died measuring.

  // Two passes, because a scene's clip has to outlast its own slide and must not
  // outlast the NEXT one — so how long the next scene runs has to be known
  // before this one can be written. Everything a scene needs on its own is
  // settled here; nothing that depends on a neighbour is.
  const cuts = beats.map((beat, i) => {
    const sid = `s${i + 1}`;
    const ctx: EmitContext = { source, format, theme, sid };
    // `pace` scales the scene's own times; the beat's length is the shell's
    // arithmetic and has to be scaled by the same factor here, or a slowed deck
    // pushes its last reveal past the end of its own slide window.
    const segments = opts.narration?.beats[beat.id];
    const { scene } = stageScene(emitScene(beat, ctx), speed);
    const seconds = beatSeconds(beat.seconds * speed, scene, segments);

    // A camera leaves from this scene only if the NEXT surviving beat says it
    // happens inside a part of this one. The move is a TAIL on this scene's own
    // window — dive, land, dip — and the next scene's window begins where it
    // ends.
    const inside = entered[i];
    const dive: Dive | undefined = inside
      ? { t0: rnd(seconds), dur: rnd(MOVE_SECONDS * speed), fade: rnd(FADE_SECONDS * speed) }
      : undefined;
    return {
      beat,
      sid,
      scene,
      segments,
      inside,
      dive,
      duration: dive ? seconds + diveTail(dive) : seconds,
    };
  });

  let start = 0;
  // Whether ANY scene deferred its timeline behind a measurement. `readyGate`
  // needs to know, and it must be told: an extra link in that chain on a deck
  // with no builders to await would move bytes in every deck we have shipped.
  let builds = false;
  cuts.forEach((cut, i) => {
    const { beat, sid, dive, inside, duration } = cut;
    if (cut.segments?.length) spoken[sid] = cut.segments;

    // THE HANDOFF, and it is the whole of why this deck no longer cuts to black
    // seven times. Scenes are absolutely positioned clips laid back to back, and
    // every archetype opens through `chromeIn` — first ink at 0.15s, headline at
    // 0.3s — so the incoming scene's opening frames are EMPTY. When the outgoing
    // clip ends on the same instant the incoming one begins, those frames are
    // the deck's flat background and nothing else: measured on the vertical demo
    // as three to five consecutive frames of luma 27 with min == max at every
    // one of the seven seams, and ELEVEN at a cameraed one, where the dip has
    // already taken the outgoing scene to zero before the seam is reached. So
    // the outgoing clip is extended past its own slide and
    // dissolves across the seam, which the engine paints correctly — its
    // visibility pass is per element and has no notion of one-scene-at-a-time.
    //
    // Only the CLIP overlaps. `start`, the island's window and the deck's total
    // are still `duration`, because `hyperframes lint` rejects overlapping
    // main-line slides outright (`slideshow_unresolved_ref`) and because a slide
    // window that moved would move every stop's narration with it.
    //
    // Clamped to the next scene's length so a long handoff onto a short beat
    // cannot leave a scene lit over the whole of its successor.
    const next = cuts[i + 1];
    const over = next ? rnd(Math.min(HANDOFF_SECONDS * speed, next.duration)) : 0;

    let scene = cut.scene;
    if (inside && dive) {
      scene = withCamera(sid, inside, format, scene, dive, over);
      archetypeCss.add(cameraCss());
    } else if (over > 0) {
      scene = { ...scene, tl: [...scene.tl, handoffStatement(sid, duration, over)] };
    }

    if (scene.css) archetypeCss.add(scene.css.trim());
    if (scene.measure?.length) builds = true;
    scenes.push(
      sceneHtml(
        sid,
        start,
        rnd(duration + over),
        beat.params.headline,
        scene,
        dive && inside ? transitWindow(start, dive, over) : undefined,
      ),
    );
    slides.push({
      sid,
      start,
      duration,
      notes: beat.narration ?? beat.intent,
      holds: scene.holds,
    });
    // Un-annotated decks must accumulate EXACTLY as they did before this
    // existed — rounding the running sum here, rather than only where it is
    // printed, moves bytes on any deck whose beat lengths came from measured
    // speech. So the camera adds its own tail and nothing else changes.
    start += duration;
  });

  return {
    family,
    // Rides with `family` because it answers the same question one level down:
    // `family` is what the stack ASKS for, this is what declares it.
    fontCss: opts.fontCss,
    theme,
    archetypeCss,
    scenes,
    slides,
    spoken,
    total: start,
    cut,
    builds,
  };
}

type Layout = ReturnType<typeof layout>;

/**
 * For each surviving beat, the relation the NEXT surviving beat asserts into it —
 * or undefined, which is the answer for almost every beat.
 *
 * The whole `inside` rather than just its `element`, because the emitter checks
 * two things about it: that the part exists, and that it is the part the plan
 * says it is. See `partLabelProblem`.
 *
 * Read off the surviving list rather than the storyboard's, because a short
 * format drops low-weight beats: if the containing beat did not survive the cut
 * there is nothing on screen to move through, and the honest answer there is the
 * cut we would have had anyway. The schema already guarantees the relation is
 * between adjacent beats in the FULL storyboard; this is the same question asked
 * of what the format kept.
 */
function enteredParts(beats: readonly Beat[]): Array<Inside | undefined> {
  return beats.map((beat, i) => {
    const next = beats[i + 1];
    return next?.inside?.beat === beat.id ? next.inside : undefined;
  });
}

/**
 * One scene, with a camera bolted on: the rig around its content, the closed-form
 * eases and the deferred measurement in `measure`, the two `fromTo`s and the fade
 * at the end of its timeline.
 *
 * BOTH CHECKS ARE HERE rather than in the schema because only the emitter knows
 * what the archetype actually drew. A camera aimed at a part that does not exist
 * would land on the neutral framing and read as a slow nothing; a camera aimed at
 * a part that exists but is not the one the plan named renders a smooth,
 * convincing dive into the wrong box. Both are precisely the shape of defect that
 * ships with every gate green, and the second one already has.
 */
function withCamera(
  sid: string,
  inside: Inside,
  format: Format,
  scene: Scene,
  dive: Dive,
  over: number,
): Scene {
  const part = inside.element;
  if (!scene.html.includes(`id="${elementId(sid, part)}"`)) {
    const drawn = enterableIds(sid, scene.html);
    throw new Error(
      `${sid}: the next beat is inside "${part}", which this beat does not draw. ` +
        `It draws: ${drawn.length ? drawn.join(", ") : "nothing with an id"}.`,
    );
  }
  const mismatch = partLabelProblem(part, inside.label, scene.parts);
  if (mismatch) {
    throw new Error(`${sid}: the next beat is inside "${part}", which this beat ${mismatch}`);
  }
  assertStopsOutsideMove(sid, scene.holds, dive);
  return {
    ...scene,
    html: rigHtml(scene.html),
    // `measure`, not `setup`: the rect this reads depends on font metrics, so it
    // has to be taken after `document.fonts.ready` — and taken ONCE, at the same
    // instant for every worker. `cameraMeasure` carries the render that proved it.
    measure: [...(scene.measure ?? []), ...cameraMeasure(sid, part, format)],
    // The dip is the cameraed scene's own handoff — it runs `over` seconds past
    // the slide's end for the same reason `handoffStatement` does, so a cameraed
    // seam is not a second kind of transition with a second set of bugs.
    tl: [...scene.tl, ...diveStatements(sid, format, dive, over)],
  };
}

/**
 * How long the finished picture is held after the last word, before the cut.
 *
 * `HANDOFF_SECONDS`, deliberately: the outgoing scene's dissolve begins where its
 * slide ends, so the settled frame gets exactly one handoff of stillness before
 * it starts fading. Two scenes therefore have `SETTLE + open` between them — a
 * breath, against the 1.86-3.44s of dead air measured on the deck this replaces.
 */
export const SETTLE_SECONDS = HANDOFF_SECONDS;

/**
 * When the voice may start inside a scene: as soon as the headline has landed.
 *
 * MEASURED off the scene rather than fixed, which is the whole point. The chrome
 * is `#sid-e` at 0.15s over 0.5s and `#sid-h` at 0.3s over 0.6s, so it settles at
 * 0.9s unpaced — but `pace` has already scaled the scene by the time this is
 * asked, so at the 0.417 a 60-second target derives the same headline lands at
 * 0.375s. A constant would have been right at one speed and wrong at every other,
 * and starting the voice over a 46%-opacity headline is the failure it would have
 * shipped.
 *
 * Falls back to the first hold when a scene draws no chrome, which is the same
 * answer the deck gives today.
 */
export function openSeconds(scene: Scene): number {
  let settled = 0;
  for (const t of scene.tl) {
    const target = String(t.target);
    if (!/-[eh]$/.test(target)) continue;
    const d = typeof t.to.duration === "number" ? t.to.duration : 0;
    settled = Math.max(settled, t.at + d);
  }
  if (settled > 0) return rnd(settled);
  const first = scene.holds.filter((h) => Number.isFinite(h) && h > 0).sort((a, b) => a - b)[0];
  return rnd(first ?? 0);
}

/**
 * How long a beat lasts once it has something to say.
 *
 * WAS `max(authored, lastHold + spoken)`, which stated as arithmetic that speech
 * and motion are CONSECUTIVE: the voice waited for the beat's FIRST hold and the
 * beat then reserved room out to its LAST one plus the whole sentence, so every
 * second of speech bought a second of frozen picture. Measured on the 60-second
 * deck that shipped: 49% of the video was silence, and 93% of that silence sat
 * astride the cut between slides — the tail one scene reserved and never used,
 * running straight into the head the next one spent waiting. Ten gaps of 1.0-3.4s,
 * one at every slide change, which is exactly where a viewer reads it as the deck
 * having nothing to say.
 *
 * The two terms now OVERLAP. The voice starts as soon as the headline lands and
 * runs continuously; the reveals play underneath it. So a beat is as long as the
 * longer of the two things happening in it, plus a breath to settle on:
 *
 *     max(authored, lastHold + SETTLE, open + spoken + SETTLE)
 *
 * `lastHold + SETTLE` is what keeps the motion from being cut off when a beat
 * builds for longer than its sentence — invariant 8 still holds, a hold can never
 * fall outside its own slide. `authored` still wins when the author asked for more
 * room than either needs. And a silent beat is untouched, so an un-narrated deck
 * emits the bytes it always did.
 */
function beatSeconds(authored: number, scene: Scene, segments?: Segment[]): number {
  if (!segments?.length) return authored;
  const lastHold = scene.holds.reduce((a, b) => Math.max(a, b), 0);
  const usable = [...new Set(scene.holds.filter((h) => Number.isFinite(h) && h > 0))].sort(
    (a, b) => a - b,
  );
  const ends = speechPlan(openSeconds(scene), usable, segments).end;
  return Math.max(authored, lastHold + SETTLE_SECONDS, ends + SETTLE_SECONDS);
}

/**
 * The scene as the deck actually contains it: paced, then filled.
 *
 * ONE function because three callers have to agree exactly — `planCut` measures
 * with it, `layout` emits with it, and `holdsFor` in src/render/timing.ts builds
 * the manifest with it. `assertHoldsAgree` cross-checks the last against the
 * island the first two wrote, but ONLY on a navigable format; `video-16x9` and
 * `short-9x16` carry no island, so on the artifact anybody actually watches a
 * divergence between them is invisible. Sharing the code is the only thing that
 * makes them the same answer.
 */
export function stageScene(scene: Scene, speed: number): { scene: Scene; open: number } {
  const paced = pace(scene, speed);
  return { scene: paced, open: openSeconds(paced) };
}

/**
 * When each sentence of a beat is spoken, on one continuous clock.
 *
 * THE FIRST SENTENCE NEVER WAITS. It describes the beat arriving, the headline is
 * already up by `open`, and making it wait for the first reveal is what put
 * 0.65-1.52s of silence at the head of every scene — which ran straight into the
 * tail of the one before it and became a 1.0-3.4s hole at every slide change.
 *
 * A LATER SENTENCE WAITS FOR THE REVEAL IT NAMES, and only when the clock has not
 * already passed it. That is the whole synchronisation rule and it is one
 * `Math.max`. When speech is dense — a short target, the case this was built for —
 * the clock is always ahead, so the sentences run back to back with no gap at all.
 * When the animation is deliberately slowed (`--speed 2`), the build outruns the
 * voice and each sentence waits for its own reveal rather than describing a
 * picture that is still seconds away. The gap that opens there is not dead air:
 * it is the motion the author asked to be slow enough to watch.
 *
 * Shared by `beatSeconds` and `place` so the room RESERVED and the room USED are
 * one piece of arithmetic rather than two statements of it that can drift apart.
 */
export function speechPlan(
  open: number,
  holds: readonly number[],
  segments: readonly Segment[],
): { starts: number[]; end: number } {
  const starts: number[] = [];
  let at = open;
  for (const [i, segment] of segments.entries()) {
    const hold = holds[Math.min(segment.stop, holds.length - 1)] ?? 0;
    if (i > 0) at = Math.max(at, hold);
    starts.push(at);
    at += segment.seconds;
  }
  return { starts, end: at };
}

export function emitComposition(
  storyboard: Storyboard,
  source: Source,
  format: Format,
  opts: DeckOptions = {},
): string {
  return renderComposition(storyboard, format, layout(storyboard, source, format, opts));
}

/** The document, from a layout already computed. Split out so `emitDeck` can lay
 * out once and write both artifacts from the one result. */
function renderComposition(storyboard: Storyboard, format: Format, laid: Layout): string {
  const { family, theme, archetypeCss, scenes, slides, total } = laid;

  const orientation =
    format.width > format.height
      ? "landscape"
      : format.width < format.height
        ? "portrait"
        : "square";
  // Inlined when the caller has the bundle, linked when it does not. The
  // bundle's `url()` names a bare file beside its own stylesheet, so inlining
  // moves the resolution base from `assets/fonts/` to the deck root and the
  // reference has to move with it — a woff2 that 404s is the same silent
  // fallback the link was causing.
  const fontFace = laid.fontCss?.trim()
    ? `\n    <style>${laid.fontCss.trim().replace(/url\((['"]?)([^'")/][^'")]*)\1\)/g, (_m: string, q: string, name: string) => `url(${q}${FONT_BUNDLE_DIR}/${name}${q})`)}</style>`
    : "";
  const fontLink =
    family && !fontFace ? `\n    <link rel="stylesheet" href="${FONT_BUNDLE_HREF}" />` : "";
  const island = format.navigable ? `\n${emitIsland(slides)}` : "";

  return `<!doctype html>
<html lang="${esc(storyboard.lang)}" data-resolution="${orientation}">
  <head>
    <meta charset="UTF-8" />
    <title>${esc(storyboard.title)}</title>
    <meta name="viewport" content="width=${format.width}, height=${format.height}" />
    <script src="${GSAP_SRC}"></script>
    <link rel="stylesheet" href="${KATEX_CSS}" />
    <script src="${KATEX_JS}"></script>${fontLink}${fontFace}
    <style>
${baseCss(theme, format)}
${[...archetypeCss].map(indent).join("\n")}
    </style>
  </head>
  <body>${buildingFlag()}
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${t(total)}"
      data-width="${format.width}"
      data-height="${format.height}"
    >
${scenes.join("\n")}
      <script>
        (function () {
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          // Spans the deck. All real motion lives on the per-scene timelines.
          tl.to({}, { duration: ${t(total)} });
          window.__timelines["main"] = tl;
        })();
      </script>${readyGate(laid.builds)}
    </div>${island}
  </body>
</html>
`;
}

/**
 * Claim "not ready yet" before anything the engine can see.
 *
 * This must be the first thing in the body, ahead of every scene script, because
 * the engine decides readiness the moment it finds the timelines it is looking
 * for — and our scenes register theirs synchronously as the document parses.
 */
function buildingFlag(): string {
  return `
    <script>window.__hfTimelinesBuilding = true;</script>`;
}

/**
 * Hold the renderer until every image has decoded and every font has loaded.
 *
 * Capture that begins while a figure is still decoding renders a blank plate for
 * the first frames, so two renders of the same deck differ. No gate sees it, and
 * it voids the byte-identical-render guarantee — the strongest regression test
 * this project has. Image-free decks were always deterministic, which is exactly
 * why it went unnoticed for so long.
 *
 * Setting `window.__renderReady = false` and flipping it after `decode()` could
 * never have worked: the engine OWNS that flag. Its readiness check ends in
 * `window.__renderReady = true` as soon as it has discovered every timeline, so
 * a composition that registers its timelines during parse is declared ready
 * before this script runs at all, and anything we write is overwritten by the
 * next check. `window.__hfTimelinesBuilding` is the engine's own protocol for
 * the same intent, read out of `hyperframe-runtime.js`: while it is set the
 * check returns not-ready and installs a one-shot listener for
 * `hf-timelines-built`. So we raise it before the scenes parse (`buildingFlag`)
 * and lower it here, once the images have decoded.
 *
 * MEASURED, so that nobody re-litigates it: on the twelve-beat demo this changed
 * NOTHING. Four renders — two with the flag, two without — gave three distinct
 * mp4 hashes with the flag orthogonal to which one came out; one no-flag render
 * was byte-identical to a with-flag render. Both variants differ in the same 428
 * of 7395 frames, in the same two runs, confined to `s3` (annotated figure) and
 * `s5` (KaTeX equation), at PSNR ~57 dB — sub-pixel antialiasing, no blank plate
 * and no content difference. So the remaining half of EXPERIMENT-006 is NOT a
 * readiness race, and the next thing to test is worker count: `render` shards
 * frames across Chrome processes (`-w/--workers`, default auto), the two runs
 * are contiguous the way a shard boundary would be, and an R3F spike separately
 * measured 1-worker and 4-worker renders of the same input differing by ±1
 * subpixel. Try `--workers 1` twice before anything else.
 *
 * This is kept anyway because it is the engine's documented handshake and the
 * thing it replaces was provably inert — code that would work if a figure ever
 * did decode slowly, in place of code that could not.
 *
 * FONTS were the last cause standing, and the reason this gate is now
 * unconditional rather than image-only. An equation deck with no figures had no
 * gate at all, and its `\\mathcal{W}` — the caligraphic glyph, the only one in
 * the deck needing KaTeX_Caligraphic — rasterised differently between two
 * renders of identical input. Vendoring the stylesheet stopped it being fetched
 * over the network but not being resolved asynchronously: a face is still
 * pending until the browser has loaded it, and a glyph first painted at the
 * moment its reveal runs can be painted before or after that. `document.fonts.ready`
 * is the browser's own answer to "all faces in use are resolved", so it belongs
 * in the same barrier as `decode()`. The CJK bundle has exactly the same shape
 * of risk and is covered by the same line.
 *
 * `decode()` rejects on a broken image; the deck should still render, so a
 * failure resolves rather than hanging the capture forever. The flag is lowered
 * in the same `then` for the same reason: an image that never decodes must not
 * leave the renderer waiting for an event that will never fire.
 *
 * A `requestAnimationFrame` barrier on top of this made things strictly worse
 * and must not come back: capture is driven by Chrome's `beginFrame`, not by the
 * rAF loop, so rAF is the wrong clock to wait on.
 *
 * SEAM B adds exactly one link to this chain, and only when some scene asked for
 * it: run the registered builders — sequentially, in document order, awaiting
 * each, so an async measurement is covered by the same barrier — BEFORE the flag
 * drops. That is what makes "measure the rendered document" a supported thing a
 * scene may do: by the time a builder runs, fonts have resolved and images have
 * decoded, and no capture has begun. Timing is not on our side here and does not
 * need to be — the prototype held the gate through a deliberately slowed
 * 12-seconds-per-scene measurement, `snapshot`'s 5s default timeout included,
 * because `__hfTimelinesBuilding` is a handshake rather than a race.
 *
 * `builds` is false for every deck that measures nothing, which is what keeps
 * those decks byte-identical: with no builder to await, this is the same chain it
 * has always been.
 */
function readyGate(builds: boolean): string {
  const run = builds
    ? `.then(function () {
          // Every builder, in document order, each awaited: an async measurement
          // is inside the barrier for the same reason a synchronous one is.
          return (window.__dsBuilders || []).reduce(function (p, b) { return p.then(b); }, Promise.resolve());
        })`
    : "";
  return `
      <script>
        Promise.all(
          Array.prototype.map
            .call(document.images, function (img) {
              return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
            })
            .concat([document.fonts ? document.fonts.ready : Promise.resolve()]),
        )${run}.then(function () {
          window.__hfTimelinesBuilding = false;
          window.dispatchEvent(new Event("hf-timelines-built"));
        });
      </script>`;
}

/** Shipped beside the deck so a built artifact needs no network to navigate. */
export const PLAYER_FILE = "hyperframes-player.global.js";

/**
 * The wrapper's filename, single-sourced because `verify` has to exclude it.
 * It is a presented page, never a rendered one, so render-time rules — the
 * determinism scan above all — do not apply to it.
 */
export const DECK_PAGE = "deck.html";

/**
 * The navigable wrapper.
 *
 * It hosts the composition in a `<hyperframes-player>`, repeats the island, and
 * inlines our step layer. The player element only exists here — the composition
 * itself has none — which is why inlining the runtime into the composition would
 * be a silent no-op.
 *
 * Deliberately NOT `interactive`: that attribute lets the iframe take pointer
 * events, and the deck wants clicks to advance the slide. A format with scenes
 * the viewer manipulates would need it, and would lose click-to-advance.
 */
/**
 * The narration island, written into `deck.html` and nowhere else.
 *
 * Keyed by scene id, because the runtime only ever sees scene ids — `beat.id`
 * never reaches the browser. Its own island rather than a key inside the
 * slideshow manifest: that manifest is HyperFrames' format, and adding a field
 * to someone else's schema is a bet you lose on their next release.
 *
 * `text` is dropped on the way out; the cues carry the same words with timings,
 * so shipping both would be shipping the script twice.
 */
function narrationIsland(
  narration: DeckNarration | undefined,
  scenes: Record<string, Segment[]>,
): string {
  if (!narration || Object.keys(scenes).length === 0) return "";
  const manifest = {
    voice: narration.voice,
    dir: narration.dir,
    scenes: Object.fromEntries(
      Object.entries(scenes).map(([sid, segments]) => [
        sid,
        segments.map((s) => ({ stop: s.stop, audio: s.audio, seconds: s.seconds, cues: s.cues })),
      ]),
    ),
  };
  // Same escape as `emitIsland`: a `</script>` inside a spoken line would close
  // the island early, and escaping `<` leaves the JSON valid.
  const json = JSON.stringify(manifest, null, 2).replace(/</g, "\\u003c");
  return `\n    <script type="application/decksmith-narration+json">
${json}
    </script>`;
}

function emitDeckPage(
  storyboard: Storyboard,
  format: Format,
  slides: SlideInput[],
  runtimeJs: string,
  narration: string,
): string {
  return `<!doctype html>
<html lang="${esc(storyboard.lang)}">
  <head>
    <meta charset="UTF-8" />
    <title>${esc(storyboard.title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
      hyperframes-player { display: block; width: 100vw; height: 100vh; }
    </style>
    <script src="./${PLAYER_FILE}"></script>
  </head>
  <body>
    <hyperframes-player
      src="./index.html"
      width="${format.width}"
      height="${format.height}"
    ></hyperframes-player>
${emitIsland(slides)}${narration}
    <script>
${closeSafe(runtimeJs)}
    </script>
  </body>
</html>
`;
}

/** A literal `</script>` inside the bundle would close the tag that carries it. */
function closeSafe(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

/**
 * One scene. The attribute set is exact: `data-composition-id/start/duration/label`
 * and nothing else. A `data-track-index` or a per-scene `data-width`/`data-height`
 * — both of which the generic HyperFrames docs ask for — make the deck
 * non-navigable without any gate noticing (EXPERIMENT-003).
 *
 * INVARIANT 11, and it is the most dangerous one we know of. The timeline this
 * writes is `paused: true` and is only ever SEEKED — capture sets an absolute
 * time and grabs a frame (invariant 1). GSAP's `seek()` passes `suppressEvents`,
 * so `onUpdate` — and `onStart`, `onComplete`, every callback — NEVER FIRES
 * under capture. Motion driven by a callback therefore plays perfectly in a
 * browser, where the deck really does run, and renders a FROZEN VIDEO with every
 * gate green: `lint` passes, `check` passes, the 40px floor passes, and `drift`
 * passes twice over because both renders are identically frozen. Nothing in the
 * stack can see it; only a human watching the video can.
 *
 * So state must be applied BY THE THING BEING SEEKED, never by a callback hung
 * off it: tween the property. When a value is not directly tweenable, tween a
 * proxy object and read it from a tween on the real property — do not write it
 * from `onUpdate`.
 */
function sceneHtml(
  sid: string,
  start: number,
  /** The CLIP, not the slide: `duration + HANDOFF_SECONDS` on every scene but
   * the last, so the outgoing scene is still on screen while the next one
   * opens. The island's slide is the shorter number. */
  clip: number,
  label: string,
  scene: Scene,
  /** `"t0,t1"` in absolute seconds when a camera flies out of this scene; see
   * `transitWindow`. Absent — not empty — on every scene that has no camera, so
   * an un-annotated deck is byte-for-byte what it was before the camera existed. */
  transit?: string,
): string {
  const setup = [...mathSetup(sid, scene.html), ...(scene.setup ?? [])]
    .map(statement)
    .join("\n            ");
  // The measurement and the timeline share ONE closure, so a tween can read a
  // variable the measurement declared. `pad` is the only difference between the
  // two branches below: deferred, this body sits two levels deeper inside a
  // builder function.
  const build = (pad: string) =>
    [
      ...(scene.measure ?? []).map(statement),
      `window.__timelines = window.__timelines || {};`,
      `// Each scene owns a paused timeline under its own composition id, with`,
      `// times relative to its start — one absolute root timeline yields a`,
      `// deck the slideshow controller cannot bind to.`,
      `var tl = gsap.timeline({ paused: true });`,
      // `tweenText` is the ONLY place a tween becomes GSAP source. Everything
      // above this line is a typed object the checker can see; below it is text.
      ...scene.tl.map(tweenText),
      `window.__timelines["${sid}"] = tl;`,
    ].join(`\n${pad}`);
  // SEAM B. A scene that measures registers a BUILDER rather than a timeline, and
  // `readyGate` awaits every builder before it lowers `__hfTimelinesBuilding`, so
  // capture cannot start on a deck whose timelines do not exist yet. A scene that
  // measures nothing emits exactly the bytes it always did — the `measure` branch
  // is why a camera-free deck is byte-identical across this change.
  const body = scene.measure?.length
    ? `window.__dsBuilders = window.__dsBuilders || [];
            window.__dsBuilders.push(function () {
              ${build("              ")}
            });`
    : build("            ");
  return `      <div
        id="${sid}"
        class="scene clip"
        data-composition-id="${sid}"
        data-start="${t(start)}"
        data-duration="${t(clip)}"${transit ? `\n        data-ds-transit="${transit}"` : ""}
        data-label="${esc(label)}"
      >
${scene.html}
        <script>
          (function () {
            ${setup}
            ${body}
          })();
        </script>
      </div>`;
}

/**
 * Render the inline TeX any archetype marked with `mathy()`.
 *
 * In the shell rather than in each emitter: twelve copies of the same three
 * lines is twelve places for one of them to be forgotten, and the symptom of
 * forgetting is a slide showing the audience `PSNR$_{\mathrm{RGB}}$`. Scoped to
 * the scene, so it cannot reach a sibling. `throwOnError:false` because a bad
 * span should leave its own text on screen, not blank the slide it is in.
 */
function mathSetup(sid: string, html: string): string[] {
  if (!html.includes(TEX_MARK)) return [];
  return [
    `Array.prototype.forEach.call(document.querySelectorAll('#${sid} .${TEX_MARK}'), function (el) {
              try { katex.render(el.textContent, el, { throwOnError: false, output: "html" }); } catch (e) {}
            })`,
  ];
}

/**
 * A `setup` line — still free text, because setup is arbitrary JavaScript
 * (`katex.render(...)`, the camera's closed-form eases) rather than a vocabulary
 * with a shape. The timeline no longer comes through here: `Scene.tl` is
 * `Tween[]` and `tweenText` writes it.
 */
function statement(s: string): string {
  const line = s.trim();
  return line.endsWith(";") ? line : `${line};`;
}

function indent(css: string): string {
  return css.replace(/^/gm, "      ");
}

/** Times are attribute text; round so float drift in the sum never moves a byte. */
function t(n: number): string {
  return String(rnd(n));
}

/** The same rounding, where a number rather than its text is wanted. */
function rnd(n: number): number {
  return Math.round(n * 1000) / 1000;
}
