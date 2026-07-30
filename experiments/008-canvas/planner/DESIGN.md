# The animation planner — the one stage we genuinely do not have

**Experiment 008 · animation-planner** · 2026-07-27
Written against `src/emit/kit.ts`, `src/emit/composition.ts` and the twelve emitters in
`src/emit/archetypes/`. Proof code and screenshots in `proof/` and `out/`.

---

## 1. The comparison, honestly

The pipeline ChatGPT proposed:

    Markdown -> Document Graph -> Story Planner (LLM) -> Scene Graph -> Animation Planner -> Web Runtime

What we have:

    Source -> Storyboard (Codex planner) -> Scene -> composition -> deck runtime

Four of the five map cleanly. `ingest` is the document graph, `plan` is the story planner,
`Scene` is the scene graph, `composition.ts` + `deck/runtime.ts` is the web runtime. One
does not map at all, and it is the fifth. **We have no animation planner.** Choreography is
written by hand inside each archetype's geometry function, and it is written as GSAP source
text.

The strongest evidence for this is not an opinion about `stack.ts`, it is `pace()` in
`src/emit/theme.ts`. That is the entire implementation of the only motion preference we
have, and it is two regexes over generated JavaScript:

```ts
const TIMES = /\b(duration|delay|stagger|amount|each|repeatDelay):\s*(-?\d*\.?\d+)/g;
const AT    = /,\s*(-?\d*\.?\d+)\s*\)\s*;?\s*$/;
```

The comment above it is careful and correct about why it has to work that way: half of a
timeline's arithmetic never passes through `tween()`, so the only thing left to manipulate
is the finished statement text. That is a correct solution to the wrong problem. A scalar
multiplier is the *only* preference expressible over a string of JavaScript. Rhythm,
emphasis, camera and cross-beat transitions are all inexpressible, and they will stay
inexpressible until choreography stops being text.

So the gap is real and it is exactly where the hypothesis said it was. What follows is
therefore not a defence of the current design; it is a proposal for the missing stage, with
the two constraints the hypothesis got wrong built in from the start — the deliverable is a
linear video, so a canvas has to collapse to a camera path over time; and the education
market needs to stop, go back, and jump, so discrete stops are a feature.

**Keep the stop. Lose the cut.** Everything below is that sentence turned into a type.

---

## 2. The split, against the real `Scene`

Today's contract:

```ts
interface Scene { html: string; tl: string[]; setup?: string[]; holds: number[]; css?: string }
type Emitter<A> = (beat: BeatOf<A>, ctx: EmitContext) => Scene;
```

`html` and `css` are what is on screen. `tl` and `holds` are how it arrives. They are
produced by the same function, from the same local variables, and `holds` is only correct
because the emitter remembered to keep it in step with `tl` by hand.

The proposal splits that into three stages and one new type.

```ts
// 1. the emitter. Geometry, and an opinion about structure. No times.
interface Figure {
  html: string;
  css?: string;
  setup?: string[];
  cues: Cue[];
  stage?: { sel: string; w: number; h: number; safe: Box };
}

interface Cue {
  sel: string;                 // already sid-scoped, exactly as today
  role: "eyebrow" | "headline" | "item" | "tag" | "link" | "note";
  step: number;                // stop group; negative is prelude and owns no stop
  after?: number;              // sub-order inside the step, in units of the rhythm's trail
  dir?: "up" | "down" | "left" | "right" | "in" | "none";
  weight?: number;             // 0..1 — which element is the point of the beat
  focus?: Box;                 // where it lives, for the camera
  custom?: { from: Vars; to: Vars; dur?: number };   // escape hatch
}

// 2. the planner. Fully timed, still structured.
interface Move { sel: string; at: number; dur: number; from: Vars; to: Vars; ease: string; why: ... }

// 3. the compiler. The only thing in the system allowed to write a tween.
compile(moves: Move[]): string[]
```

The whole stage is `choreograph(figure, seconds, style) -> { tl, holds }`, so
`composition.ts` keeps consuming exactly what it consumes now.

Three things to notice about `Cue`.

