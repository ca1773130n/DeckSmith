# 015 — the experiment that decides whether to build the vocabulary

Pre-registered in `PREREGISTERED.md` before anything was generated. 40 Codex runs,
40 decks built, 41 decks rendered, ~350 frames measured, 11 frames opened by eye.

---

## THE ANSWER

**The pre-registered metric says expose it. The pre-registered metric is wrong, and
I can show you the frame that proves it.**

| reading | arm MENU | arm VOCAB | Δ | Fisher 2-tailed | §7 branch |
|---|---|---|---|---|---|
| **pre-registered primary** — 0 errors from `hyperframes check` + the 40px floor | **18/20** (90%) | **16/20** (80%) | −0.10 | **p = 0.661** | **R1 — expose it** |
| post-hoc, minus decks whose diagram never appears | 18/20 | **12/20** (60%) | −0.30 | p = 0.065 | R3 — do not expose yet |
| sensitivity: a permissive emitter that ignores an op on the wrong object | 18/20 | 20/20 | +0.10 | p = 0.487 | R1 — expose it |

Four of arm VOCAB's sixteen **gate-clean** decks render their main diagram as
nothing at all. Boxes and labels are in the DOM, sized legally, positioned legally,
and multiplied to zero opacity by a group they are nested in. `lint`, `runtime`,
`layout`, `motion`, `contrast` and the 40px floor all pass on an empty frame. Arm
MENU cannot express that error, because revealing what a beat draws is the
archetype's job and the plan never mentions opacity.

So the honest answer to the owner is not a branch of §7. It is:

> **Reliability is not what stops you. Measurement is.** The compositional
> vocabulary reaches 80% on the gate this project currently has, against the menu's
> 90%, and the difference is not significant at n = 20. But the gate cannot see the
> algebra's characteristic failure — content that exists and is never shown — and it
> found that failure in 20% of runs. Do not decide exposure on this experiment.
> Decide it after a fidelity gate exists, and the number to pre-register is
> **"the diagram appeared"**, not "the deck passed".

The one thing that is settled: **schema validity is not the risk and never was.**
40 of 40 runs validated, 40 of 40 resolved every reference, both arms, first try.
The risk is entirely downstream of the schema.

---

## 1. WHAT WAS PRE-REGISTERED, AND WHAT I DID WITH IT

Everything in §4–§7 of `PREREGISTERED.md` was computed exactly as written.
`judge.mjs` transcribes the decision rule into code so the branch is arithmetic
rather than a judgement, and it fired **R1**.

I am reporting R1 as the pre-registered result **and telling you not to act on it**,
because §8 of the pre-registration says the artifact gets opened and reported
whether or not it helps. It did not help. This is the promised behaviour, not a
retreat from it: renegotiating the metric now would be exactly the move that made
6/8-vs-3/8 reverse, so the corrected number is labelled **post-hoc** everywhere it
appears and it is offered as the metric a *new* experiment should pre-register.

**Fisher's exact test is computed, not looked up** (`judge.mjs:fisher`). It
reproduces the three values published in `VOCABULARY-REVIEW` §3.1 — 6/8 vs 3/8 →
0.3147, 0/8 vs 2/8 → 0.4667, 8/8 vs 3/8 → 0.0256 — which is why I trust it here.

---

## 2. EQUAL SPECIFICATION, MEASURED

`run.mjs` refuses to launch outside the pre-registered band.

| | human-written guidance | schema | whole prompt |
|---|---|---|---|
| arm MENU | **13,122 B** (shipped `systemPrompt`) | 18,265 B | 15,657 B |
| arm VOCAB | **12,603 B** (`prompt.mjs`) | 3,588 B | 15,785 B |
| ratio | **0.96×** — inside the ±10% band | 0.20× | 1.01× |

Neither schema carries a single `description` string, so neither arm has an
information channel the other lacks. The task, the preferences block, the closing
instructions and `renderSource(source)` are byte-identical strings in both arms.

**The named limitation** (PREREGISTERED §2.1): the schemas cannot be equalised. A
menu's schema *is* its specification — twelve archetypes, sixty-eight fields — and
that 14.7 KB cannot be handed to a grammar without inventing archetypes. Arm MENU
therefore still holds ~15 KB of enumerated structure arm VOCAB does not. Everything
below should be read with that in it.

Both arms were pinned to **`gpt-5.5`, reasoning effort `medium`** on the command
line rather than left to the local Codex config, because `VOCABULARY-REVIEW` §7
could not attribute the previous 26 runs to any model.

