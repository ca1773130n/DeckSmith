# THE REVEAL-ORDER INVERSION, and why the eight warnings are not evidence for it

§13 closed with a proposal:

> The eight warnings are real and unfixed: the planner writes a sentence naming
> parts in an order the emitter does not draw them in. Nothing steers it yet, and
> per §9 a prompt rule about this can be met cosmetically — the honest lever is
> probably to let the beat declare its reveal ORDER from the sentence rather than
> the other way round.

The owner asked for "investigate, then build if sound." It is not sound. This
section is why, and what to do instead.

The short version: **the sentence "the eight warnings are real" is the part that
does not survive.** On the archetype carrying the largest share of them the
detector cannot tell a correct order from a reversed one, and no permutation of
the beat's parts can clear it — so the lever it motivates is a no-op exactly
where the load is. Where the detector *is* sound, the prompt rule that shipped in
§15 already reaches it. What is left over is a detector bug, three of them, and a
prompt that contradicts itself in the same file.

---

## 1. WHAT THE DETECTOR ACTUALLY COMPARES

`scanNarrationLead` (`src/verify/index.ts:515-554`) walks each scene's part
labels and asks when each one is spoken against when it is drawn:

```ts
const appears = scene.start + (scene.holds[Math.min(j, scene.holds.length - 1)] as number);
const said = firstMention(mine, label);
if (said !== undefined && said + LEAD_SECONDS < appears) { … }
```

`src/verify/index.ts:538-540`, with `LEAD_SECONDS = 1` at `:460`.

So label `j` is charged against **hold `j`** — and where a scene has fewer holds
than labels, `Math.min` pins every remaining label to the *last* hold. The
docstring is explicit that this is meant to be safe in one direction
(`src/verify/index.ts:501-504`):

> a part is assumed to appear at the EARLIEST hold that could be its own,
> `holds[min(j, last)]`. Where an archetype spends its first hold on a landing
> rather than a part, the real appearance is later than this and the finding is
> missed rather than invented.

That is true when `holds.length >= labels.length`. It is exactly false when it is
not, and one shipped archetype guarantees it is not.

---

## 2. THE MEASUREMENT THAT DECIDES IT

Feed the **real exported gate**, imported read-only from `dist/index.js`, a
five-bar chart with the **real holds the emitter produces**: `[3.65, 4.45]`,
taken from `demo/deck/timing.json` scene `s8`. Then enumerate all 120 orderings
of the bars, each paired with a narration naming them in that same order. A
perfectly obedient planner, in other words: whatever the beat lists, the sentence
says, in that order.

```
IS THERE ANY PERMUTATION THAT CLEARS A 5-BAR CHART?
  120 permutations, each with narration naming the bars in that exact order:
    2 warning-part(s): 48 permutation(s)
    3 warning-part(s): 72 permutation(s)
  best achievable: 2 (e.g. CARN, DQ-CTM-SR, IMDN, RFDN, CATANet) — zero is UNREACHABLE

SAME SWEEP ON PIPELINE (holds match parts one-for-one):
    0 warning-part(s): 24 permutation(s)
  best achievable: 0 (e.g. Encoder, Windows, Ticks, Decoder) — zero is REACHABLE
```

Two facts, and between them they settle the build question:

- **On `bar-compare` the gate is unsatisfiable.** Not hard to satisfy —
  unsatisfiable. Zero of 120 orderings clear it. A feature whose whole purpose is
  to let the beat choose an order cannot help, because every order loses.
- **On `pipeline` the gate is already satisfied**, by all 24 orderings, whenever
  the narration names the stages in the order the beat lists them. That is
  precisely what the prompt rule shipped in §15 already instructs
  (`src/plan/prompt.ts:366-376`). A schema field would be re-plumbing a decision
  the planner already makes and already gets told to make.

Order discrimination, swept over the offset at which the voice enters (the
narration waits for the headline entrance, so 0.0s is not a real deck):

```
  voice starts 0.0s | bar-compare  order=4 reversed=3 || pipeline  order=4 reversed=2
  voice starts 0.6s | bar-compare  order=3 reversed=3 || pipeline  order=0 reversed=2
  voice starts 1.2s | bar-compare  order=3 reversed=2 || pipeline  order=0 reversed=2
  voice starts 1.8s | bar-compare  order=2 reversed=2 || pipeline  order=0 reversed=2
```

