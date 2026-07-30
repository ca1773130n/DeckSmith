# EXPERIMENT-007 — reconciling five concurrent workstreams

Five agents landed at once: the narrated video renderer, library packaging, the drift
gate, slide density, and camera continuity. Each was written against one prose
description of the system and none could see the others' code. This is what disagreed,
what it cost, and what is still open.

The determinism ending is in EXPERIMENT-006 and is not repeated here.

---

## 1. The one that would have shipped broken

**A camera move never reached the rendered video, and every gate stayed green.**

Two workstreams each made a locally correct decision:

- `camera.ts` puts the dive in the **tail** of the containing scene's window, and
  `assertStopsOutsideMove` *guarantees* no hold falls inside it. That guarantee is the
  point: text is measured in final rendered pixels, so a stop mid-move has no checkable
  40px floor.
- `framePlan` in `render/timing.ts` freezes each hold for its sentence and then plays out
  "whatever the motion and the freezes did not use". It took those leftover frames from
  `source` — the cursor's position, i.e. the last hold.

Composed: the renderer played the right *number* of tail frames from the wrong *place*.
Measured on a scene with a 3s last hold, 5s of speech and a 1.8s dive, at 30fps:

```
dive occupies source frames [240, 294)
pieces: [{from:0,motion:30,freeze:0},{from:30,motion:60,freeze:150},{from:90,motion:54,freeze:0}]
                                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^
dive source frames rendered: 0 of 54
```

54 frames of a still where a camera move should be. Nothing could see it: `lint`, `check`,
the type floor, and `drift` all pass — `drift` especially, because both renders freeze
identically.

**Fix:** the tail is anchored to the end of the scene, not to the source cursor.

```ts
const rest = last - out;
if (rest > 0) pieces.push({ from: last - rest, motion: rest, freeze: 0 });
```

On a genuinely dead tail this is the same picture, which is why the old form survived
review. Three tests encoded the old behaviour and were updated; one of them was asserting
that a scene ends by replaying a stretch the viewer already watched.

**Verified end to end, not just in unit tests.** Built the narrated two-beat camera deck
(`experiments/009-camera/pipeline-grid.storyboard.json` + the demo's narration), rendered
it to mp4, and extracted output frames across the dive at 39.13–40.93s: wide shot →
travel → landed on `stage1` filling the frame → dip to background. This is the sixth-plus
case of green gates over wrong output and, as with every one before it, only looking at
the artifact settled it.

This is now **INVARIANT 11's neighbour** in AGENTS.md — the callback trap and this one are
the same family: state that the seek does not itself produce.

## 2. Library surface did not include two of the five workstreams

`src/index.ts` was written before `render/` and `drift.ts` existed and exported neither.
Both are now exported, with `framePlan`/`planTiming`/`TIMING_FILE`/`toSrt` beside them so
a caller can cost a render without spawning anything.

`src/cli.ts` had no `drift` verb either; it is wired now (`--identical`, `--floor`,
`--keep`).

## 3. `buildDeck` produced a deck `render` refused

The library's output was byte-identical to the CLI's **except** `timing.json`, which only
`cli.ts` wrote. So a consumer calling `buildDeck` then `render` got:

> `timing.json is missing. render needs the timing manifest build writes; rebuild the deck.`

— advice that could never work, because rebuilding through `buildDeck` never wrote one.
`buildDeck` now writes it, with the same non-fatal failure policy the CLI uses.

While fixing it: `speed` is now resolved **once** and handed to both `emitDeck` and
`planTiming`. They must agree exactly — the manifest indexes audio by holds the emitter
scaled, so a default applied in one place and not the other puts every sentence off its
reveal by the ratio. Both defaulted to 1 independently; now they cannot drift.

**Proof:** `diff -rq` of a consumer's output (tarball installed into a fresh project
outside the repo) against `demo/deck` is empty. 64 files, zero differences.

## 4. split-compare's fixture outlived its budget

The density work replaced a flat 560px body budget with a measured one. On the fully
dressed chrome — eyebrow, a headline that wraps, and a note — the body is 534px and
content gets 419px after the label band. Six bullets a side need 438px *at the 40px
floor*, so the emitter threw, at module scope, taking the whole suite's collection down.

Measured, rather than assumed:

| bullets a side | largest size that fits |
|---|---|
| 5 | **46px** (fits with margin) |
| 6 | none — over by 18.8px even at 40 |

