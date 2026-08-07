/**
 * One camera move, between two beats the SOURCE says are nested.
 *
 * This is the whole of "keep the stop, lose the cut" (ARCHITECTURE-CANVAS §1).
 * It is deliberately not a canvas and not a general camera: a beat may declare
 * that it happens `inside` one named part of the beat immediately before it, and
 * when it does, the containing beat's window is extended by a dive that lands
 * with that part filling the frame, so the incoming beat opens on the rect the
 * outgoing one left on. Where the source supplies no such relation there is no
 * move, because a smooth pan between unrelated diagrams is a fancier cut and
 * measurably worse than the cut it replaces (Prezi's motion-sickness complaint
 * is the market's own version of this finding).
 *
 * Three things here are load-bearing and each of them cost a render to learn:
 *
 * 1. THE MOVE IS TWO `fromTo`s AND NOTHING ELSE. `seek()` passes
 *    `suppressEvents`, so a GSAP `onUpdate` never fires under capture. The first
 *    camera in experiment 008 drove `viewBox` from an `onUpdate`, played
 *    perfectly in a browser, and rendered 900 frames of a frozen `0 0 1920 1080`
 *    with every gate green (invariant 11). State must be applied by the thing
 *    being seeked.
 *
 * 2. THE EASES ARE CLOSED FORM AND THEY ARE NOT DECORATION. `zoomEase` travels
 *    scale in log space — a linear scale tween reads as a lurch, and every
 *    smooth-zoom implementation since Van Wijk 2004 fixes it the same way.
 *    `panEase` is the normalised integral of 1/k over the same path, which is
 *    exactly the condition "the target moves at constant SCREEN speed"; without
 *    it a pan at 5x whips. Both are pure functions of the tween's own progress:
 *    nothing reads a clock, a frame delta, or an element's current value, so
 *    `seek(x)` gives the same transform for a given x on every run and in any
 *    order.
 *
 * 3. THE CONTAINING DIAGRAM IS AT FULL OPACITY FOR THE WHOLE FLIGHT. The spike
 *    faded its world out DURING the move by accident and made the mid-flight
 *    frame an empty world — a camera over nothing is not continuity, it is a
 *    slow wipe. So the fade here starts only once the camera has stopped, and
 *    lasts `FADE_SECONDS`: the deck dives into the region, comes to rest on it,
 *    and dips through its own background into the beat that lives there.
 *
 *    WHAT THE DIP COSTS, MEASURED, so nobody has to find it twice. Luma sampled
 *    every 1/30s across the handoff of a `pipeline`→`grid` deck: the dive lands
 *    at 10.4s, the dip runs to the scene's window end at 10.8s and hands off at
 *    max luma 63 over a background of 13 — and then the frame is FLAT BACKGROUND
 *    FOR FIVE FRAMES, 10.8s through 10.933s, before the incoming scene reaches
 *    23 at 10.967s. Those five frames are not the camera's. They are the
 *    incoming scene's own opening: `chromeIn` (`title.ts`) puts its first tween
 *    at 0.15s, so every scene in the deck opens on 150ms of nothing, and a plain
 *    cut in the demo measures the same four-to-five dark frames at 10.233s.
 *    Nothing this file can do reaches them: `paint()` and the engine both swap
 *    scene visibility on one instant, so retiming the dip only moves the hole —
 *    verified over dip lengths of 0, 0.25 and 0.4, all five frames.
 *
 *    THAT HOLE IS NOW CLOSED, and it was closed the way this note predicted:
 *    extend the OUTGOING scene's clip past the incoming scene's start and run
 *    the dip on into it. `composition.ts` no longer derives the scene div's
 *    window, the island's window and the next scene's start from one number —
 *    the div's `data-duration` is `duration + HANDOFF_SECONDS` while the island
 *    and the deck's running clock still see `duration`. Doing it on the island
 *    as well still fails the gate — `slideshow_unresolved_ref: main-line slides
 *    "s1" and "s2" overlap`, still true on 0.7.71 — which is the same §4
 *    `planTransition`/`paint()` work described below, and is why the overlap
 *    lives on the clip and nowhere else. The 150ms proposed here turned out to
 *    be short by half; `HANDOFF_SECONDS` carries the luma trace that fixes it.
 *
 *    That dip is a compromise and it is worth naming. The spike's version keeps
 *    the container lit while the contained scene arrives inside it, which needs
 *    both scenes on screen at once — and `hyperframes lint` rejects that
 *    outright: `slideshow_unresolved_ref — main-line slides "s1" and "s2"
 *    overlap`. Overlapping windows need the island to place one of them off the
 *    main line and `paint()` to stop owning `display`, which is exactly the
 *    `planTransition`/`paint()` work ARCHITECTURE-CANVAS §4 scoped and deferred.
 *    So what is here is a dive that lands on the incoming beat's frame and dips
 *    to background across the seam — items 1 and 4 of §2, "do first" and "the
 *    cheap half of lose the cut" — and not item 5. Called by its right name it
 *    is a match cut with a camera in front of it, not a continuous world.
 *
 * The geometry is measured in the browser rather than computed here, because the
 * region's page rect depends on how much room the headline above it took, which
 * depends on font metrics. Measuring during parse frames the deck on fallback
 * metrics and lands the camera in the wrong place, silently, in a deck that still
 * renders twice to the same bytes because both renders take the same wrong path.
 * So the measurement is DEFERRED into the ready gate's barrier and taken exactly
 * once — see `cameraMeasure`, which carries the render that made it necessary.
 */