At every realistic offset `pipeline` behaves: correct order silent, reversed
order flagged. And `bar-compare` is either indifferent or **anti-correlated** —
at 1.2s the narration in exact draw order scores *worse* than the exactly
reversed one.

---

## 3. WHY: ONE HOLD FOR N BARS, AND IT IS DELIBERATE

`src/emit/archetypes/bar-compare.ts:434-437`:

```ts
// One reveal, not `count` of them: the comparison only exists once every bar is
// drawn, so that is the frame navigation should land on.
const settled = barsAt + (count - 1) * step + grow + 0.05;
const holds = [settled + 0.2];
```

A second hold is pushed only if there is a unit or a note (`:453`). So a five-bar
chart has two holds for five bars, and `holds[Math.min(j, last)]` charges bars 1
through 4 against the settled chart. The arithmetic, from `:379-382`
(`barsAt = 0.95`, `step = min(0.4, 2.4/count)`, `grow = 0.85`) and the label fade
at `:393-398` (`.bc-lab` from 0.8s, staggered by `step`):

```
  bar 0: grows 0.95-1.80s, label readable 1.20s, gate believes 3.65s, over-estimate 1.85s
  bar 1: grows 1.35-2.20s, label readable 1.60s, gate believes 4.45s, over-estimate 2.25s
  bar 2: grows 1.75-2.60s, label readable 2.00s, gate believes 4.45s, over-estimate 1.85s
  bar 3: grows 2.15-3.00s, label readable 2.40s, gate believes 4.45s, over-estimate 1.45s
  bar 4: grows 2.55-3.40s, label readable 2.80s, gate believes 4.45s, over-estimate 1.05s
```

The smallest over-estimate is 1.05s against a **1.0s threshold**. The error alone
clears the bar. Every bar-compare finding is manufactured by the model, not
observed in the picture.

This is not an accident anyone can quietly fix by nudging a constant, because a
test pins it. `test/arch-bar-compare.test.ts:206-209`:

```ts
// The first hold is where navigation lands, so every bar must be grown by
// then — the last bar's tween ends at 0.95 + (n-1)*step + 0.85.
expect(scene.holds[0] ?? 0).toBeGreaterThanOrEqual(grown);
```

The suite asserts that the first hold comes **after every bar is drawn**. The
detector's stated conservatism assumes the first hold comes before. One of the
two has to give, and it is not the emitter: a bar chart's comparison genuinely
does not exist until the bars are there, which is the whole reason for the single
hold.

Measured across the built decks, the split is clean. `pipeline` pushes one hold
per stage and nothing else (`src/emit/archetypes/pipeline.ts:625,647`), so
`holds[j]` *is* stage `j`'s reveal, exactly. `annotated-figure` and `grid` open
with a landing hold (`annotated-figure.ts:742` `const holds = [FIG_IN]`,
`grid.ts:471` `const holds = [drawn]`) and then one per part, so `holds[j]` is
part `j-1`'s reveal — genuinely conservative, exactly as the docstring says.
Only `bar-compare` runs the other way.

---

## 4. §15's WORKED EXAMPLE DOES NOT CLEAR ITSELF

This is the part that says a previous assumption was wrong, and it is worth
stating plainly because it is now teaching the planner.

§15 recorded a true positive and shipped a prompt rule carrying it as the worked
example (`src/plan/prompt.ts:372-376`):

> "The reported averages put DQ-CTM-SR in the CNN baseline range" over bars
> listed CARN, IMDN, RFDN, DQ-CTM-SR names the fourth bar while the first is
> still growing; either list DQ-CTM-SR first, or open on what the early bars
> show.

Applying that fix, through the real gate, with the real holds:

```
as criticised (DQ-CTM-SR listed 4th):
  … names 1 part(s) … — "DQ-CTM-SR" at 2.5s, drawn at 4.5s.
as the prompt instructs (DQ-CTM-SR listed 1st):
  … names 1 part(s) … — "DQ-CTM-SR" at 2.5s, drawn at 3.6s.
```

