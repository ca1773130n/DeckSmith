# DECISION — the compositional vocabulary

Written after reconciling three workstreams: `experiments/015-decision/` (the
pre-registered experiment), `experiments/014-seam-b/` plus the landed deferred
measurement, and `experiments/016-watch/` (render-and-watch, plus the thirteenth
case). Every number below is either reproduced in this session or cited to the
file that holds its evidence.

---

## THE ANSWER, IN ONE PARAGRAPH

The pre-registered experiment fired **R1 — reliability is not the reason to refuse
the vocabulary** — and R1 is a *direction*, not a measurement: at n = 20 the design
could only detect a 35-point gap and the gap it saw was 10 points, p = 0.661.
So on the question actually asked, **we still do not know**, and the pre-registration
said so in advance. What the experiment did settle is that the thing everyone was
worried about is not the risk: 40 of 40 runs produced schema-valid plans with zero
dangling references, both arms, first try. What it also did — by opening frames,
which no metric asked it to do — is find a failure the entire gate stack is blind
to: **four of arm VOCAB's sixteen gate-clean decks render their main diagram as
nothing at all.** That is a 20-point effect, twice the size of the effect the primary
metric was measuring, and it is invisible to `lint`, `runtime`, `layout`, `motion`,
`contrast`, the 40px floor and `drift`. The decision therefore is not a branch of
§7 of the pre-registration. It is:

> **Do not expose the vocabulary to the planner yet, and do not spend the sample
> size that would settle the old metric. Build the fidelity gate — "did the diagram
> appear" — as a shipped gate first, then re-run 015 at n = 32 with that as the
> pre-registered primary. Build the algebra internally only as far as item 1–5 of
> `VOCABULARY.md` §7, which is a defensible month that contains no vocabulary and
> one visible capability.**

---

## 1. WHAT THE PRE-REGISTERED EXPERIMENT ACTUALLY SHOWED

| reading | MENU | VOCAB | Δ | Fisher 2-tailed | §7 branch |
|---|---|---|---|---|---|
| **pre-registered primary** — 0 errors from `check` + the 40px floor | **18/20** | **16/20** | −0.10 | **p = 0.661** | **R1** |
| post-hoc, minus decks whose diagram never appears | 18/20 | 12/20 | −0.30 | p = 0.065 | R3 |
| sensitivity — permissive emitter | 18/20 | 20/20 | +0.10 | p = 0.487 | R1 |

Three things this table earns, and they are worth more than the headline.

**The specification really was equalised.** Human-written guidance 13,122 B vs
12,603 B — 0.96×, inside the pre-registered ±10% band, enforced by `run.mjs`
refusing to launch outside it. Whole prompts 15,657 vs 15,785. Neither schema
carries a `description` string. That kills the review's §3.2 objection to 013, which
was that arm B had been given a third of arm A's specification. The residual
asymmetry is named rather than hidden: the schemas cannot be equalised (18,265 vs
3,588 B), and arm MENU keeps ~15 KB of enumerated structure that arm VOCAB does not.

**R2 never fires.** "Measured reliability downgrade" — the finding that would have
ended the question — does not appear under any reading, strict (p = 0.661) or
permissive (p = 0.487). The 013 claim that the algebra "validates and builds less
often" does not survive n = 20 with a pinned model and matched guidance. Nor does
its reverse.

**Cost is the one number in this whole workflow that has never moved.** 4.9× wall
clock (32 s → 157 s median) and 3.8× JSON per unit (1,238 → 4,669 B), reproducing
013's 4.7–6.4× and 4.0× at n = 20 instead of n = 8. `VOCABULARY.md` §7 already
rested the exposure decision on those three numbers after the clean-rate comparison
was withdrawn, and they stand.

### It was underpowered, and this is not a hedge

`PREREGISTERED.md` §6 fixed n = 20 knowing it detects ~35 percentage points and
nothing smaller. The largest effect in the data is Δ = −0.30 and it lands at
p = 0.065. To settle what is actually in play, at α = 0.05 and 80% power:

| difference to detect | n per arm | cost |
|---|---|---|
| 90% vs 60% (the post-hoc reading) | **32** | ~45 min of Codex + gates |
| 90% vs 70% | 62 | ~1.5 h |
| 90% vs 80% (the pre-registered reading) | **199** | ~4 h of Codex, 400 gate runs |

Needing 199 per arm to measure the pre-registered gap **is itself the finding**:
R1's margin is a direction, and reporting it as a measurement would be the same
mistake 013 made in the other direction.

