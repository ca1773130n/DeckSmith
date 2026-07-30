# VOCABULARY-REVIEW — adversarial read

Reviewing `.planning/VOCABULARY.md` (595 lines) and the six spikes under
`experiments/013-vocabulary/`. Everything I add is in
`experiments/013-vocabulary/review/`; `src/` is untouched.

**Summary.** The document's engineering is good and two of its recommendations
survive contact — do not move the renderer, and the plugin-`render()` finding is
real (I reproduced it). Its *decisive* number does not survive. The 6/8 vs 3/8
planner comparison rests on a post-hoc metric that excludes the one defect class
where the algebra wins; under the metric actually implemented in the spike's own
`score.mjs`, the result reverses to 0/8 vs 2/8. Neither is significant at n=8.
And the reason nobody noticed is the thing all seven of us missed: **in six
investigations and 26 Codex runs, not one planner output was ever built into a
deck.** I built three. One of the three the document scores *clean* fails
`hyperframes check` with 14 errors, and **all eight** arm-A plans contain a
diagram that silently asserts something the source does not say — a bug that also
ships in `demo/storyboard.json`.

---

## 1. THE ESTIMATE

### 1.1 What each number is actually from

| item | claimed | claimed basis | what I found |
|---|---|---|---|
| 1 Seam A | 2–4 d | counted | **basis is a token count, not a coupling count** (§1.2) |
| 2 Seam B | ~1 wk | guess from reading two functions | **too thin for the item the doc calls "not optional"** (§1.3) |
| 3 `immediateRender` lint | 1–2 d | guess | fine |
| 4 `equation-morph` | ~1 wk | spike timed ~3h | **the spike does not contain the thing being costed** (§2) |
| 5 `prompt.ts` holds | 1 d | measured | **verified.** `prompt.ts:200` says five sentences for a four-stage pipeline; I confirmed the line exists and the claim is checkable from `emitScene(beat).holds.length` |
| 6 Vector vocabulary | 1–2 wk | counted | plausible |
| 7 Layout pass | 3–6 wk | guess with a bad prior | **verified as the right label.** `fitBoxes` is called exactly once, at `pipeline.ts:296`, against 28 direct `wrap(` sites |
| 8 Re-express 2–3 archetypes | 1–2 wk | counted | **the other 9–10 are not costed at all** (§1.4) |

### 1.2 Seam A: "12 non-comment GSAP lines in 19,849" measures the wrong thing

`src` is 19,849 lines across 57 files — verified. But:

```
grep -rn "gsap" src --include="*.ts"                     →  4 lines
grep -rin "gsap" src --include="*.ts" (incl. comments)   → 24 lines
```