It still fires. And the picture says the opposite of the message: listed first,
that bar grows from 0.95s to **1.80s** and its label is readable at **1.20s**.
The word is spoken at 2.5s — 0.7s *after* the bar finished drawing, 1.3s after it
became readable. The warning text reads "The viewer hears the word over a picture
that does not have it yet" (`src/verify/index.ts:549`) and the viewer is in fact
looking straight at it.

So §15's measured "2 warnings → 1" did not come from the ordering fix. Something
else moved that count — most plausibly the 0.8s gap between `holds[0]` (settle)
and `holds[1]` (the unit/note tail), which a reorder shifts without changing a
single frame. That is §9's "a prompt rule about this can be met cosmetically"
already happening, in shipped code, in the rule written to prevent it.

---

## 5. THE PROMPT CONTRADICTS ITSELF, in one file, about bars

No measurement needed for this one — both halves are in `src/plan/prompt.ts`.

`:46`, the reveal-count table the planner is handed:

```
  "bar-compare": "2, however many bars there are",
```

`:367-369`, the ordering rule:

> The beat reveals its stages, **bars**, layers and notes one at a time, in the
> order you list them in `params`, and the voice starts before the first one has
> landed.

The table is right and matches the emitter. The ordering rule's premise is false
for bars, and the gate implements the false half. The word "bars" in that
sentence is the whole bug, restated as instruction.

There is a second contradiction, softer but larger in effect.
`src/plan/prompt.ts:354-359` asks every beat to open by connecting to the one
before it — "it may open with a pronoun, a consequence or a contrast" — and
`:369-371` forbids naming anything before it appears. A connecting opener names
its subject. Both rules cannot hold at once, and today the planner is asked to
satisfy both.

---

## 6. THE RATE, AND WHAT SURVIVES A CORRECT MODEL

There is no committed corpus this can be measured on honestly, which is itself a
finding (§8 below). What follows is **modelled**: real gate, real plans, real
per-archetype hold arithmetic read from each emitter, and modelled scene and
segment times using §13's own reported 60.03s length and 42.54s of speech.

Over all 137 committed plans that carry narration:

```
plans with narration:  137
plans firing the gate: 80 (58%)
warnings total:        149  (1.1 per plan)

by archetype:
  bar-compare            62  (42%)
  pipeline               57  (38%)
  annotated-figure       25  (17%)
  grid                    4  (3%)
  stack                   1  (1%)
```

Now recompute `appears` from each emitter's own arithmetic, taking the moment the
part actually finishes drawing instead of `holds[min(j, last)]`, and count how
many flagged parts survive:

```
archetype            flagged  vanish  survive
bar-compare               90      86        4
pipeline                  64       1       63
annotated-figure          35       0       35
grid                       9       0        9
stack                      1       0        1
```

**86 of 90 bar-compare flags are artefacts of the holds model.** Every other
archetype is untouched by the correction, because for them the model is either
exact (`pipeline`) or conservative (`annotated-figure`, `grid`). One bug, one
archetype, 43% of all flagged parts.

Treat the archetype **share** and the **survivor ratio** as load-bearing. Do not
trust the absolute rate: it applies one 60s fill regime uniformly to plans
authored at many durations, and a parallel reconstruction of the same thing
using a different voice offset produced 137/137 firing and 1.8 per plan against
my 58% and 1.1. The two disagree on the rate and agree on the shape, which is
about what a model of this kind is worth.

---

## 7. THE HAND-JUDGED CASES

§13's plan is `experiments/018-duration/sb-continuous-60s.json`; its first
narration matches `renders/filled-12beat-60s.srt` verbatim, which is how it was
identified. Replayed through the real gate over modelled fill timing it
reproduces **7 warnings against the 8 §13 measured**. Each one below carries the
beat's real draw order and its real sentence.

### b02-compare — `annotated-figure` — FALSE

```
DRAW ORDER : 0:compact CTM representation | 1:window-wise adaptation | 2:DQ-CTM comparison point
NARRATION  : The comparison shows why a direct compact thought is not enough.
FLAGGED    : "DQ-CTM comparison point"
```