**Disclosed, because it was a generation run outside the batches:** one arm-VOCAB
calibration run (`runs-calib/vocab-01/`) was made before the batches, to time a run
and to confirm `emit.mjs` could build real model output at all. It took 174 s and
built clean. It is **not** in any count in this report, and no arm-MENU counterpart
was run — arm MENU's timing was already known from 013. Nothing about the metric,
the arms or n was chosen from it; those were fixed in `PREREGISTERED.md` first.

---

## 3. EVERY PLAN WAS BUILT

`VOCABULARY-REVIEW` §4: 26 runs, zero decks. Here:

- **Arm MENU**: `node dist/cli.js build`, the shipped verb, unedited. Also put
  through `npm run score`, which receipted all 40 files (raw capture and
  null-stripped plan) in `experiments/score/ledger.json`. **36/40 PASS = 18/20 per
  plan, which matches this experiment's gate exactly** — a useful cross-check that
  the gate really is nearly the whole shipped verdict.
- **Arm VOCAB**: `emit.mjs`, 813 lines, written for this experiment on the pattern
  of `experiments/014-seam-b/emit.mjs`. It refuses to repair its input (see §5).
- **Both**: one function, `gate.mjs` → shipped `check()` + shipped
  `scanTypeFloor()`. No second opinion, no lookalike.

### The refutation control passed, and it mattered

`control/task.json` (the same three-beat task, hand-composed) and
`control/ops.json` (every object kind and every op) are both **gate-clean**, and
`control/task.json`'s frames were opened. Writing them found three real emitter
bugs before a single generation run: my scene-3 bar arithmetic put value labels
inside their bars, a 1.1× scale on an inline KaTeX span produced three
`content_overlap` errors, and the carrier equation broke across three lines because
`.ctr` shrink-to-fits inside a zero-width anchor. All three would have been charged
to arm VOCAB.

---

## 4. THE PART THAT MATTERS MOST: MY OWN INSTRUMENT WAS WRONG THREE TIMES

The arm-VOCAB headline moved **8/20 → 10/20 → 16/20** as I fixed `emit.mjs`, and
**every** error was in the same direction — against the vocabulary. Had I stopped at
any earlier point I would have reported a significant downgrade with a p-value.

| # | what I first reported | what it actually was | cost |
|---|---|---|---|
| 1 | 4 plans "asked to highlight two overlapping terms" | `\htmlClass` **nests fine** in KaTeX. Four runs asked to light the encoder *and* its argument — a legitimate walk-the-equation move. My right-to-left splice could not express nesting and threw. | 8/20 → 10/20, p 0.0022 → 0.0138 |
| 2 | 6 plans put labels off the canvas | **My emitter disagreed with its own prompt.** A child nested in a group inherited the group's offset, so `at` was parent-relative while the prompt said "FRACTIONS of it [the stage]". Four stage boxes at (0.17, 0.47) inside a group at (0.17, 0.47) landed at (0.34, 0.94), half off the bottom. | 10/20 → 16/20, p 0.0138 → **0.661** |
| 3 | (found by the control, before any run) | three layout/emission bugs, §3 | would have been charged to arm VOCAB |

Bug 2 is the one to dwell on. `vocab-20` scored DIRTY with three
`canvas_overflow` errors and a real, checkable, reproducible failure — and it was my
bug. Here is that deck's first slide before and after a two-line change to
`objectHtml`, at the same hold:

- `out/f-vocab20-7.9.png` — boxes fallen off the bottom, arrows pointing at nothing
- `out/f-vocab20-fixed.png` — a correct four-stage flow with a real self-loop

**A gate failing is not evidence either.** This project has a catalogue of green
gates over wrong output; this is the mirror, and it is just as dangerous, because a
red gate that agrees with your hypothesis is the one you stop investigating. The
only reason it was caught is that the pre-registration required opening a broken
output, and the broken output turned out to be mine.

---

## 5. THE FOUR REMAINING ARM-VOCAB GATE FAILURES, AND WHY THEY ARE ARGUABLE

All four are one thing: **`highlight` applied to a `rect`** — the bar for
DQ-CTM-SR — which is precisely the defect class `VOCABULARY.md` §1 names, "an op
applied to the wrong kind of object: renders nothing, complains about nothing". The
prompt forbids it twice. `emit.mjs` refuses, the way `equation-walk.ts:144/228`
refuses an unlocatable term and seven archetypes refuse a beat they cannot lay out.