The throw is correct: invariant 5 forbids shrinking further, and a slide with 12 bullets,
an eyebrow, a wrapping headline and a note is the slide this archetype should refuse. So
the fixture became the true maximum (five), and a new test pins **both sides** of the
boundary — five fits, six throws — so the next budget change reports which way it moved
instead of exploding at collection time.

## 5. Decisions on the carried items

### Subtitle reading rate: **left at `+0%`**, deliberately

Re-measured over the demo's 49 cues rather than trusting the handoff:

| | |
|---|---|
| mean | 14.85 cps |
| median | 14.72 |
| p90 / p95 | 17.27 / 17.55 |
| max | 18.76 |
| over 17 cps | 9 of 49 |
| over 20 cps | **0 of 49** |

The ~17 cps broadcast figure is a ceiling for comfortable reading, not a target. Our
central tendency sits 13% under it and nothing approaches the 20 cps hard limit. Slowing
the default 10% would tax the 82% of cues that are already comfortable in order to fix 9
that are marginal, and would lengthen every video by 11%.

Worth recording because it is easy to get wrong: **splitting a cue cannot change
chars/sec.** It halves the text and the time together. The only levers are speech rate
and shorter narration. `narration.rate` remains available per deck.

### `composition_file_too_large`: **accepted, in writing**

Downgraded to `info` in `check.ts`'s `accepted()`, with the reason at the code. Not
filtered out — a finding that vanishes is how a rule stops being a decision and becomes a
habit. It still prints; it just stops counting, so "PASS, 1 warning" now means one thing
nobody has decided about yet.

The reasoning: upstream counts **lines** and justifies the rule by "easier to read,
iterate on, and diff", every word of which is about a composition a person maintains.
Ours is generated on every build and no human reads or edits it. Splitting it into
sub-compositions would buy nothing and put real things at risk — invariant 7, the
island's fragment layout, and the byte-identical fixture. And at ~52 lines a beat it fires
on every correct deck over a dozen beats; a warning that is always on is one nobody reads.
Revisit if upstream starts measuring something that tracks a real cost, like bytes or
parse time.

The remaining warning is `connector_detached` on the pipeline SVG, which is real, is
pre-existing, and grew from 232px to 380px when density made the boxes taller.

---

## Still open

- **`buildDeck` duplicates ~70 lines of `cli.ts`'s file work** (`vendorKatex`,
  `copyAssets`, `copyAudio`, `refreshFont`). The copies have already drifted cosmetically,
  and one difference is behavioural: `cli.ts` writes to the `AUDIO_DIR` constant,
  `index.ts` honours `narration.dir`. Today those are always the same value, so both paths
  are self-consistent and nothing is wrong — this is latent, not live. Left alone rather
  than refactored on a tree that had just gone green with five agents' work in it, which
  is exactly when a seventh green-gates-wrong-output case gets introduced. It remains the
  highest-value structural follow-up.
- **The demo deck fails `drift` in psnr mode** (7350/7395 frames differ, worst 9.20 dB) and
  the drift workstream's evidence points at a font race: `index.html` names `Inter`, ships
  no `@font-face`, and Inter is not installed on this machine — invariant 9. The headline
  sets on one line in one render and wraps to two in the other. Not investigated here.
  EXPERIMENT-006 recorded 447/7395 for this deck, so something regressed since.
- **The burn-in subtitle path is still unexercised** — this machine's ffmpeg has no libass.
- **The camera is a video-path feature.** `planTransition`'s `MAX_SPAN = 2.5` cuts the
  step in deck mode. A deck with a camera also cannot use `drift --identical`.
- **RULE 11 in the planner prompt has never been run against a real Codex call.**

---

## The render-and-watch pass, and the thirteenth case

Two agents died on API errors before this ran, so everything the previous session
claimed about the pipeline beat, narration, subtitles and the play button was
unverified in the artifact. It has now been rendered and watched. Artifacts and the
scripts that produced them are in `experiments/016-watch/`.

### What the video shows

`experiments/016-watch/deck.mp4` — 7394 frames, 1920x1080, 30.000 fps, 246.48s.
`ffprobe` reports two streams and nothing else: h264 1920x1080 (246.467s) and aac
48kHz stereo (246.479s), agreeing to 12ms. Subtitles are the default sidecar,
`deck.srt`, 49 cues.