The sentence names no annotation. It is charged with naming the third one because
the common noun *comparison* is also a word inside that note's label. `mentions`
(`src/verify/index.ts:617-630`) matches if **any** non-stop label word of length
≥3 matches, so one incidental word convicts a three-word label.

### b06-windows — `grid` — FALSE

```
DRAW ORDER : 0:window group | 1:window group | 2:remaining cells | 3:remaining cells
NARRATION  : Windows make the dense carrier addressable without losing location.
FLAGGED    : "window group"  (the second copy)
```

Four regions, two distinct labels, each used twice. The single word "Windows" is
spoken once and charged against both copies — and one spoken word cannot be early
for a *duplicate*. `partLabels` (`src/verify/index.ts:590-606`) emits duplicates
without collapsing them.

### b07-ticks — `pipeline` — FALSE

```
DRAW ORDER : 0:Read carrier | 1:Compact thought | 2:Update carrier
NARRATION  : The same compact process can be reused across the dense field.
FLAGGED    : "Compact thought"
```

*compact* here is an adjective describing the method. The sentence names no
stage. Same mechanism as b02: one generic word inside a two-word label.

### b08-progress — `annotated-figure` — FALSE

```
DRAW ORDER : 0:bicubic reference | 1:early reconstruction | 2:later ticks | 3:ground truth
NARRATION  : The reconstruction sequence makes each thought tick visible in output.
FLAGGED    : "early reconstruction"
```

"The reconstruction sequence" describes the whole figure. Again one word,
"reconstruction", standing in for a two-word label.

### b09-error — `annotated-figure` — **REAL**

```
DRAW ORDER : 0:same crop basis | 1:absolute error | 2:shared colour scale
NARRATION  : A shared colour scale keeps the error maps directly comparable.
FLAGGED    : "shared colour scale"
```

The sentence opens on the **third** annotation while the first is still landing.
This is the genuine defect the whole section is about, and a viewer would notice
it. Note the archetype: notes carry explicit x/y anchors, so their reveal order
is free of layout — reordering the notes fixes it and changes nothing on screen.

### b10-results — `bar-compare` — FALSE (marginal)

```
DRAW ORDER : 0:CARN | 1:IMDN | 2:RFDN | 3:DQ-CTM-SR
NARRATION  : The reported average puts DQ-CTM-SR close to the CNN baselines.
FLAGGED    : "DQ-CTM-SR"
```

Four bars: `step` 0.4, so bar 3 grows 2.15-3.00s and its label is readable at
2.40s, while the gate believes 4.05s. Over-estimate 1.05s against a 1.0s
threshold — the finding is entirely the error. This is the same shape §15
recorded as its true positive.

### b11-transformer-gap — `bar-compare` — AMBIGUOUS, and unfixable either way

```
DRAW ORDER : 0:DQ-CTM-SR | 1:CATANet
NARRATION  : CATANet marks the current lightweight transformer gap in the table.
FLAGGED    : "CATANet"
```

Two bars. Bar 1 grows 1.35-2.20s, label readable 1.60s, gate believes 3.25s. On
bar geometry the lead survives correction at ~1.35s; on label readability it does
not, at ~0.75s. So whether a viewer would notice depends on whether "drawn" means
the rectangle finished or the name became readable.

It does not matter, because the lever cannot move it. Swapping the two bars —
applying the proposed inversion perfectly, so the first-named bar is listed first
— produces a **byte-identical** warning:

```
bars listed [DQ-CTM-SR, CATANet]: … "DQ-CTM-SR" at 0.0s, drawn at 2.5s.
bars listed [CATANet, DQ-CTM-SR]: … "DQ-CTM-SR" at 0.0s, drawn at 2.5s.
byte-identical: true
```

**Tally: five false, one real, one ambiguous.** The one real case is
`annotated-figure`, which the prompt rule shipped in §15 already reaches. Neither
the real one nor the ambiguous one is the archetype the prompt's worked example
is written about.

---

## 8. THERE IS NO CORPUS TO MEASURE ANY FIX ON

`scanNarrationLead` needs a built deck's `timing.json` **with narration
segments** — it returns at `if (mine.length === 0) continue`
(`src/verify/index.ts:534`) otherwise, and it is wired only where the cut beats
and a timing are both in hand (`src/verify/index.ts:134`), so `verify <dir>`
never reaches it. Measured over the repository:

```
timing.json committed:            45
  ... with narration segments:     5
  ... pairing to a matching plan:  2
  ... actually firing the gate:    0
```

The two are `demo/deck` and `experiments/016-watch/deck` — the same 12-beat
storyboard built twice. Both fire zero, and the reason is not that their ordering
is right. `demo/storyboard.json`'s bar-compare beat reads:

> b08: bars [CATANet, RFDN, IMDN, DQ-CTM-SR, CARN]
> narration: "On parameters the method is the second largest here, at 1.13
> million. So this is not the cheap option, and the paper never claims it is."

It says *the method*. It never names a bar, so there is nothing to be early
about.

This is §9's lesson with a bigger number attached. §9 recorded that a wording
change could not be scored over a single plan; here a whole gate has one deck,
and that deck cannot exercise it. **Anything built now — prompt rule or schema
field — would ship unmeasured, and would be reported as landed on the strength of
a green gate.** That is the failure mode AGENTS.md opens with.

---

## 9. WHY THE INVERSION IS THE WRONG BUILD

Four reasons, in descending order of how much they cost to discover.

**It is a no-op where the load is.** 42% of modelled warnings are `bar-compare`,
where zero of 120 orderings clear the gate and a perfect swap produces an
identical message. Whatever the feature does, it cannot do it there.

**Where the gate is sound, the shipped rule already reaches it.** All 24 pipeline
orderings clear. The planner writes both the sentence and `params`, and
`src/plan/prompt.ts:370-372` already tells it to make them agree. Moving that
decision into the schema buys a new optional field, 261 receipts in
`experiments/score/ledger.json` to keep valid, and seven test sites that assert
holds are emitted in ascending order — `test/archetypes.test.ts:322`,
`test/arch-pipeline.test.ts:243`, `test/arch-bar-compare.test.ts:203`,
`test/arch-annotated-figure.test.ts:361`, `test/arch-grid.test.ts:222`,
`test/arch-stack.test.ts:202`, `test/arch-split-compare.test.ts:256` — in
exchange for a decision that is already being made.

**Reveal order is welded to meaning on the archetypes that fire most.** A
pipeline's stage `i` is position `i` along the flow, with arrow `i-1` revealed
just before it (`src/emit/archetypes/pipeline.ts:625-647`); reordering `params`
draws the pipeline backwards. `bar-compare` puts bar `i` at x position `i`.
`stack` prints an ordinal per layer. `split-compare` has no array at all — `left`
and `right` are named object keys (`src/types.ts:263-272`), so there is no order
to declare, only a side swap. The order is genuinely free only on
`annotated-figure` and `grid`, whose parts carry their own x/y anchors — which is
17% and 3% of firings, and 35 and 9 of the 112 survivors.

**And the half that already shipped is unsafe next to the camera.** This one
matters regardless of what is decided here. `inside.element` names a part by
**index suffix**, and `withCamera` (`src/emit/composition.ts:438`) only checks
that the id exists:

```ts
if (!scene.html.includes(`id="${elementId(sid, part)}"`)) { throw … }
```

Measured over the 140 committed plans: 127 carry an `inside.element`, 130
references in total, and **every one is index-derived** — `stage1`×96,
`stage0`×25, `stage2`×6, `lay0`×2, `rgn0`×1. Reordering a beat's `params` to
satisfy an ordering rule leaves the id existing and silently re-aims the dive at
a different part. The deck renders a camera move into the wrong box with every
gate green. Most of those dives sit on `equation-walk`, which
`scanNarrationLead` skips via `EMPHASISED` (`src/verify/index.ts:479`) — but 11
of them sit on `grid`, `annotated-figure` and `pipeline`, which is precisely the
set any ordering work would touch.

---

## 10. WHAT TO DO INSTEAD

In order. The first four are small, and together they are most of the problem.

1. **Guard the index-to-hold map.** In `scanNarrationLead`
   (`src/verify/index.ts:537`), skip any scene where
   `scene.holds.length < labels.length`. The map is unsound by construction
   there, and this is the archetype-agnostic form — it covers any future
   archetype that batches its reveals. Measured effect: 86 of 90 bar-compare
   flags disappear, nothing else moves.