**And in three of the four, the rendered deck is correct anyway.** The model had
already set `tone: "c"` on that bar, so the misapplied `highlight` was redundant;
under a permissive emitter (`DS15_PERMISSIVE=1`, the sensitivity arm) all four build
and all four are gate-clean — `out/f-perm05-26.8.png` is a legible, correct,
correctly-ordered bar chart with DQ-CTM-SR distinguished.

So the choice of whether an emitter throws or shrugs moves arm VOCAB between
**16/20 and 20/20**, and `PREREGISTERED.md` did not pin it down. That is a genuine
gap in my pre-registration and I am naming it rather than picking the number I
prefer. What the two readings agree on: **R2 — "measured downgrade" — never fires,
under any reading.** The strict reading gives p = 0.661 and the permissive one
p = 0.487. There is no reliability case against the vocabulary in this data.

---

## 6. CASE THIRTEEN: A GREEN GATE OVER A BLANK SLIDE

The finding the primary metric could not see, found by opening four frames.

**`vocab-18` is gate-clean with zero errors, and its first slide is a headline over
three grey arrowheads.** Four stage boxes and four labels are on the plate; none of
them is ever visible. `out/f-vocab18.png`. `vocab-11` is the same disease:
`out/f-vocab11-8.3.png` shows a loop arrow returning into empty space and a label
reading "ticks return here" pointing at nothing. Both PASS.

### The mechanism, and the prompt walks the planner into it

Two rules that are each correct:

> "`opacity` is the object's state at t = 0 … an object that should fade in must be
> authored at opacity 0."
> "`group` … one tween on the group moves, fades or scales all of them together."

Compose them — author the children at 0, fade the **group** in — and CSS multiplies
1 × 0 = 0 forever. `vocab-18` fades in `g-enc`, `g-win`, `g-think`, `g-dec` and
never touches the boxes' own opacity. The composition is internally coherent, every
reference resolves, every tween is a legal `fromTo`, and the deck is empty.

### Measured two ways, and they agree

| | method | plans affected |
|---|---|---|
| `invisible.mjs` | arithmetic over the plan: effective opacity is the product down the parent chain; which drawables are never above 0 at any hold | **4/20** — vocab-11, 13, 16, 18 — **all four gate-clean** |
| `ink.mjs` | measurement over the **render**: seek to every hold each plan declares, count non-background pixels in the band the diagram lives in (y 0.22–0.95) | **5/20** — the same four plus vocab-10, whose only empty hold is its scene landing |

Arm MENU: **0 of 20**, on ~200 measured holds, median body ink 20.8%.

The numbers are unambiguous once you look at them per hold. Body ink across a
scene's holds:

```
vocab-01  (0 invisible)   0.94  2.10  3.21     content arriving
vocab-11  (8 invisible)   0.00  0.03  0.76  0.79
vocab-16 (15 invisible)   0.00  0.05  0.10  0.36      … and its bar chart: 0.71 1.17 1.37 1.66 2.50
vocab-18  (8 invisible)   0.00  0.06  0.51  1.27
control   (hand-written)  0.88  …  median 3.08          the calibration point
```

**A measurement that failed, reported because it failed.** Whole-frame ink does not
work: arm MENU 16.5%, arm VOCAB 3.4%, and the **hand-written control 3.6%** — sitting
among arm VOCAB's failures rather than above them. The 5× gap between arms is a
drawing-style difference (an archetype fills its stage boxes with a panel colour; a
composed plan draws outlines), not a defect signal. Only excluding the headline band
makes the measure discriminate. Four metrics and three winners is how the last
attempt went wrong; this one is kept in the open.

**Neither measure is pre-registered.** The post-hoc corrected reading — arm VOCAB
16 − 4 = 12/20 — gives Δ = −0.30 at **p = 0.065**, which does *not* clear R2's
threshold either. Even the correction is underpowered.

---

## 7. SECONDARY METRICS (named as secondary; they cannot move the decision)

| | arm MENU | arm VOCAB |
|---|---|---|
| S1 schema-valid | **20/20** | **20/20** |
| S2 a deck was produced | 20/20 | 16/20 (4 refusals, §5) |
| S3 error rules | `canvas_overflow` ×1, `text_box_overflow` ×1 | `emit_refused` ×4 |
| S4 shipped `decksmith build` verdict | **18/20 PASS** — identical to the primary gate | no shipped path exists |
| S5 median wall clock | **32 s** | **157 s — 4.9×** |
| S5 median JSON bytes per unit | 1,238 | **4,669 — 3.8×** |
| S6 used the camera | 20/20 | 20/20 |
| S7 failed only the 40px floor | 0 | 0 |
| refs resolve | 20/20 | 20/20 |
| infrastructure losses | 0 | 0 |