**The self-loop is right, in the picture.** At t=41.006s — the midpoint of the cue
"place rather than around the whole pipeline" — the frame shows a dashed loop leaving
the bottom of DQ-CTM and returning into DQ-CTM, labelled "one thought tick". It does
not touch Window. In the DOM both endpoints (x=1156.82 and x=976.82) sit inside
DQ-CTM's box (869.28..1264.36), which spans none of Window (435.64..830.72). The beat
that used to assert the opposite of its own source now agrees with it, in the frame a
viewer sees, at the second the narrator says so.

**Narration and subtitles agree with the picture.** Eleven frames were pulled at cue
midpoints across the whole timeline and each checked against what is being said there:
t=27.3 "the thought machine sits here in the middle" over DQ-CTM arriving; t=83.9
"attention runs inside one window at a time" over exactly one window highlighted;
t=113.9 "at the bottom is the carrier" over one slab labelled "Dense carrier / token
count preserved"; t=173.7 "five-benchmark averages at four times upscaling" over the
x4 table, whose numbers match the headline's claim; t=214.2 "every tick, on all one
hundred validation images" over the T=1..T=4 figure. No mismatch found.

### The play button: a mode, and it behaves like one

Served over http and driven in a real browser (`deck.html`, Chromium).

- **Narrated stops are timed by their own audio.** Pressing play walked
  3 -> 3.1 -> 3.2 -> 3.3 -> 4 -> 4.1 -> 4.2 in 25s, each advance landing when
  `audio.currentTime` reached `duration` and not before. Subtitles repainted mid-segment
  from the element's clock, as `follow()` intends.
- **Silent stops are timed by the authored gap.** `experiments/016-watch/silent.storyboard.json`
  builds a deck with no narration at all. Play walked all eleven stops and stopped at
  the last. Measured dwells against the authored gaps: 5.65s -> 5.85s, 2.8s -> 2.82s,
  and every 1.4s gap floored to ~1.5s. So `Math.min(8000, Math.max(1500, gap))` is doing
  exactly what its comment says, and the deck does not stop dead on the first slide
  nobody narrated.
- **The end is a stop, not a loop.** On the last stop the button flipped itself to off
  when the audio ended.
- **`p`, `m`, `s` all work and navigation is not wedged.** `p` off, then 2.5s with no
  advance; `m` mutes and shows "muted"; `s` clears `.ds-cap`, which un-reserves the
  caption strip and gives the slide its height back; `ArrowRight`/`ArrowLeft`/`Home`/`End`
  all navigate with playback off. A deck with no narration island takes the `SILENT`
  voice and never reserves the strip at all — the player measured a full 800px.

### THE THIRTEENTH CASE: the clip that amputates the loop it reveals

**`short-9x16` could not draw the demo's self-loop at all, and every gate was green.**

The loop is revealed by a clip rect that wipes against the flow. That rect is where
the reveal tween *ends*, so anything outside it is not "not yet drawn" — it is never
drawn. In `short-9x16` the rect was `y=784 h=72` over a route spanning y 746.3..893.7,
so 75.4px of a 147.4px route were unrenderable: both corners and the arrowhead. What a
viewer saw was a short dashed stub floating in empty space beside DQ-CTM, next to the
words "one thought tick" — which survived only because the label happens to sit inside
the band. Screenshot before and after: `shots/9x16-loop-zoom.png`, `shots/9x16-loop-fixed.png`.

`hyperframes check` said `PASS — 0 error(s), 2 warning(s)`. A clip is not a layout
finding. The one warning that does fire on that path, `connector_detached`, fires
identically on the **correct** 16:9 deck (380px there, 330px here), so it carries no
signal — it is the pre-existing benign warning this document already records under
"Still open". `drift` cannot see it either: both passes clip identically.

The cause, `src/emit/archetypes/pipeline.ts` around line 576: the sweep's half-extent
was taken from the **label**, and for a self-loop `cx(from) === cx(to)`, so the `±30`
either side of `mid` covers nothing while the route reaches `selfSpan / 2` — a distance
with no relation to how wide the label is. Portrait always loses, because portrait sizes
from `labelBlock / 2` (a line height, 37.2px) against a 90px reach.

**Landscape escaped by luck, and the control proves it.** The old landscape formula is
`textWidth(label) / 2 + 10`. For "one thought tick" that is 160.4, comfortably over the
90 the route needs. For "tick" it is **45.6** — 44.4px clipped each side. So this was
never a portrait bug; it was a self-loop bug that portrait always hits and landscape
hits whenever the label is shorter than the loop it labels.

The fix floors the half-extent at the route's own reach:

```ts
const routeHalf = loop.self ? selfSpan / 2 + 16 : 0;
const half = Math.max(routeHalf, /* the two label formulas, unchanged */);
```