2. **Delete the word "bars" from the ordering rule** at
   `src/plan/prompt.ts:367`, and rewrite the worked example at `:372-376`, which
   does not clear itself. The prompt's own reveal table at `:46` already says
   bar-compare has two reveals however many bars there are.

3. **Fix `mentions`** (`src/verify/index.ts:617-630`). Four of the seven
   hand-judged cases are one mechanism: a single generic word inside a multi-word
   label convicts the whole label. Require a match on the label's distinctive
   word, or on all-but-one of its words, rather than on any word.

4. **Collapse duplicate labels** in `partLabels`
   (`src/verify/index.ts:590-606`) to their earliest draw index. One utterance
   cannot be early for the second copy of a label.

5. **Correct the docstring** at `src/verify/index.ts:499-509`. As written it
   promises under-reporting. On bar-compare it over-reports by 1.05-2.25s against
   a 1.0s threshold, and the docstring is the reason nobody checked.

6. **Commit one narrated deck's `timing.json` as a fixture** — the timing, not
   the mp3s. Until then, no change to this gate can be scored, and §9 repeats.

7. **Then re-measure, and only then decide.** The residual after the corrections
   is 112 flagged parts: 63 `pipeline`, 35 `annotated-figure`, 9 `grid`, 4
   `bar-compare`, 1 `stack`. Judge a sample of those by hand the way §7 above
   does before building anything for them.

8. **Resolve the topic-sentence question explicitly**, because it will dominate
   whatever is left. `src/plan/prompt.ts:354-359` asks each beat to open by
   connecting to the previous one; `:369-371` forbids naming a part before it
   appears; a connecting opener names its subject. Either exempt the first
   sentence in `scanNarrationLead` or drop the connecting-opener rule.

9. **Separately and regardless: make the camera safe.** Either record which label
   each enterable id carried and check identity in `withCamera`, or tell the
   planner never to reorder the `params` of a beat the next beat dives into.
   This is live today, shipped in §15, with 130 index-derived references in the
   committed corpus.

If an ordering *field* still looks worthwhile after step 7, scope it to
`annotated-figure` and `grid`, make it optional with an identity default so the
261 ledger receipts and every stored plan's sha256 in
`experiments/score/scored.test.mjs` stay valid, and name `pipeline`, `stack`,
`bar-compare` and `split-compare` as out of scope rather than half-supporting
them. A cheaper lever exists and should be compared against it first:
`segment.stop` (`src/types.ts:584`) already binds a sentence to a specific
reveal and `speechPlan` already honours it (`src/emit/composition.ts:568-582`);
only `planSegments` (`src/narrate/narrate.ts:91-102`) assigns stops positionally.
Letting a beat say which reveal each sentence belongs to inverts the same
dependency without touching a single archetype's layout, DOM id, or camera
target — though it only bites under `density: high`.

---

## 11. WHAT I COULD NOT VERIFY

Stated plainly, because a gate passing is not evidence and neither is a report.

- **I could not replay the actual eight §13 warnings.** The deck that produced
  them was never committed built. `experiments/018-duration/` holds storyboards,
  mp4s and srts, and rebuilding needs TTS and a build, both forbidden in this
  session. The seven in §7 are the real gate over the real plan with real
  archetype hold arithmetic, but **modelled** scene and segment times. That they
  land on 7 against 8 is corroboration, not measurement.
- **The corpus rate in §6 is modelled and disagrees with a parallel
  reconstruction** (58% firing / 1.1 per plan here, 100% / 1.8 there, differing
  in voice offset). The archetype share and the 86-of-90 survivor result hold
  regardless, since they follow from `holds.length < parts`. The absolute rate
  should not be quoted.
- **The false/real split in §7 is a judgement**, and my cue windows are
  synthetic, so which beats fire is phrasing-sensitive. An independent pass
  produced a different set of seven with the same 5-false shape and a different
  real one (`b03-carrier` rather than `b07-ticks`), which is about the agreement
  a modelled replay deserves.