Four lines contain the token, not twelve. More importantly the token is not where
the coupling is. `Scene.tl` is an array of **GSAP source text**; `tween()`
(`title.ts:224`) returns the string `` `tl.fromTo("${target}", ${from}, ${to}, ${sec(at)});` ``;
there are **58 `tween(` call sites**; and `paceStatement` (`theme.ts:189`) rewrites
that text with two regexes, one of which — `AT = /,\s*(-?\d*\.?\d+)\s*\)\s*;?\s*$/`
— parses the trailing position argument of a GSAP call out of a string. Counting
lines that say "gsap" to size GSAP coupling is the bounding-box-instead-of-ink
error the brief warned about. The *conclusion* (don't move the renderer) is still
right, and is better supported by the renderer spike's 1,820 checks with 0
mismatches than by the line count. **Correct the number, keep the conclusion.**

Seam A itself at 2–4 days is credible: 58 call sites, ~37 test references to
`.tl` and 37 to `fromTo` across 29 test files.

### 1.3 Seam B is the load-bearing estimate and the thinnest basis

The doc costs it at "~1 week — guess, informed by the morph engine timed at ~3h
and by reading `sceneHtml`/`readyGate` (two functions)". Reading two functions is
not a basis for changing the shell's contract. I traced what reads build-time
timeline text or build-time times:

- `theme.ts:173` — `pace()` maps every statement through `paceStatement`, a
  regex over the emitted string.
- `composition.ts:330, 405` — the shell **appends** statements (`handoffStatement`,
  `diveStatements`) to `scene.tl` after the archetype returns.
- `composition.ts:704` — `sceneHtml` serialises them, synchronously at parse time.
- `island.ts` / `emitIsland` — holds become absolute fragment times at build time
  (invariant 8).
- `render/timing.ts` `framePlan` and `planTiming` — the retimer and narration
  timing consume holds at build time.
- `verify/check.ts`, `verify/drift.ts` — gates over the built artifact.

The good news the doc missed: `buildingFlag()` already sets
`window.__hfTimelinesBuilding = true` before any scene script, and `readyGate()`
clears it after `document.fonts.ready`, so **the barrier is fully wired** — a
scene *could* register inside it today. The bad news: the moment positions are
browser-measured, `tl` can no longer be a string the build can rewrite, so Seam B
strictly contains Seam A and touches at least six files rather than two.

I would not call this a week. Say **2–4 weeks**, or say "unknown until someone
enumerates what reads the statement text" — which is a half-day of work the
investigation could have done and did not.

### 1.4 The estimate excludes the transition

Item 8 costs "2–3 archetypes as proof" at 1–2 weeks. §3 then says eight of twelve
"would eventually be re-expressed… one at a time under existing tests" — costed
nowhere. At item 8's own rate (2.5–5 days each) the remaining nine are **4.5–10
weeks**. So either:

- **finish the transition: 12.5–23 weeks**, not 8–13; or
- **don't**: carry twelve hand-solved archetypes *and* a vocabulary indefinitely,
  which is two systems, two sets of layout bugs, and a permanent tax on every
  future change.

The document never states which. That is the missing half of the estimate the
brief asked about, and it is the larger half.

One further sequencing problem: items 6 and 8 are both downstream of item 7. You
cannot re-express `grid` or `stack` on a vocabulary until something places the
objects, and placement is 174 and 73 solver lines in those two emitters
respectively. A schedule whose last two items depend on the item explicitly
labelled "highest-variance" does not have a p50 at the sum of its parts.

### 1.5 What month 1 actually delivers

"What fits in one month: items 1–5." Read the list: two refactors, a lint, a bug
fix, and one archetype. **Month 1 contains no vocabulary.** That is a defensible
plan — the seams are worth doing on their own merits — but it should be sold as
"a month of enabling refactors plus one demo", not as the first month of a
vocabulary. And item 4, the one visible capability, has a dependency nobody
measured (§2.3).

**Verdict on the estimate: 8–13 weeks is the cost of *starting*, with Seam B
2–4× light and the migration omitted. Budget 14–20 weeks to a state where the
vocabulary is the way archetypes are written, and treat item 7 as able to double
on its own.**

---

## 2. THE MORPH SPIKE

It ran. `morph/out/` holds 60 PNGs, `report.json`, `fidelity.json`, `probe.log`,
all timestamped 23:13–23:15. `morph.js` is 438 lines / **275 code lines** —
the "275 lines" claim checks out exactly. I opened eleven frames.

### 2.1 The midpoints: keyed is fine, unkeyed is a mess, and the doc counts both

Seven "test cases" are **four distinct equation pairs**, three of them appearing
twice (keyed and unkeyed):

| case | groups A→B | what it is |
|---|---|---|
| swap / swapKeyed | 8→8 / 5→5 | `a²+b²=c²` → `c²−b²=a²` |
| fraction / fractionKeyed | 5→7 / 4→6 | `E=mc²` → `m=E/c²` |
| sum / sumKeyed | 17→17 / 3→3 | `Σ1/n²=π²/6` → `π²/6=Σ1/n²` |
| derivative | 4→4 | `d/dx(x²)=2x` → `d/dx(x³)=3x²` |

`out/sum-2-mid.png` — the unkeyed 17-leaf case — is exactly the failure the brief
predicted. At the midpoint the frame contains a floating detached `2`, an `n`
and a `2` overprinting each other as "n2", a `π` overprinted with an `=`, two
fraction rules hanging in space with nothing under them, and `6=` jammed
together. `out/swap-2-mid.png` is the same disease milder: `a`, `b`, `c` piled
in one vertical column while two `2` exponents float unattached, one at each side
of the frame.

The spike's own source names this and is more honest than the write-up. From
`morph.js:184`:

> "Matching GLYPH BY GLYPH … is visibly wrong: in `a^2+b^2=c^2 -> c^2-b^2=a^2`
> the three `2`s are interchangeable … The audience sees the letters swap and the
> exponents refuse to follow, **which asserts something false about the algebra**."

So VOCABULARY.md §1's "seeks correctly on all seven test cases" is true and
misleading in the same breath: seek-correctness holds on 7/7, visual correctness
on 4/7, and the three failures are the three that would run without an author
supplying keys.

The keyed midpoints I opened (`swapKeyed-2-mid`, `sumKeyed-2-mid`,
`fractionKeyed-2-mid`, `derivative-2-mid`) are legible and the signed arc does
separate exchanging terms as designed. The doc's own disclosure — "a stray
fraction rule sits on the π²" — is accurate; there are two of them.

### 2.2 What the keyed mode actually is

`sumKeyed` has **3 groups**: the entire `Σ_{n=1}^∞ 1/n²` is one key, `π²/6` is
another. Seventeen leaves move as two rigid bodies. `derivative` has 4 groups, so
`x²→x³` is a crossfade of a parenthesised blob, not a term morph.

The fine-grained, genuinely 3Blue1Brown-shaped mode is the unkeyed one, and it is
the broken one. **The spike did not demonstrate a mode that is both fine-grained
and clean.** The document reports the union of the two modes' best properties:
"term-by-term" from the unkeyed arm, "correct" from the keyed arm. Correct that.

### 2.3 The keys are hand-written TeX, not "a key list"

§1 says the morph "can be expressed as *two TeX strings plus a key list* — an
archetype parameter — and therefore inherits the archetype arm's 6/8
generability". What the spike accepts is TeX with the keys already embedded:

```
a: "\\htmlClass{ds-k-S}{\\sum_{n=1}^{\\infty} \\dfrac{1}{n^2}} = \\htmlClass{ds-k-P}{\\dfrac{\\pi^2}{6}}"
```

Turning a key *list* into that annotation is the substring-location problem
`equation-walk.ts` solves with `normalise`/`locate` and **throws** when it cannot
(lines 144, 228 — verified, and `equation-walk` is one of seven archetypes that
throw). So the archetype needs the planner to emit a key list that locates in
**both** TeX strings and that cuts the expression at the places a viewer would
find meaningful. Neither property was measured. The claimed inheritance of "6/8
generability" is an assertion about an untested capability.

Worse for the "one visible capability the owner can watch" framing: the choice of
keys *is* the animation. `sumKeyed` and `sum` are the same two strings and produce
a block slide and a glyph riot respectively, entirely because of how they were
cut. That decision is an authorial judgement, and it is the one thing you are
asking an LLM to make.

### 2.4 An undisclosed fidelity gap

`fidelity.json` compares each resting frame against a plain KaTeX render of the
same TeX. The document does not mention it. Measured:

| case | rest A vs plain KaTeX | rest B vs plain KaTeX |
|---|---|---|
| swap / swapKeyed | byte-identical | 40 px, max Δ 84 |
| fraction / fractionKeyed | byte-identical | 1,373 px, max Δ 226 |
| sum / sumKeyed | **4,663 px, max Δ 226** | **5,261 px, max Δ 226** |
| derivative | 1,317 px | 907 px |

I opened `fid-sum-a.png` and `fid-derivative-b.png`: the differences are **glyph
outlines only** — one-pixel edges around Σ, ∞, n, 2, 6 and around a `d` and a
fraction rule. So this is subpixel placement, not misplacement, and it is small
(0.003%–0.39% of the clipped band). But three things follow that the document
should say:

1. Rest-B differs in **7 of 7** cases while rest-A is exact in 4 of 7. The
   asymmetry is consistent with `R()` rounding transforms to 3 decimals
   (invariant 10): the morph's *end* state is a computed transform, so it never
   lands exactly on KaTeX's own layout.
2. This is the one place invariant 10 (determinism by rounding) and
   EXPERIMENT-006 (scaled-glyph rasterisation drift) actively trade against each
   other, and the morph sits on both.
3. `morph.js`'s comment claims baseline alignment "is exact". Its own measurement
   says: exact in 4 of 14 resting frames.

None of this kills the morph. It means "byte-identical" in §2.2 is a claim about
the morph reproducing *itself*, never about it reproducing the equation it
replaces — and a reader will not make that distinction unaided.

### 2.5 What is solidly established

- Seek purity: 7 cases × 6 times, cold vs walked-up vs walked-down, all
  `stateIdentical` and `pixelIdentical`.
- Render determinism: 3 separate browser processes, byte-identical at 3 times × 7
  cases.
- The font race: `maxTravelDeltaPx` 77.05 on `sum`, rest frames differing
  13,025–31,862 px between a parse-time and a fonts-ready build. This is the real
  argument for Seam B and it is well measured.
- The `immediateRender` finding is mechanically sound. The "6 of 7 false before /
  7 of 7 true after" measurement is **not in the artifacts** — only the after
  state is. Unverified, believed.

---

## 3. THE PLANNER NUMBERS

26 real `codex exec` runs (A0=6, A=8, B=8, B0=4), plus one excluded pilot. Every
run has `prompt.txt`, `schema.json`, `out.json`, `codex.log`, `result.json`. This
part of the work is real and well kept. The conclusions drawn from it are not
supported.

### 3.1 The headline number reverses under the metric the spike itself implements

`score.mjs` computes `coherent = shared.length === 0 && algebra.length === 0 &&
emitFail.length === 0` and writes it to `summary.txt`:

```
arm A   fully coherent 0/8
arm B   fully coherent 2/8
```

VOCABULARY.md reports **A 6/8, B 3/8**. I reproduced both. The gap is one
decision: drop the `narration N sentences, M holds` class (and the soft
overlaps). Arm A carries **22 of those across 24 beats**; arm B carries **2 of 24**.
Excluding that class is the entire result.

| metric | arm A | arm B | Fisher 2-tailed |
|---|---|---|---|
| as implemented in `score.mjs` (`coherent`) | **0/8** | **2/8** | p = 0.47 |
| as reported in VOCABULARY.md | **6/8** | **3/8** | p = 0.31 |
| …also dropping A's headline-char proxy (§3.3) | 8/8 | 3/8 | p = 0.026 |
| …plus the defects I found by rendering (§4) | **0/8** | 3/8 (unrendered) | — |

Four metrics, three different winners, none pre-registered. At n=8 per arm a
6/8-vs-3/8 split is **p = 0.31** — you cannot distinguish a 75% process from a
37.5% one with eight samples. The document's §7 line "**measured**: 3/8 vs 6/8
clean" should not carry the word *measured* without the word *underpowered* next
to it.

The exclusion is *arguable*: the hold-count mismatch is downstream of a shipped
`prompt.ts` bug and costs a day. But it is not only a bug. In arm A the planner
writes narration blind to a hold count the **emitter** decides; in arm B the
planner declares both and can make them agree by construction. That is the menu's
structural coupling, and the document deletes it from the comparison while
counting the algebra's structural weakness (placement) in full.

### 3.2 Arm B was given one third of the specification

§4: "the compositional prompt written at the same length and care as
`src/plan/prompt.ts` so B is not sandbagged." Measured from the run directories:

| | prompt bytes | schema bytes | vocabulary-specific prompt (common source tail removed) | total spec |
|---|---|---|---|---|
| arm A | 15,438 | 18,265 | 14,009 | **32,274** |
| arm B | 8,704 | 3,324 | 7,314 | **10,638** |

**Arm A received 3.0× the specification.** Part of that is intrinsic — an
enumerated menu needs a bigger schema than a grammar — but the human-written
guidance is 14,009 vs 7,314 characters, and that is a choice. Beyond bytes,
`src/plan/prompt.ts` is the product of the project's whole history of tuning;
the compositional prompt was written once. The sentence "B is not sandbagged" is
false as written and should be replaced with the measurement.

This does not mean B would win with a fuller prompt. It means the experiment
cannot tell us, and the document says it can.

### 3.3 The two arms' defect checks are not commensurable

`coherence.mjs:92` scores arm A's headlines by **character count** (`> 60`).
`coherence.mjs:267` scores arm B's by **measured geometry** (`box extends off
stage`). These are different questions. I rendered A-01, whose three "headline
> 60 chars" defects make it one of the two runs the document marks dirty:
`review/shots/A01-t9.5.png` shows a 73-character headline wrapping to two lines
at full size, well above the floor, looking completely fine. **It is not a
defect.** Arm A's 6/8 is understated on this axis, exactly as arm B's 3/8 is
overstated on its own (the investigator's own disclosure about unlabelled bars).

### 3.4 The extra arm-B defect the document claims to have found is not established

§4 and §1 both lean on: "I opened `planner/out/B06.png` and found a second
uncounted class — in scene `s02-carrier` the `tex` object's content runs off the
right edge, clipped mid-token."

I opened it. The clipped string is `{E}(\mathbf{I}_{\mathrm{LR}}),\qquad
\mathbf{X}=\mat…` — **raw LaTeX source**, and the highlight labels above it read
`highlight: \mathcal{E}(\mathbf{I}_{\mathrm{LR}})`. `preview.mjs` is a 153-line
hand-written SVG renderer that never invokes KaTeX; it draws the TeX string as
literal text. The width being overrun is the width of the *source*, which is not
the width of the rendered equation — the very point the document makes two
sentences later. **The observation is an artifact of the preview.** Whether that
`tex` overflows when KaTeX renders it is unknown.

There *is* an uncounted defect class visible in B06 that nobody named: all three
scenes place their entire composition in the left ~55% of the stage, leaving the
right half empty, in every one of the six frames. That is a real algebra-only
failure — a menu cannot express it — and it strengthens the document's
conclusion. It should replace the `tex` claim.

### 3.5 What the planner experiment does establish

- 26/26 schema-valid across two very different schemas.
- 0 dangling `target`/`parent`/`toObject` across 69 compositional scenes.
- A 4.7× wall-clock and 4.0× JSON cost for the algebra. These are process
  measurements and I have no quarrel with them.
- Self-consistency collapsing with length (2/24 → 42/45) — the strongest single
  finding in the section and the one least dependent on the metric choice.

None of that tells you which vocabulary makes better decks, because **no deck was
made**.

---

## 4. WHAT ALL SEVEN MISSED: nobody ran `decksmith build`

Six investigations, 26 Codex runs, 60 morph PNGs, 12 seek cells, and not one
planner output was put through the shipped pipeline. Arm A's outputs *are*
storyboards — `dist/cli.js build` accepts them unmodified. I ran it on three,
with the shipped `demo/storyboard.json` and a 3-beat slice of it as controls
(`review/gates.log`, `review/sb-*.json`):

```
demo/storyboard.json      12 beats, shipped               PASS   0 errors
sb-demo3.json             shipped beats 2/5/8             PASS   0 errors
sb-A-01.json              arm A, scored DIRTY             PASS   0 errors
sb-A-07.json              arm A, scored CLEAN             PASS   0 errors
sb-A-04.json              arm A, scored CLEAN             FAIL  14 errors
sb-A-04-noinside.json     A-04 minus one field            PASS   0 errors
```

### 4.1 A "clean" plan that fails the shipped gate

A-04 fails with 14 `layout canvas_overflow` errors and one `escaped_container` on
`div.ds-zoom`, all at t=11.2s. Controlled test: delete
`beats[1].inside = {beat:"b01-method-flow", element:"stage0"}` — one field — and
it passes. The 3-beat control built from the shipped storyboard, same three
archetypes, passes. So it is the plan, not the cut.

The plan is legal every way the experiment could see: schema-valid, refs resolve,
and `coherence.mjs:125–138` specifically validates that `inside.beat` is the
immediately preceding beat and `inside.element` is a real part of that
archetype. It passes all three. `review/shots/A04-t11.2.png` shows what the gate
is complaining about: the camera has dived into `stage0`, the Encode box fills
the frame, and the neighbouring Window box is clipped mid-word — which is what a
dive *does*. Whether the bug is in the dive or in the gate, **the shipped product
refuses to build a deck that uses its own camera feature**, and `demo/storyboard.json`
never sets `inside`, so the path ships untested.

VOCABULARY.md lists the camera under §2.3 as already working, "bit-identical
forward, reverse and scattered seek". It is bit-identical and it fails the gate.
Both can be true; only one was measured.

### 4.2 The tenth case of green gates over wrong output — and it is in the demo

The matched task given to **both arms** says:

> "…with the recurrence shown as a loop that returns to the thought stage itself,
> **not around the whole flow**."

All eight arm-A runs answered `loop: {from: 2, to: 2}` — stage 2 to itself,
exactly right. Four more A0 runs did the same. Then `pipeline.ts:399`:

```ts
const to = Math.min(Math.max(0, p.loop.to), Math.max(0, from - 1));
```

> "A degenerate pair becomes the nearest legal one rather than drawing an arrow
> onto the box it left."

**A self-loop is silently rewritten to a loop into the previous stage.**
`review/shots/A01-t9.5.png`: the dashed arrow leaves DQ-CTM and its head lands on
**Window**, labelled "shared parameters across ticks". The picture asserts that
the recurrence returns to the windowing stage. The paper says it does not. The
task said it does not. The planner said it does not. The emitter says it does.

This is not an arm-A artifact. `demo/storyboard.json` beat `b02` carries
`loop: {from: 2, to: 2, label: "one thought tick"}`, and
`review/shots/demo3-t8.5.png` shows the shipped demo drawing "one thought tick"
as an arrow from DQ-CTM into Window. **`PASS — 0 error(s), 1 warning(s)`.** The
warning, in every build including the shipped one, is
`connector_detached … 380px from the nearest anchorable element` on exactly that
path. The gate has been pointing at it since the demo was written.

Consequences for the document:

- **§4's "Arm A's only non-narration defect is a headline over 60 chars" is wrong.**
  Arm A's dominant defect is a diagram that contradicts its own source, in 8 of 8
  runs. By the standard the document applies to arm B — `highlight` on a rect
  "renders nothing, complains about nothing" counted as a defect — arm A's clean
  rate on this task is **0/8**.
- **§4's "the failures are all placement, never structure"** describes arm B's
  checker, not the arms. Arm A's failure here is purely structural.
- **§8's trust argument is weakened where it is strongest.** "Seven archetypes
  throw rather than emit an illegible slide" is true (verified: annotated-figure,
  bar-compare, claim-figure, data-table, equation-walk, grid, split-compare). But
  `pipeline` is one of the five that does not throw, and what it does instead is
  worse than an illegible slide: a legible, beautiful, confidently wrong one. A
  researcher's failure mode is "the video was silently wrong and I published it",
  and this is that failure, in the demo, today.
- It makes **ten** documented cases, not nine, and — like the other nine — it was
  found by opening the artifact.

### 4.3 Why this is the finding rather than a bug report

Every quality number in VOCABULARY.md comes from a checker written for the
occasion by the person whose hypothesis it tested. The single number that came
from shipped code is `emitFail 0/8`, which only says the emitter did not throw.
The project's own standard — eight, now ten, cases caught by a human opening the
artifact — was applied rigorously to the morph (60 PNGs) and to nothing else.
Arm B's frames came from a 153-line re-implementation; arm A's came from nowhere.

Cost of doing it: one command per plan, one minute each.

---

## 5. THE SEEDED HYPOTHESIS

The brief told all six agents that geometry and content-shaping survive and
choreography is replaced. The document confirms it, adds "and it understates the
case", and keeps the word **additive**. The evidence supports the narrow claim
and contradicts the framing.

I reproduced the split. `autopsy/emitter-split.mjs` gives exactly the §3 table:
SOLVER 1,013 / CHOREO 227 / MARKUP 122 / CSS 113 / SCAFFOLD 110 = 1,585 emitter
body lines. Verified.

But the same directory contains a **second classifier over a larger scope**, and
the document does not reconcile them:

| | scope | CHOREO | "solver-ish" |
|---|---|---|---|
| `emitter-split.mjs` (quoted) | 1,585 emitter-body lines | 227 (14%) | 1,013 (64%) |
| `classify.mjs` (not quoted) | 2,807 archetype code lines | **393 (14.0%)** | GEOMETRY 1,103 + SHAPING 477 = **1,580 (56%)** |

The famous **72%** is `(1,013 + 998) / 2,807` — 1,013 classified and **998
assumed**, by treating every non-emitter-body line in an archetype file as
solver. Under the sibling classifier that same code is 56%, with 445 lines
(15.9%) landing in SCAFFOLD. The 998 also double-counts: `title.ts` contributes
123 helper lines to the "998 solver" while §3 separately credits `title.ts` with
"128 lines of shared infrastructure, reused, zero rewrite". Both classifiers are
in the same directory and they disagree by a third; the document quotes the one
that makes the number bigger and calls it measured.

Where the hypothesis actually breaks: the document simultaneously says
content-shaping *survives* and proposes `Fitted` ("the 2,011-line solver,
**promoted**"), `Group.arrange` (subsuming stack/grid/split-compare layout), and a
general layout pass costed at 3–6 weeks and labelled the highest-variance item on
the list. You cannot describe the same 2,011 lines as surviving and as the
largest single deliverable. §3's own sentence gives it away: "re-expressed
generically. **Harder than per-archetype, not easier.**"

So the honest restatement, which the document is one edit away from:

> Choreography (227–393 lines) is replaced and it is the cheap part.
> `svg.ts`'s 255 lines and `title.ts`'s chrome survive untouched.
> Everything else — 1,600–2,000 lines of per-archetype fixed-point solving —
> is **rebuilt, not preserved**, and that rebuild is the project.

"Additive" is what makes 8–13 weeks sound plausible. Six agents agreed with the
framing because it was in every brief; the numbers they produced do not.

---

## 6. THE BUSINESS CLAIM

§8 is the best section in the document and I have almost no quarrel with it. It
refuses the easy sentence. "The vocabulary makes the tool better and does not by
itself change the market position" is correct, and "that is a switching cost, not
a moat" is the right verdict on the determinism work. Keep it.

Two things to add, both of which make it more uncomfortable.

**First — the ceiling the owner named is not in the emit layer either.** He said
"limited on various animations and vector graphics, 3d graphics, even embedding
generated image and video". The document reads that as a vocabulary problem. I
counted what the product actually animates. Across the archetypes plus
`camera.ts`/`svg.ts`, parsing 37 of 58 `tween()` call sites:

```
opacity 33 · y 14 · x 6 · scale 4 · width 2 · textContent 1 · fillOpacity 1
```

and the renderer spike's census of the built 12-beat deck agrees (opacity 65,
y 28, x 9, scale 8, fillOpacity 2, textContent 1 across 117 statements). CSS
motion declarations emitted by the twelve emitters: **0**.

DeckSmith is a fade-and-slide slideshow with excellent typography. I can say that
having looked: `review/shots/A01-t9.5.png` is a genuinely handsome slide, and
nothing on it moves in a way that carries meaning. The distance to 3Blue1Brown is
not twelve archetypes versus an algebra — it is that no motion in this product
*explains* anything. And the recommended program does not close it, because the
recommendation is to keep the planner on a menu and the planner is what decides
whether a deck contains an explanation-carrying move at all. **You can build the
whole algebra and ship a deck the owner will describe the same way he described
this one.**

**Second — the trust story now has a hole in it.** §8 sells "it explained my
paper and it was not wrong" as the product. §4.2 is that product being wrong, in
the demo, about the one structural fact the task was built around, with every
gate green. Fix that before the sentence is used in front of a customer. It is
also, in fairness, an argument *for* something in the document: an algebra draws
the arrow you asked for, so this specific class of silent falsification is a menu
disease.

**Third, a smaller one.** §6's loyalty check — `composition.ts:38` and `:45` ship
CDN `<script src>` for GSAP and KaTeX with no SRI — I verified both lines. For a
paper-to-explainer product sold on trust, a deck that breaks when jsdelivr is
down, or when a conference wifi blocks it, is a customer-visible failure. It is
listed as a 1–2 day conditional. It should be in month 1.

---

## 7. VERIFIED, CORRECTED, UNVERIFIED

### Verified independently
- `gaps/spike/seektest.mjs` re-run twice: under `suppressEvents = true`, cell 10
  (plugin `render()` writing `d`) tracks 180 → 121.097 → 62.194; cell 11
  (`onUpdate` writing the same) is frozen; cell 09 (CSS keyframes) frozen; cell 08
  (SMIL) frozen in both modes. **§5's load-bearing fact is real.**
- `autopsy/emitter-split.mjs` and `autopsy/taint.mjs` reproduce the §3 tables.
- `morph.js` = 275 code lines. `fitBoxes` called exactly once (`pipeline.ts:296`).
  Seven archetypes throw. `prompt.ts:200` says five sentences for four stages.
  `composition.ts:38/45` are CDN URLs. `sceneHtml` (`:701`) builds synchronously;
  `readyGate` (`:559`) is separate. `src` = 19,849 lines.
- 26 Codex runs exist with full provenance; `summary.txt` regenerates from
  `scores.json`.

### Corrected in VOCABULARY.md
See the change list at the end of that file. Six claims: the 6/8 headline, the
"not sandbagged" sentence, the B06 `tex` observation, "all seven test cases", the
12-line GSAP count, and the 72% solver figure. Plus two additions: the pipeline
self-loop (tenth case) and the omitted migration cost.

### Unverified — do not pass on
- **`immediateRender` before/after.** Only the "after" state exists in
  `report.json`. The mechanism is sound; the 6-of-7 measurement is not in the
  tree.
- **Canvas cell 12 seek purity.** `seektest.mjs` reports 5,724 ink at t=2 on its
  first pass and 5,825 on its second, reproducibly across two full runs. I could
  not reproduce it in isolation (`review/canvas12.mjs` returns 5,825 at t=2 from
  cold, after t=4, after t=0, and with suppression on and off), so I cannot
  attribute it — but §5's "a canvas redrawn from a plugin's `render()` is
  seek-pure and byte-identical" is stated more strongly than its own artifact
  supports. Re-measure before scheduling three.js on it.
- **Which model produced the 26 runs.** `run.mjs` passes no `--model`; the numbers
  are tied to whatever the local Codex default was on the day.
- **The 3D and media numbers** (2× render cost, `--workers 4` 3.0% subpixel
  divergence, video +10–20%). I did not re-run them. The `--workers 1` vs
  byte-identical trade-off is the right decision to surface either way.
- **Whether the planner can produce equation-morph keys.** Unmeasured; it is a
  dependency of the one month-1 deliverable that is visible.
- **Arm B's true clean rate.** No arm-B plan has ever been rendered by anything
  but a 153-line preview. 3/8 is an upper bound of unknown looseness.

---

## 8. WHAT I WOULD DO

Not a rewrite of §7 — a reordering, with one item promoted and one deleted.

**Week 1, before any decision.** Fix the pipeline self-loop (draw a real
self-loop or throw; do not silently redraw the claim). Derive hold counts from
`emitScene(beat).holds.length`. Make `inside` build. Vendor GSAP and KaTeX.
Add `decksmith build` to the planner harness so no future experiment can score a
plan it never built. That is a week, it is all shipped-product repair, and three
of the five came out of measurements this workflow already paid for.

**Then Seam A (2–4 days) and the `immediateRender` lint.** Both are right whatever
else is decided, and Seam A is what makes every later gate structural instead of
regex-over-text.

**Then Seam B, budgeted 2–4 weeks, with the file list written first.** It is the
one thing that raises the ceiling — everything layout-aware is downstream of
browser measurement — and it is the estimate most likely to be wrong.

**Stop there and look.** Item 7, the layout pass, is 3–6 weeks against a bad
prior and unlocks items 6 and 8. Do not start it until Seam B has landed and its
actual cost is known, because if Seam B is 4 weeks the layout pass is probably 8.

**Delete the equation morph from month 1.** It is the most impressive item and the
worst first move: its fine-grained mode is visually wrong, its clean mode is a
block slide, and its planner-facing story depends on key generation nobody has
tried. Build it after Seam B, when the measurement it needs is a supported
operation rather than a spike.

---

## Answer to the owner's question

**Build the seams; do not buy the vocabulary yet.** The document is right that the
renderer is not the ceiling — 1,820 checks with 0 mismatches say `Scene.tl` is
already data, and Remotion buys a player you do not need at a licence risk you
cannot control. It is right that a plugin's `render()` firing under
`suppressEvents` is the real unlock, and right that the planner should keep a
menu. But its decisive evidence does not hold: the 6/8-vs-3/8 comparison reverses
under the metric its own scorer computes, is not significant at n=8, and was run
with 3× the specification on one arm; and when I built three of the arm-A plans
nobody had ever built, one failed the shipped gate and all eight contained a
diagram that silently contradicts the paper — a bug that is in the demo deck
right now, with every gate green. The 8–13 weeks is the cost of starting, not of
finishing: Seam B is costed from reading two functions and touches six files, and
migrating the nine archetypes that item 8 does not cover is another 4.5–10 weeks.
So the honest number is 14–20 weeks to a state where the vocabulary is how
archetypes are written, and at the end of it the product still animates opacity,
x, y and scale, because the thing that decides whether a deck contains an
explanation-carrying move is the planner, and the recommendation is to leave the
planner alone. **What I would buy instead, for about five weeks: the week of
shipped-product repair in §8, Seam A, and Seam B with a real file list.** That is
the entire enabling half of the proposal, it makes the twelve archetypes measure
the browser — which is what "arrows that know where they land" actually requires
— and it leaves the algebra, the layout pass and the renderer all still open, at
a fifth of the commitment. Then re-run the planner experiment against decks that
were actually built, with a metric fixed in advance, and let that decide the rest.

---

## 9. APPENDIX — the harness, and what it found when it scored the corpus

Appended after the review, by the workflow it authorised. The review's fourth
correction — "nobody ran `decksmith build`" — is now a `npm run` target and a
red test.

### 9.1 What was built

`scripts/score.mjs`. It takes plans and a source, runs the shipped
`node dist/cli.js build` on each, and reports the CLI's own PASS/FAIL and
findings. It imports no emitter and re-implements no gate: the one thing it must
never become is a second opinion, which is what every quality number in
VOCABULARY.md already was.

```
npm run score -- <plan|dir>... --source demo/source.json
npm run score                     # everything under experiments/
```

**Cost, measured, not estimated** (this machine, 10 cores,
chrome-headless-shell 145.0.7632.46). A full `build` of `demo/storyboard.json`
is **5.81s** wall; `npx hyperframes check --json` on the same directory alone is
**5.78s**. So the brief's "build ~8s, gates ~60s" is stale by an order of
magnitude — the gate is essentially the whole cost and emit is free. Two levers
were taken and one refused:

- **Parallelism.** Each check is its own process with its own Chrome and pins
  about 40% of one core, so they overlap well. Default pool 4. The 23-plan
  corpus takes **38.5s** wall against **148s** of summed per-plan time — 3.8×.
- **A verdict cache** keyed on plan bytes + source bytes + format + *the bytes of
  `dist/` that would run*. Twenty plans of which two changed cost two gate runs.
- **Refused: one browser reused across plans.** That means re-implementing
  `hyperframes check` in-process, which is precisely what made arm B's numbers
  incommensurable with arm A's (§3.3). A slower harness running the shipped gate
  beats a fast one running a lookalike.

### 9.2 The review's result reproduces, exactly

At the compiler the review ran against, the harness returned `gates.log` line for
line: `sb-A-04` FAIL with 14 `layout canvas_overflow`, `sb-A-01`, `sb-A-07`,
`sb-demo3` and `sb-A-04-noinside` PASS with 0 errors and the one
`connector_detached` warning. `review/shots/A04-t11.2.png` was re-shot from a
deck this harness built and shows the same frame: the dive fills the canvas with
Encode and clips Window mid-word.

One correction to §4.1's wording. A-04's `escaped_container` on `div.ds-zoom` is
severity **info**, not an error; the FAIL is 14 errors, all `canvas_overflow`.
The prose reads as though it were a fifteenth error. Nothing else changes.

### 9.3 A correction to §4: arm A's outputs are NOT buildable unmodified

> "Arm A's outputs *are* storyboards — `dist/cli.js build` accepts them
> unmodified."

They are not. All 14 raw captures under `planner/runs/*/out.json` are rejected by
`storyboardSchema` before a deck is emitted, on `theme: null`,
`beats[n].inside: null`, `params.note: null`. This is transport, not planning:
`schema.mjs:forStructuredOutput` makes every optional property required and
widens it with `{type:"null"}`, so the planner *cannot* omit a field, and
`run.mjs:39` strips nulls before validating. The review's `sb-*.json` are those
captures with nulls removed — verified byte-identical to `stripNulls(out.json)`.

The harness therefore has `--strip-nulls`, and every receipt it writes records
whether normalisation was applied. A harness that quietly repairs its inputs and
then reports how well they did is the same disease in a new place.

### 9.4 What scoring all 23 plans found: the camera is the only thing failing

The review built 3 arm-A plans and found 1 failure. The harness builds all 23
storyboards in `experiments/` in 38.5s. At compiler `d3d2eb36`:

```
                              PASS  FAIL
plans with a camera dive         5     9
plans without one                9     0
                              ----  ----
                                14     9
```

**Every failure in the corpus uses `inside`, and no plan without `inside` fails.**
Not one of the nine is anything but `layout canvas_overflow`. They span three
unrelated experiments — `009-camera/pipeline-grid.storyboard.json` (9 errors),
`010-blackout/camera.storyboard.json` (3), and 6 of the 14 planner captures —
so this is not an arm-A artifact and not a 013 artifact. `demo/storyboard.json`
never sets `inside`; the only broken path is the only untested one.

This makes §4.1 much stronger than three builds could. It is not "a clean plan
failed the shipped gate". It is: **the camera feature fails the shipped gate
wherever it is used, and the shipped demo is green because it does not use it.**
Whether the dive is wrong or the gate is wrong is still the open question §4.1
left; how much of the corpus it costs is no longer a guess.

### 9.5 The finding that justifies the whole design: `dist/` moved under me

Between 03:57 and 04:11 local, three builds of the same plan bytes produced three
different compositions — `56e04f25`, `330d7c98`, `56425ae2` — because a
concurrent workstream rebuilt `dist/` twice. In the middle window `sb-A-04`
PASSED with 0 errors, seven times in a row, sequentially and 4-way concurrent.
The two compositions differ by one attribute:

```
<div class="ds-zoom" data-layout-allow-overflow>     ← PASS: overflow suppressed
<div class="ds-zoom" data-ds-transit="10,11.8">      ← FAIL: 14 canvas_overflow
```

Had the receipt not carried the compiler's fingerprint I would have reported
"the review's A-04 finding does not reproduce" — true for about thirty minutes,
false before and after, and a clean, confident, wrong correction to a correct
finding. That is case eleven of a green gate over wrong output in this project,
and the only reason it is written here as a near-miss instead of a correction is
that the verdict was dated. **Every number about a build belongs with the bytes
of the compiler that produced it.** The ledger records it; `score` refuses a
cached verdict from a different one and says out loud how many receipts are
stale.

### 9.6 How it is made unskippable

Not by convention — the convention already existed and produced 26 Codex runs
and zero decks. `experiments/score/scored.test.mjs` runs inside `npx vitest run`,
one of the five commands this project keeps green. It discovers every
storyboard-shaped JSON under `experiments/` — by *shape*, so a schema-invalid
capture cannot slip past a filename filter — and fails unless
`experiments/score/ledger.json` holds a receipt whose `planSha` matches the
file's current bytes, with the exact command to fix it in the failure message.
Verified by making it fail both ways: a new unscored plan, and a one-byte edit to
a scored one.

It does **not** require a PASS. Requiring one would make deleting an inconvenient
plan the cheapest route to a green suite, which is the incentive that produces
exactly the corpus this exists to prevent. A FAIL with a receipt is a good
outcome; it is a finding. The only forbidden state is a plan nobody built.

So the next planner experiment cannot score plans it never built: dropping its
outputs anywhere under `experiments/` turns the suite red until `npm run score`
has been through them, and the ledger then says, per plan, what a user would
actually have received.