Evidence, in this order:

- `experiments/016-watch/clip-contains-route.mjs` checks clip ⊇ route on any built
  deck. Pre-fix it reports `FAIL deck-9x16 s2 clip y 784..856 (72.0) route y
  746.3..893.7 (147.4)` and `OK deck s2` — so it separates the broken format from the
  sound one rather than condemning both. Post-fix both pass.
- **16:9 is byte-identical**, sha256 `01dacd10361e97a6c62c6109730359169b03b8940cc7d3f56f5be751a4ddb297`
  before and after, and the landscape clip is still exactly `x=906.42 w=320.8`. The
  demo deck, its fixture and the watched video are untouched.
- The frame was opened, twice. `shots/9x16-loop-fixed.png` is the snapshot path;
  `shots/vid9x16-t41-loop.png` is cut from `deck-9x16.mp4` (5363 frames, 1080x1920,
  30fps, 178.77s, two streams) at t=41.006s, the same cue midpoint used for 16:9. Both
  show a complete loop with a visible arrowhead pointing back into DQ-CTM. The video one
  matters because it went through the sharded multi-worker capture path, not a single
  process — though a clip rect is static geometry, so the twelfth case's lazy-measurement
  hazard could not have touched it either way.

`test/` is outside this session's ownership, so the regression test was not added. It
belongs in `test/arch-pipeline.test.ts` beside "draws a self-loop on its own stage",
which asserts the route and says nothing about the clip — that is the gap the case fell
through. The assertion to add, in **both** orientations and with a **short** label:
the `#<sid>-sweep` rect must contain the dashed route's extent along the flow axis.

### Also seen, not fixed

- **An imported figure carries text a third of the floor, and no gate can measure it.**
  On the qualitative beat, `assets/fig-progress.jpg` supplies the column labels that
  say which panel is T=1 and which is T=4 — the only thing that makes "the trajectory
  is visible" legible. Measured on the rendered frame by scanning for dark rows: the
  glyph band is **13px** at 1920x1080, against the 40px audience floor. The figure is
  1298x578 natural, drawn at 1045x465 (scale 0.805), so it is under the floor at source
  and the deck's downscale makes it worse. Invariant 5 is enforced against DOM text;
  these are JPEG pixels, so the type floor has nothing to measure and reports nothing.
  A raster figure is an unchecked hole in the one invariant the audience notices first.
- The 16:9 headline on the pipeline beat sets on one line in the browser at 1280px and
  wraps to two in the 1920px render. Consistent with the font race already recorded
  above under "Still open" (invariant 9: `index.html` names `Inter`, ships no
  `@font-face`).
- `src/deck/runtime.ts:465` — `const mine = epoch; if (mine === epoch && !blocked)` is a
  tautology, so the `ended` handler's epoch guard does not guard. Latent, not live:
  `silence()` drops the src, and dropping a src fires `emptied`, never `ended`. The
  comment above it claims a guarantee the code does not provide.
- `src/deck/runtime.ts` autoplay — if `play()` is *refused* on a stop that does have a
  segment, `speak()` has already returned `true`, so `go()` sets no dwell timer and
  `ended` will never fire: playback wedges there for good. This is the exact failure the
  return value of `Voice.at` exists to prevent, in the one case it does not cover. Not
  reachable by the autoplay policy, since pressing play is itself a gesture — but the
  same rejection path handles a **missing audio file**, so a deck with one absent mp3
  stops forever at that slide.

### The ledger, refreshed

`npm run score` reported 23 stale receipts. Refreshed. **The `inside` repair is verified
across the corpus, not one fixture: 14 PASS / 9 FAIL became 23 PASS / 0 FAIL** on the
same 23 plans, and all nine former failures — every one a `canvas_overflow`, every one
using `inside` — now build with **0 errors**. The transit exemption keyed on
`data-ds-transit` holds on nine independently authored plans.

One correction to how that number must be read. A bare `npm run score` puts 14 of the 23
at `build_failed` before they reach a gate: the `013-vocabulary/planner/runs/*/out.json`
captures are raw structured output carrying `"inside": null`, and `insideSchema.optional()`
rejects an explicit null. They were previously receipted **with `--strip-nulls`**, which is
what that flag is for, and the ledger records it (`normalized: true` on exactly those 14).
So the refresh command that reproduces the comparable corpus is:

```
npm run score -- demo experiments --strip-nulls
```