### The instrument was wrong three times, always in the hypothesis's favour

Arm VOCAB moved **8/20 → 10/20 → 16/20** as `emit.mjs` was fixed, and p moved
0.0022 → 0.0138 → 0.661. Bug 2 was an emitter that disagreed with its own prompt:
a child nested in a group inherited the group's offset, so four stage boxes at
(0.17, 0.47) inside a group at (0.17, 0.47) landed at (0.34, 0.94), half off the
canvas. That single defect produced **all six `canvas_overflow` failures** charged
to the vocabulary. Compare `out/f-vocab20-7.9.png` with `out/f-vocab20-fixed.png`.

The lesson generalises past this experiment: **a red gate that agrees with you is
the one you stop investigating.** This project has a documented catalogue of green
gates over wrong output; that catalogue has a mirror image, and it is just as
expensive. Anyone re-running 015 must budget for their own instrument being wrong,
in their own favour, more than once.

---

## 2. WHAT IT COULD NOT SHOW — CASE THIRTEEN

Four of arm VOCAB's sixteen **gate-clean** decks draw their main diagram and never
show it. `out/f-vocab18.png` is a headline over three grey arrowheads with eight
drawables — four stage boxes, four labels — present, sized legally, placed legally,
and invisible for the whole scene. `out/f-vocab11-8.3.png` is a loop arrow returning
into empty space under a caption pointing at nothing. Both PASS with zero errors.

The mechanism is two rules that are each individually correct:

> "`opacity` is the object's state at t = 0 … an object that should fade in must be
> authored at opacity 0."
> "`group` … one tween on the group moves, fades or scales all of them together."

Compose them — children at 0, fade the *group* in — and CSS multiplies 1 × 0 = 0
forever. Measured twice and the two agree: `invisible.mjs` (arithmetic over the plan,
effective opacity as the product down the parent chain) says **4/20**;
`ink.mjs` (measurement over the render, non-background pixels in the body band at
every declared hold) says **5/20**. Arm MENU: **0 of 20** on ~200 holds, median body
ink 20.8%.

Two properties of this finding decide the whole decision.

1. **Arm MENU cannot express the error.** Revealing what a beat draws is the
   archetype's job; a menu plan never mentions opacity. So this is not a fair-fight
   defect the vocabulary happens to lose — it is a *new failure class that exposure
   creates*, at a measured rate of 20–25%.
2. **It is not a bug you fix.** The previous twelve cases were each a defect with a
   patch. This one is a class the stack has no instrument for. `ink.mjs` is the
   first thing in this repo that can see it, it is not shipped, and it is not
   pre-registered anywhere.

A measurement that failed is reported with it, which is the right habit: whole-frame
ink does not discriminate — MENU 16.5%, VOCAB 3.4%, and the **hand-written control
3.6%**, sitting among the failures rather than above them. Only excluding the
headline band makes the measure work. That is exactly the shape of the mistake 013
made (four metrics, three winners), caught in the open this time.

---

## 3. DOES THIS SUPPORT BUILDING THE COMPOSITIONAL VOCABULARY?

**Separate the two questions the workflow has been conflating.**

**(a) Expose the algebra to the planner? No, not yet — and the reason changed.**
The reason is no longer "it is less reliable" (unmeasured, p = 0.661) and no longer
"it cannot compose a graph" (refuted: 0 dangling references in either arm). It is
that exposure creates a failure class nothing can see, at 20–25%, and costs 4.9×
the wall clock and 3.8× the tokens to do it. Either of those alone would be
arguable. Together they say: not until the gate exists.

**(b) Build the algebra internally, as the way archetypes are written? 015 does not
speak to this at all,** and no one should read it as though it does. Its question
was reliability of *generation behind a schema*. The construction decision still
rests where `VOCABULARY.md` §7 left it, and this reconciliation does not move it:
≈14–20 weeks to reach a state where the vocabulary is how archetypes are written,
with the two items that would make it pay (item 6 vector verbs, item 8 re-expressed
archetypes) sitting downstream of item 7, the layout pass — the one line explicitly
labelled highest-variance, 3–6 weeks with a bad prior.

What the month-one slice (items 1–5) buys is real and should be sold honestly as
what it is: two refactors, a lint, one shipped bug fixed and one visible capability
(the keyed equation morph). **It contains no vocabulary.** Seam B has now landed for
one file's benefit and cost two files and a type — evidence that the seam estimates
in §7 are not wild — but Seam B's value showed up as a *determinism* fix, not as
expressive power, which is a hint about where this program's returns actually are.