**The cost figures reproduce 013's almost exactly** (4.7–6.4× wall clock, 4.0×
JSON), at n = 20 instead of n = 8, on a pinned model, with equalised guidance. Those
were the three numbers `VOCABULARY.md` §7 said carried the decision after the clean
rates were withdrawn, and they stand: **4.9× the wall clock and 3.8× the JSON.**

Every plan produced exactly 3 units, both arms. Every plan used the camera when
asked to. Nothing in this data supports the "planner cannot compose a graph" worry:
zero dangling references in either arm.

---

## 8. THINGS FOUND ALONG THE WAY

### A shipped bug: `transitWindow` under-reports the camera window by `over`

Arm MENU's `menu-10` FAILs with 13 `canvas_overflow` errors, and it is not the
plan. Controlled test, the one the review used on A-04: delete
`beats[1].inside` — one field — and it PASSes.

`diveStatements` makes the dip `d.fade + over` long (0.4 + 0.4 = 0.8), running
`[11.4, 12.2]`. `transitWindow` publishes `[t0, t0 + d.dur + d.fade]` = `[10, 11.8]`.
The 0.4 s of `over` is unexempted, so `regrade` grades a legitimate mid-camera-move
frame as an error. `out/f-menu10-11.978.png` is that frame: the plate magnified onto
the Window stage, neighbours clipped mid-word, the incoming scene's eyebrow already
fading in over it. Nobody stops there — the dip is still running.

The comment at `camera.ts:405` explains why `diveTail` deliberately excludes `over`
from the deck's running clock, and that reasoning is right. `transitWindow` reuses
`diveTail` for a different job — publishing when off-canvas is legitimate — and that
window has to cover the whole time the magnified plate is on screen. One of arm
MENU's two failures is this bug. I own `experiments/015-decision/` only, so it is
reported, not fixed.

### Two corrections owed to `VOCABULARY-REVIEW`

- **§4.2, the pipeline self-loop, is FIXED.** All 20 arm-MENU plans asked for
  `loop: {from: 2, to: 2}` and `pipeline.ts` now draws a real self-loop
  (`self: p.loop.to === from`, line 415). `out/f-menu01-8.5.png` shows the dashed
  arrow leaving DQ-CTM and returning to DQ-CTM. The tenth case is closed; I
  re-derived the old clamp arithmetic from the review before checking the current
  source, and was wrong for one commit's worth of reading.
- **§9.4, "the camera feature fails the shipped gate wherever it is used", is
  FIXED.** `experiments/score/ledger.json` records 24/24 PASS including both camera
  fixtures and `sb-A-04`. What remains is the narrower `over` bug above.

### `scored.test.mjs` cannot see a compositional plan

The enforcement test that makes "nobody built it" impossible discovers plans by
**shape** — `beats` + `title` + `sourceId`. Arm VOCAB's 20 plans have `scenes`, so
all 20 are invisible to it. The mechanism built to stop this experiment's predecessor
would not have stopped this experiment. If the vocabulary ever ships, `looksLikeStoryboard`
needs a second shape.

---

## 9. TWO REAL OUTPUTS

**Good** — `out/f-vocab01-bars.png`. Arm VOCAB, gate-clean, and correct: five bars
smallest-first, heights proportional to the source's own numbers, DQ-CTM-SR toned
apart, every value label above its bar and clear of the fill, and the headline says
the thing the task insisted on ("second largest", not "cheap"). Nothing here came
from an archetype. `out/f-vocab20-fixed.png` is the same story for the flow, self-loop
included.

**Broken** — `out/f-vocab18.png`. Arm VOCAB, **gate-clean, zero errors**, and the
slide is a headline over three grey arrowheads. Eight drawables — four stage boxes,
four labels — are present, sized, placed, and invisible for the whole scene. The
audience stops there for 1.4 s of narration about a diagram that is not on screen.
`out/f-vocab11-8.3.png` is the same failure with a caption pointing at nothing.

Also worth opening: `out/f-menu10-11.978.png` (§8, arm MENU failing on a frame
nobody sees) and `out/f-perm05-26.8.png` (§5, a correct deck that only exists
because the emitter shrugged).