**It carries no time at all.** `stack.ts` currently writes `first = 0.9` and
`step = min(0.8, max(0.4, (beat.seconds - first - 1.5) / count))`. Under the split it writes
neither. It says "here are five items, each with a caption that trails it, and the top one
is the point". The 0.9 moves into a rhythm, where a preference can reach it.

**`step` is the stop.** `holds` is not accumulated alongside the tweens any more; it is
derived from the step grouping — a stop is the moment the step's *item* has landed. That
inverts today's failure mode. Today `holds.push(at + 0.62)` is a number the author has to
keep in agreement with a tween written eight lines earlier, and if it drifts, navigation
lands on a half-built slide and no gate sees it. Under the split the two cannot drift,
because one is computed from the other.

**`weight` and `focus` are things the emitter already knows and currently cannot say.** The
emitter knows the top plane is the focal point — it says so, in a comment, next to the
`ambient()` call. It knows exactly where every element sits, because it solved the layout.
Both facts are thrown away today at the moment they are most useful.

### Why the compiler is a separate step

`compile` is the only function permitted to emit a statement, and it emits nothing but
`fromTo`. That is currently a convention twelve authors have to remember, documented in
`kit.ts` and in `tween()`'s doc comment, and enforced by nothing. Making `Move` the only
thing that can become a statement turns a convention into a type.

It also buys the thing a per-archetype emitter structurally cannot do: a *chain* of camera
`fromTo`s, where each one starts from the state the previous one left. No single archetype
ever sees the whole sequence of framings, so no single archetype can compile a camera that
survives an arbitrary seek. The planner does see it. (Verified, not assumed — §5.)

---

## 3. Seekable, deterministic, and it still produces stops

- **Seek, not play.** A `Move` has an absolute `at` and a `dur` and becomes one `fromTo`.
  Nothing in the planner reads a clock, a delta, or `performance.now()`. Timeline position
  is the only input.
- **Determinism.** No `Date.now`, no `Math.random`. The same two/four-decimal rounding the
  emitters already use (`sec()`, `n()`) is applied at the same places. Two builds of the
  three proof decks are byte-identical (§5).
- **Stops.** `holds` is the planner's primary output; `tl` is the by-product. The clamp is
  the same one `holdsWithin` performs today, kept deliberately identical so a hold cannot
  fall outside its slide window and fail `emitIsland`.
- **The 40px floor and `fromTo`-only survive as types**, not as review discipline: the
  camera's zoom is floored at 1 and ceilinged by the figure's declared safe box, so it can
  never scale audience type down or crop it.

---

## 4. What this unlocks that is impossible today

### Pacing that changes rhythm, not speed

A rhythm is four independent numbers, not one:

```ts
interface Rhythm { lead; gap; gapMax; dur; trail; settle; travel; ease }
```

`animationSpeed` multiplies all of them together, which can only make the same rhythm
happen faster. Varying them against each other gives different pacing at the *same total
length*. `staccato` snaps an element in over 0.18s and then sits on it for 0.4s; `measured`
takes 0.85s to arrive and 0.25s to settle. Same geometry, same duration, different deck.

`gapMax` is worth calling out separately. `pipeline.ts` has the comment "fill the beat
rather than always racing" and then implements it as one more bespoke clamp; `stack.ts` and
`data-table.ts` each have their own. It is a property of a rhythm — `staccato` wants the
spare second as silence between snaps, `brisk` does not want it at all — and once it lives
on the rhythm, twelve hand-rolled clamps collapse into one solver that compresses *gaps*
first and durations last, because a squeezed gap reads as urgency and a squeezed duration
reads as a glitch.

`density` and `tone` become reachable the same way. `density: "sparse"` is a policy that
splits a step into two; `tone: "punchy"` is a rhythm.

### An emphasis model

`Cue.weight` plus `MotionStyle.emphasis: "none" | "focal" | "each"`. Under `focal` the
heaviest cue gets a longer, further, overshooting entrance (`back.out(1.4)`), a stop that
lingers 2.6x, **and an extra 70% of gap in front of it** — the deck pauses before the
punchline. In the proof, `even` holds are evenly spaced 0.80s apart; `emphatic` holds are
1.15s apart and then **2.70s** before the one that matters. Nothing about that is a speed.