---

## 4. WHAT THIS RECONCILIATION VERIFIED, AND WHAT IT CHANGES

**Seam B's claim is confirmed, including the uncomfortable half.** The camera
fixture's drift across worker counts is **201 of 594 frames, worst 51.52 dB —
unchanged** by deferred measurement, reproduced here from a fresh build. Pinned at
3 workers: **1 of 594, 63.54 dB**, a single frame. So the deferral is real and the
number the twelfth case published was never the camera's.

A control the seam-b workstream did not run settles the attribution independently:
**a deck containing one `grid` beat and no camera at all differs in 180 of 270
frames at 1 vs 3 workers, worst 51.52 dB — the same dB, and the differing pixels are
the same 10,393 in the same bounding box.** The diff mask is the grid's cell
outlines, on a 74.5 px lattice, ≤14/255 on hairline borders, and **identical from
one frame to the next across the whole shard** — a per-worker layerisation decision
taken at that worker's first seek and held, not per-frame dither. Above the 40 dB
floor, invisible to a viewer, and genuinely worker-count-dependent, which means
`--identical` cannot hold on any deck containing a grid. `src/emit/archetypes/grid.ts`
computes fractional cell pitch by construction, so making it hold would mean
integer-snapping every grid deck's layout — a byte-changing cosmetic change with a
wide blast radius, not worth it to satisfy a flag whose own error message says to
drop it.

**Byte identity holds where it must.** The camera-free 16:9 deck built from
`demo/storyboard.json` is byte-identical to a baseline built before any of the three
workstreams started (`demo/deck/`, 06:07): `index.html`
`01dacd10361e97a6c62c6109730359169b03b8940cc7d3f56f5be751a4ddb297`, `deck.html`
`ebebafd7…`. 9:16 differs, which is the intended effect of the thirteenth case's fix.

**The methodological point, which is the expensive one.** The twelfth case's
headline number was rasteriser noise misread as a determinism defect, and the fix
that followed it was justified only afterwards, by a control someone chose to run.
The thirteenth case was found by a human watching a video. Case thirteen-of-015 was
found by opening four frames. **Three consecutive findings in this project came from
looking at the artifact, and none came from a gate.** Gates are catching the classes
they were built for and nothing else, which is precisely the argument for spending
the next unit of effort on a new *kind* of gate rather than on more samples through
the old one.

---

## 5. THE NEXT STEP

**One thing, and it is not the vocabulary.**

**Ship a fidelity gate: "the diagram appeared."** `experiments/015-decision/ink.mjs`
is the working prototype — seek to every hold the plan declares, count non-background
pixels in the body band, fail a hold whose band is empty. It found 5/20 where the
plan arithmetic found 4/20, and 0/20 on the menu across ~200 holds, so it has a
measured false-positive rate of zero on the shipped path. Promote it into
`src/verify/`, give it a floor, and run it in `verify` beside the type floor. It is
the first gate this project would have that measures *what the audience sees* rather
than what the DOM contains, and on this data it moves the vocabulary's score by 20
points — twice the effect the primary metric was measuring.

Then, in order:

1. **Fix `transitWindow`'s under-reported camera window.** `diveStatements` runs the
   dip for `d.fade + over` (0.8 s) but `transitWindow` publishes `d.dur + d.fade`,
   so `regrade` errors on a legitimate mid-move frame — this is one of arm MENU's two
   failures (`menu-10`, 13 `canvas_overflow`) and deleting one `inside` field makes
   it PASS. **The obvious one-line fix is wrong**: `regrade` (`src/verify/check.ts:271`)
   exempts by *time alone*, with no scene or element scope, and `assertStopsOutsideMove`
   guards only `[t0, t0+dur+fade)` — so widening the window by `over` would exempt
   overflow anywhere in the deck for 0.4 s, including the *incoming* scene, whose
   first stop can land inside it. The fix needs to scope the exemption to the
   dipping rig, and the control that must be run is a deck whose incoming scene
   overflows at a stop inside the outgoing scene's `over` tail.
2. **Teach `scored.test.mjs` a second shape.** It discovers plans by `beats`, so all
   twenty compositional plans were invisible to the mechanism built to make "nobody
   built it" impossible. If the vocabulary ever ships, `looksLikeStoryboard` needs to
   know about `scenes`.
