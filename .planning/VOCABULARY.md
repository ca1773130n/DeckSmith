# VOCABULARY — a costed decision

Six investigations, `experiments/013-vocabulary/`. Every number below is sourced.
I re-ran two measurements myself and opened six frames before agreeing with anyone.

> **CORRECTED after adversarial review — see `.planning/VOCABULARY-REVIEW.md`.**
> Nine claims below were wrong rather than merely unproven and are struck through
> or amended in place, each marked `[CORRECTED]`. The two that change the
> argument: the 6/8-vs-3/8 planner comparison **reverses** under the metric the
> spike's own `score.mjs` computes and is not significant at n=8 (§4), and no
> planner output was ever built into a deck — when three were, one failed
> `hyperframes check` and all eight contained a silently falsified diagram (§4).
> Change list at the end of this file.

---

## 1. THE ANSWER

**Build the vocabulary in the emit layer. Do not expose it to the planner.**

A compositional algebra is adoptable — that question is settled, measured, and the
answer is yes. Manim's primitives compile to `fromTo` with **deviation exactly 0**
across 200 shuffled absolute times (`manim/spike/fold.py`), 21 of 23 probed
primitives are bit-identically pure in alpha, and the one move that would justify
the whole exercise — the 3Blue1Brown term-by-term equation morph — was built in
**275 lines**, and renders **byte-identical across separate browser processes**.
Invariant 1 and invariant 2 survive contact with a Manim-shaped vocabulary. That
was the thing most likely to kill this and it did not.

> `[CORRECTED]` ~~seeks correctly on all seven test cases~~. Seek-correct on 7/7,
> **visually correct on 4/7**. The seven cases are four distinct equation pairs,
> three of them run twice — keyed and unkeyed. The three *unkeyed* midpoints are
> incoherent (`out/sum-2-mid.png`: detached exponents, overprinted glyphs, fraction
> rules with nothing under them), which `morph.js:184` itself calls "visibly wrong
> … asserts something false about the algebra". The keyed mode that is clean is
> also coarse: `sumKeyed` moves 17 leaves as **3 rigid bodies**. The spike did not
> demonstrate a mode that is both fine-grained and clean. See review §2.

What kills the *product* version of it is the planner — with a caveat now attached
to every number in this paragraph. Given the identical task in both vocabularies,
the archetype menu came back clean **6 of 8** times and the compositional algebra
**3 of 8**. The algebra costs **4.7–6.4× wall clock** (36s → 168s matched;
70s → 446s full deck) and **4.0× the JSON**, and has a defect class a menu cannot
express — an op applied to the wrong kind of object (`highlight` on a rect:
renders nothing, complains about nothing). Those cost figures stand. The clean
rates do not:

> `[CORRECTED]` **6/8 vs 3/8 is one metric of four and the only one that favours
> the menu at that margin.** `score.mjs`'s own `coherent` field — all defects
> counted — gives **A 0/8, B 2/8**. The 6/8 is obtained by dropping the
> `narration N sentences, M holds` class, which arm A carries 22 times in 24 beats
> and arm B twice in 24. Fisher two-tailed on 6/8 vs 3/8 is **p = 0.31**: n=8 per
> arm cannot separate a 75% process from a 37.5% one. Arm B was also given
> **one third** of arm A's specification (10,638 vs 32,274 bytes of prompt +
> schema). And the claim that arm A's 6/8 is a floor is wrong in the other
> direction: all eight arm-A plans emit a diagram that contradicts the source
> (§4), so by the standard applied to arm B, arm A is **0/8** on this task.
> The comparison does not currently support a conclusion in either direction.
> Review §3, §4.

> `[CORRECTED, UNVERIFIED]` ~~I opened `planner/out/B06.png` and found a second
> uncounted class — a `tex` object running off the right edge of the stage.~~
> `preview.mjs` never invokes KaTeX; it draws the TeX **source string** as SVG
> text. What is clipped is the source, not the rendering — the very distinction
> the next paragraph relies on. Withdrawn. A real uncounted arm-B class *is*
> visible in that frame: all three scenes use only the left ~55% of the stage.

So the split is not "menu vs algebra". It is **where the seam sits**:

> **An algebra inside the emitters. A menu at the planner boundary.**

The twelve archetypes stop being twelve bespoke implementations and become the
first twelve *consumers* of a shared vocabulary. The planner keeps choosing from a
menu — it is measurably good at that — but the menu items get radically more
powerful, and a thirteenth item stops costing 380 lines from scratch.

**Scope: a partial vocabulary, and partial in exposure rather than in capability.**
Full algebra internally; the planner sees named moves with typed parameters. The
one new capability that ships to the planner immediately is the keyed equation
morph, because it can be expressed as *two TeX strings plus a key list* — an
archetype parameter — and therefore inherits the archetype arm's 6/8 generability
instead of the compositional arm's 3/8.

> `[CORRECTED]` The inheritance is asserted, not measured, and the input is not a
> key list. The spike takes TeX with the keys **already embedded** as
> `\htmlClass{ds-k-<name>}{…}`; turning a list into that is the substring-location
> problem `equation-walk.ts` solves and **throws** on (lines 144, 228). Nobody has
> asked the planner for keys. And the key cut *is* the animation: `sum` and
> `sumKeyed` are the same two strings and produce a glyph riot and a block slide
> respectively. This is the one visible month-1 deliverable and it rests on an
> unmeasured planner capability. Review §2.3.

**What actually raises the ceiling the owner named is not the algebra.** It is two
small seams (§2.4) and one measured fact nobody knew: **a GSAP plugin's `render()`
fires under `suppressEvents`; an `onUpdate` does not.** I reproduced this myself.
Invariant 11 has been read as "derived state cannot be written per frame", which
caps the vocabulary at whatever GSAP tweens natively — and *that* cap, not the
archetype list, is why the tool is a menu. The real rule is narrower: state may not
be written from an **event**; it may be written from a tween's own **render**. That
one distinction is what makes richer vector animation, canvas/3D, and retimed media
reachable on the stack we already have.

---

## 2. WHAT THE VOCABULARY IS

Sized to the evidence, not to Manim. Every entry is either measured pure in this
repo's capture path, or measured pure in Manim and structurally identical.

### 2.1 Objects — things that know their own structure