That is now **27/27 PASS**, one tool fingerprint, zero stale: the 23 above, plus
`demo/storyboard.json` and two `demo/fixtures/` plans that had never been in the ledger,
plus `experiments/016-watch/silent.storyboard.json` added here. The enforcement test in
`experiments/score/scored.test.mjs` caught that new plan's missing receipt on the first
run, which is the mechanism working: it is parameterised per discovered plan, so adding a
storyboard adds a test that fails until somebody builds it.

---

# Reconciliation — the decision session

Three workstreams in at once: deferred measurement (Seam B), the pre-registered
vocabulary experiment, and render-and-watch. What follows is what I verified rather
than accepted, what landed, what is now worse, and what I left undone. The decision
itself is `.planning/DECISION.md`.

## Verified, not believed

**Seam B's claim, including the half that is bad news.** Rebuilt
`demo/fixtures/camera.storyboard.json` from the current tree and ran the gate twice:

```
drift --identical               201 of 594 frames differ, worst 51.52 dB at frame 397   FAIL
drift --identical --workers 3     1 of 594 frames differ, worst 63.54 dB at frame 299   FAIL
drift            (PSNR floor)   393/594 identical, worst 51.52 dB, above the 40 dB floor  PASS
                                "All 2 measurable scene(s) moved within their own window"
```

So the number the twelfth case published **did not move**, exactly as the workstream
reported, and the workstream's explanation — it was never the camera's — holds. The
pinned control differs from theirs (63.54 dB here against 117.32 dB there) on the
same single frame, which tells you what that residual is: a couple of anti-aliased
pixels whose magnitude is itself run-dependent at a fixed worker count.

**A control they did not run, which is what settles the attribution.** A deck built
from **one `grid` beat with no camera anywhere in it**:

```
drift --identical    180 of 270 frames differ, worst 51.52 dB at frame 91
```

Same worst dB. And measured on the kept frames, the same defect: 10,393 differing
pixels in bbox x 115–1007, y 299–858 against the camera fixture's 10,387 in the
identical bbox, max delta 14/255, **and the difference map is byte-for-byte the same
from frame 91 to frame 270**. A per-frame rasteriser dither would vary; a constant
offset held across a whole shard is one layerisation decision taken at that worker's
first seek. Amplified 18×, the mask is the grid's cell outlines on a 74.5 px lattice
(`experiments/014-seam-b/grid-only-mask.png`; `grid-only.mjs` beside it rebuilds
the fixture and carries the commands) — hairline borders, nothing else. `grid.ts` computes a
fractional cell pitch by construction (`Math.min` of a continuous fit), so the
borders never land on device pixels.

Conclusion: `--identical` **cannot hold on any deck containing a grid**, and that is
the flag's own documented limitation rather than a defect. Making it hold would mean
integer-snapping every grid deck's layout — byte-changing, cosmetic, wide blast
radius. Not done, not recommended.

**Byte identity of a camera-free 16:9 deck.** `demo/deck/` (mtime 06:07) predates
every edit in this session — `camera.ts` 07:41, `composition.ts` 07:26, `kit.ts`
07:44, `pipeline.ts` 07:33 — and contains no `.ds-zoom`, so it is a genuine
pre-change baseline for a camera-free deck. Rebuilt now:

```
index.html  01dacd10361e97a6c62c6109730359169b03b8940cc7d3f56f5be751a4ddb297   identical
deck.html   ebebafd75bb01deb920c4c67286f5f89efd2751ecd685d7c908a82801a4c8661   identical
```

Also `grep -c data-composition-id deck.html` = 0 on both the 16:9 build and the
camera-free control build. Invariant 7 holds.

## What landed

- **Deferred measurement.** `Scene.measure?: string[]`, `cameraMeasure` replacing
  `cameraPreamble`, builders awaited inside `readyGate` before
  `__hfTimelinesBuilding` drops. GSAP is handed numbers; no callback, so invariant 11
  is untouched, and `drift`'s own motion check confirms the deferred timeline
  animates. Two files and a type — the review's claim that Seam B strictly contains
  Seam A is false, and Seam A was not needed.
- **The pipeline self-loop clip** (the thirteenth case), with 16:9 byte-identical and
  9:16 correctly changed.
- **`experiments/015-decision/`** — the pre-registration, the report, and the
  measurement code, including `ink.mjs`, which is the first thing in this repo that
  can see a slide with nothing on it.
- **One comment fix.** `src/emit/theme.ts:134` said `dsFrame().cx`, a symbol that no
  longer exists. Prose only; `dist` bytes unchanged, which is why `npm run score`
  still served a cache hit keyed on the tool fingerprint.