3. **Then, and only then, re-run 015 at n = 32 per arm** with "the diagram appeared"
   as the pre-registered primary. That is ~45 minutes of generation. Do not spend the
   199 per arm the old metric needs; the old metric is measuring the wrong thing.

**Not now:** the layout pass (item 7). It is the highest-leverage item in §7 and
also the highest-variance, and its value is unmeasurable until a gate can tell a
good layout from an invisible one.

---

## 6. IS THIS A PROFITABLE PRODUCT?

The honest reading of everything above, on the question the owner is actually asking.

**The vocabulary is not the product decision.** It changes the *rate* at which
capability #13 can be added — days instead of 380 lines — which is a real compounding
advantage and is invisible in a demo. It does not change what a buyer sees this
quarter, and 015 gives no evidence that it makes the planner better. The two things
in `VOCABULARY.md` that move the market position are the planner ceiling and the
layout pass, and neither is the algebra.

**The moat is not in the renderer either, and the project should stop paying for one
there.** The determinism work, the 2,011-line solver and the green-gate catalogue are
a switching cost: expensive, non-transferable, and worth nothing to a customer. This
session is a clean measurement of that. A full workstream went into deferred
measurement; it produced a genuine fix for a genuine defect (a camera landing 18
screen px off, 39 of 594 frames at 14.96 dB, visible in an opened frame) and the
headline number it was launched to move turned out to belong to hairline
anti-aliasing that no viewer will ever see. That is not wasted work — the defect was
real — but it is the wrong *kind* of work to be the main line.

**What is worth money is the one thing the buyer is actually buying.** In the
paper-to-explainer framing, the customer's failure mode is not "the deck is ugly",
it is **"the video was silently wrong and I published it."** That is the only thing
this project has a genuine, hard-won, hard-to-copy competence in — and case thirteen
says the competence has a hole exactly where the product's promise is. A deck that
passes every gate and shows a blank diagram is the product's core promise failing
silently. Twenty per cent of the time, on the authoring path we were about to open up.

So the profitable sequence is not "build the algebra". It is:

1. **Make "it was not wrong" checkable.** The fidelity gate, then the raster type
   floor (an imported JPEG currently carries 13 px column labels against a 40 px
   floor, and nothing can measure it), then the two `runtime.ts` playback defects
   that can wedge a deck on a missing mp3. Each of these is a day to a week, and each
   closes a way the promise fails in front of a customer.
2. **Sell the trust, not the framework.** Manim-for-the-web sells to developers who
   pay little and churn, against free incumbents. The deck-generator market buys
   templates, not algebras. Neither wants what the vocabulary is.
3. **Then find out whether a planner behind a schema can reliably produce an
   explanation worth watching.** That is the only open question with real upside, it
   is upstream of every renderer decision, and 015 is the first honest measurement
   pointed at it. It measured mechanics and found the mechanics fine. Nobody has yet
   measured whether the output *explains anything* — and `VOCABULARY.md` §8's own
   census says it currently does not: 37 of 58 tween sites are opacity, y and x, and
   zero CSS motion declarations are emitted by any of the twelve archetypes. A
   fade-and-slide slideshow with excellent typography is not a product a researcher
   pays for, and no algebra fixes that by itself.

**Bluntly: the cheapest path to knowing whether this is a business is the fidelity
gate plus one honest measurement of explanatory quality — call it two to three
weeks — not fourteen to twenty weeks of vocabulary.** If that measurement comes back
saying a schema-driven planner produces explanations a researcher would publish, the
vocabulary becomes worth its 14–20 weeks because the ceiling starts to bind. If it
comes back saying the output is a handsome slideshow, no amount of algebra will make
it a product, and the 14–20 weeks would have been the most expensive way to find that
out.

---

## 7. THE FIDELITY GATE, AS BUILT AND AS ATTACKED

Written by the reconciliation that followed §5. Every number below was re-derived
in this session by a harness that shares no code with the one that produced the
gate's own acceptance report, over 44 decks and 529 stops.

### What it is

`src/verify/fidelity.ts`. At every stop the artifact declares, seek the pinned
hyperframes runtime with `renderSeek(t, { suppressEvents: true })` — invariants 1
and 11, the same two arguments the renderer uses — screenshot through CDP, and
count the pixels below that scene's own caption that differ from the frame's modal
colour by more than 12/255. Fewer than **0.15% of the frame** is an error naming
the scene. The floor is the measured ink of one 40px label, so it is invariant 5
expressed in pixels rather than a number fitted to the corpus.

