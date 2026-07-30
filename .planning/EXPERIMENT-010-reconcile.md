# EXPERIMENT-010 — reconciling blackout, burn-in, and selection

Three agents landed at once: the scene-to-scene blackout (`emit/composition.ts`,
`emit/camera.ts`), burned-in captions (`render/*`, `cli.ts`), and budgeted beat selection
(`plan/select.ts`, `verify/budget.ts`, `types.ts`). Each was written against one prose
description of the system; none could see the others' code. This is what disagreed, what
the wiring cost, and what is still open.

The blackout's own measurements are in that workstream's record and are not repeated. The
determinism story is still EXPERIMENT-006.

---

## 1. The main job: the selection was a pure function nobody called

`selectBeats` was complete, tested twenty ways, and **dead**. The deck was cut by
`weight >= format.minWeight` inside `layout()`, and the budget could only be *reported*,
by `verify`, after the over-long deck had already been written. One storyboard could not
produce both a deck and a short without a human running the arithmetic and feeding a
threshold back in.

It is now `planCut` in `src/emit/composition.ts`, called by `layout`.

**The hard part was that the input did not exist yet.** `selectBeats` needs each beat's
*narrated* length, which is only known once the scene has been emitted and its holds are
in hand — but a scene id is a position over the beats that **survive** (`s1`, `s2`, …) and
every timeline selector is scoped by it (invariant 3). So a scene emitted before the cut
is known carries ids for a deck that is not the one being built. `planCut` therefore emits
every candidate, reads `beatSeconds` off it, throws the HTML away, selects, and `layout`
emits again for real. Holds are times and do not depend on the scene id, which is what
makes measuring with provisional ids exact rather than approximate.

**Measured, and the prediction is exact.** On the unflagged 9:16 demo:

```
cut.seconds  = 178.75   (predicted, before a byte is emitted)
root data-duration = 178.75   (emitted)
```

Zero prediction error, not "close". The nine kept slides sum to 178.750.

The cost is one extra emit pass per layout. It is paid for: `emitDeck` used to run
`layout` **twice** — once inside `emitComposition` and once for the slides — and now runs
it once and renders both artifacts from the result. For `emitDeck`, total scene emissions
are unchanged (24 on the demo, before and after).

### Only the floor's survivors are measured

`emitScene` throws on a beat it cannot draw. A beat the floor has already dropped must not
be able to fail a build that never wanted it, so `planCut` measures the floor's survivors
only and lets `selectBeats` fall back to authored `beat.seconds` for the rest — which is
all a floor drop's report needs.

### The camera tail is charged to the budget

A dive is 1.8s of deck that is not narration: `layout` gives the containing beat
`seconds + diveTail`. A selection blind to that under-counts by 1.8s per camera and hands
`verify` a cut that turns out not to fit. `planCut` charges `MOVE_SECONDS + FADE_SECONDS`
to the containing beat, asked of the **floor's** list, which is an upper bound and
therefore safe: a beat carries a tail only when the next *surviving* beat dives into it,
and cutting beats can remove a tail but never add one. Pinned in `test/camera.test.ts`
("charges the camera's tail to the budget that has to pay for it": 10.8 for a 9s beat with
a dive, 9 without).

The demo has no `inside` relation, so this changes nothing there — which is the point of
having a test for it.

---

## 2. The disagreement that would have deleted content

**`select.ts` and `camera.ts` held opposite beliefs about a broken `inside`, and both were
tested.**

- `selectBeats` step 2 cascaded: drop a container, drop everything inside it, to a
  fixpoint. Its comment: *"Keeping the dependent without the container is not a worse deck,
  it is a build error."*
- `enteredParts` in `composition.ts` reads the relation off the beats that **survived**, so
  an orphan simply gets no dive and draws itself. `test/camera.test.ts` has asserted this
  since the camera landed: *"ignores a relation whose containing beat the format dropped"*.

The emitter is right and the comment is false — it is demonstrably not a build error.
Wiring the two together turned a two-beat fixture into `no beat survives short-9x16`: the
floor took b01 at weight 0.1, the cascade then took b02 at weight 0.95, and the deck came
out empty.

**Resolution: a beat orphaned by the floor is KEPT, and the broken relation is reported.**
`DropRule` no longer has `orphaned`; `Cut.dangling` carries `{ kind: "beat" }` alongside
the figure/table/equation citations, because it is the same shape of problem — a kept beat
pointing at something the cut does not contain — and deserves the same answer that
`select.ts` had already chosen for citations: *report, do not repair*. Only the author can
decide whether the wording still reads.