import type { Format } from "../types.js";
import { fromTo, raw, type Tween } from "./kit.js";

/**
 * Slack around the region, as a fraction of its own size, when the camera lands.
 *
 * The landing framing is the region plus this, extended to the format's aspect.
 * At 0 the region's own border sits on the frame edge and reads as a crop rather
 * than as an interior; much above 0.2 and the landing scale drops back toward
 * the 1.127x that made the safe-box camera a nudge instead of a camera.
 */
const PAD = 0.16;

/** How long the dive takes. The spike's MOVE1; long enough to read, short
 * enough that deck mode's `MAX_SPAN` still sweeps the step around it. */
export const MOVE_SECONDS = 1.4;

/** How long the landed framing takes to dip to the deck's background, after
 * which the incoming scene's window begins. Below ~0.25 it reads as a pop; much
 * above and the seam becomes a noticeable hole in the deck. */
export const FADE_SECONDS = 0.4;

/**
 * How far a scene's CLIP outlasts its own slide, so the next scene opens
 * underneath it instead of on an empty plate. Zero on the last scene.
 *
 * This is the number that closes the hole described at the top of this file,
 * and 0.4 is measured rather than chosen. Every archetype opens through
 * `chromeIn`, which puts the eyebrow at 0.15s and the headline at 0.3s, so a
 * scene's first frames carry no ink at all. Luma sampled every 1/30s across the
 * first handoff of the vertical demo, as mean frame luma above the deck's
 * background of 27:
 *
 *   +0.163s 0.007   +0.263s 0.053   +0.363s 0.809   +0.463s 1.801
 *
 * — against 7.73 for the outgoing scene's last lit frame. So the incoming
 * scene is, measurably, EMPTY for its first tenth of a second and near-empty
 * for a third of one, and an overlap that ends before ~0.36s only MOVES the
 * hole rather than closing it: at 0.15 the floor across the seam was 0.007,
 * indistinguishable from background. At 0.4 the floor is 1.40 and the frames
 * either side of it are a legible dissolve.
 *
 * Do not raise it much further. The two scenes are absolutely positioned on
 * top of each other, so a long dissolve is two headlines superimposed — at
 * 0.45 the outgoing eyebrow is still at 58% while the incoming's is up, and
 * the two lines of type collide legibly.
 */
export const HANDOFF_SECONDS = 0.4;

/**
 * The dissolve that carries a scene across the seam, for a scene with no camera
 * on it. Starts where the slide ends and runs into the next slide's window, so
 * it is only ever seen against the incoming scene rather than against nothing.
 *
 * `power2.in` for the same reason the dip uses it: the outgoing scene holds
 * most of its brightness through the first half of the overlap, which is
 * exactly the half in which the incoming scene has nothing to give.
 *
 * The target is the scene div itself. There is no wrapper to fade instead, and
 * adding one would put a second copy of the scene box in the tree — the camera
 * rig already carries that cost and only earns it because it needs the
 * transforms.
 */
export function handoffStatement(sid: string, at: number, over: number): Tween {
  return fromTo(
    `#${sid}`,
    { opacity: 1 },
    { opacity: 0, duration: round(over), ease: "power2.in", immediateRender: false },
    round(at),
  );
}