Three choices are load-bearing and each was checked against the alternative:
pixels not plan arithmetic (a DeckSmith storyboard never mentions opacity, so
`invisible.mjs` has nothing to read on the shipped path); the capture path not
`hyperframes snapshot` (snapshot omits `suppressEvents`, so it is permissive in
exactly invariant 11's direction); modal-relative not absolute luma (`ink.mjs`'s
luma > 26 counts a whole `mono` frame as ink).

### Measured separation

Re-derived independently, 44 decks / 529 stops: **TP 4, FP 0, TN 40, FN 0.** It
flags `vocab-11`, `-13`, `-16`, `-18` and names `s01-flow` in each. It flags none
of arm MENU's 20, none of the twelve other built VOCAB decks, neither hand-written
control, the twelve-beat demo in none of its four formats, and neither fixture.
Two full runs agree to **full double precision**, not merely to four decimals
(`vocab-09` 0.0066304976851851855 both times).

| | worst / best stop | margin to the floor |
|---|---|---|
| worst true positive (`vocab-13`) | 0.0387% | **0.26x** — fails by 3.9x |
| best true negative (`vocab-09`, one KaTeX line) | 0.6630% | **4.42x** |
| tightest DeckSmith format (demo 9:16) | 1.1382% | 7.59x |

**The 5-vs-4 dispute is closed by the frame, not by choosing.** `ink.mjs` called
`vocab-10` empty at 0.376%; opened, its emptiest hold is a headline over an
"Encode" box with a dim panel fill — a legitimate first step of a reveal, reading
2.703% background-relative. The true count is 4 of 20.

**The arm-correlated instrument confound, which the acceptance report did not
address.** All four positives are 015-emitter decks that declare no `.headline`,
so every one was measured on the 0.22H *fallback* band; all twenty negatives in
that arm are real DeckSmith builds measured on the stricter caption-tracked band.
That is the shape of a result produced by the instrument rather than the decks.
Control: re-measure all 20 MENU decks forced onto the same 0.22H fallback band.
They read 2.183–4.243%, **20 of 20 clean, x14.6 to x28.3**. The separation is the
decks. (The confound also runs conservative on both sides: the generous band was
given to the positives, the strict one to the negatives.)

### What survived being attacked, and what did not

**Case thirteen, reproduced from scratch.** One CSS rule holding every scene's
body at `opacity: 0; visibility: hidden` while the captions reveal normally.
`verify --no-fidelity`: **PASS, 0 errors, 0 warnings** — it even loses the
`connector_detached` warning the honest deck carries. `verify`: **FAIL, 12
errors**, all 37 stops at 0.0000%. Their four-scene blank-archetype control was
extended to all twelve: **0.0000% below the caption on every scene of the demo**,
so no scene is propped up by chrome.

**A deck that shows nothing and passes: could not be built on the shipped path
with a browser present.** `holdsWithin` always yields at least one stop, so the
"a scene with no holds is never looked at" hole is not reachable through the
archetypes — all 12 demo scenes and all 36 corpus decks declare ≥1.

**A legitimately sparse deck that fails: no, but the headroom is a quarter of what
the corpus advertises.** Every realistic sparse beat passes — a one-row benchmark
table, a two-line split-compare, a single-number equation, across 16:9, 9:16 and
1x1: worst 0.6317%, **x4.21**. Only *degenerate* content crosses: a one-cell table
whose cell is `.` fails at 9:16 (0.091%, correctly — the stage really is two dots
and two hairlines). But the tightest *legal* margin found is **x1.42**, not the
x4.4 the corpus suggests, and the mechanism that eats it is the caption-tracked
band: a five-line headline drives the band to 0.572H, far past the 0.382H the demo
ever reaches. **9:16 is the tight format** and the one to watch.

**The gate fails open, and this is the finding that matters for the re-run.** On
the fully blanked deck, `DECKSMITH_CHROME=/nonexistent/chrome decksmith verify`
returns **PASS — 0 errors, 1 warning** where the same command with a browser
returns **FAIL — 12 errors**. For a user build, `not_measured` as a warning is the
right call: "the instrument is missing" and "the deck is blank" are different
claims. For a pre-registered primary metric it is not, because a run that silently
did not measure is recorded as clean, and `verify()` returns only
`{ passed, findings }` — the stop count is dropped, so a harness cannot tell 466
measured stops from zero except by string-matching a warning.

### Cost