---

## 10. WHAT n WOULD SETTLE IT

`PREREGISTERED.md` §6 said n = 20 per arm detects ~35 percentage points and nothing
smaller, and that is what happened: the largest effect in the data, Δ = −0.30 on the
post-hoc reading, lands at p = 0.065.

To settle the differences that are actually in play, at α = 0.05 and 80% power on a
two-proportion test:

| difference to detect | n per arm |
|---|---|
| 90% vs 60% (the post-hoc reading) | **32** |
| 90% vs 70% | 62 |
| 90% vs 80% (the pre-registered reading) | 199 |

**n = 32 per arm is the number to run**, and it is affordable: 64 runs at 32 s and
157 s is about 35 minutes at 5-way concurrency, plus 10 minutes of builds and gates.
That would settle the post-hoc reading. Settling the pre-registered 10-point gap
needs 199 per arm — four hours of Codex and 400 gate runs — which is itself the
finding that R1's margin is a direction and not a measurement.

**But do not spend it on this metric.** A fidelity gate — "did the diagram appear",
"does the picture say what the narration says" — changes the answer by 20 points on
arm VOCAB in this data, which is twice the effect the primary metric was measuring.
Build the gate first; the sample size question is second.

---

## 11. WHAT I WOULD TELL THE OWNER

1. **Reliability is not the reason to refuse the vocabulary.** 80% against the
   menu's 90% on the shipped gate, p = 0.661, with matched guidance and a pinned
   model, and 20/20 schema-valid with zero dangling references in either arm. The
   013 finding that the algebra "validates and builds less often" does not survive
   n = 20 and an equalised prompt. Neither does its reverse.
2. **Cost is.** 4.9× the wall clock and 3.8× the JSON, reproduced at n = 20. That
   is the same conclusion `VOCABULARY.md` §7 reached and it is the one number in
   this whole workflow that has never moved.
3. **The blocker is the gate, not the vocabulary.** Twenty per cent of arm-VOCAB
   runs shipped a slide with no diagram on it and every gate green. That is case
   thirteen, and unlike the previous twelve it is not a bug you fix — it is a whole
   class the stack has no instrument for. Exposing an algebra to the planner without
   a fidelity gate means shipping blank slides at some rate you cannot see.
4. **Three of my own bugs each looked like a significant result.** Anyone re-running
   this must budget for the instrument being wrong, in the direction of their
   hypothesis, more than once. The control that caught it was two hand-written plans
   and eleven opened frames.

---

## Reproduce

```sh
npx esbuild experiments/015-decision/_reexport.ts --bundle --platform=node \
  --target=node22 --format=esm --external:zod --external:puppeteer-core \
  --external:hyperframes --outfile=experiments/015-decision/out/bits.mjs

node experiments/015-decision/emit.mjs experiments/015-decision/control/task.json \
  experiments/015-decision/out/control-task      # the control must gate clean first

node experiments/015-decision/run.mjs menu  20 5   # ~11 min
node experiments/015-decision/run.mjs vocab 20 5   # ~11 min
node experiments/015-decision/judge.mjs runs 4     # build all 40, gate all 40
node experiments/015-decision/invisible.mjs        # case thirteen, by arithmetic
node experiments/015-decision/ink.mjs 3            # case thirteen, by measurement
npm run score -- experiments/015-decision --source demo/source.json --strip-nulls
```

| file | what it is |
|---|---|
| `PREREGISTERED.md` | the question, the arms, the metric, n, and the decision rule — before any run |
| `vocab.mjs` | arm VOCAB's schema: objects, transforms, a camera |
| `prompt.mjs` | both arms' prompts, and the byte budget `run.mjs` enforces |
| `emit.mjs` | arm VOCAB's build path. Does not repair its input |
| `gate.mjs` | the one gate, both arms, shipped `check()` + `scanTypeFloor()` |
| `run.mjs` | generation, one batch per arm, model pinned |
| `judge.mjs` | build every plan, gate every deck, Fisher, and §7's rule in code |
| `invisible.mjs` | never-visible content, by arithmetic over the plan |
| `ink.mjs` | never-visible content, by measurement over the render |
| `control/` | the refutation control: hand-written plans that must gate clean |
| `out/results.json` | every run, every verdict, every finding |
| `out/ink.json` | body ink at every hold of every deck |
| `out/f-*.png` | the frames quoted above |