## What is now WORSE

1. **The corpus score number regressed, and it is honest.** The ledger command
   `npm run score -- demo experiments --strip-nulls` was **27/27 PASS**; it is now
   **63/67 PASS**, because the vocabulary experiment added 40 receipted plans and two
   of them fail. `menu-10` is the shipped `transitWindow` bug (13 `canvas_overflow` on
   a frame nobody sees); `menu-15` is a real `text_box_overflow` on a KaTeX close
   delimiter. Each appears twice (raw capture + plan). **The command now exits
   non-zero.** It is not a required gate and `scored.test.mjs` only requires a
   receipt, not a pass, so `vitest` stays green — but anyone who reads "27/27" in the
   section above will be confused, and the number to quote from now on is 63/67 with
   two named defects.
2. **`--identical` is now a flag with a known-unfixable failure on the fixture the
   twelfth case made famous**, and the docstring in `camera.ts` is the only place
   that says so. Somebody will point it at a grid deck again.
3. **The gate stack's coverage got measurably worse relative to what it must cover.**
   Nothing changed in the gates, but case thirteen established a failure class with a
   measured 20–25% rate on the authoring path the vocabulary would open, and no gate
   can see it. The stack is the same size and the thing it has to catch got bigger.

## What I left UNDONE, and why

- **`transitWindow` is not fixed.** The one-line fix — add `over` — is wrong.
  `regrade` (`src/verify/check.ts:271`) exempts by time alone with no scene or element
  scope, and `assertStopsOutsideMove` guards only `[t0, t0+dur+fade)`, so widening the
  published window by `over` would exempt overflow **anywhere in the deck** for 0.4 s,
  including the incoming scene, whose first stop can fall inside that tail. Fixing it
  properly means scoping the exemption to the dipping rig, and the control that must
  run first is a deck whose incoming scene overflows at a stop inside the outgoing
  scene's `over` tail. Doing this blind is how a fourteenth case gets written.
- **The grid hairline non-determinism is not fixed.** Argued above: above the PSNR
  floor, invisible, and the fix is worse than the symptom.
- **The self-loop clip regression test is still not in `test/`.** It belongs beside
  "draws a self-loop on its own stage" in `test/arch-pipeline.test.ts`, asserting in
  **both** orientations and with a **short** label that `#<sid>-sweep` contains the
  dashed route's extent along the flow axis. `experiments/016-watch/clip-contains-route.mjs`
  is the check; it FAILs the preserved pre-fix build and passes both sound ones. Two
  workstreams have now declined it for ownership reasons. It should just be added.
- **`scored.test.mjs` still cannot see a compositional plan.** `looksLikeStoryboard`
  discovers by `beats`; arm VOCAB's plans have `scenes`. The mechanism built to stop
  "nobody built it" would not have stopped this experiment.
- **`ink.mjs` is not promoted into `src/verify/`.** That is the next step and it is
  the whole recommendation of `DECISION.md`; it is a session of work, not a
  reconciliation edit.
- **Still open from earlier, unchanged:** the 13 px raster type floor inside an
  imported JPEG that no gate can measure; the `runtime.ts` autoplay wedge on a
  refused `play()` and the tautological epoch guard at line 465; and invariant 9's
  font race — `index.html` names `Inter` and ships no `@font-face`, so the 16:9
  headline sets on one line in a browser at 1280 px and wraps to two at 1920 px.

## Gates, this session

```
npx tsc --noEmit                                            0 errors
npx biome check .                                           Checked 90 files. Found 2 infos.  (exit 0)
npx vitest run                                              886 passed, 30 files
npm run build                                               dist/cli.js 281.9kb, dist/index.js 264.1kb, dist/deck-runtime.js 11.4kb
npm run build:server                                        clean
build --format deck-16x9                                    PASS — 0 error(s), 1 warning(s)
build --format short-9x16                                   PASS — 0 error(s), 2 warning(s)
npx hyperframes check <16:9 deck>                            Check passed — 0 errors, 2 warnings, 59/59 contrast
npm run score -- demo/storyboard.json --source demo/source.json --no-cache   1/1 PASS, 0 err, 1 warn
```

The two `biome` infos are pre-existing (`biome.json` config migration,
`src/cli.ts:917` `useTemplate`) and belong to no one in this session. The 16:9
warning is `connector_detached`, which fires identically on the correct deck and
therefore carries no signal — recorded above in the thirteenth case.