/** A dive, in the containing scene's own time base. All three already scaled by `speed`. */
export interface Dive {
  /** Seconds from the scene's start at which the camera leaves the wide shot. */
  t0: number;
  /** Travel time. */
  dur: number;
  /** The dip that follows the landing, and ends this scene's window. */
  fade: number;
}

/** How much longer a scene's window is because a camera leaves from it. */
export function diveTail(d: Dive): number {
  return d.dur + d.fade;
}

/** The DOM id an archetype gives one of its parts: `s2` + `stage1` -> `s2-stage1`. */
export function elementId(sid: string, element: string): string {
  return `${sid}-${element}`;
}

/**
 * The parts of a scene a camera could enter, read back out of the emitted HTML.
 *
 * Only used to write a useful error. There is no registry of enterable regions —
 * `src/emit/svg.ts`'s `id(sid, part, i)` is the whole convention, and an
 * archetype that draws a thing with an id can be entered at it.
 */
export function enterableIds(sid: string, html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    const id = m[1] ?? "";
    if (id.startsWith(`${sid}-`)) found.add(id.slice(sid.length + 1));
  }
  return [...found].sort();
}

/** Same label, differently typed: trim, collapse runs of space, lowercase. */
function sameLabel(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * THE CAMERA HAZARD, checked. `inside.element` is an index, so naming the right
 * kind of part and the wrong number is not a build error — `stage2` exists, it
 * has a rect, and the deck dives smoothly into whatever happens to be third.
 * That is this project's signature failure shape: correct-looking output that no
 * gate can see is wrong. `inside.label` is what the plan says it is entering,
 * `Scene.parts` is what the archetype drew, and this is the one place they meet.
 *
 * Returns the PREDICATE of a sentence whose subject is the containing beat, so
 * that both callers can keep their own framing — the emitter says "this beat",
 * `assertInsideResolves` names the beat and its archetype — over one comparison.
 * Undefined means nothing to report.
 *
 * A plan that omits `label` is not checked: the field has to stay optional or
 * the 130 committed references stop validating and every stored plan's sha256
 * moves. A plan that SUPPLIES one for a part carrying no label is refused rather
 * than skipped, because a check that silently does nothing is how the six
 * green-gate failures in this repo all began — and by RULE 11 only a pipeline
 * stage, a grid region and a stack layer are enterable anyway.
 *
 * The comparison is deliberately not exact and deliberately not fuzzy. Exact,
 * and a re-typed or re-cased label fails a build over nothing; fuzzy — substring
 * — and "Window" matches "window group", which occurs in this corpus.
 */
export function partLabelProblem(
  part: string,
  expected: string | undefined,
  parts: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (expected === undefined) return undefined;
  const labelled = Object.keys(parts ?? {}).sort();
  const drawn = parts?.[part];
  if (drawn === undefined) {
    return (
      `does not label, so "${expected}" cannot be checked against it. ` +
      `It labels: ${labelled.length ? labelled.join(", ") : "nothing"}.`
    );
  }
  if (sameLabel(drawn, expected)) return undefined;
  return `draws as "${drawn}", not "${expected}".`;
}

/**
 * The camera rig, wrapped around one scene's content.
 *
 * Two nested transforms and a plate, in that order, because the order is what
 * makes the neutral framing the IDENTITY transform: scaling about the frame's
 * centre and then translating the plate by `centre - target` frames the target
 * for any scale, and both tweens start at 0/1 — the values an element has before
 * a `fromTo` with `immediateRender: false` has ever run. A rig whose rest state
 * needed setting would show the wrong framing for every frame before the move.
 *
 * The plate carries `class="scene"` so it lays out through the one rule in
 * `theme.ts` rather than a copy of the padding kept in step by hand.
 */
export function rigHtml(inner: string): string {
  return `        <div class="ds-zoom"><div class="ds-pan"><div class="scene ds-plate">
${inner}
        </div></div></div>`;
}

/**
 * THE TRANSIT WINDOW, in absolute composition seconds — `[t0, t0+dur+fade+over]`
 * measured from the deck's start — written onto the cameraed scene's own div as
 * `data-ds-transit`. Nothing in the browser reads it, and there is exactly one
 * of them per camera.
 *
 * `over` IS PART OF THE WINDOW, and leaving it out was a live bug. `diveTail` is
 * how much the camera lengthens the scene's SLIDE — `dur + fade`, deliberately
 * ignorant of the handoff — but the dip `diveStatements` writes lasts
 * `fade + over`, so the rig is displaced and still visible for `over` seconds
 * after that. Publishing `dur + fade` therefore describes less than the move:
 * `menu-10` of `experiments/015-decision` dives at 10s and clips at 12.2s, the
 * gate sampled 11.978s, and the window said `10,11.8` — thirteen
 * `canvas_overflow` errors on one legitimate mid-move frame, which was one of
 * the two failures in that experiment's arm MENU
 * (`out/f-menu10-11.978.png`; deleting the beat's `inside` made the same plan
 * PASS). The window must be the move: everything the rig is displaced for.
 *
 * It is here because a camera is the first thing in this project that puts
 * MOTION between two stops, and the layout gate samples a uniform grid that
 * knows nothing about stops. `hyperframes check` on
 * `demo/fixtures/camera.storyboard.json` samples 1.1, 3.3, … 18.7 across a 19.8s
 * deck; exactly one of those, 9.9, lands inside the dive, and at 9.9 the frame
 * is a legitimate mid-flight crop — headline sliced, outer stages gone past the
 * edge. Upstream calls all eight of those findings `info` and returns `ok:true`,
 * because a single-sample dynamic issue is a transient to it. `regrade` in
 * `src/verify/check.ts` promotes every `canvas_overflow` to `error` on the
 * stated premise that "every DeckSmith frame the audience sees is a static plate
 * at a hold" — which is true, and which this window is the exception to. So a
 * legal storyboard builds a deck that fails our own gate on seven errors, none
 * of which is a frame anybody sees.
 *
 * WHY NOT `data-layout-allow-overflow`, which is the vocabulary upstream's own
 * fixHint offers. Because it hides real overflow, measured rather than argued.
 * The audit exempts a text node when `element.closest("[data-layout-allow-
 * overflow]")` matches — an ancestor test with no notion of time. Every glyph a
 * camera moves is inside the rig, so the flag can only go on the rig, and there
 * it exempts the scene at every sample instead of only the ones inside the move.
 * Three builds of this fixture with the containing beat's `note` replaced by a
 * 130-character unbreakable word, which overflows the canvas at scale 1, at
 * every stop, forever:
 *
 *   no `inside`, no flag   FAIL 1 error   #s1-note t=5s
 *   `inside`,    no flag   FAIL 8 errors  #s1-note t=5.5s and t=9.9s, + 6 transit
 *   `inside`,    flag      PASS
 *
 * (Those three were measured before this exemption existed; see the re-measured
 * pair below, which is the same experiment through today's grading.)
 *
 * The third line is a deck shipping with its own copy sliced through and every
 * gate green — the failure shape this project has now found by hand eleven
 * times. So the flag is not written. The exemption is published as DATA the
 * caller can compare a finding's `time` against, and the teeth stay in because
 * the SECOND line is what a real defect looks like through this window: the note
 * is reported at 5.5s as well as at 9.9s, and 5.5 is outside the window.
 * Anything genuinely wrong with the plate is wrong at rest, and at rest the gate
 * is sampling it. The emitter's half of the same guarantee is
 * `assertStopsOutsideMove`: no stop is ever inside the window to begin with.
 *
 * WIDENING A WINDOW IS THE CHANGE THAT COULD EXCUSE A REAL DEFECT, so the `over`
 * term was checked both ways rather than argued.
 *
 * The teeth, RE-MEASURED with `over` in the window — the same three builds, now
 * against `9,11.2`. Line two is the one that matters, and it is the number that
 * did NOT move:
 *
 *   no `inside`, no flag   FAIL 1 error              #s1-note t=5s
 *   `inside`,    no flag   FAIL 1 error + 7 info     #s1-note t=5.5s, 7 at 9.9s
 *
 * (The middle column reads 1+7 rather than the 8 errors recorded above only
 * because this exemption now exists; the ERROR at 5.5s is unchanged, and 5.5 is
 * outside the widened window as it was outside the narrow one.)
 *
 * THE ADVERSARIAL DECK, which `.planning/DECISION.md` §5.1 named as the control
 * this change must survive: `regrade` exempts by TIME ALONE, with no scene scope,
 * so the extra `over` seconds exempt the whole deck — including the INCOMING
 * scene, whose first stop can land inside them. Constructed rather than argued
 * about: the incoming beat is 0.5s long, so `holdsWithin` clamps its stop to
 * 0.35s (inside the 0.4s tail), its eyebrow AND headline are 130-character
 * unbreakable words, and a third 0.3s beat tunes the deck's total so that one of
 * the layout gate's nine uniform samples lands at 10.956s — inside the tail. That
 * deck's stop really is inside the published window: `[9, 11.2]` against a
 * fragment at 11.15.
 *
 * One render of it, graded twice, which is the only way to attribute a change to
 * the change:
 *
 *   window [9, 10.8] (the bug)   FAIL 7 errors, all `#s1-*` at t=10.956s
 *   window [9, 11.2] (fixed)     PASS
 *   findings naming `#s2`        ZERO, at any severity, in both gradings
 *
 * So everything the wider window forgave was the dipping rig's own displacement,
 * and nothing about the incoming scene was forgiven — because during the handoff
 * the incoming scene has nothing to forgive. `chromeIn` starts its eyebrow at
 * 0.15s over 0.5s and its headline at 0.3s over 0.6s, so at 0.156s into a scene
 * there is no text at a measurable opacity yet. That is the same 150ms of nothing
 * the handoff exists to cover, seen from the other side.
 *
 * The corpus agrees: across the 36 built decks of
 * `experiments/015-decision/out/decks` (36 windows, one per deck), widening every
 * published window by 0.4s AND by 0.8s swallows ZERO stops, and the earliest stop
 * any of their 60 scenes has is 1.55s into itself.
 *
 * WHAT IS STILL NOT GUARANTEED, said out loud because the exemption's own message
 * overstates it. `regrade` prints "no hold is inside this window"; what the
 * emitter guarantees is that no hold of the DIPPING scene is
 * (`assertStopsOutsideMove`), and an incoming scene's hold inside the `over` tail
 * is reachable — the deck above has one. It is harmless only because nothing of
 * that scene is visible yet. Closing it for good means scoping the exemption to
 * the dipping rig's own subtree, which is `regrade`'s job in
 * `src/verify/check.ts`: the sid is right there in the selector it already has.
 *
 * `over` is a required argument, not one defaulting to 0. A default is what let
 * the sole call site drift out of step with `diveStatements` in the first place;
 * making it required means the compiler asks.
 */
export function transitWindow(start: number, d: Dive, over: number): string {
  return `${round(start + d.t0)},${round(start + d.t0 + diveTail(d) + over)}`;
}

export function cameraCss(): string {
  return `/* The camera. Identity is the neutral framing: scale about the frame's
   centre, then translate by (centre - target). */
.ds-zoom, .ds-pan { position: absolute; inset: 0; transform-origin: 50% 50%; }
/* The plate is a .scene, so padding and centring come from the one rule that
   owns them. This class is only the handle the measurement reads through —
   giving it geometry of its own would put a second copy of the scene box here. */
.ds-plate { }`;
}

/**
 * THE MEASUREMENT, taken ONCE, inside the ready gate's barrier — after
 * `document.fonts.ready` and before this scene's timeline exists. Emitted as
 * `Scene.measure` (see `sceneHtml`), so these statements run in the scene's own
 * builder closure and the tweens below read `dsFramed` as a plain number.
 *
 * WHY NOT LAZILY, which is what this did until the twelfth case of a green gate
 * over wrong output. `hyperframes render` shards frames CONTIGUOUSLY, one span
 * per worker, so worker k's first seek lands MID-DECK — and a value first read on
 * a tween's first render is therefore read under different conditions in every
 * worker. `experiments/014-seam-b` measured that standalone: `lazy` moved 286 of
 * 360 frames when only `--workers` changed, `defer` 0 of 360.
 *
 * WHAT THE NUMBER ATTRIBUTED TO THIS FILE ACTUALLY WAS, because the first reading
 * of it was wrong and the correction is the useful part. The twelfth case reported
 * `demo/fixtures/camera.storyboard.json` differing in 201 of 594 frames at 1 vs 3
 * workers, worst 51.52 dB, and blamed the lazy read here. It is not the lazy read.
 * Three controls, each varying one thing:
 *
 *   defer vs lazy, same worker count   594 of 594 frames BYTE-IDENTICAL
 *   lazy, 1 vs 3 workers               201 of 594, worst 51.52 dB — the same
 *                                      frames and the same dB as `defer`
 *   the same two beats, camera REMOVED  180 of 540, worst 51.52 dB, and the
 *                                      differing frames are exactly worker 3's
 *                                      contiguous shard
 *
 * So the fixture's 201 is 198 frames of the `grid` scene's cell fill landing one
 * LSB apart in a worker whose first seek is inside that scene, plus 3 frames of 3
 * pixels at 113 dB. It has nothing to do with the camera and this change does not
 * move it.
 *
 * AND WHY THAT FIXTURE CANNOT WITNESS THE CLASS AT ALL, which is worth knowing
 * before anyone points it at this again. The dive tweens carry
 * `immediateRender: false`, so under a lazy read GSAP never touches them before
 * `t0`; the read therefore happens on each worker's first frame at or after `t0`,
 * and by then everything it measures — `#s1-stage1`, revealed at 2.4s over 0.5s —
 * has stopped moving. Every worker that reaches the dive measures the same rects.
 * Point a camera at something that is STILL MOVING at `t0` and the class appears
 * at once. Measured, target given a 4s `y` tween running through `t0` and the
 * shard boundary forced inside the dive at 2 workers:
 *
 *   lazy    39 of 594 frames differ, worst 14.96 dB — the camera lands 18px off
 *   defer    7 of 594 frames differ, worst 62.64 dB — antialiasing on a scaled edge
 *
 * 14.96 dB is a visibly different frame. That is the defect this file no longer
 * has, and the 51.52 dB one belongs to somebody else.
 *
 * Deferring is not merely earlier. It is the difference between a value GSAP
 * evaluates when it feels like it and a NUMBER in the vars payload — which is why
 * the eases below are now closed-form functions built once from a fixed ratio
 * rather than wrappers that re-read a memo on every call.
 *
 * `dsFramed` measures the target RELATIVE TO THE PLATE and divides out the
 * plate's scale, so the answer is a property of the LAYOUT and not of the moment
 * it was taken. Nothing has moved the rig when this runs, but a non-1920 canvas
 * carries a scale on `.scene` regardless (`zoomOf`), so the division is load-
 * bearing in portrait and it is also what keeps a second reading — if anything
 * ever takes one — equal to the first.
 *
 * A missing target degrades to the neutral framing rather than to `NaN`: a
 * camera that does not move is a cut, and a cut is what we had. The emitter
 * refuses to write a camera at a target that is not in the HTML, so this branch
 * only fires if something removed the element after emit.
 */
export function cameraMeasure(sid: string, element: string, format: Format): string[] {
  const w = format.width;
  const h = format.height;
  return [
    `function dsSmooth(p) { return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p); }`,
    `function dsZoomEase(r) { return Math.abs(r - 1) < 1e-9 ? dsSmooth : function (p) { return (Math.pow(r, dsSmooth(p)) - 1) / (r - 1); }; }`,
    `function dsPanEase(r) { return Math.abs(r - 1) < 1e-9 ? dsSmooth : function (p) { return (1 - Math.pow(r, -dsSmooth(p))) / (1 - 1 / r); }; }`,
    `var dsFramed = (function () {
                var framed = { cx: ${w / 2}, cy: ${h / 2}, k: 1 };
                var plate = document.querySelector('#${sid} .ds-plate');
                var el = document.getElementById('${elementId(sid, element)}');
                if (plate && el) {
                  var pr = plate.getBoundingClientRect(), r = el.getBoundingClientRect(), s = pr.width / ${w};
                  if (s > 0 && r.width > 0 && r.height > 0) {
                    var fw = (r.width / s) * ${1 + PAD}, fh = (r.height / s) * ${1 + PAD};
                    if (fw / fh < ${w} / ${h}) fw = (fh * ${w}) / ${h}; else fh = (fw * ${h}) / ${w};
                    framed = { cx: (r.left + r.width / 2 - pr.left) / s, cy: (r.top + r.height / 2 - pr.top) / s, k: ${w} / fw };
                  }
                }
                return framed;
              })()`,
    // The move always leaves the wide shot, so the scale ratio IS the landing
    // scale and both eases take the same argument. Built here, from a number, so
    // the curve a given progress maps to is fixed before the timeline exists.
    `var dsZoom = dsZoomEase(dsFramed.k)`,
    `var dsPan = dsPanEase(dsFramed.k)`,
  ];
}

/**
 * The move itself. Two `fromTo`s on the rig, plus the container's fade.
 *
 * Every value that depends on the measurement is an EXPRESSION over `dsFramed`,
 * which `cameraMeasure` has already assigned by the time these statements run.
 * So GSAP is handed numbers, and the timeline is as seekable as one written here
 * at emit time — no function value evaluated on a first render whose position in
 * the deck depends on how many workers the renderer happened to start.
 *
 * `immediateRender: false` is not optional: with it, the rig has no transform at
 * all before `t0` — which is the neutral framing — and GSAP holds the landing
 * transform after the move ends, which is the framing the incoming scene opens
 * on.
 */
export function diveStatements(sid: string, format: Format, d: Dive, over = 0): Tween[] {
  const landing = round(d.t0 + d.dur);
  return [
    fromTo(
      `#${sid} .ds-zoom`,
      { scale: 1 },
      {
        // `raw`, not a string: every one of these is JavaScript. `ease: "dsZoom"`
        // would be a GSAP ease NAME, which does not exist, so GSAP would fall
        // back to its default curve and the camera would land on the wrong one
        // with every gate green.
        scale: raw("dsFramed.k"),
        duration: d.dur,
        ease: raw("dsZoom"),
        immediateRender: false,
      },
      d.t0,
    ),
    fromTo(
      `#${sid} .ds-pan`,
      { x: 0, y: 0 },
      {
        x: raw(`${format.width / 2} - dsFramed.cx`),
        y: raw(`${format.height / 2} - dsFramed.cy`),
        duration: d.dur,
        ease: raw("dsPan"),
        immediateRender: false,
      },
      d.t0,
    ),
    // Dips AFTER the landing, never during the move: a container that
    // disappears mid-flight leaves the camera flying over an empty world.
    // The dip runs `over` seconds PAST the end of this scene's slide, into the
    // next one's window, for the same reason a camera-free scene gets
    // `handoffStatement`: it must still be fading while the incoming scene
    // opens, or the deck cuts to background between the two. `diveTail` is
    // deliberately unchanged — the tail this scene ADDS to the deck's running
    // clock is still dive + fade, and only the CLIP outlasts it.
    fromTo(
      `#${sid} .ds-zoom`,
      { opacity: 1 },
      {
        opacity: 0,
        duration: round(d.fade + over),
        ease: "power2.in",
        immediateRender: false,
      },
      landing,
    ),
  ];
}

/**
 * THE TYPE FLOOR UNDER A CAMERA.
 *
 * The 40px rule is about what the audience can READ, so under a camera it has to
 * be stated in final rendered pixels rather than in the emitter's font-size:
 *
 *   At every stop time t_s, for every text node n intersecting the viewport,
 *     effOpacity(n, t_s) == 0  OR  finalPx(n, t_s) >= 40
 *   where finalPx = computedFontSize x screenScale and effOpacity is the product
 *   of computed opacity to the root. TRANSIT IS EXEMPT, and is exempt only
 *   because the deck never rests between stops.
 *
 * That reading is what lets a cropping camera reach 1.55-1.75x where a camera
 * that had to keep everything inside a safe box was stuck at 1.127x: text that
 * leaves the frame is not small, it is absent, and nobody is asked to read it.
 *
 * This function is the part of that rule an emitter can enforce WITHOUT a
 * browser, and it enforces it by making the general case unnecessary: if no stop
 * falls inside the move, then at every stop of a cameraed scene the rig is at
 * scale 1 (before `t0`, because `immediateRender: false` leaves no transform) or
 * at the landing scale with the region filling the frame (after the landing,
 * where every surviving glyph is LARGER than it was authored). Either way the
 * static 40px floor the archetypes already satisfy is still the true floor, and
 * the browser-measured rule above is only needed once a stop lands mid-camera.
 *
 * Throws rather than warns: a stop inside a camera move is a frame where the
 * audience is asked to read text at an arbitrary scale, and that is exactly the
 * class of defect that ships green.
 */
export function assertStopsOutsideMove(sid: string, holds: readonly number[], d: Dive): void {
  const end = round(d.t0 + diveTail(d));
  const inside = holds.filter((hold) => hold > d.t0 && hold < end);
  if (inside.length) {
    throw new Error(
      `${sid}: stop${inside.length > 1 ? "s" : ""} at ${inside.join("s, ")}s fall inside the camera move [${d.t0}, ${end}). ` +
        `Text is measured in final rendered pixels, so a stop mid-move has no checkable 40px floor. ` +
        `Give the beat more seconds, or drop its \`inside\`.`,
    );
  }
}

/** Times are attribute and source text; round so float drift never moves a byte. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