Standalone: 0.9–1.4s for a corpus deck's 8–14 stops, 3.8–4.1s for the demo's 37.
Inside `verify`, concurrent with `check`: median of three runs **5.78s without,
6.00s with** — +0.22s, inside the 0.70s run-to-run spread. Cheap enough to be on
by default, which it is; `--no-fidelity` exists for a machine with no browser.

### Can 015 be re-run at n = 32 with this as the pre-registered primary?

**Not yet. Two things are missing, and the first is not a detail.**

1. **`fidelity(dir)` cannot see an arm-VOCAB deck at all.** Those decks carry
   neither `timing.json` nor a slideshow island, so `readStops` returns nothing and
   the shipped entry point returns `not_measured` — a *warning*. Measured: all four
   known-bad decks score **clean** through the shipped call. The 4-of-20 result
   only exists when stops are supplied from outside, from the plan's own `holds`.
   So `experiments/015-decision/gate.mjs` must grow a stop source per arm — the
   emitter's `timing.json` for MENU, the plan's declared holds for VOCAB — and that
   asymmetry in the instrument has to be pre-registered as such, exactly as
   `ink.mjs` argued for it, rather than discovered afterwards.
2. **`not_measured` must invalidate a run rather than pass it.** Otherwise one
   flaky Chrome in 64 runs is scored as a clean deck, in the arm where clean decks
   are the hypothesis.

With those two, the design is sound and the primary is well-posed: separation is
17x between the worst positive and the best negative, the verdict is reproducible
to full float precision, and the floor comes from invariant 5 rather than from the
corpus it is validated on.

### What it still cannot see

Everything §2's prototypes could not, plus one now measured. It answers "something
was drawn", never "something was legible" — nothing in the stack grades contrast
for a *shape*. It looks only at declared stops. And it is per-scene, so
`vocab-16`'s third scene — a bar chart whose five bars are invisible while its
value labels and axis are not — reads 0.520%, 3.5x the floor, and passes. No
threshold fixes that; it needs the beat's intent, which is what an archetype
encodes and a composed plan does not.

---

## 8. A REGRESSION THIS WORKFLOW INTRODUCED, IN `regrade`

§5.1 predicted it and it happened. `transitWindow` now publishes
`t0 + dur + fade + over`, which is where the dip actually ends — the fix is right
about the *motion*. But `regrade` exempts `canvas_overflow`,
`panel_out_of_canvas` and `text_occluded` **by time alone**, and pre-fix the window
ended exactly where the incoming scene began, so no instant inside an incoming
scene was ever exemptible. It now extends `over` seconds into it.

**The deck that demonstrates it.** The camera fixture with the incoming beat cut to
0.5s — so `holdsWithin` clamps its stop to 0.35s, absolute **t = 11.15s**, inside
the published window `[9, 11.2]` and outside the pre-fix `[9, 10.8]` — and its
eyebrow and headline set to 220-character unbreakable words. `hyperframes check
--at 11.15` reports **9 `canvas_overflow` findings**, two of them `#s2-e` and
`#s2-h`: the *incoming* scene's own text, visibly running off both edges of the
canvas at a declared stop. The camera has landed, so the landed content is drawn
while the chrome is still fading in — which is why the earlier control, whose
incoming scene was invisible at its stop, could not find this.

One raw report, graded twice through `parseCheckReport`, one variable:

| window | verdict | errors |
|---|---|---|
| `[9, 10.8]` (pre-fix) | **FAIL** | 9, including `#s2-e`, `#s2-h` at t=11.15s |
| `[9, 11.2]` (fixed) | **PASS** | 0 — all nine excused |

The excuse's own message — "no hold is inside this window" — is false on this deck:
the hold at 11.15s is inside it. `fidelity` does not cover the gap either; ink at
that stop is 3.508%, 23x the floor, because the text is present, merely off-canvas.

**It is latent, not firing.** With the default nine uniform samples `check` does
not land in `(10.8, 11.2)` on any deck built here, which is why every gate is green
— the sample grid is a function of duration, so this is luck rather than a
guarantee. **The fix is to scope the exemption to the dipping scene's own sid,
which is already in the finding's selector.** Until then the transit exemption is
wider than the motion it was measured against, and `src/verify/check.ts`'s owner
should be handed this deck.

Separately, and pre-existing: `check`'s layout pass samples on its own uniform
grid and **never at the stops the deck declares**, so off-canvas text at a stop
goes unsampled whatever the camera does. `fidelity` is now the only gate that
looks at a declared stop.