### Camera as a verb, and its honest price

A camera Move is one more `fromTo` on the same paused timeline, so it is seekable and
deterministic by construction and needs zero runtime work — `deck/runtime.ts` already
sweeps a forward step across frames by seeking, so a camera move inside that span animates
for free. That is "keep the stop, lose the cut" with no new machinery: the stop is still a
settled frame, but arriving at it was a continuous push rather than a jump.

**But the camera has to be paid for, and the payment is geometric.** A camera can only move
inside slack, and every one of our archetypes fills its box. The first version of this proof
put the whole slide on the camera layer, and the first screenshot showed both consequences
at once: framing the bottom plane pushed the eyebrow off the top of the frame and the
right-hand notes off the side.

Two rules came out of that, and both are in the code:

1. **The chrome is not on the camera.** The headline is the beat's claim and the audience
   needs it at every stop. The camera is the *diagram's* viewport, not the slide's.
2. **A figure declares a `safe` box, and the zoom ceiling is `min(w/safe.w, h/safe.h)`.**
   A figure whose content fills its box gets no camera at all — silently and correctly.

For `stack` the diagram is therefore solved against a frame inset by 10%, permanently,
whether or not a camera is ever planned over it. The pile is 10% narrower and 10% shorter
than it is today. That is the real cost, and it has to be unconditional: a geometry that
changed with the animation style would put choreography back inside the emitter, which is
the thing this design exists to end.

With that budget, the measured ceiling on the proof beat is **1.127**, and the camera pans
up the pile across the reveal — 7 distinct framings over the beat (`out/measured.txt`).

### Reusable transitions between beats

Not delivered here, but this is the representation that makes it possible. Once entrances
are `Move`s over roles rather than strings, an exit is the same type with `from`/`to`
swapped, and two adjacent beats whose figures share a cue key can be paired into a carry
instead of a cut. That is the strong half of the hypothesis — "our scenes are isolated
islands" — and it needs this seam first. Claiming more than that would be dishonest: it also
needs `composition.ts` to stop treating scenes as independently-timed siblings, which is a
separate piece of work.

---

## 5. The proof, and what looking at it changed

`proof/` rewrites `stack` under the split and choreographs it three ways from one geometry.
`stackLayout` is **imported from the real emitter, unforked** — the geometry half of an
archetype is not what this touches. What is gone is lines 321–346 of `stack.ts`: two timing
constants, five `tl.push(tween(...))` and six `holds.push(...)`.

```
$ node proof/build.mjs
real emitter   holds: [1.52,2.32,3.12,3.92,4.72,5.6]   tweens: 13
planner:even   holds: [1.52,2.32,3.12,3.92,4.72,5.52]  tweens: 13  gaps: [0.8,0.8,0.8,0.8,0.8]
planner:emphatic holds:[1.28,2.43,3.58,4.73,7.43,8.01] tweens: 16  gaps: [1.15,1.15,1.15,2.7,0.58]
planner:brisk  holds: [0.85,1.25,1.65,2.05,2.45,2.85]  tweens: 13  gaps: [0.4,0.4,0.4,0.4,0.4]

"even" vs the hand-written timeline, per stop: [0,0,0,0,0,-0.08]
camera viewport 1700x656, safe 1508x411 -> zoom ceiling 1.127
```

The `even` rhythm is not an invention: it is `stack.ts`'s own numbers extracted
(`lead: 0.9, dur: 0.55, trail: 0.2, settle: 0.07, gapMax: 0.8`), and it reproduces **all
five item stops exactly**. The tail is 0.08s early because the original spends 0.6s on its
note where the rhythm spends 0.55 — an emitter-local constant the shared vocabulary
deliberately does not preserve. Reproducing the current output from the new representation
is what makes the migration checkable one archetype at a time.

### Measured in a browser

Screenshots are seeks of a paused timeline, taken through headless Chromium over CDP
(`proof/shoot.mjs`), because the shared MCP browser is being driven by two other workflows.