| primitive | what it does | pure fn of t | subsumes |
|---|---|---|---|
| **`TermTree`** | a TeX expression cut at author-declared keys; each term is a handle with a measured box | **yes — measured**, seek-identical on 7/7 cases via 3 arrival paths | `equation-walk` |
| **`Path`** | an SVG path that knows its own length and can be partially drawn | **yes — measured** (gaps cells 02/03) | `drawFrom()` in `svg.ts`, generalised |
| **`Group`** | ordered set with `arrange(axis, gap)` and a shared box | yes, by construction (build-time) | `stack`, `grid`, `split-compare` layout |
| **`Fitted`** | text that solves for the largest size fitting a box at ≥ the 40px floor | yes, by construction | the 2,011-line solver, promoted |
| **`Raster`** | image or video leaf, placed and timed | **yes — measured**: a bare `<video>` tracks composition time to ~1 frame; two renders byte-identical | new; `split-compare`'s one-off `image()` |

`TermTree` is the centrepiece and it is not speculative. The keying mechanism
already ships: `equation-walk.ts` wraps terms in `\htmlClass{term t-<tone>}{...}`
so KaTeX emits a real element (line 133), and `normalise`/`locate` (lines 45/75)
already fold `\left`/`\right`, `\lVert`, `\mathrm{d}` and whitespace, and **throw
rather than silently highlight nothing** (lines 144, 228). Manim does none of that
and would have died on the same deck. What we lack is only the tree — one class
name away.

### 2.2 Transforms

| primitive | what it does | pure fn of t | subsumes |
|---|---|---|---|
| **`Morph(a, b, keys)`** | carries each keyed term from its place in A to its place in B; unmatched terms fade | **yes — measured**: state- and pixel-identical from cold seek, walk-up and walk-down at 6 times × 7 cases; **byte-identical across 3 separate browser processes** | `equation-walk` entirely, and adds derivation chains |
| **`Draw(path, a, b)`** | partial path reveal | yes — measured | 5 `strokeDasharray` sites |
| **`Reshape(a, b)`** | path-to-path morph across differing command counts (MorphSVG: 10 `L` → 1 `A`, `d` length 331 → 408 → 35) | yes — measured | new |
| **`Move/Fade/Scale`** | the six properties we already tween (opacity 65, y 28, x 9, scale 8, fillOpacity 2, textContent 1 across 56 call sites) | yes — 1,756 numeric checks, **0 semantic mismatches** | itself |
| **`Track(v)`** | one scalar several elements read | yes **iff bound by a tween, not written from a callback** | new |
| **`Emphasis`** | indicate / circumscribe / flash, closed-form `there_and_back` | yes — measured in Manim, trivially portable | bespoke highlights in `equation-walk`, `callout`, `annotated-figure` |

`Track` has a shipped existence proof: `bar-compare` tweens `textContent` with a
`snap`, directly on the target. That is a Manim `ValueTracker` implemented
seek-safely — the value is tweened *as a property* rather than written from an
`onUpdate`. Invariant 11 forbids the mechanism, not the idea.

### 2.3 Composition and camera

| primitive | what it does | pure fn of t | subsumes |
|---|---|---|---|
| **`Lag(children, ratio)`** | precomputed `(child, start, end)` table; no cursor | yes — measured pure in Manim | four hand-rolled stagger loops (`grid`, `stack`, `pipeline`, `bar-compare`) |
| **`Squish(anim, [a,b])`** | run a sub-animation inside a slice of the parent's alpha | yes — closed form | new; the one genuinely missing idea from Manim's 53 rate functions |
| **`Camera`** | the frame as a tweenable box | yes — **bit-identical** forward, reverse and scattered seek, and on a fresh page whose first seek is the landing | already `camera.ts` |

Everything else composes by absolute time, which is what `Scene.tl` already is.

**Explicitly not adopted**, each an invariant-11 frozen-video generator under seek:
`Succession` (measured impure, deviation 3.0 — and its semantics are exactly
`AnimationGroup(lag_ratio=1)`, which *is* pure), all two-argument `dt` updaters
(`always_shift`, `always_rotate`), `TracedPath`, `AnimatedBoundary`, `ChangeSpeed`,
`Blink`, SMIL (**the sole nondeterministic technique of eleven tested**), and CSS
`@keyframes` in the interactive deck (correct in the video via the WAAPI adapter,
wall-clock in the player — the split invariant 6 already encodes).

**Also not adopted: glyph-outline morphing.** Measured cost is 120.6 KB of Bezier
coordinates for one morph of the attention formula, against ~1 KB for what
`equation-walk` emits today. The part-level box morph gets the value at 4 floats
per term, is what the spike actually built, and survives the 40px floor and
EXPERIMENT-006's scaled-glyph drift where outline morphing would worsen both.

### 2.4 The two seams everything above depends on

These are the actual deliverable. The primitives are downstream of them.

**Seam A — `tween()` returns a `Tween`, not a string.** Today it is a 3-line
function producing GSAP source text (`title.ts:224`). Making it structural kills
`paceStatement`'s regex-over-source-text, puts the animation vocabulary in front of
the type checker, and turns ~50 test assertions from textual to structural.
**2–4 days**, and worth doing whatever else is decided.

> `[CORRECTED]` ~~Every non-comment GSAP mention in `src/` is 12 lines in 19,849;
> the twelve archetypes contain zero.~~ Measured: **4 lines** contain the token
> `gsap` (24 including comments). The token is not where the coupling is. `Scene.tl`
> is GSAP *source text*: **58 `tween(` call sites** emit `tl.fromTo(…)` strings, and
> `theme.ts:189` rewrites them with a regex that parses a GSAP position argument out
> of a string (`AT = /,\s*(-?\d*\.?\d+)\s*\)\s*;?\s*$/`). Counting the token to size
> the coupling is a bounding-box measurement. The *conclusion* — don't move the
> renderer — is unaffected and is better carried by the renderer spike's 1,820
> checks with 0 mismatches.

**Seam B — a scene may build part of its timeline in the browser, after fonts.**
This is the expensive finding and it is not optional. Every number a morph needs —
`dx`, `dy`, `scale`, group centres — is a measurement of browser layout after
webfonts arrive. Measured consequence of getting this wrong: travel error up to
**77.1 px**, resting frames differing by 13,025–31,862 pixels, silently and
deterministically. Today `sceneHtml` (`composition.ts:701`) builds the timeline
**synchronously at parse time** and registers it into `window.__timelines[sid]`;
`readyGate()` (line 559) is a *separate* script that awaits `document.fonts.ready`
later. So the barrier exists and the scene does not use it.