- **I ran no build, no test and no typecheck** — `dist/` is held by a live
  server. Every file:line above was read from source and every measurement drove
  the already-built `dist/index.js` read-only, so I have not confirmed the cited
  set still compiles together.
- **I did not check whether any committed plan's `inside.element` already points
  at the wrong stage.** The mechanism is confirmed in source and the 130
  references are measured; whether the hazard has already fired is unknown.

  **ANSWERED, 2026-08-07: it has fired.** All 162 committed `inside.element`
  references were resolved against the params they index and grouped into 60
  distinct (archetype, element, resolved label, headline) situations, each read
  against the diving beat's headline, intent and narration. 59 are right. One is
  not: `experiments/015-decision/runs-n32/menu-20/plan.json` has
  `b02-carrier-equation` — headlined "The dense carrier is encoded before it is
  windowed" — enter `stage2`, which is "DQ-CTM thought", where 22 other plans in
  the same sweep pair the identical headline over the identical stage list with
  `stage1`, "Window". Every gate is green on it, because the id exists. That is
  1 of 60 situations, 2 of 162 references, 1 of ~26 plans, and it is experiment
  output rather than the shipped demo — `demo/fixtures/camera.storyboard.json`
  is correct. `inside.label` and `Scene.parts` were added because of it; the two
  tests that pin it are in `test/camera.test.ts`. It is still a judgement from
  headline, intent and narration against a 22-plan control, NOT a rendered
  artifact check. The 130 pre-existing references stay unchecked, `label` being
  optional, so rebuilding menu-20 today still dives into the wrong box.
- **I did not look at a rendered video.** Nothing here is an artifact check, and
  by this project's own record that is where the next real defect will be found.

Repository untouched — `git status --short` empty. Scripts backing every number
above are in `/Users/neo/.blackhole/DeckSmith/2026-08-07/`: `verify-report.mjs`
(bar-compare arithmetic, §15's worked example, the mechanisms), `verify-order.mjs`
(the permutation sweep and offset sweep), `verify-corpus.mjs` and
`verify-narrated.mjs` (what the committed corpus can exercise), `verify-s13.mjs`
(the §13 replay and draw orders), `verify-rate.mjs` (corpus rate and the survivor
table), `verify-camera.mjs` (the `inside.element` scan).

---

## 12. WHAT LANDED FROM §10, AND WHAT DID NOT

Committed with this document, on `fix/slides-floor-and-rederive`:

- **§10.1, the hold guard.** `scanNarrationLead` now skips any scene where
  `holds.length < labels.length` instead of clamping with `min(j, last)`. This is
  the 86-of-90 correction, in the archetype-agnostic form §10 asked for.
- **§10.2, "bars" out of the ordering rule.** `src/plan/prompt.ts` no longer
  names bars in LEAD WITH WHAT IS DRAWN FIRST, and the worked example — which §4
  showed does not clear its own gate — is replaced with a `pipeline` one, the
  archetype where §6 measured the hold map to be exact.
- **§10.4, duplicate labels collapsed** to the first index that drew them.
- **§10.5, the docstring corrected.** It promised under-reporting; it
  over-reported. That promise is the reason nobody checked, so the correction
  says so in those words.

**NOT done, deliberately:**

- **§10.3, `mentions`.** Not a few lines. `firstMention` calls `mentions` once
  per WORD of a cue, so a single fragment can never match two words of a label —
  requiring the distinctive word or all-but-one first needs `firstMention`
  restructured to match over a window of cue text. Worth doing; not worth doing
  blind, which is §10.6's whole point.
- **§10.6–§10.8.** A committed `timing.json` fixture, the re-measurement it
  enables, and the topic-sentence contradiction. §10.7 is explicit that the
  residual should be hand-judged before anything is built for it, and none of
  the four changes above can be *scored* until §10.6 exists.
- **§10.9, the camera.** This is the one that should not wait. It is live today,
  shipped in §15, with 130 index-derived references in the committed corpus, and
  it is a correctness hazard rather than a reporting one.

The measurement scripts this document cites by name (`verify-*.mjs`, `permute*.mjs`,
`lens-*.mjs`) were written into a dated scratch directory and are not committed.
Every number here is reproducible from the corpus in `experiments/` and `demo/`
against the exported `scanNarrationLead`.