| Claim | Evidence |
|---|---|
| two builds are byte-identical | `shasum` over the three decks, twice, no diff |
| seek order does not matter | every stop reached forward then backward: identical opacity **and transform** on all 12 elements, all three decks |
| every stop is a settled frame | no element strictly between opacity 0 and 1 at any of 18 stops |
| type floor holds | `minFont = 40px` in all three, including under the camera |
| the camera actually moves | 7 distinct `transform` values across the beat in `emphatic`, 1 in `even`/`brisk` |
| rhythm does not disturb composition | at every stop, `even` and `brisk` agree on the computed style **and every attribute** of all 72 nodes in the scene; on a fresh load, seeking straight to a stop gives the identical PNG |

That last row is the one worth keeping. A pacing preference cannot change a slide's
composition, because a stop is a settled frame and a settled frame is a property of the
geometry. The rhythm decides only how you got there.

It is also the row I got wrong first, and the correction is in §5.3.

Screenshots: `out/shots/{even,emphatic,brisk}-hold{0..5}.png` and `-mid.png`.

`even-hold5.png` is the finished slide. It is *not* identical to what ships today, and the
difference is the camera budget rather than the choreography: the pile is 10% narrower and
10% shorter, which reads as a slightly airier slide with more dead space in the numeral
gutter. Look at it before deciding the camera is worth having, because that is the trade in
its entirety. `emphatic-hold0.png` is the same beat with the camera pushed into the bottom
plane, chrome and label spine both intact — that is what the 10% buys.

### Three defects found by looking

Consistent with the project's own rule that a screenshot is part of the definition of done,
all three passed every check I had written at the time.

**1. The camera cropped the claim.** Described above. The fix is architectural — chrome off
the camera, and a declared safe box — not a tweak to a number.

**2. `staccato` scheduled the next entrance behind a stop it had not reached.** With
`settle: 0.4` and the focal step's 2.6x linger, step 5 began arriving 0.16s *before* step
4's stop, so the tail note was 40% faded in at the stop before its own. The scheduler now
enforces `start(k) >= hold(k-1)`. A stop that is not settled is the exact failure the whole
`holds` mechanism exists to prevent, and it took a rhythm the original code could not
express to surface it — which is an argument for the representation, not against it.

**3. My own "stops are pixel-identical across rhythms" claim was false, and chasing it found
something the project should know.** I wrote it after the `even` and `brisk` stop
screenshots came back with matching SHA-256s. After the scheduler fix they stopped matching,
and the difference turned out not to be in the deck at all:

- At every stop the two decks agree on the computed style *and every attribute* of all 72
  nodes in the scene. Zero differing nodes.
- The PNGs nonetheless differ at four of six stops — at most **286 of 2,073,600 pixels
  (0.014%)**, max channel delta **29/255**, confined to `x 340–898, y 548–720`: the band
  where the translucent slab faces overlap.
- On a **fresh page load**, seeking straight to the last stop produces the **identical PNG**
  for `even` and `brisk`, and for a page that was walked stop by stop, and for a page swept
  60 frames first. All four hash the same.

So the difference is a property of the *capture session*, not of the content: seeking
through an animation leaves elements composited into layers, and blending translucent SVG
faces across those layers rounds a shade differently from blending them in one pass.

This matters beyond this experiment. If `render` reuses one page and seeks per frame — which
is the fast and obvious way to write it — then "two renders are byte-identical" holds only
because both take the same path through the timeline. It is not the same guarantee as "the
frame at time *t* is a function of *t*", and the gap between those two is exactly the kind
of thing EXPERIMENT-006 found when it discovered the determinism guarantee had never been
tested on images. Worth a deliberate check on the real render path, independently of
anything proposed here.

There is also a rounding trap worth recording: `r2(1.127)` is `1.13`, which is *over* the
zoom ceiling, and a camera one hundredth past its ceiling crops the label it was framing.
Zoom is floored, not rounded.

And a note on method: 60ms between a seek and a capture was not enough, and produced
screenshots that disagreed with themselves. `proof/shoot.mjs` waits 220ms.

---

## 6. What it costs, and the smallest change that pays

### Measured surface