Pay for Seam B once and the whole class of layout-aware primitives opens — arrows
that know where they land, "point at that term", anything measured. Refuse it and
the vocabulary stays a fixed menu no matter how many primitives are listed above.

> `[CORRECTED]` One thing is easier than stated and one much harder. Easier: the
> barrier is already wired — `buildingFlag()` sets `window.__hfTimelinesBuilding =
> true` ahead of every scene script and `readyGate()` clears it after
> `document.fonts.ready`, so a scene *can* register inside it today. Harder: the
> moment positions are browser-measured, `tl` stops being a string the build can
> rewrite, so Seam B strictly **contains** Seam A and touches at least six files —
> `theme.ts:173` (`pace`), `composition.ts:330/405` (the shell appends handoff and
> dive statements after the emitter returns), `composition.ts:704`, `island.ts`
> (holds → island fragments, invariant 8), `render/timing.ts` (`framePlan`,
> `planTiming`), `verify/check.ts`. **Re-cost at 2–4 weeks**, and write the file
> list before starting. Review §1.3.

### 2.5 One new invariant, found by the spike, that must ship as a lint

> **Invariant 2 is necessary and not sufficient. At most one `fromTo` per
> (element, property) may render immediately.**

A `fromTo` renders its *from* state at construction. Build two on the same property
of the same element — which a bowed travel path is, `y` out then back — and the
second one's construction parks the glyph mid-arc. A cold seek to any time *before*
the morph then finds a tween GSAP has never had to render, and the equation opens
with a symbol floating 166px above the line. Walking down from the end fixes it, so
**the bug is invisible to anyone who scrubs and fatal to anyone who captures**.
Measured: `stateIdentical: false` on 6 of 7 cases before the fix, `true` on all 7
after (`immediateRender: false` on every tween after the first touching a given
element+property).

This is invariant 11's shape one layer up, it is not specific to morphs — any
archetype putting two `fromTo`s on one property has it today.