**Inside the optimiser the dependency stays hard.** The distinction is whose decision it
is. The floor is the author's instrument and they own its consequences; deleting a 0.95
beat because the 0.1 beat in front of it went is the author's own flag doing something
they cannot predict. The knapsack's choice is the machine's, and the machine should not
silently produce an incoherent argument — so `dep` still forces "keep the container if you
keep the dependent", which costs some optimality and buys a deck whose camera language
survives.

---

## 3. The seam that would have put every sentence on the wrong picture

`planTiming` re-derived the drawn beats with `storyboard.beats.filter(b => b.weight >=
format.minWeight)` — the same list as `layout`'s, exactly and only while the threshold was
the only thing that cut. With a budget in play the two lists differ, and `timing.json`
indexes audio **by scene**. A silent mis-pairing here puts every sentence on the wrong
frame, and no gate in this repo can see it.

`TimingInput.beats` now takes `emitDeck`'s `cut.kept`; `cli.ts`, `src/index.ts`, and the
tests all pass it. The fallback survives for an unbudgeted format, and the count assertion
that already existed turns a disagreement into a loud failure with actionable text rather
than a misalignment. Pinned in `test/render.test.ts` ("takes the beat list from the cut
rather than re-deriving it").

`scanBudget` had the same latent bug in `remedy` — it derived `kept` by threshold to pair
scene windows with beats, and would have silently fallen back to the generic message on
every budgeted build. It takes the emitted list too, threaded through `verify(dir, opts,
storyboard, kept)`.

---

## 4. The explanation reaches the user

`selectBeats` writes a sentence per casualty naming what it cost, what it was worth, and
what the deck still has of its kind. Those sentences are the whole reason a trim is
permitted at all — the budget gate spent three experiments refusing to trim precisely
because a quiet trim means PASS on a deck with a third of its argument gone and nothing
saying which third.

- `build` prints every budget casualty and every dangling reference (`reportCut`).
- `buildDeck` (library) returns `cut` on `BuildResult` and steps the same lines.
- `buildDeck`'s beat count said `storyboard.beats.length` — already wrong for any format
  with a floor, and now wrong for any budgeted one. Fixed to report what was drawn.

`verify`'s budget gate header was rewritten: it no longer claims the build never trims. It
is now the **backstop**, and fires on exactly two things — a cut `selectBeats` could not
make fit at all (the narration itself has to get shorter), and a composition built by
something other than `build`.

---

## 5. Every change to 16:9 output, accounted for

**Artifacts: none. 67/67 files byte-identical** to the pre-change build, including
`index.html`, `deck.html`, and `timing.json`. Both 16:9 profiles have an empty
`DESTINATIONS` list and therefore `maxSeconds: Infinity`, so `selectBeats` returns the
floor's survivors untouched and `Cut.dropped` is empty. Asserted in `test/emit.test.ts`
("leaves an unbudgeted format exactly as it was").

**Logs: one line, unchanged when nothing is cut.** `build: N beats …` becomes
`build: N of M beats …` only when `N !== M`. On 16:9 the whole log is identical modulo the
output path.

`--min-weight 0.85` at 9:16 — the second required build gate — is **65/65 files
byte-identical** as well: the floor leaves eight beats at 2m49s, under the 3m00s cap, so
the budget trims nothing.

The 9:16 build that changes is the one with no flag, which is the entire point:

| | before | after |
|---|---|---|
| beats | 12 | 9 |
| narrated cut | 4m07s | 2m59s (178.750s) |
| `verify` | **FAIL** — 1 error (`over_budget`) | **PASS** — 0 errors, 2 warnings |
| dangling citations | 1 (b08 → `tbl-bench`) | 0 |

Kept: b01, b02, b04, b05, b07, b08, b09, b10, b12 — all four archetype families present,
both terminals kept. Dropped: b03 annotated-figure (27.5s, 0.033 w/s), b06 stack (24.7s,
0.032), b11 claim-figure (15.5s, 0.048).

**This differs from the selection workstream's own predicted cut (b04/b06/b09, 179.802s),
and the discrepancy is explained.** That report measured beat lengths by reading
`data-duration` off the *built* composition — which, after the blackout workstream landed
in the same session, is the **clip** (`duration + HANDOFF_SECONDS`), not the slide. Every
non-final beat was measured 0.4s long, so the knapsack solved a slightly different
problem. It is also exactly the 3.2s gap that report could not explain between its
predicted 179.802 and its built 176.602: 8 seams × 0.4s. It attributed the gap to camera
tails shrinking; the demo has no cameras. `planCut` measures `beatSeconds` directly and
lands on the emitted total to the millisecond.

---

## 6. Gates

All run on the final tree.

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx biome check .` | clean (1 info: `biome.json` uses the deprecated `recommended` field — pre-existing) |
| `npx vitest run` | **649 passed, 25 files** (was 645/24 — one file's count moved, three tests added) |
| `npm run build` | ok |
| `build … -o /tmp/w` (16:9) | PASS — 0 errors, 1 warning |
| `build … --format short-9x16 --min-weight 0.85 -o /tmp/v` | PASS — 0 errors, 2 warnings |
| `npx hyperframes check /tmp/w` | Check passed — contrast 59/59 AA |
| `npx hyperframes check /tmp/v` | Check passed — contrast 57/57 AA |
| `drift /tmp/plain --identical` | **210/210 frames byte-identical** |

The one warning on each build is the pre-existing `connector_detached` on `#s2-pipe`.

---

## 7. Also fixed

- **`puppeteer-core` and `@puppeteer/browsers` are now direct dependencies.**
  `src/render/captions.ts` imported both while relying on them arriving through
  hyperframes' tree. The day hyperframes swaps its automation library, burned captions
  stop working for a reason nothing in this repo mentions. Still imported dynamically —
  that is a different concern (degrade to the sidecar rather than throw after capture).
- **`emitDeck` lays out once**, not twice.
- **The empty-deck error names the beats.** `no beat survives short-9x16's minWeight of
  0.6` could not distinguish a floor set too high from a budget shorter than the shortest
  beat; it now carries every drop's reason.

---

## Still open

- **The 9:16 composition reserves no caption safe area, and this is the most valuable
  thing left.** The burn-in workstream measured it: over 112 sampled frames, slide ink
  enters the caption band on **61 of them (54%)**. The composition draws ink to y=1827 of
  1920; the band occupies y=1627–1747. The caption sits on the slide's own text, clearly
  visible at phone width. Asked of emit: **9x16 formats must keep ink above y=1627 —
  reserve the bottom 293px, 15.3% of frame height.** Not done here: it touches every
  portrait archetype's `contentH`, would change 9:16 output substantially, and the
  render-side alternative (scale+pad) drags the audience-text floor to 33.9px and violates
  invariant 5. It is a workstream, not a seam.
- **The camera path still cannot pass `build`.** Any deck with an `inside` relation fails
  `verify` with 3 × `canvas_overflow` at t=9.9s (mid-dive) plus `escaped_container` on
  `div.ds-zoom`. Confirmed unchanged in count, rule, and timestamp on
  `experiments/010-blackout/camera.storyboard.json`. It is the hyperframes layout gate
  sampling mid-camera-move — the transit exemption `assertStopsOutsideMove` makes
  unnecessary on our side, which the external gate does not know about. Pre-existing.
- **No mp4 was rendered this session.** `timing.json` is byte-identical on 16:9 and the
  frame plan fits the capture exactly, but the retime/mux path was not exercised.
- **`deck.html` navigation was not clicked through in a browser.** Island bytes are
  unchanged and invariant 7 holds.
- **Selection predicts from the full deck's measurements**, so a cut's *neighbours* change
  and a camera tail can disappear. Proven conservative in direction on the demo (the
  prediction is now exact because the demo has no cameras); not proven conservative in
  general.
- **`buildDeck` still duplicates ~70 lines of `cli.ts`'s file work.** Carried from
  EXPERIMENT-007, still the highest-value structural follow-up, still not the thing to do
  on a tree that has just gone green with three agents' work in it.
- **Platform limits in `DESTINATIONS` are from memory, not the network.** Instagram Reels
  180s and Facebook Reels 90s want a human check; the 90 is load-bearing for the
  `near_budget` warning that fires on every short.
- **Latin caption typography is not cross-machine deterministic** — with no CJK bundle the
  stack falls to Helvetica/Arial. Byte-identical on this machine, untested elsewhere.