Across the twelve archetypes (3,113 lines), choreography is roughly **193 lines** —
`tween(...)` calls, `holds.push`, and the step arithmetic feeding them. It is a small
fraction of each file and it is the fraction that is duplicated.

Six of the twelve use motion no role-to-verb mapping will ever cover: `strokeDashoffset`
draw-ons (`annotated-figure`, `grid`, `line-chart`), the previous-term release in
`equation-walk`, the loop sweep in `pipeline`, the bar growth in `bar-compare`. Those need
`Cue.custom`, which keeps the *timing* under the planner's control while leaving the
*motion* to the emitter. Without that escape hatch the vocabulary would have to cover all
twelve archetypes before any of it could ship, which is how a refactor like this dies.

The real cost is not the lines, it is the judgement: choosing step groups and weights per
archetype is a decision per archetype, and `bar-compare` and `annotated-figure` will take
thought. Budget an afternoon each for the three hard ones and under an hour for the rest.

### Recommendation: do the planner, but make it opt-in per emitter

The brief asks whether a shared choreography vocabulary — helpers the emitters call — would
capture most of the value for less. It would not, and the reason is specific. A helper still
leaves each emitter deciding order, grouping and stops inline, so a pacing or emphasis
preference has to be re-implemented at twelve call sites and will drift at the first one
that is special. The value here is not code reuse; it is having a *representation of
choreography that a preference can be applied to*. A helper does not produce one.

But the full-stage refactor does not have to happen at once. The smallest change that
unlocks the preferences is about six lines in `composition.ts`:

```ts
const out = emitScene(beat, ctx);                                  // Scene | Figure
const scene = "cues" in out
  ? { ...out, ...choreograph(out, beat.seconds, motionFor(prefs)) }
  : pace(out, speed);                                              // unchanged path
```

Which means:

- **Day one, nothing changes.** Ship `motion.ts` and one migrated archetype. Eleven emitters
  keep returning `Scene`, keep going through `pace()`, and stay byte-identical — which
  matters, because byte-identical output is this project's strongest regression test.
- Preferences become real the moment one archetype migrates, and coverage grows monotonically
  rather than in one 12-file commit that has to be reviewed as a unit.
- `animationSpeed` keeps working on both paths: `pace()` for un-migrated emitters, a scale
  over the rhythm's four numbers for migrated ones.
- The migration test per archetype is the one demonstrated here: does the `even` rhythm
  reproduce the stops the hand-written timeline produced?

The one thing that should *not* be deferred is the camera budget, because it is a geometry
change and geometry changes are the ones that need a screenshot. Give it to an archetype
only when someone is looking at that archetype.

### What this does not fix

- Scenes are still isolated islands. Cross-beat carries need `composition.ts` to change too.
- The known `ambientCss` duplication from EXPERIMENT-005 is untouched.
- Nothing here helps the raster-figure determinism problem.
- The claim that this makes decks *feel* less mechanical is unproven. It makes the
  preferences that would let us test that possible. That is the honest claim.

---

## 7. Files

| Path | What it is |
|---|---|
| `proof/motion.ts` | The planner: `Cue`, `Move`, `Rhythm`, `MotionStyle`, `planFigure`, `compile`, `choreograph` |
| `proof/figure-stack.ts` | `stack` under the split — geometry only, imports the real `stackLayout` |
| `proof/render.ts` | Builds three decks from one figure; prints the comparison numbers |
| `proof/build.mjs` | esbuild bundle + run. Writes only inside this directory |
| `proof/shoot.mjs` | Seek-and-screenshot every stop; asserts settledness, seek-order independence, type floor |
| `proof/compare.mjs` | Dumps per-element state at every stop for two decks and diffs it |
| `out/diff.html` | Canvas pixel-differ used for §5.3 (`window.diff(a, b)`) |
| `out/{even,emphatic,brisk}.html` | Standalone, offline, paused timeline; `?t=` or `?hold=` to seek |
| `out/numbers.txt`, `out/measured.txt` | The two tables above, as generated |
| `out/shots/` | 21 screenshots |

Reproduce: `node proof/build.mjs`, serve the directory, `node proof/shoot.mjs`.