> `[CORRECTED]` ~~nine documented cases~~ → **ten**. The tenth was found by the
> review and is in the shipped demo: `pipeline.ts:399` silently rewrites a
> self-loop `{from: n, to: n}` into `{from: n, to: n-1}`, so the diagram claims
> the recurrence returns to the *previous* stage. `demo/storyboard.json` b02 asks
> for `{from:2,to:2}` and the demo renders "one thought tick" as an arrow from
> DQ-CTM into Window. `PASS — 0 error(s)`. All eight arm-A runs hit it. See §4 and
> review §4.2.
>
> `[UNVERIFIED]` The `immediateRender` before/after measurement ("`stateIdentical:
> false` on 6 of 7 before, `true` on all 7 after") is not in `report.json` — only
> the after-state is. The mechanism is sound; the number is not in the tree.

---

## 3. WHAT SURVIVES AND WHAT DIES

**The hypothesis I was given — geometry and content-shaping survive, only
choreography is replaced, so this is additive new code — is confirmed, and it
understates the case.** Content shaping is not a separable half. It is the
organising principle of 72% of the archetype code.

From `autopsy/scan.mjs` (a real tokeniser; the first two classifiers were wrong and
one silently dropped `data-table` entirely — the numbers below are the third's):

| bucket | code lines | verdict |
|---|---|---|
| SOLVER — layout fixed points, fitting, wrap | **1,013 in emitter bodies + 998 helpers = 2,011 (72%)** — `[CORRECTED: 1,013 measured + 998 assumed; see below]` | **re-expressed generically. Harder than per-archetype, not easier.** |
| CHOREO — timing statements | **227 (14% of bodies)** | **replaced** |
| MARKUP | 122 (8%) | replaced |
| CSS | 113 (7%), 209 declarations, **0 motion** | mostly survives |
| SCAFFOLD | 110 (7%) | survives |
| CHROME (`title.ts`: 128 of its 163 code lines are shared infrastructure) | 128 shared + ~36 call sites | **reused, already factored, zero rewrite** |
| GEOMETRY primitives (`svg.ts`, 255 code lines, **0 mentions of gsap/react/hyperframes**) | 255 | **reused, ~1:1 onto object constructors** |

Swapping in a vocabulary **deletes roughly 350 lines (12%)** and leaves 2,011 lines
of hand-solved layout to be rebuilt as one general solver. That is the whole cost
story: **this is additive**, and the additive part is the hard part.

> `[CORRECTED]` The 72% is `(1,013 + 998) / 2,807`, where the 1,013 is classified
> and the **998 is assumed** — every non-emitter-body line in an archetype file
> counted as solver. The *other* classifier in the same directory,
> `autopsy/classify.mjs`, does classify those lines and puts geometry + shaping at
> **1,580 of 2,807 (56%)** with 445 lines (15.9%) in SCAFFOLD, and CHOREO at 393
> rather than 227. The 998 also double-counts `title.ts`'s 123 helper lines, which
> the CHROME row separately calls "reused, zero rewrite". Two classifiers in one
> directory disagree by a third and only the larger is quoted.
>
> `[CORRECTED]` **"Additive" is the wrong word and it is what makes 8–13 weeks
> sound plausible.** This section says content-shaping survives; §2.1 promotes the
> same 2,011 lines into `Fitted`, §2.1 subsumes stack/grid/split-compare layout
> into `Group.arrange`, and §7 item 7 costs rebuilding it at 3–6 weeks as the
> highest-variance line on the list. It cannot both survive and be the largest
> deliverable. Honest restatement: choreography (227–393 lines) is replaced and is
> the cheap part; `svg.ts` (255) and `title.ts`'s chrome survive untouched;
> 1,600–2,000 lines of per-archetype fixed-point solving are **rebuilt, not
> preserved**, and that rebuild is the project. Review §5.

Why it is hard, concretely — geometry and content shaping are a *fixed point*,
solved by hand and differently per archetype:

- `bar-compare` 140–184: `bar` → `labelSize` → `wrap()` → `maxLines` → `head` →
  **`bar` recomputed from `head`** → `pitch` → throw if it overflows.
- `pipeline`'s `solve`: tries 1–3 label lines *before* shrinking type.
- `grid`'s `fitsInside`: re-wraps a label to decide gutter placement.
- `annotated-figure`'s `attempt`: 4 column widths × line counts.

Four different search strategies. A general solver must subsume all four. This is
the single riskiest line item in §7 and I have labelled it accordingly.

There is a tell that the general solver is genuinely harder than it looks: **the
one general layout solver we already have, `fitBoxes`, is called exactly once**,
and eleven of twelve archetypes declined it in favour of calling `wrap()` and
`textWidth()` directly (84 fitting call sites against 36 pure-geometry ones). It
answers "fit N labels across a width". The real question is always "fit these
labels **and** this figure **and** this note in this box at ≥40px, and if you
cannot, change the arrangement."

**What dies outright:** nothing in `src/` today, if the vocabulary is built under
the archetypes. Eight of twelve archetypes would eventually be re-expressed as
compositions (`equation-walk` → `Morph`; `line-chart` → axes + `Track`; `stack`,
`grid`, `split-compare` → `Group.arrange`; `annotated-figure` and most of `callout`
→ brace/arrow/surround; `data-table` → a table object), but re-expressed is not
deleted, and it happens one at a time under existing tests.

**The real argument for doing this** is not that the archetypes are bad. It is that
**eight of twelve are the same four primitives with different parameter names**, and
a vocabulary makes that visible where a menu hides it. The authorable surface today
is **161 lines of zod, 12 variants, 68 fields — of which 31 are chrome, so 37
content fields is the entire expressible space of the product.**

---

## 4. THE GENERATION PROBLEM

**This section decides the shape of the answer, and it decides against exposing the
algebra.**

Schema validation was expected to be the risk and **is not**: 26 of 26 `codex exec`
runs validated, in both vocabularies, with **zero dangling references across 69
compositional scenes — 1,224 objects, 1,632 tweens, not one broken `target`,
`parent` or `toObject`.** The planner composes graphs correctly. That is a real and
somewhat surprising positive.

What it cannot do is **place** them, and it cannot ever do it, because placement
requires measuring glyphs.

| arm | vocabulary | task | n | schema-valid | **clean** | algebra defects | median s | JSON chars/unit |
|---|---|---|---|---|---|---|---|---|
| A0 | archetypes (shipped prompt) | whole deck | 6 | 6/6 | 3/6 | **0** | 70 | 951 |
| **A** | archetypes | matched 3 beats | 8 | 8/8 | **6/8** | **0** | **36** | 1,209 |
| **B** | composition | same 3 beats, same wording | 8 | 8/8 | **3/8** | **7** | **168** | **4,832** |
| B0 | composition | whole deck | 4 | 4/4 | 1/4 | **21** | 446 | 3,763 |

The decisive comparison is A against B — identical task, identical wording, both
through the same `forStructuredOutput`. **4.7× the wall clock. 4.0× the JSON.**

> `[CORRECTED]` ~~the compositional prompt written at the same length and care as
> `src/plan/prompt.ts` so B is not sandbagged~~. Measured from the run
> directories: arm A got prompt 15,438 B + schema 18,265 B (**32,274** total,
> 14,009 of it vocabulary-specific after removing the shared source tail); arm B
> got 8,704 + 3,324 (**10,638** total, 7,314 vocabulary-specific). **Arm A
> received 3.0× the specification.** Some of that is intrinsic — a menu needs a
> bigger schema than a grammar — but the human-written guidance is 14,009 vs
> 7,314 characters and that is a choice, on top of `prompt.ts` being the product
> of the project's entire tuning history against a prompt written once. "B is not
> sandbagged" is false as written.
>
> `[CORRECTED]` ~~Half the clean rate.~~ See the correction in §1: `score.mjs`'s
> own all-defects metric gives **A 0/8, B 2/8**; the reported 6/8 vs 3/8 is
> obtained by dropping the one class where B structurally wins; Fisher two-tailed
> **p = 0.31**. Four metrics, three different winners, none pre-registered.

**3/8 remains an upper bound on B's true quality** — the investigator disclosed
why: previewing `B-06` by eye, their checker found 2 of ~4 real defects and missed
that two of five bars carry no value label, because in an algebra a bar is a rect
and a label is a text and their relationship lives only in the author's head. (The
second class claimed here — a `tex` running off the right edge — is withdrawn; see
§1. `preview.mjs` draws TeX source, not KaTeX output.) **And no arm-B plan has
ever been rendered by anything but that 153-line preview.**

The failures are **all placement, never structure** — for arm B, and as measured
by a checker that only looks for placement.

> `[CORRECTED]` For arm A the reverse is true and it was never checked, because
> **no arm-A plan was ever built into a deck either**. Three were, in review:
> `A-04`, scored **clean** here, fails `hyperframes check` with **14 errors**
> (`canvas_overflow` + `escaped_container` on `div.ds-zoom`); deleting its one
> `inside: {beat:…, element:"stage0"}` field — a legal camera dive that
> `coherence.mjs:125–138` explicitly validates — turns FAIL into PASS. A 3-beat
> control cut from the shipped storyboard passes. Separately, **8 of 8** arm-A
> runs answered the task's explicit "the recurrence returns to the thought stage
> itself" with `loop: {from:2, to:2}` — correctly — and `pipeline.ts:399` silently
> rewrote it to `{from:2, to:1}`, drawing the arrow into the *previous* stage.
> That is a structural failure, in every run, invisible to every gate, and present
> in `demo/storyboard.json` today. Review §4.

The same authoring error costs
the two arms differently, and that asymmetry is the finding:

| headline | archetype emitter | compositional planner |
|---|---|---|
| 15 chars | 156px | picks an absolute `fontPx` |
| 53 chars | 156px, wraps | — |
| 88 chars | **107px — refit** | nothing refits it |

Arm B's dominant defect is a headline box off the stage, 5 in 24 scenes. Arm A's
only non-narration defect is a headline over 60 chars, 5 in 24 beats. **Same error,
same rate.**

> `[CORRECTED]` Not the same error and not the same measurement.
> `coherence.mjs:92` scores arm A by **character count**; `coherence.mjs:267`
> scores arm B by **measured geometry**. Rendering A-01 — one of the two runs
> marked dirty on this basis — shows its 73-character headline wrapping to two
> lines at full size and looking correct
> (`experiments/013-vocabulary/review/shots/A01-t9.5.png`). It is not a defect.
> And "arm A's only non-narration defect" is false: see the loop correction above.

The archetype's `charUnits` table, `wrap` solver and `fitBoxes`
absorb it; seven archetypes throw rather than emit an illegible slide. The algebra
has nowhere to put it. Three independent measurements of arm B's pilot headline at
its chosen 74px on a 1920px stage — Chromium with real Inter (**1997.4 px**), our
own estimator (2065 px), a flat 0.50 em/char (1961 px) — all exceed the stage. The
model had declared `size.w: 0.84`. Wrong about its own text by 24%. Every gate
green.

And self-consistency **collapses with length**: narration/hold mismatches go from
2/24 at three scenes to **42/45 at eleven**, with algebra defects per scene rising
0.29 → 0.47. The planner stops holding its own two numbers together exactly when a
real deck needs it to.

**Would a layout pass fix this?** Partly, and not enough to change the
recommendation. It would fix the 26 placement defects. It would not fix `highlight`
applied to a rect, or a bar with no label. Best case it moves B to rough parity
with A — **at 5× the cost.** Parity at five times the price is not a product
decision, it is a hobby.

**So: the planner keeps a menu.** Two consequences follow.

1. **The layout pass gets built anyway, as infrastructure rather than as a planner
   feature.** If archetypes are written in an algebra, *something* must place the
   objects, and today that something is 2,011 lines of per-archetype hand-solved
   fixed points. A general solver is how you stop rewriting them. It is the
   enabling investment for §2, and it is on the critical path whether or not the
   planner ever sees an object graph.
2. **Revisit exposure only against evidence.** The gate is arm B reaching arm A's
   clean rate *with the layout pass in place*, on ≥8 runs, on more than the single
   1,715-byte source everything here was measured against. Until then the algebra
   is an internal API.

> `[CORRECTED]` That gate is not runnable as stated, because "arm A's clean rate"
> is not a fixed number — it is 0/8, 6/8 or 8/8 depending on which defect classes
> are counted, and 0/8 once the artifact is opened. Before any re-run: fix the
> metric **in advance**, give both arms comparable specification (arm B had 33% of
> arm A's), and score by **building the deck**, not by a bespoke checker. Every
> quality number in this section came from a checker written for the occasion by
> the person whose hypothesis it tested; the one number from shipped code
> (`emitFail 0/8`) says only that the emitter did not throw.

### A shipped bug, found on the way — fix this independently of everything else

`src/plan/prompt.ts:200` says *"A pipeline of four stages wants five sentences."*
The emitters disagree, measured by running every produced beat through `emitScene`
and counting `holds.length`:

| beat | prompt says | emitter's holds |
|---|---|---|
| pipeline, 4 stages | 5 | **6** |
| **bar-compare, 5 bars** | 6 | **2** |
| equation-walk, 2 terms | 3 | **2** |
| data-table, 4 highlights | 5 | **6** |
| grid, 3 regions | 4 | **5** |

The model obeys the prompt; the prompt is wrong about its own emitters, by one on
most archetypes and **by four on `bar-compare`**. Narration is cut sentence by
sentence across holds, so this is the voice running ahead of the animation,
systematically, in the shipped product. It accounts for 40 of arm A0's 44 defects.
Derive the count from `emitScene(beat).holds.length` instead of from prose.

---

## 5. THE THREE GAPS

All three are downstream of the one measured fact: **a plugin's `render()` fires
under `suppressEvents`, an `onUpdate` does not.** I re-ran `gaps/spike/seektest.mjs`
and reproduced it — cell 10 (plugin writing path `d`) tracks 180 → 121.1 → 62.2
with suppression on; cell 11 (`onUpdate` writing the same `d`) is frozen at a
single value. A GSAP plugin is a `render(ratio, data)` function: the same signature
as a Manim mobject's interpolation, and a pure function of t.

### Gap 1 — richer vector animation: **DO IT. 1–2 weeks.**

Nine of eleven candidate techniques pass both seek purity and render determinism.
The two failures are already excluded by existing rules: SMIL (**the sole
nondeterministic technique** — isolated, not assumed: the full 12-cell composition
rendered to two different mp4 hashes; removing SMIL alone made it byte-identical
twice, and again at `--workers 4`) and CSS `@keyframes` (right in the video via the
WAAPI adapter, wall-clock in the player).

Bundle cost measured: MorphSVG 21,195 B + MotionPath 22,002 B + DrawSVG 4,351 B =
**47,548 B against gsap.min.js's 72,779 B — +65% on the animation runtime**,
inlined at compile time exactly as `GSAP_SRC` is, so invariant 4 holds. All three
ship in the public `gsap@3.14.2` tarball under the standard licence.

The cheapest single win inside this: **DrawSVG removes the path-length requirement
entirely** (cell 03 needed no length), which is arithmetic `drawFrom()` currently
forces the emitter to know at build time.

**One thing to fix while here, unrelated to cost:** `hyperframes snapshot` is not
the capture path and lies about CSS 3D — at t=3.9s it produced a flat, un-rotated
frame where the render produced correct perspective, and it moves the `onUpdate`
cell that the player freezes. "Look at the artifact" is this project's strongest
gate; the tool a human reaches for to do that is wrong. **Extract frames from the
render.**

### Gap 2 — 3D: **DO the depth half. 2–3 weeks. Defer meshes.**

Split it, because there are two asks and they must not share a verb set.

**Depth as exposition** — a stack exploding, an isometric pipeline, a diagram
tilting to reveal a layer. CSS 3D, same verbs, same world: measured working and
looking right (72px type crisp under 46°/−12°), real per-element occlusion, one
tween on one ancestor moving both 3D-placed DOM cards and an SVG annotation
together, depth-sorted by the browser. **~2× render cost** (6.3–8.2s vs 3.2–3.4s
blank for 4s at 1080p), against WebGL's 3.3×.

**One decision ships with it, not after: CSS 3D forfeits the byte-identical render
unless `--workers 1` is pinned.** `[SUPERSEDED 2026-09-04 — the premise does not
hold. The plain deck is not byte-identical on either pin (2954/3120 at 0.8.27,
3109/3120 at 0.7.90), and a deck-wide 3D transform measured FEWER differing
frames than the plain one (26, worst 61.69 dB, PASS). Nothing here shows a
depth archetype needs `--workers 1`. See`.planning/2026-09-04-css3d-recheck.md`.]` Measured: byte-identical at 1 worker; at 4
workers, 189,237 of 6,220,800 subpixels differ (3.0%), max channel delta 41 —
antialiasing scale, same shape as EXPERIMENT-006's drift. The pure-2D composition
was byte-identical at 1 *and* 4, so this is the 3D transform's cost specifically.
Byte-identical output is described in this repo as the cheapest correctness signal
it has. 3D costs it, or costs the parallelism. Pick deliberately; `src/render/render.ts`
currently defaults to hyperframes' auto.

**3D as subject matter** — a mesh, a surface, a molecule. three.js in a canvas,
approved but unscheduled, and with one new fact: cell 12 proves the timing half is
solved (a canvas redrawn from a plugin's `render()` is seek-pure and byte-identical),
so it joins the same timeline without a second animation model.

> `[UNVERIFIED]` `seektest.mjs` reports cell 12 ink of **5,724 at t=2 on its first
> pass and 5,825 on its second**, reproducibly across two full re-runs — the same
> absolute time, two values. In isolation the cell is pure
> (`review/canvas12.mjs`: 5,825 at t=2 from cold, after t=4, after t=0, with and
> without suppression), so the discrepancy is unattributed. But "seek-pure and
> byte-identical" is stated more strongly than the artifact supports. Re-measure
> before scheduling three.js on it. What cannot be
shared is the picture: a WebGL canvas is **one opaque rectangle** in the DOM
stacking order. No annotation passes behind the mesh; no mesh occludes a caption.
Treat it as a **leaf** the vocabulary places and times but never interpenetrates,
and say so in the design. Anyone promising a unified 2D/3D scene graph on this
stack is promising the compositing, and the compositing is not there.

### Gap 3 — generated media: **images yes (~1 week). Existing video yes (days). Generated video NO.**

Measured with a video whose source frame *n* is a flat grey of value 2*n*, so the
captured mean reads back the source frame index exactly. A **bare `<video>`** — no
autoplay, nothing in the timeline touching it — tracks the composition clock (out
frame 0/30/60/90/119 → src 0.0/29.5/59.0/88.5/118.0), because hyperframes' media
adapter syncs `currentTime` before screenshotting. Two renders byte-identical.
Driving `currentTime` from a plugin gives the same result, so **arbitrary retiming
— freeze, slow-mo, scrub a clip against a hold — is a pure function of t.** Cost:
**+10–20% render time** for a full-frame 1080p video. Video is nearly free under
our capture.

`src/pack/media.ts` already has the right seam: `policyFor()` bakes local paths and
`data:` URLs unconditionally. The one hard constraint: **a generated asset is an
input artifact, not a build step.** Generate at plan time, content-address the
bytes, record the hash in the storyboard. Generate during `build` and two builds of
one storyboard produce different pixels, drift fires, and byte-identical dies.
`bakedName()` already hashes the URL — extend it to hash the *prompt*, so the same
prompt resolves from cache rather than re-billing.

**Generated video is a no, and not because it cannot be embedded.** A generated
clip is stock motion competing with the explanation for attention, costs real money
per second, cannot be restyled to the theme, cannot be seeked to a hold that means
anything, and is two orders of magnitude larger than the vector scene that says it
better. Every motion a generative model would make for an explainer — a process
advancing, a figure assembling, a quantity growing — is exactly what Gap 1's
vocabulary does, seekably, at ~1/100th the bytes. Embedding *existing* video is a
different and worthwhile proposition: a paper's supplementary clip, a screen
recording, a demo capture — information that cannot be redrawn.

Per-deck money cost for image generation is a **guess**; no provider was priced.
Not a guess: it is a plan-time cost billed once per unique prompt, never a
render-time cost, because determinism forces it there.

---

## 6. THE RENDERER, AND SEQUENCING

**Do not move the renderer. Move the seam.** The coupling that would make a
compositional vocabulary change this answer is **12 non-comment lines in 19,849**.

The spike that decides it: take the *built* deck, seek the real GSAP timeline with
`suppressEvents` — the capture path — and independently evaluate the same statement
text with a hand-written evaluator that never touches GSAP.

| pass | checks | semantic mismatches |
|---|---|---|
| numeric | 1,756 | **0** |
| plugin-shaped (`attr.width`, `textContent`+`snap`, `color`, `fontWeight`) | 64 | **0** |

117 statements, **zero** callbacks, **zero** keyframes, **zero** repeats, seven
eases all closed-form and reproduced in 12 lines. The camera — the only non-lerp,
with function values and browser measurement — is bit-identical across forward,
reverse and scattered seek orders. `Scene.tl` is **data wearing a GSAP costume**.

So Remotion's frame-purity is a property we already have and did not know we had,
and a *compositional* vocabulary is more data and fewer statements — it reduces the
host's leverage further, not less. Moving costs **7–14 engineer-weeks** (2–3 counted
from 900–1,400 lines touched; 3–5 a guess to rebuild `hyperframes check`'s five
passes; 2–6 a guess with a bad prior to re-establish determinism, given that
EXPERIMENT-006, -007 and the `readyGate` note are three separate investigations
into exactly that and none of their conclusions transfer).

**Licence, where it actually bites.** Not the cost — below 4 employees the free
tier explicitly permits commercial video-making. Two other places. *Distribution*:
`npm i decksmith` obligates the installer to nothing today; on Remotion every user
above 3 employees inherits an obligation we cannot discharge for them. And *the
clause*: building on Remotion is fine, selling something that substantially *is*
Remotion is not. A document-to-deck product is clearly the former; an animated
presentation **framework** with a composable vocabulary — the thing the owner
described — is, read unkindly, a video framework on a video framework. I do not
think the clause reaches it. I also would not want to argue it while raising, and
**"Remotion 5.0 changes the terms" is what turns a manageable ambiguity into an
unmanageable one**: the risk is not today's text, it is that a dependency rewrites
our obligations on their schedule.

**Sequencing: vocabulary first, renderer after — with exactly one bit pulled
forward.** Deciding the renderer first optimises the cheap half of a seam we are
about to redesign. The one bit worth an afternoon: **is the new vocabulary DOM/SVG-shaped
or canvas/WebGL-shaped?** §2 answers it — DOM/SVG-shaped, with canvas as a leaf.
Therefore the renderer decision is **independent**, the answer is **stay**, and it
is revisitable in a year.

**One loyalty check that failed on our behalf, worth fixing whatever else happens:**
"a built deck is a directory of static files" is only partly true. The shipped
`index.html` still carries `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/...">`
(`composition.ts:38`) and the KaTeX JS (line 45); only the KaTeX *CSS* is vendored.
A served deck is 70 KB of self-contained HTML **plus two CDN fetches, with no SRI**.
Invariant 4 covers render time and holds; the presented deck is the gap.

---

## 7. THE COST

One engineer. "Measured" means a spike was timed or bytes were compared; "counted"
means lines were counted; "guess" means guess.

### Recommended program

| # | item | cost | basis |
|---|---|---|---|
| 1 | **Seam A** — `tween()` returns a `Tween` object | **2–4 days** | **counted**: 3-line fn, 56 call sites unchanged, 12 GSAP lines of coupling total, 50 test assertions |
| 2 | **Seam B** — deferred browser-measured scene build inside `readyGate` | **~1 week** | **guess**, informed by the morph engine timed at ~3h and by reading `sceneHtml`/`readyGate` (two functions) |
| 3 | `immediateRender` lint (§2.5) — ships *with* the morph, not after | **1–2 days** | guess |
| 4 | **`equation-morph` archetype**, keyed, part-level | **~1 week** | **spike timed**: 275 code lines, empty dir → green measurements in ~3h incl. two designs discarded on screenshot evidence. Productionising (lint, tests, key prompting) is the guess |
| 5 | Fix `prompt.ts` hold counts (§4) — derive from `emitScene` | **1 day** | **measured** defect table |
| 6 | **Vector vocabulary** (Gap 1): plugin seam + 8 verbs + DrawSVG | **1–2 weeks** | **counted**: archetypes avg 380 lines, `svg.ts` 427 for the whole primitive layer, `drawFrom` is 4 lines → 400–800 lines |
| 7 | **Layout pass** — the general solver, §3 | **3–6 weeks** | **guess with a bad prior.** Must subsume four different per-archetype search strategies; `fitBoxes` is the existing attempt and 11 of 12 archetypes declined it. **Highest-variance item here.** |
| 8 | Re-express 2–3 archetypes on the vocabulary as proof | **1–2 weeks** | **counted** from per-archetype line counts |
| **9** | `[ADDED]` **Migrate the other 9–10 archetypes** — §3 says eight of twelve "would eventually be re-expressed… one at a time"; costed nowhere | **4.5–10 weeks** | item 8's own rate (2.5–5 d each) × 9. Skipping it means carrying twelve hand-solved archetypes *and* a vocabulary indefinitely |
| **10** | `[ADDED]` Fix the pipeline self-loop, make `inside` build, vendor the CDN scripts, add `decksmith build` to the planner harness | **~1 week** | all shipped-product repair surfaced by this workflow; see review §8 |
| | **Total as listed** | **≈ 8–13 weeks** | the cost of *starting* |
| | `[CORRECTED]` **Total to a state where the vocabulary is how archetypes are written** | **≈ 14–20 weeks** | items 1–10, with Seam B re-costed at 2–4 wk |

> `[CORRECTED]` Two structural problems with the schedule, not just the sum.
> **(a)** Items 6 and 8 are downstream of item 7 — you cannot re-express `grid`
> (174 solver lines) or `stack` (73) until something places the objects — so the
> plan's last two items depend on the one item explicitly labelled
> highest-variance. **(b)** "What fits in one month: items 1–5" contains *no
> vocabulary*: two refactors, a lint, a bug fix and one archetype. That is a
> defensible month, but it should be sold as enabling work plus a demo.

### Conditional, decide after the above lands

| item | cost | basis |
|---|---|---|
| CSS-3D depth (Gap 2) + the `--workers 1` decision | **2–3 weeks** | **counted**: `camera.ts` is 332 lines for the 2D dive; depth is the same shape plus a z axis |
| Generated images (Gap 3) — materialiser, provider adapter, prompt-hash pinning | **~1 week** | **counted**: `media.ts` 255 lines, `policyFor`/`bakedName` exist → 200–300 new lines |
| Existing-video embed slot | **days** | **measured**: adapter exists, +10–20% render |
| Vendor GSAP/KaTeX JS into the deck page (kill the CDN fetches) | **1–2 days** | guess |

### Not doing

| item | cost avoided | why |
|---|---|---|
| Renderer move to Remotion | **7–14 weeks** | 12 lines of coupling; frame-purity already held; licence distribution risk |
| Exposing the algebra to the planner | — | ~~**measured**: 3/8 vs 6/8 clean~~ `[CORRECTED]` — **measured**: 4.7–6.4× wall clock, 4.0× JSON, and self-consistency collapsing 2/24 → 42/45 with length. Those three carry the decision. The clean-rate comparison does not (§1, §4). |
| Glyph-outline morphing | — | **measured**: 120.6 KB per morph vs ~1 KB today |
| Generated video | — | judgement, argued in §5 |
| three.js meshes | — | approved, unscheduled; compositing is a leaf, not a scene graph |

**What fits in one month:** items 1–5. That is both seams, the new invariant and its
lint, one shipped bug fixed, and **one visible new capability the owner can watch** —
the keyed equation morph, which is the single move that most looks like the thing he
asked for. Everything after month 1 is optional and independently justifiable, which
is the point of sequencing it this way.

---

## 8. WHAT THIS DOES FOR THE BUSINESS

Three framings exist in this project's history. They have different markets and
different moats, and the vocabulary serves exactly one of them.

**Manim-for-the-web framework.** This is what the vocabulary literally is, and it is
the worst business of the three. The market is developers, who pay little and
churn. Manim is free with a large community; Motion Canvas and Remotion already
occupy the "programmatic video in TypeScript" position. A framework's moat is
ecosystem, which we would be starting from zero, and the Remotion licence analysis
in §6 is a preview of what it feels like to *be* the dependency someone else worries
about. **Do not build for this framing.**

**Deck generator.** Crowded — Gamma, Tome, Beautiful.ai, Canva — and the vocabulary
does nothing for it. That market buys templates and speed, not algebras. A buyer
choosing between us and Gamma is not comparing morph fidelity.

**Paper-to-explainer pipeline.** This is where the accumulated evidence is worth
something, and it is the only framing where the vocabulary compounds. The customer
is a researcher, a lab, or a conference with a paper and a deadline, and their
failure mode is not "the deck is ugly" — it is **"the video was silently wrong and I
published it."** That is precisely the failure this project has spent eight — now
nine — documented cases learning to catch. The 40px floor, the drift gate, the
determinism work, the seven archetypes that throw rather than emit an illegible
slide, and the discipline of a human opening the artifact are a *trust* product,
and trust is what an explainer buyer is actually purchasing.

**Now the honest part.**

The vocabulary **makes the tool better and does not by itself change the market
position.** The ceiling the owner felt is real and §2 raises it — but a customer
does not buy "twelve archetypes became an algebra". They buy "it explained my paper
and it was not wrong."

> `[ADDED]` Two things this section should say and does not.
> **(a) The ceiling is not in the emit layer either.** Census of what the product
> animates: across the archetypes plus `camera.ts`/`svg.ts`, 37 of 58 parsed
> `tween()` sites give `opacity 33 · y 14 · x 6 · scale 4 · width 2 · textContent
> 1 · fillOpacity 1`; the renderer spike's census of the built 12-beat deck agrees
> (opacity 65, y 28, x 9, scale 8, fillOpacity 2, textContent 1 across 117
> statements); CSS motion declarations emitted by the twelve emitters: **0**.
> DeckSmith is a fade-and-slide slideshow with excellent typography — see
> `review/shots/A01-t9.5.png`, a handsome slide on which nothing moves in a way
> that carries meaning. The distance to 3Blue1Brown is not twelve archetypes
> versus an algebra; it is that no motion here *explains* anything, and the
> planner — which this document recommends leaving on a menu — is what decides
> whether a deck contains an explanation-carrying move at all.
> **(b) The trust story has a hole in it right now.** "It was not wrong" is the
> product, and `demo/storyboard.json` currently renders a diagram that contradicts
> the paper, with every gate green (§4). Fix that before the sentence is used in
> front of a customer. The 2,011-line solver, the determinism work and the
green-gate-over-wrong-output catalogue are what make that true, and the renderer
investigation's judgement on them is correct and uncomfortable: **that is a
switching cost, not a moat. It is expensive, non-transferable, and worth nothing to
a customer.**

Two things in this document *do* move the position, and neither is the algebra:

1. **The measured planner ceiling.** 37 content fields is the entire expressible
   space of the product today. Every new capability currently costs an archetype
   from scratch. The vocabulary is what makes capability #13 cost days instead of
   380 lines — so the product's *rate of improvement* changes, not its features
   this quarter. That is a real compounding advantage and it is invisible in a
   demo.
2. **The layout pass.** It is the only item here that would let the planner author
   more freely without degrading, and the planner is where the ceiling actually
   binds. Item 7 is the highest-variance line in §7 and also the highest-leverage
   one. If exactly one thing on this list ships, it should be the seams; if exactly
   two, add the layout pass.

**The moat question, answered plainly.** There is no moat in the renderer and none
in the vocabulary. If there is one, it is upstream of both: whether a planner behind
a JSON schema can reliably generate an explanation worth watching. Arm A's 6/8, the
0 dangling references in 1,632 tweens, and the fact that the planner did unprompted
proportional arithmetic correct to 1% on a bar chart are the most encouraging
numbers in this entire workflow — and they all come from the *menu*. Nothing in the
renderer layer moves that number, and giving the planner an algebra measurably moves
it the wrong way.

**Build the algebra for ourselves. Keep giving the planner a menu. Spend the
difference on the layout pass, which is the only thing that lets the menu grow.**

> `[CORRECTED]` "Every encouraging number… comes from the menu" is the sentence
> the corrections above most damage. Arm A's 6/8 is metric-dependent and 0/8 once
> the deck is built; the 0 dangling references in 1,632 tweens is an **arm-B**
> number, from the algebra; the unprompted proportional arithmetic is a property
> of the model, not of the vocabulary. What survives is the cost comparison
> (4.7–6.4×, 4.0× JSON, self-consistency 2/24 → 42/45) — which is enough to keep
> the planner on a menu, and is not enough to call the menu *reliable*.

---

## CHANGE LIST — corrections applied after review

Source: `.planning/VOCABULARY-REVIEW.md`, evidence in
`experiments/013-vocabulary/review/`.

| § | claim | disposition |
|---|---|---|
| 1, 4 | "clean 6 of 8 vs 3 of 8", "half the clean rate" | **wrong as a conclusion.** `score.mjs`'s own metric gives 0/8 vs 2/8; p = 0.31; four metrics, three winners |
| 1 | "seeks correctly on all seven test cases" | **narrowed.** Seek-correct 7/7, visually correct 4/7; 4 distinct equations, not 7 |
| 1 | keyed morph "inherits the archetype arm's 6/8 generability" | **unsupported.** Keys are embedded `\htmlClass` TeX, and planner key generation was never tested |
| 1, 4 | "`tex` running off the right edge in B06" | **withdrawn.** `preview.mjs` draws TeX source, not KaTeX output |
| 2.4 | "12 non-comment GSAP lines in 19,849" | **wrong.** 4 lines contain the token; the coupling is 58 `tween()` sites + a regex over statement text |
| 2.4 | Seam B "~1 week" | **re-costed 2–4 weeks**, six files listed |
| 2.5 | "nine documented cases" | **ten.** `pipeline.ts:399` silently rewrites a self-loop; in the shipped demo; all 8 arm-A runs |
| 3 | "2,011 (72%)" | **1,013 measured + 998 assumed.** Sibling classifier says 56% |
| 3 | "this is additive" | **restated.** 1,600–2,000 lines are rebuilt, not preserved |
| 4 | "B is not sandbagged" | **false.** Arm A got 3.0× the specification (32,274 vs 10,638 bytes) |
| 4 | "arm A's only non-narration defect is a headline over 60 chars" | **false**, and the 60-char check is a proxy that renders fine |
| 4 | "the failures are all placement, never structure" | **arm B only**, and only as measured |
| 5 | canvas cell 12 "seek-pure and byte-identical" | **unverified.** Its own artifact reports two values at t=2 |
| 7 | "≈ 8–13 weeks" | **cost of starting.** 14–20 weeks with migration and a re-costed Seam B |
| 8 | "every encouraging number comes from the menu" | **half wrong**; the dangling-reference number is arm B's |

Two claims the review **confirmed** by independent re-run and that should be
trusted: the plugin-`render()`-under-`suppressEvents` fact (§5), and the §3
emitter-body split from `autopsy/emitter-split.mjs`.
