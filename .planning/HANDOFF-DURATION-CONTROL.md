# HANDOFF — duration, slide count, narration density

Written 2026-07-30 for the next session. Everything below is either measured in
this repo or cited to the file that holds it. Where a number is a guess it says so.

---

## 1. WHAT THE OWNER ASKED FOR, in his words

> "i want to let user choose only these things regarding content length and
> playback speed. total duration, total number of slides, how much the narration
> dense(high, medium, low). the number of words and narration speed is
> automatically decided by the logic."

So: **three knobs exposed, two derived.**

| exposed | derived |
|---|---|
| total duration (seconds) | words per sentence / per stop |
| total number of slides | narration speed (`rate`, and playback factor) |
| narration density — high / medium / low | which stops get narrated at all |

The motivating case, also his: a 12-slide deck renders to over two minutes and he
wants it under one, **keeping all twelve slides**.

---

## 2. THE MEASUREMENT THAT DECIDES THE DESIGN

Do not design this before reading this section. It is why "add a speed slider" is
the wrong answer.

Measured on `demo/audio/narration.json` (the real narrated demo):

```
beats 12 · stops/segments 37 · cues 39
total speech 195.9s · 2827 chars · 14.43 chars/sec overall
```

Per-cue rate measured separately: mean 14.85 cps, p95 17.55, max 18.76.
Broadcast practice caps around **17 cps** and ~84 characters over two lines.

### What a target duration costs, if speed alone is used

| target | speech must run | resulting subtitle rate |
|---|---|---|
| 120s | 1.64× | 24.3 cps |
| 90s | 2.18× | 32.4 cps |
| 60s | **3.27×** | **48.6 cps** |

At 3.27× the audio is not listenable and the subtitles are decoration. **Speed
alone cannot deliver the motivating case.** The video is long because it says a
lot, not because it plays slowly.

### What a target duration costs, if word count is used

**Divide by STOPS, not by beats.** This is the trap. The demo has 12 beats and
**37 stops** — narration is cut one sentence per stop (`planSegments`), so the
budget is per stop:

| target | seconds per stop | characters per sentence at 14.85 cps |
|---|---|---|
| 120s | 3.24s | ~48 |
| 90s | 2.43s | ~36 |
| 60s | 1.62s | **~24 (four words)** |

Four words per reveal is not narration. So at low density the answer is **not
shorter sentences — it is fewer narrated stops.**

`planSegments` (`src/narrate/narrate.ts:87`) already supports this: given fewer
sentences than stops it fills the early stops and **leaves the later ones silent**,
deliberately, rather than inventing copy. That is the mechanism low density should
use.

### Suggested density semantics (not yet implemented, argue with it)

| density | sentences | 12-beat demo | per-stop budget at 60s |
|---|---|---|---|
| high | one per stop (today's behaviour) | 37 sentences | 1.6s — unusable |
| medium | one per stop, capped at ~2 per beat | ~24 | 2.5s |
| low | **one per BEAT** | 12 | 5.0s — comfortable |

At low density the 60s target becomes reachable at roughly 1× speed. That is the
combination that makes the owner's case work, and it is worth checking that
arithmetic yourself before building to it.

---

## 3. WHAT ALREADY EXISTS

### Preferences (`src/prefs.ts`, schema in `src/types.ts`)

* `slides` — target beat count, 3–40. **Already exposed**, already threaded into
  the planner prompt. Reuse; do not add a second one.
* `animationSpeed` — 0.25–3, multiplies every tween duration and hold.
* `density` — `sparse | normal | dense`. **Currently about how much TEXT a slide
  carries, not narration.** Decide whether narration density is a fourth value on
  this or a separate `narration.density`. They are different axes and sharing one
  name will confuse the prompt.
* `narration.rate` / `narration.pitch` — edge-tts prosody strings, e.g. `"+10%"`.

### The timing model — read these three functions

1. **`beatSeconds`** — `src/emit/composition.ts:451`
   ```
   max(authored, lastHold + Σ segment.seconds)
   ```
   **Narration drives beat length.** This is why `animationSpeed` alone cannot
   shorten a narrated deck: speech dominates the max. Speeding the animation on a
   narrated deck changes almost nothing about its duration. Verify this before
   assuming a speed knob does anything.

2. **`pace`** — `src/emit/theme.ts:186`. Scales tween durations, staggers,
   positions and holds by `animationSpeed`. Identity at 1 by construction, which
   is what keeps a default deck byte-identical.

3. **`framePlan`** — `src/render/timing.ts`. The video retimer: freezes each scene
   at its holds for that segment's measured duration, then plays the tail **from
   the end of the scene**, not from the source cursor. There is a documented trap
   here — see AGENTS.md.

### Narration

* `stopsFor` — `src/narrate/narrate.ts:45`. Calls `emitScene` and counts holds, so
  the stop count is the EMITTER's, not the prompt's.
* `REVEALS` — `src/plan/prompt.ts:35`. The measured per-archetype stop counts,
  with `test/prompt.test.ts` recomputing every row from `emitScene`. Use this to
  predict a plan's stop count *before* narrating: it is how a word budget can be
  computed at plan time.
* Cache — `src/narrate/tts.ts`, keyed on sha256 of `(text, voice, rate, pitch)`.
  **Changing `rate` invalidates every segment.** Measured cost of a full
  re-narration: ~25–30s for 12 slides / 37 segments; warm re-run 0.45s. Not free,
  not expensive.
* `SpeechProvider` + `PROVIDERS` + `DECKSMITH_TTS` — the synthesiser is behind an
  interface, so nothing here should assume edge-tts.
* Subtitles: `splitCue` / `CUE_MAX_CHARS = 84` (`src/deck/subtitles.ts:78`) caps a
  cue at two lines. **Splitting a cue does NOT change chars/sec** — same text,
  same time. It cannot rescue a fast deck.

### Duration budgets already enforced

`src/verify/budget.ts` already compares a deck's **narrated** length against per-
format caps (YouTube Shorts 3 min, Reels 90s) and reports what to drop. A new
target-duration feature should reuse or extend this rather than adding a parallel
notion of "too long".

### Playback speed after the fact — PROVEN, and cheap

`atempo` + `setpts` retimes a finished mp4 with pitch preserved. Measured on
`experiments/010-burn-in/short.mp4` (169s):

```
ffmpeg -i in.mp4 -filter_complex \
  "[0:v]setpts=PTS/2.9[v];[0:a]atempo=1.7,atempo=1.70588[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 20 -c:a aac out.mp4

169.0s -> 58.3s in 4.1s wall clock. 2.7 MB.
```

`atempo` is limited to 2.0 per instance — chain it for more, as above. No
re-render, no re-synthesis. This is the "after generation" path and it is an hour
of work, not a day.

---

## 4. THE DESIGN THIS SESSION ARRIVED AT

Presented as a starting point with reasons, not as a specification to implement
unexamined.

**Duration drives word count first, speed second.** Given `duration`, `slides`
and `density`:

1. Predict the stop count from `slides` × the archetype mix (`REVEALS`), or more
   simply from the plan once it exists.
2. Derive a **character budget per sentence** = `duration × cps / stops`, where
   `stops` already reflects density (low density narrates one sentence per beat,
   not per stop).
3. Hand that budget to the planner as a constraint it can hit — the prompt already
   says "about 25 words"; this replaces the constant with a computed number.
4. Measure the narrated result. If it overshoots, close the gap with **bounded
   speed**, not by re-planning.

**Two speed mechanisms, chosen by when the user asks:**

* *Before generation* — `narration.rate`. edge-tts speaks genuinely faster, which
  sounds better than time-stretching. Costs a full re-synthesis (~30s).
* *After generation* — the `atempo`/`setpts` retime above. Instant, re-runnable at
  different factors, no deck rebuild.

**A ceiling with a stated reason.** Cap the comfortable factor around **1.25×
while subtitles are on**, and *warn* rather than refuse above it. Compute the
warning from the deck's own measured p95 cue rate against 17 cps — not from a
hardcoded guess. Past roughly 1.2× the captions stop being readable, and that is a
product decision the user should be told about rather than have made for them.

---

## 5. TRAPS, each one already paid for

* **`animationSpeed` does not shorten a narrated deck.** `beatSeconds` takes a
  max and speech wins. Do not ship a duration control that quietly does nothing.
* **Divide the budget by stops, not beats.** 12 beats, 37 stops in the demo.
* **`splitCue` cannot fix a fast deck.** Splitting halves text and time together.
* **Changing `rate` invalidates the whole audio cache.** Fine, but say so in the
  UI rather than appearing to hang for 30 seconds.
* **Invariant 11.** `seek()` passes `suppressEvents`, so a GSAP `onUpdate` never
  fires under capture; callback-driven motion renders a frozen video with every
  gate green. Anything that adjusts timing must adjust the tween, never a callback.
* **A deck built at `animationSpeed: 1` must stay byte-identical.** `pace` is
  identity at 1 on purpose and it is the cheapest regression test in the project.
* **Do not confuse `drift --workers` with playback speed.** `drift` renders its two
  passes at 1 and 3 workers to catch order-dependent measurement; unrelated.
* **The 40px floor is not affected by any of this**, but the subtitle band is —
  faster speech means the same band changes more often, not that it shrinks.

---

## 6. ACCEPTANCE — what "done" should mean

1. Setting `duration: 60, slides: 12, density: "low"` on the demo source produces
   a narrated deck whose rendered video is within ~10% of 60s, at a speed factor
   at or below 1.25×, with subtitle p95 under ~20 cps. **Render it and watch it.**
2. Setting `density: "high"` on the same inputs reproduces roughly today's output.
3. A finished video can be retimed to a new target without re-synthesis or
   rebuild, and the result stays in sync — check a frame against its caption at
   three points, not just the total duration.
4. `animationSpeed: 1` with no duration target still emits a **byte-identical**
   16:9 composition.
5. The three knobs are in the web UI (`src/server/ui.ts`) and in
   `src/server/options.ts`, and nothing else about content length is exposed.
6. `npx tsc --noEmit`, `npx biome check .`, `npx vitest run` (1007 tests at time
   of writing), `npm run build`, `npm run build:server`, both format builds, and
   `npm run score -- demo/storyboard.json --source demo/source.json`.

---

## 7. REPO STATE AT HANDOFF

Green: tsc, biome (1 pre-existing config info), **1007 tests / 32 files**,
`npm run build`, `npm run build:server`, 16:9 and 9:16 builds, `hyperframes check`,
`drift --identical` on the real demo (**7395/7395 byte-identical**), `npm run score`.

Server runs on 8475, bound `0.0.0.0`, no auth. `~/.decksmith/work` and
`~/.decksmith/serve.log`.

Landed recently and relevant here: the fidelity gate (`src/verify/fidelity.ts` —
does the diagram actually appear); deferred measurement (Seam B); `tween()` as data
(Seam A); the measured `REVEALS` table replacing prose that was wrong for most
archetypes; vendored GSAP and KaTeX; the pipeline self-loop fix.

Open and unrelated to this work: experiment 017 is **void** — `fidelity` is vacuous
on compositional plans because they declare no stops, so the pre-registered primary
was only ever computed on one arm. See `.planning/DECISION.md`. Items 3 and 4 of
`VOCABULARY.md` §7 (the `immediateRender` lint and the `equation-morph` archetype)
are the remaining capability work.

## 8. WHAT THIS PROJECT WILL DO TO YOU IF YOU SKIP THE ARTIFACT

Thirteen documented cases of a green gate over wrong output. Every one was caught
by a human opening the file. The three most recent were found by building plans
that had only been scored, by a control that separated two explanations, and by
opening a frame no metric asked about. Two confident claims made this week were
wrong and both were caught by controls.

For this feature specifically: a duration control that produces a 61-second video
whose audio is 40% out of sync with its animation will pass every gate in the
stack. **Render it, watch it, and check a caption against its frame.**

---

## 9. WHAT LANDED, and what the artifact showed that the design did not

Built as specified in §4, with §2's arithmetic re-derived from `narration.json`
first — 14.44 cps, 3.08 stops per beat, 18.41 p95 all reproduce.

`src/plan/duration.ts` is the whole of the derivation: `duration` + `slides` +
`narration.density` in, an animation speed and a character budget out, warnings
for a target that cannot be bought. `narration.density` is its own field beside
`rate`/`pitch`, not a fourth value on `density` — §3's question, answered the way
§3 leaned. `respeedArgs` in `src/render/ffmpeg.ts` is the atempo/setpts retime,
driven by `RenderOptions.targetSeconds` so `render` is the only place a finished
file gets shortened.

### §2 is right, and incomplete in a way that changes the build

§2 says low density is what makes 60s reachable "at roughly 1× speed". Measured:
one sentence per beat takes the demo from 246.5s to **116.9s**, not to 60s. The
binding term flips. Once speech stops dominating, `lastHold` holds the floor — a
six-stage pipeline reveals its last stage at 7.8s regardless of what is said over
it — and `lastHold` moves only with `animationSpeed`. So the 12-slide 60-second
case needs a shorter sentence AND a faster animation; neither alone gets there.
`durationPlan` therefore derives both, and `animationSpeed` is ignored when a
target is set (warned, not silent).

### Measured end to end, on the real demo

| | asked | got |
|---|---|---|
| `duration 60, slides 12, density low` | 60s | **59.248s composition, 59.23s video, playback factor 1.0** |
| subtitle p95 | under ~20 cps | **15.63 cps**, longest cue 46 chars |
| retime the same capture to 70s | no re-synthesis, no rebuild | **70.00s**, sidecar rescaled with it |
| no target, `animationSpeed 1` | byte-identical | **identical** `index.html`, `deck.html`, `timing.json` |

Audio sync was checked off the FILE, not off the plan that wrote the captions —
`silencedetect` over the muxed mp4 gives twelve spoken spans, each starting
~0.1s inside its own cue and ending before it, with no drift accumulating across
60 seconds. The captions alone could not have shown this: they come from the same
`framePlan` the audio does, so a mis-stretched track would agree with them.

### Two bugs that only a DERIVED speed reaches

Both pre-existing, both confirmed on unmodified code with a plain `--speed 0.417`
and no duration involved, and both invisible: `build` printed `PASS — 0 error(s)`,
wrote no `timing.json`, and `render` would have refused.

1. `pace` rounded holds to FOUR decimals while `emitIsland` and the scene divs
   publish `round3(start + hold)`. The two rounding orders landed either side of
   a millisecond, so `assertHoldsAgree` compared 87.200 against 87.199 and threw.
   Fixed in `src/emit/theme.ts` (holds are timeline times — invariant 10's three
   places) and `src/emit/island.ts` (round the start once, then add to it).
2. `assertFits` compared a full-precision `need` against a `scene.duration`
   already quantised to three decimals, so correct arithmetic failed by 0.0005s.
   `EPS` is now 5e-4 — the quantisation, not a tolerance. One frame is 33ms.

Regression test sweeps 751 speeds through `emitComposition` + `planTiming`; a
one-off sweep over 1502 (speed, narration) pairs on the real demo also passes.
**Nobody would have found these from the gates.** They surfaced the first time a
non-round speed was built, which is every time a duration is set.

### The finding that needed a human looking at a frame

Three frames checked against their captions, all in sync — and all three showed
the same defect. At low density the one sentence is heard over the beat's
**landing** frame, before anything past the first reveal is drawn. The pipeline
frame said "encode, window, think once, then decode" over a diagram showing only
`Encode`; split-compare named both halves with only the left one up; the callout
promised three numbers with one panel visible. Then the rest appeared, at 0.417×
speed, with nothing said over it.

Not a timing bug — the arithmetic is right and the audio is in sync. It is a
prompt problem, and the fix is in `cadenceFor`: at low and medium density the
prompt now says the sentence is heard over the first frame, so it must say the
beat's POINT and never list its parts. Worth re-checking on the next real
planner run, because a 47-character budget pushes a model toward enumeration —
that is the densest way to say something about a multi-stage diagram.

### Deliberately not built

* **`narration.rate` is not derived.** Character count plus animation speed plus
  a bounded retime covers the range, and deriving `rate` too would add a
  30-second cache invalidation for a lever already covered. `--rate` still works
  by hand. Add it if a target needs more than 1.25× of retime to close.
* **`planSegments` does not truncate.** A planner that writes four sentences at
  low density gets all four on the landing stop rather than three dropped: a deck
  that comes out long is better than one that silently deletes what was written.
  The retime is the backstop, and it warns when it runs out.
* **`LAST_HOLD_SECONDS` is one mean over twelve beats**, not a per-archetype table
  predicted from `REVEALS`. The spread is real (1.9s for a title, 7.8s for a
  six-stage pipeline), so a deck of nothing but pipelines will overshoot. Predict
  per-beat if the retime starts exceeding its ceiling on real plans.
* **`SPEECH_CPS.cjk` is a guess (6.5), and says so.** No narrated CJK deck exists
  here to measure. Measure it the first time one is made; a Korean deck's budget
  is currently wrong by a little rather than by 2×.

### Verified against a real Codex plan

`plan demo/source.json --duration 60 --slides 12 --narration-density low`, then
narrate, build, render, watch. The model held both new constraints:

```
12 beats, 12 sentences, one per beat.
narration 32–44 chars, mean 40.1 against a 47 budget.
composition 57.205s · video 57.20s · playback factor 1.0 · p95 16.31 cps
```

None of the twelve sentences enumerates its beat's parts — "The carrier keeps the
spatial state alive", "The same thought block is reused over ticks", "The
parameter count is not the smallest". The `cadenceFor` clause added after the
previous run's frames is doing its job: the pipeline frame now shows the stage the
sentence is about, where before it said "encode, window, think once, then decode"
over a lone `Encode` box. Audio spans measured off the file again: twelve for
twelve, each starting ~0.1s inside its cue, no drift.

### The headline finding: a fix, and a diagnosis that was wrong

`b06`'s headline was "ThinkSR links encoding, windows, thought ticks, and
decoding", over a pipeline whose four stages are Encoder, Windows, Shared DQ-CTM
ticks and Decoder. I first wrote this up as a LANDING-FRAME defect — the headline
names four things while one is drawn. **That diagnosis does not survive
measurement, and the measurement matters more than the fix:**

* `b04`, the GOOD headline on the same archetype, is no truer of its own landing
  frame. "A dense carrier is read and updated by compact thought" names `Compact
  thought`, which is stage 1, drawn at 2.40 against a 1.55 landing.
* For `grid` and `annotated-figure` the landing draws ZERO regions and ZERO notes,
  so no headline naming anything specific to the visual is ever true of it.
* Scored over 24 real headlines, a frame-truth rule fires on 13 and wrongly
  condemns 10–11.

A metric that condemns the good example and structurally condemns two archetypes
is not measuring the defect. What is actually wrong with `b06` is that it asserts
nothing — cover the four names and "links" has said only what the arrows already
draw. That is RULE 8's own subject, live at every density, and low density did not
cause it. It only kept the landing frame on screen long enough for someone to look.

**The prompt fix was tried, measured, and reverted.** RULE 8 was sharpened with
that exact bad headline and its good twin as a worked contrast, plus the imperative
"rewrite until the verb carries the sentence". A real Codex run on identical inputs
answered:

```
before:  "ThinkSR links encoding, windows, thought ticks, and decoding"
after:   "ThinkSR runs through encoder, windows, ticks, and decoder"
```

Same beat, same four labels, verb swapped — and a second instance appeared
("The comparison separates CTM, windowing, and DQ-CTM"). Whether a sentence
"asserts nothing" is a judgement the writer makes about their own output, so it
can always be met cosmetically. The rule was reverted; six lines of prompt that
buy nothing measurable are worse than none, and that run also came back 9 beats
against a 12 target, which I cannot attribute at n=1 but is the wrong direction.

**What shipped instead: `scanHeadlines` in src/verify/index.ts.** A detector, not
a steer, because the label strings are not a judgement. Two conditions, and it
needs both — three or more of the beat's own part labels, landing in SEPARATE
coordinated clauses:

| headline | verdict |
|---|---|
| "ThinkSR **links** encoding, windows, thought ticks, and decoding" | flags |
| "ThinkSR **runs through** encoder, windows, ticks, and decoder" | flags |
| "The comparison separates CTM, windowing, and DQ-CTM" | flags |
| "A dense carrier is read and updated by compact thought" — 3 labels, no list | clear |
| "One pass in, one pass out, and a loop in the middle" — 3 clauses, no labels | clear |

Both halves of the conjunction are load-bearing. Labels-alone condemns `b04`;
coordination-alone condemns the shipped demo's sharpest line. Measured over all
33 real headlines across three plans: fires on 3, zero false positives, including
every case the review flagged as collateral risk. It prints at `plan`, which is
the moment the author is already being told to open the file, and folds into
`verify()`. Pinned by four tests on those exact strings.

Also fixed, found by the same review: the low-density narration bullet claimed the
sentence is heard "before the stages, **bars**, panels or layers after the first
have been drawn". False of the emitter — bar-compare's landing shows every bar
grown. `bars` removed.

### Still open

`scanHeadlines` reports; nobody has tried to make the planner stop doing it, and
after the run above I would not reach for prompt text again without a way to score
a wording over several plans rather than one.

The landing-frame class itself has a real fix nobody has built: at low density,
speak the beat's single sentence at its LAST usable stop instead of its first, so
both the voice and the headline land on the assembled diagram. `segments.push({stop,
...})` already carries an arbitrary stop index and `framePlan` freezes only where a
segment exists, so it is a few lines in `narrate()` plus a late-filling variant of
`planSegments`. It is duration-neutral — `beatSeconds` is `max(authored·s,
lastHold·s + spoken)` regardless of which stop holds the audio, so the room is
already reserved. Honest cost: it falsifies prompt.ts's "THAT SENTENCE IS HEARD
OVER THE BEAT'S FIRST FRAME" and the test/duration.test.ts assertions on it, it
inverts the presenter model to build-in-silence-then-speak, and it does nothing at
medium or high density.

Two things the real plan showed that are plan quality, not duration control:
`b10-params` and `b11-average` both cite `tbl-bench`, which no beat in the cut
draws (the existing `cut.dangling` warning caught it), and `b04`/`b06` are two
pipelines over the same architecture, which RULE 9 exists to prevent.

---

## 10. WHAT THE NEXT SESSION FOUND, and why §9's landing-frame fix is the wrong build

The owner watched the mp4s and reported two things. Both were real, and one of
them was not the defect anyone thought it was.

### The landing frame was a DROPPED-FRAME bug, not a placement problem

"The resulting video shows sudden showing all other three blocks at once."

§9 above reads that class as a question of WHERE the sentence sits. It is not.
Measured on the six-stage pipeline at the speed `durationPlan` derives for
60s/12 slides, with the one sentence `density: low` produces:

```
holds  [0.5, 1.04, 1.58, 2.13, 2.67, 3.25]   spoken 3.25s   scene 6.5s   fps 30
framePlan pieces  [{from:0,motion:15,freeze:98},{from:113,motion:82,freeze:0}]
```

**98 of 195 source frames never reach the screen, and all six holds are inside
the skipped span.** The video shows stage one, freezes for the sentence, then
jumps to the assembled diagram. Not compressed — cut out.

The mechanism is one identity. Per scene the output owes `last - first` frames
and `out = (source frames shown) + freeze`, so `dropped == freeze`, always,
wherever the tail is anchored. An INTERMEDIATE freeze earns its dropped frames:
it exists to stop the next reveal running under this sentence. The LAST freeze
has no next, so it stood in front of the whole remaining build, and the frames
it cost were the beat's own stages. Moving the sentence to the last stop — §9's
proposal — does not change `dropped == freeze`; it only changes which end of the
scene pays, and it buys ~39s of silence in a 60s video to do it.

The fix is that the last stop's freeze is paid out of the dead tail instead:
play the build first, freeze only what the sentence still needs after it. Five
lines inside `framePlan`, nothing else in the pipeline. `place`, `assertFits`,
`Piece`, ffmpeg, the composition, narration and the prompt are all untouched, and
the camera dive survives because `assertStopsOutsideMove` already guarantees the
dive falls after every hold, so the new build piece stops at the last hold and
never eats into it.

Verified on the artifact, not on a gate: one capture retimed twice, old code and
new. Same length to the millisecond (57.200s), byte-identical audio stream, 1344
distinct frames before against 1522 after. `experiments/018-duration/renders/`
holds both videos and three frames across the span that used to be one frozen
picture and a jump.

**Why every gate was green.** `drift` renders twice and compares — and both
renders were identically wrong. This is invariant 11's shape one level down: not
a callback that never fires, but a frame that is never asked for.

### The sentences are thin, and nothing said so

"For a one-minute clip the sentences are too short and lack explanation."

Measured: `demo/storyboard.json`, the deck this repo is measured against, runs 39
narration sentences at mean 72.1 characters, median 74, first quartile 59. The
60s/12-slide plan came out at mean 40.1, median 40. The budget was doing exactly
what it was told; 47 characters clears `MIN_SENTENCE_CHARS` by seventeen, so
nothing warned, and the tool built a thin deck in silence.

`EXPLAINING_CHARS = 60` — the demo's own first quartile — now warns in the gap
between "buildable" and "explains anything", and NAMES the slide count that would
fix it rather than saying "use fewer slides":

> 60s over 12 slides leaves 47 characters a slide, about 9 words. The shipped
> demo averages 72. Each slide will caption rather than explain: 9 slides at the
> same target would buy 62, or keep the twelve and raise the target to 80s.

This is an advisory, not a steer, and deliberately so. The arithmetic is not
wrong — 60 seconds over twelve slides IS 5 seconds a slide, and at 150 wpm one
sentence already fills 3.9 of them. The beat count is the binding constraint, not
the budget, and only the author can decide whether to spend slides or seconds.

**That advisory was the wrong build, and the owner said so.** "I told you to
speed up the narration speaking to put more sentences in case of duration is
short like one minute." He is right, and §1 of this document already said it:
narration speed is in the DERIVED column, next to word count. It was never
derived. `durationPlan` returned an animation speed and a character budget and
left `narration.rate` at whatever the preference said, so the only lever the
feature ever pulled for a short target was *saying less*. Recommending nine
slides to someone whose stated case is "keep all twelve" is answering a question
nobody asked.

### Speaking rate, derived

The seconds a beat can spend on speech are fixed by the target. How many WORDS
fit in them is not. So the rate is raised first and only what speed cannot buy is
charged to the word count.

`RATE_STEPS` is a MEASURED table, not a formula, and both of its irregularities
matter. edge-tts's nominal percentage overshoots — the first `+10%` buys 19% —
so a linear model under-speaks every deck. And the curve is not monotonic:
`+50%` came back *slower* than `+40%`. Interpolating between these points would
be inventing data.

```
  rate    seconds   chars/sec   speedup   p95 cue cps
  +0%       4.416       16.30     1.000          16.7
  +10%      3.720       19.35     1.187          19.9
  +20%      3.528       20.41     1.252          21.0
  +30%      3.168       22.73     1.394          23.6
  +40%      2.880       25.00     1.533          26.0
  +50%      2.904       24.79     1.521          25.7   <- slower than +40%
  +60%      2.640       27.27     1.673          28.5
```

It stops at `+40%` because of the SUBTITLE, not the ear: 26 cps is already half
again over `COMFORTABLE_CPS`. The step chosen is the SLOWEST that clears the bar,
so 90s and 120s targets stay at `+0%` and their decks do not move a byte.

One bug found while building it: `EXPLAINING_CHARS` is measured on English, and
a Hangul character carries several times a Latin one. Holding a Korean deck to
sixty *characters* would have sped up every Korean deck to chase a bar 2.3× too
high. The bar is really ~4.2 seconds of speech and now converts through the same
cps the budget uses.

### The prompt was a ceiling with no floor, and it had gone false

"Keep each sentence to about N characters — ... there is no way to say it
faster." The last clause stopped being true the moment the rate was derived. And
the whole framing was about not going OVER, so the planner sat well under:
**61% of a 47-character budget, 77% of a 66-character one.** A range with a floor,
and "write to the TOP of that range", fixes it.

### Measured, over three plans rather than one

Because §9's lesson was that a prompt steer cannot be judged at n=1.

| | beats | mean chars | median | % of budget |
|---|---|---|---|---|
| original, 47-char budget | 12 | 40.1 | 40 | 61% |
| rate knob only, 66-char budget | 10 | 51.1 | 49 | 77% |
| rate + prompt floor | 9 / 10 / 8 | 60.6 / 60.3 / 59.4 | 61 / 59 / 60 | 90–92% |

**50% more words per slide, stable across three independent runs.** Against the
demo's own 72.1 mean this is 83%, up from 55%. Speech density on the rendered
deck goes 13.9 to 18.75 characters a second. The cost lands exactly where the
warning says it does: subtitle p95 16.3 → 21.3 cps, over the 17 cps practice.
`renders/fast-60char-54s.mp4` is the artifact.

---

## 11. THE SILENCE, and where it actually was

The owner, on the deck §10 produced: *"still the sentences are too short to
explain the paper. make the narration speak more even on pause, animation on the
slide and in between to transition to the next slide so fully explain even though
the duration is set to short. but make sure you must synchronize everything."*

### The measurement that found it

Not from the timing model — from `silencedetect` on the shipped mp4:

```
real-plan-57s.mp4   57.20s   speech 28.25s (49%)   SILENCE 28.95s (51%)
```

**Half the video says nothing.** And the gaps are not scattered: assigning each
to a scene boundary,

```
  SPANNING A CUT   24.81s   93%   <- ten gaps, one at every slide change
  INSIDE A SCENE    1.00s    4%
  SCENE ENTRANCE    0.93s    3%
```

Ten gaps of 1.0-3.4s, each one astride a cut. Decomposed further, every gap is
the same two pieces: the TAIL the outgoing scene reserved and never used, running
straight into the HEAD the incoming one spent waiting.

Both come from one line. `beatSeconds` was `max(authored, lastHold + spoken)` and
`place` anchored each sentence to its own hold, so a scene reserved room out to
its LAST reveal plus the whole sentence, while the voice only occupied from the
FIRST reveal. tail = `(lastHold - firstHold) * speed`, head = `firstHold`. Speech
and motion were CONSECUTIVE, stated as arithmetic.

### What changed

Three things, and none of them is the warp the design fan-out recommended — that
retimes the emitted scene and buys sync at the cost of the emitter, invariant 11
and the camera dive. The silence needed none of it.

1. **`beatSeconds` overlaps the two terms.** `max(authored, lastHold + SETTLE,
   speechEnd + SETTLE)`. A beat is as long as the longer of the two things
   happening in it, not their sum.
2. **`speechPlan` is one continuous clock.** The first sentence starts when the
   HEADLINE lands (`openSeconds`, measured off the scene, ~0.375s at the speed a
   60s target derives — not a constant, which would have been right at one speed
   and started the voice over a half-drawn headline at every other). Later
   sentences run back to back, and wait only if their own reveal has not happened.
3. **`budget` stops charging for the build.** `beatSeconds - lastHold*speed`
   became `beatSeconds - (open + SETTLE)`, which is ~0.75s against ~1.75s.

`framePlan` needed no change at all: the `if (!next)` fix from §10 already pays
the freeze out of the dead tail, so `dropped == freeze` stays honest.

### Synchronisation, which was the hard half

The frozen picture was a guarantee by construction and therefore unfalsifiable.
Giving it up means asserting it, and `assertFits` now has three checks. The third
is the real one: **a sentence must not end before the reveal it speaks over
appears.** It is worth having because its two sides share no term — `hold` comes
from `emitScene` via `holdsFor`, `start` from the measured mp3 lengths — so it
can genuinely fail. It catches narration re-cut after the build, and a deck
narrated for one format and built for another with deeper staging.

The other direction is prevented rather than detected: `speechPlan`'s `Math.max`
makes a later sentence wait for its reveal, so the voice cannot run ahead of the
picture even at `--speed 2`. A clamped stop (`stop >= holds.length`) is exempt,
because speaking late over the finished picture is a documented degradation and
must not become a build failure.

### The bar was the wrong statistic

`EXPLAINING_CHARS` was 60, the demo's first QUARTILE, picked as a floor. But
`fastEnough` reads it as a TARGET, so a bar set at the worst quarter of the deck
that works produced decks at the worst quarter of the deck that works — twice,
and the owner rejected both. It is now 72, the demo's MEAN.

That interaction is worth remembering: the overlap freed a second of speech per
beat, and `fastEnough` immediately gave it back by dropping the rate from `+30%`
to `+0%`, for a net gain of nothing. A floor and a target cannot be one constant.

### The prompt was telling the planner to come up short

*"Aim for about N beats. That is a target to come close to, not a quota to fill."*
Four of the last five plans came back short — 8, 9, 9, 10 against 12 — and since
`beatSeconds` derives from the REQUESTED count, every missing beat is duration the
video does not use. The anti-padding half survives (RULE 9 is why it was written);
what changed is that the cost of being short is now stated, in seconds and
characters.

### Measured, end to end

| | original | rate knob (§10) | now |
|---|---|---|---|
| length | 57.20s | 54.23s | 60.76s |
| **speech** | 28.25s (49%) | 27.49s (51%) | **42.51s (70%)** |
| **silence** | 28.95s (51%) | 26.74s (49%) | **18.25s (30%)** |
| worst gap | 3.96s | 3.81s | **2.07s** |
| beats | 12 | 10 | 12 |
| narration | 481 chars | 603 | **794** |
| mean sentence | 40.1 | 60.3 | 66.2 |

**The voice now speaks for 70% of the video against 49%, and says 65% more.** The
deck also passes with 0 errors and 0 warnings, which no 12-beat plan in this
experiment had done before. `renders/continuous-12beat-60s.mp4`.

---

## 12. THE WORD-ALIGNMENT STEP, and why it is not the next one

§11 left "align each reveal to the word that names it" as the honest next step.
Three designs were built and adversarially verified against the real emitter.
All three scored 3-4 of 10, and the reason is a measurement, not a review
opinion.

### The defect it was going to fix does not exist

The premise was §9's shape one level down: a name spoken before its thing
arrives. Measured over all 136 plans in `experiments/` and `demo/` — 496 of 498
beats emitted, each part container mapped to its own reveal time off the paced
`Scene.tl`, every narration word placed on the scene clock, at the speed a 60s
target derives:

```
  1103 named parts across 337 containers
  lead (part appears − word spoken): median −6.87s, p90 −2.47s, MAX +0.87s
  parts named more than 1.0s before they appear:  0 of 1103
```

The positive control fails too: transplanting §9's own defect sentence —
*"ThinkSR runs through encoder, windows, ticks, and decoder."* — onto a real
pipeline beat produces **zero** early names, because the build finishes at 2.40s
and the sentence runs 2.95s.

That is geometry. The build is roughly 4× faster than the voice, so narration
cannot outrun the picture. `scanHeadlines` catches the enumeration defect in a
HEADLINE because a headline is instantaneous — all four names are on screen at
0.375s while one stage is drawn. Spread the same four names over three seconds of
speech and the defect evaporates.

A second measurement kills the mechanism independently: **only 39% of drawn part
labels are ever named in the narration** (15 of 38 on the shipped plan). That is
not an accident — `cadenceFor` forbids enumerating a beat's parts, deliberately,
because of §9. So word-matching has nothing to align for 61% of reveals, and its
fallback is the thing it was supposed to improve on.

### What the fan-out found instead, which was worth the run

`framePlan` ignored `place`. It re-derived each segment's audio position by
playing the video to `segment.hold`, so the speech clock §11 introduced was
overridden on every scene of the shipped deck:

```
  scene   place said   render did   drift
  s1        0.334s       0.800s     0.466
  s4        0.375s       0.999s     0.624
  s10       0.375s       1.363s     0.988
  s12       0.375s       1.529s     1.154
                              total 6.03s
```

**This is not extra silence** — per scene it is still `open + SETTLE`, just
shifted from the tail to the head. It is a SYNC bug: every sentence was heard
later against its own reveals than the manifest said, and `assertFits`'s
sync check tested `start`, a number the renderer was not using. The check was
therefore unfalsifiable in exactly the way §11 claimed to have fixed.

Fixing it collapsed `framePlan`: with speech and motion overlapping, `beatSeconds`
already sizes every scene for both, so **no freeze is ever needed**. One piece per
scene, `freeze: 0`, every source frame played in order. Drift 6.03s → 0.109s
(frame quantisation). The camera-dive anchoring that shipped a bug once is now
true by construction rather than by arithmetic, and `retime` skips the whole
re-encode — a narrated video is the capture itself with audio muxed on, no
generation loss.

### Measured

| | original | §11 | §12 |
|---|---|---|---|
| length | 57.20s | 60.76s | 60.10s |
| speech | 28.25s (49%) | 42.51s (70%) | **42.67s (71%)** |
| silence | 28.95s (51%) | 18.25s (30%) | **17.43s (29%)** |
| audio drift from manifest | — | 6.03s | **0.109s** |
| re-encode | full | full | **skipped** |

`renders/synced-12beat-60s.mp4`.

### THE REAL REMAINING DEFECT, measured

**63% of all narration plays over a picture that has already stopped moving** —
31.19s of 49.68s. Per beat the build covers only 10-56% of its sentence and then
freezes:

```
  s1 10%   s2 40%   s3 27%   s4 56%   s5 43%   s6 41%
  s7 53%   s8 48%   s9 43%   s10 28%  s11 24%  s12 42%
```

That, not word alignment, is what a viewer notices. The fix is to spread each
scene's build across its own sentence — a PER-SCENE `pace` factor, which is the
existing tested mechanism with a different argument rather than any new warp
machinery. It was designed and scored 3, with one fatal worth carrying forward:
`animationSpeed: 1` is not a no-op under it, so the identity that keeps an
un-narrated deck byte-identical has to be re-established explicitly.

Note the interaction, which is why it must not be done casually: apply that
stretch and the name-before-reveal defect **appears for the first time** — the
same measurement goes from 0 of 1103 parts over 1.0s early to **222 of 1103**.
The detector that is worthless today becomes load-bearing the instant the build
is slowed. Land them together, or land the detector first.

---

## 13. THE BUILD FILLS THE SENTENCE, and the detector that had to ship with it

§12 measured the remaining defect: **63% of all narration played over a picture
that had already stopped moving**, because each beat's build covered only 10-56%
of its sentence and then froze.

### `fillFactor` + `stretchAfter`

Each scene's reveals are slowed so the build finishes as the sentence does. Three
things make it safe rather than the warp §12 rejected:

**It is not `pace`.** A per-scene `pace` factor scales EVERYTHING, including the
headline entrance the voice waits for, so `openSeconds` grows with the factor and
every scene gains head silence — measured at 3.2s per deck, which is what §11
just spent itself removing. `stretchAfter` is piecewise linear with ONE knot at
`open`: chrome untouched, build stretched. A tween's new duration is
`w(at + d) − w(at)`, so one straddling the knot keeps both endpoints exactly.

**It cannot run slower than the deck was authored.** The ceiling is `1 / speed` —
a duration target derives `animationSpeed` *below* 1 to make the reveals fit, and
this gives back as much of that as the sentence can absorb and not one frame more.
`max(1, …)` on the ceiling is load-bearing: at `--speed 2` the animation is
deliberately slow, `1 / speed` is 0.5, and a bare `min` would turn the cap into a
compressor. It also makes the factor exactly 1 at `animationSpeed: 1`, so an
un-narrated deck is byte-identical — the `pace` identity preserved rather than
re-argued. A test caught that; it was written wrong first.

**One segment only.** `speechPlan` ignores `holds` for a single sentence, so the
sentence's end does not move when the holds do. With two or more a later sentence
WAITS for its reveal, so stretching moves the speech the stretch was computed
from. Not worth a fixed point for a case that already spreads its sentences.

`stageScene` is the single place pacing and filling happen, shared by `planCut`,
`layout` and `holdsFor` — which matters because `assertHoldsAgree` only runs on a
navigable format, so on `video-16x9` a divergence between the emitter and the
manifest is invisible.

### The detector, and why it is in the same commit

`scanNarrationLead` warns when the narration names a part more than a second
before it is drawn. §12 measured that this defect **did not exist**: 0 of 1103
named parts, because the build ran ~4× faster than the voice.

Slowing the build is exactly what makes it reachable. Measured on the same deck,
same narration, the flag flipped by one line:

```
  without the stretch:  1 warning
  with the stretch:     8 warnings
```

That is the whole argument for one commit rather than two. The detector is not a
smoke alarm for a fire already burning; it is the one fitted before the gas is
turned on. It is conservative in three ways — earliest-possible appearance,
`scanHeadlines`'s five-character prefix match, and a full-second threshold — so
it under-reports rather than crying wolf.

### Measured

| | §11 | §12 | §13 |
|---|---|---|---|
| length | 60.76s | 60.10s | 60.03s |
| speech | 42.51s (70%) | 42.67s (71%) | 42.54s (71%) |
| silence | 18.25s (30%) | 17.43s (29%) | 17.49s (29%) |
| **static under the voice** | 63% | 63% | **18%** |
| build covers its sentence | 10-56% | 10-56% | **24-100%**, six at 100% |

The audio is deliberately unchanged — this moves pictures, not words. What a
viewer sees is the diagram assembling across the whole sentence instead of
snapping together in the first second and then sitting there.
`renders/filled-12beat-60s.mp4`, with `fill-s5-building.png` (two stages, mid
sentence) and `fill-s5-settled.png` (all four, as the voice ends).

### STILL OPEN after §13

The eight warnings are real and unfixed: the planner writes a sentence naming
parts in an order the emitter does not draw them in. Nothing steers it yet, and
per §9 a prompt rule about this can be met cosmetically — the honest lever is
probably to let the beat declare its reveal ORDER from the sentence rather than
the other way round.

---

## 14. THE NARRATION IS ONE SENTENCE PER SLIDE, AND THAT IS WHY IT HAS NO STORY

The owner, on the §13 deck: *"static under voice is not a problem. viewers should
have enough time to see the slide. more important problem is your narration
sentences. they don't explain the paper well and they don't have a flow. just
sentence by sentence. it's all about storytelling... and this must be consistent
regardless of the length of the video (duration setting)."*

### The measurement that found the cause

The generated deck writes 12 sentences over 12 beats. The hand-written demo
writes **39 over 12 — 3.25 a beat**. And every bit of the demo's storytelling
lives in its second and third sentences: *"Then the field is cut into
windows..."*, *"Only at the very end does the decoder upsample..."*, *"That loop
is a single tick..."*, *"So this is not the cheap option, and the paper never
claims it is."* **The flow is INSIDE a beat, between its own sentences.**

The decisive test is to reduce the demo to its first sentence per beat — which is
exactly what a 60-second target over twelve slides buys:

```
  The encoder does the heavy lifting first.
  The encoder turns the low-resolution image into a dense feature field.
  The first tick is worth almost a full decibel.
```

The deck that works, at the 60-second configuration, is ALSO captions. So the
prose was never the problem. **One sentence per beat cannot flow, whoever writes
it.** The complaint is arithmetic.

### The rule, and its reason, which had been false for two sessions

`cadenceFor` at `density: low` said `ONE SENTENCE PER BEAT`, justified by:

> THAT SENTENCE IS HEARD OVER THE BEAT'S FIRST FRAME, before the stages, panels
> or layers after the first have been drawn.

§11 made that false — the voice starts when the headline lands and runs
continuously with the reveals underneath. Nobody removed the rule when its reason
went, so the planner went on being told to write one self-contained caption per
slide, and did, twelve times.

### What changed

**The sentence count is derived** (`durationPlan.sentences`) from the beat's own
speech budget rather than from the density preference, and `SENTENCES_PER_BEAT`
is 2 — the floor below which a beat can only caption. The prompt asks for that
many sentences **as one continuous take**, says the deck is one script rather
than N captions, and names the failure explicitly: *a line that would read
identically if the other beats did not exist*.

**`narration` moved after `params` in the schema.** Structured output decodes in
key order, and stored plans confirm it: `id, intent, claim, evidence, narration,
weight, seconds, archetype, params`. Every line was being written BEFORE the
archetype was chosen — the model was asked what the slide shows while it had not
yet decided. Free for the 136 stored plans; zod ignores key order on parse.

**A shipping bug, found by a judge**: at 300s over twelve slides the prompt said
`ONE SENTENCE PER BEAT` and *"each sentence runs 290-341 characters"* — an
instruction to write a 341-character sentence. The budget is now the beat's
total and the count is separate.

**`--slides` reaches `narrate` and `build`.** The comment above `lengthFlags`
already warned that "a flag missing from one of those is a deck whose three
stages disagree about how long it is" — and `--slides` was missing from two.
Every derived number comes from `duration / slides`, so a deck planned at five
slides and narrated without the flag was SPOKEN at the twelve-slide rate.

### WHY THERE IS NO COHESION GATE

The obvious check is to score connectives and anaphora. It was built, and then
defeated in one edit: prefixing a discourse marker to each of the twelve rejected
sentences — changing no content, no claim, no relation — moved the score from
**42% to 92%, above the hand-written demo's 74%**. It is also exactly invariant
under shuffling the deck, so it is provably blind to the only property being
asked for. That is §9 with the answer key attached.

So what ships instead is (a) the sentence-count arithmetic, which is a property
of the BUDGET and not a judgement, and (b) `plan` printing the narration joined
into one paragraph, because a human reading it is the detector that has actually
worked six times in this project.

### Measured, and duration-consistent

| target | 12 slides | flows at |
|---|---|---|
| 60s | 1.00 sentences/beat — captions | 5 slides |
| 120s | 1.76 — captions | 8 slides |
| 180s | **2.74 — flows** | 12 slides |
| 300s | **4.74 — flows** | 12 slides |

That table IS the owner's fourth requirement: the same twelve-slide deck told a
story at 180s and could not at 60s. The advisory now names the slide count that
reaches two sentences at whatever target is asked for, so the arc and the flow
are available at every duration and only the DETAIL scales.

Two real 60s/5 runs, against the rejected deck:

```
  back-reference at the sentence opener:  9%  ->  22% and 33%   (demo 21%)
  speech                            42.51s (70%)  ->  41.00s (72%)
  subtitle p95                       18.6 cps     ->  17.1 cps   (practice 17)
  animation speed                    0.417x       ->  1.0x, uncompressed
```

`renders/story-5beat-60s.mp4`. Read `sb-story-60s.json`'s narration end to end:

> The problem starts with a mismatch in shape. CTM keeps its reasoning compact,
> **but** super-resolution must predict detail across the image. **That carrier**
> is the bridge between the two shapes. **It** keeps spatial state available
> while the compact process decides what to revise... **After windowing**, the
> same DQ-CTM module is applied across ticks. The decoder **then** turns the
> updated representation into the reconstruction... CATANet remains ahead, **so**
> the result is competitive but not best.

---

## 15. THE TWO THINGS §14 LEFT

### The slide count is derived, not just warned about

`slidesFor` returns the MOST slides a target can carry while every beat still
affords `SENTENCES_PER_BEAT` — most, not fewest, because beyond the floor more
slides is more of the paper drawn. It is applied in `loadPrefs`, which is the
layer that already owns "what happens when a preference comes from nowhere", and
ONLY when nobody said: a number in the config file or on the command line is
obeyed even when it cannot flow, because `slides` is one of the three knobs the
owner asked to hold. `durationPlan` reports the mismatch instead.

```
   30s ->  3 slides      180s -> 16 slides
   60s ->  5             300s -> 26
   90s ->  8             600s -> 40
  120s -> 10
  explicit --slides 12 at 60s -> 12, obeyed and warned about
  no duration at all          -> 12, the schema default, untouched
```

### `name_before_reveal` was two different things

Both survivors turned out to be separate problems wearing one warning.

**The true positive was an ORDERING mismatch the planner controls both sides
of.** `b05-results` said *"The reported averages put DQ-CTM-SR in the CNN
baseline range"* over bars listed `CARN, IMDN, RFDN, DQ-CTM-SR, CATANet` — it
opens on the fourth bar while the first is still growing. The planner writes both
the sentence and the part order, so the fix is to make them agree, and the prompt
now says so with that exact case as the worked example. Measured over two fresh
runs: **2 warnings → 1.**

**The remainder was a FALSE POSITIVE class.** Every one left was `equation-walk`.
Checked against the real emitter: `#sid-eq` fades the whole equation in at 0.8s
and `terms` are `color`/`scale` tweens on symbols that have been on screen the
entire time. Naming a term "early" is naming something the viewer is already
looking at. Excluded — same precedent and same reasoning as `partLabels`'
existing exclusion of `highlight[].row`, and placed in `scanNarrationLead` rather
than in `partLabels` because `scanHeadlines` wants the opposite answer: a
headline reciting an equation's term labels is RULE 8's defect either way.

**2 → 1 → 0, and the detector keeps its teeth**: re-run against §14's deck it
still flags the genuine `pipeline` and `bar-compare` cases. Both directions are
pinned by tests.

### Measured

```
  60s, no --slides passed at all:
    5 beats, PASS, 0 errors 0 warnings
    58.23s   speech 42.87s (74%)   silence 26%
    subtitle p95 16.6 cps, under the 17 practice
```

`renders/auto-60s.mp4`. The narration, read end to end:

> Start with the mismatch: CTM keeps its thought compact, **but** super-resolution
> asks for a value at every spatial location. The method has to bridge **that
> gap**. The dense carrier is the part that persists, **so** spatial detail does
> not disappear when thought stays compact. The thought process reads **it** and
> writes **it** back... The CNN baselines cluster around the same reported
> average, **and** DQ-CTM-SR sits in **that range**. CATANet is **still** higher.

---

## 16. A ONE-MINUTE DECK IS A CONFERENCE FAST-FORWARD TALK

The owner, on §15's deck: *"in auto mode the decision of narration speed,
animation speed and the number of slides and the enrichment on slides in terms of
animation/figures are too conservative when it's 1 minute... haven't you ever seen
a fast-forward presentation of paper authors on conferences... they never use
stupidly small number of slides... put more images and animations. you must
utilize all the space of the screen. you must utilize every single second."*

Three things measured on the §15 artifact, and the third is the damning one:

```
  5 beats            a fast-forward talk uses 10-15
  133 words/minute   a fast-forward talk delivers 160-190
  0 of 4 figures     the paper's own architecture figure sat unused
```

### The reference was wrong, not the arithmetic

§14 derived `SENTENCES_PER_BEAT = 2` from `demo/storyboard.json` and concluded
one sentence a beat cannot flow. That is true of the demo — a FOUR-MINUTE deck at
twenty seconds a beat — and false of a teaser, which runs one sentence a slide
across a dozen slides and flows fine because its flow comes from the SCRIPT being
continuous, which §14's own prompt rewrite already delivers. Reading a lecture's
shape onto a teaser is what produced five slides.

So the rule now reads onto lectures only: the advisory fires when a beat is
LONGER than `FF_BEAT_SECONDS` and still gets one sentence, which is the genuine
thin case. Under it, one sentence a slide is the format.

### Three changes

**`slidesFor` is tempo, not sentence count.** Beat length clamped to
[`MIN_BEAT_SECONDS`, 20] and slides derived from it. Both references agree on
twelve: a fast-forward talk is 12 beats in 60s, the demo is 12 in 246s. What
changes with duration is how long each beat lasts.

```
  30s ->  8    90s -> 12    300s -> 15
  60s -> 12   120s -> 12    600s -> 30
```

**`fastEnough` has two regimes.** A lecture takes the slowest step that clears a
sentence. Under `FF_BEAT_SECONDS` there is no spare room, so the deck takes the
FASTEST step the captions can carry — `SHORT_FORM_CPS`, anchored on the demo's
own measured 18.41 cps rather than the 17 of broadcast television.

`CUE_OVERHEAD` exists because the first version of that ceiling was on the wrong
quantity. A cue spans the words and not the breath around them, so it reads ~17%
faster than the utterance; the arithmetic admitted `+30%` and the artifact came
back at 23.7 cps, past the bar the constant exists to hold.

**The prompt demands the figures.** "Every figure in the inventory should earn a
beat unless you can say why it does not", plus a FORMAT block that names the
fast-forward talk explicitly when the beats are short enough to be one.

### Also: `inside` is checked at plan time

A real run asked to fly the camera into `stage1` of an ANNOTATED-FIGURE. The
emitter refuses it, so nothing shipped broken — but it refuses at BUILD, after
`narrate` has spent a minute and a dozen network round trips on a storyboard that
was never going to build. `assertInsideResolves` emits the previous beat and asks
`enterableIds` what it drew, so it cannot drift from the emitter.

### Measured

```
                    §15 (5 beats)      §16 (12 beats)
  beats                    5                12
  figures used           0/4               4/4
  narration            734 chars        927 chars
  words per minute       133               169
  speech            42.87s (74%)      44.32s (74%)
  gates              0 err 0 warn      0 err 0 warn
```

`renders/ff-12beat-60s.mp4`, `sb-ff-60s.json`.

### STILL OPEN after §16

- **The subtitle p95 lands at 22.8 against a 22 ceiling.** `CUE_OVERHEAD` is 1.17
  from single-sentence probes; this deck measures ~1.26. Within 4% and in a known
  direction, but the constant is optimistic and should be re-measured over whole
  decks rather than probes.
- **Screen space is unaddressed.** "You must utilize all the space of the screen"
  is an emitter question — figure sizing, full-bleed layouts — and nothing here
  touched it. `annotated-figure` still parks the image in a box.
- The 120s cliff: beats cross `FF_BEAT_SECONDS` between 90s and 120s, so the
  rate drops +20% to +0% and words per minute go 172 to 139. It is a regime
  change and defensible, but it is abrupt.

### STILL OPEN after §15

- `slidesFor` sits exactly at the two-sentence floor, so a planner that writes
  slightly long lines can tip a beat back to one. The demo's own load is 3.25
  sentences a beat; a margin above the floor is defensible and unmeasured.
- Nothing checks that the arc is actually an arc. `scanNarrationLead` catches a
  name arriving early; nothing catches a deck whose five beats are all mechanism
  and no cost.

### STILL OPEN after §14

- **The slide count is still the author's to get right.** `durationPlan` warns
  and names the number; it does not choose. Deriving a default beat count from
  the duration is the obvious next step and was deliberately not taken here,
  because `slides` is one of the three knobs the owner asked to control.
- `scanNarrationLead` fires twice on the new deck — real instances, where a
  sentence names a stage a second before it is drawn. Nothing steers the planner
  on reveal ORDER yet, and per §9 a prompt rule about it can be met cosmetically.
- The shuffle-drop test used to check the back-reference numbers above is too
  noisy at n=12 to be a gate. It is a diagnostic, not a check, and is not shipped.

### STILL OPEN after §11

- **30% silence, not 15%.** The model predicts 16% (`open + SETTLE` per scene);
  `silencedetect` sees 30% because it also counts edge-tts's own breath pauses
  INSIDE a sentence, at a 0.3s threshold. Some of that is real prosody and should
  stay. Nobody has separated the two, so the true remaining seam silence is
  somewhere under 30% and above 16%.
- **`speechPlan`'s wait rule is per-segment, not per-clause.** At `density: low`
  there is one sentence per beat, so it is sentence-level containment only: the
  reveals play under the voice, but no word is aligned to the reveal it names.
  `segment.cues` carries edge-tts word boundaries and is unused. That is what
  would turn "the reveals happen while it talks" into "each name lands on the
  thing arriving", and it is the honest next step.
- **The subtitle is now the binding constraint**, at p95 18.6 cps against the 17
  practice. `render` says so. Raising `EXPLAINING_CHARS` further trades directly
  against it.

### The old §10 note, now partly answered

**Longer sentences are costing beats.** Twelve requested; 12 → 10 → 9/10/8 as the
budget and then the floor went up. Four runs, all under target, so unlike §9's
n=1 observation this is now attributable: asked for more to say per slide, the
planner consolidates slides.

Two consequences, neither fixed here. The owner asked for twelve slides AND
fuller sentences, and is getting fuller sentences and eight to ten slides. And
`beatSeconds` is derived from `prefs.slides`, so a plan that returns ten beats
against a twelve-beat budget undershoots its target — this deck came out 54.2s
against 60. `playbackFactor` will not stretch a short video, correctly, so the
gap simply stands.

The honest read is that beat count and sentence length are one budget, not two,
and the prompt currently states them as independent targets. Whoever takes this
next should decide whether `--slides` is a target or a floor, and whether
`durationPlan` should re-derive `beatSeconds` from the beats actually returned
rather than the ones requested.

### RULE 9 now has a detector

`b04`/`b06` above is a misreading — they are two pipelines over DIFFERENT parts.
The real repeats in that plan are `b06`/`b07` (both cite `fig-arch`) and
`b10`/`b11` (both draw the identical five bars from `tbl-bench`).

`scanRepeatedObject` takes the same shape `scanHeadlines` documents, and for the
same reason: whether a second beat is padding is a judgement the writer makes
about their own output, so a prompt rule can always be met cosmetically. Three
conditions, all required — same evidence id, same archetype, identical drawn
labels. Measured over the 134 plans in `experiments/` and `demo/`: matching on
the shared id alone fires on ten and condemns `demo/storyboard.json`, which
draws bars and then the table — the shape, then the numbers, which is teaching,
not repeating. All three conditions together fire on four plans, every one of
them the same five bars drawn twice, and leave the demo alone.

The dangling-citation half needed no code: `cut.dangling` already reports it at
`build`, correctly — a bar-compare draws numbers derived from a table, it does
not SHOW the table, and the comment on `dangling()` is right that only the author
can decide whether that matters.

## 17. THE BUDGET WAS STRUCK AT A SLIDE COUNT THE DECK DID NOT HAVE

There are two functions called `beatSeconds` and only one of them decides the
video. `DurationPlan.beatSeconds` is a budget the planner is written to;
`beatSeconds()` in `src/emit/composition.ts` is what actually sizes a scene. The
only channel between them is `speed` — and `speed` came from
`duration / prefs.slides`, the count that was ASKED FOR, not the count that came
back.

Four of the last five real plans came back short. So an eight-beat plan against a
sixty-second target was paced for five-second beats that are really seven and a
half, and the finished video came in at forty seconds with `lint`, `check`, the
type floor and `drift` all green. `playbackFactor` never slows a video down to
fill a duration, so nothing downstream closed the gap either. Nothing anywhere
compared the two numbers.

### (a) The budget is restruck on the beats that exist

`durationPlan(prefs, beats = prefs.slides)`. Every caller holding a storyboard
passes `storyboard.beats.length`: `build` (src/cli.ts), `narrate`
(src/narrate/narrate.ts) and the server pipeline. Two callers structurally
cannot and keep the request, which is the only number they have — `systemPrompt`,
which builds the prompt before a plan exists, and the MCP `estimate`, which is a
pre-flight with no plan at all. Both now say so in a comment, because they are
the sites someone will otherwise "fix".

The default is load-bearing. It is what keeps a run where the planner hit its
number byte-identical, and `test/duration.test.ts` asserts the identity
(`durationPlan(p)` deep-equals `durationPlan(p, p.slides)`) so that the twenty-odd
pinned values in that file cannot fail as if the arithmetic broke.

`build` passes `storyboard.beats.length` and NOT `deck.cut.kept.length`: the cut
is decided by `planCut`, which consumes `speed`, so reading it back would make the
pace depend on a cut that depends on the pace. A beat the CUT drops afterwards is
still an undershoot this cannot see. That case is not fixed here.

One consequence worth naming: `--slides` no longer decides a single derived number
after `plan`. `narrate` and `build` both read the storyboard, so the
three-stages-disagree failure `lengthFlags` was written for is now structurally
impossible rather than a flag away. The flag stays because it is the floor.

### (b) `--slides` is a floor, said twice

The prompt's LENGTH block said `N` beats and then, four lines later, "if the
source genuinely will not carry N distinct points, say fewer". That escape clause
is gone, and the block now says what being short actually costs — which the
re-derivation changed. It is no longer seconds the video does not use; the seconds
are handed to the survivors, so a short plan fills its target with fewer points in
it and each surviving beat owes MORE than the character budget the same prompt
just printed. Beat count and sentence length are one budget, and the prompt now
says so instead of stating them as two independent targets.

A prompt rule alone was not enough, for the reason `scanHeadlines` records: a
sharpened RULE 8 was answered by a real Codex run swapping one verb. So
`scanBeatCount` ships beside it — `severity: "warning"`, `gate: "storyboard"`,
`rule: "beats_under_target"` — and prices the shortfall in the numbers the
re-derivation moved:

```
12 beats were asked for and the plan returned 8. The 60s is not lost, it is
redistributed: each surviving slide runs 7.5s instead of 5s and has to carry 102
characters where the prompt budgeted 66. ... The deck is being built for 8 beats,
not 12.
```

Reported, never repaired, the same shape as `cut.dangling`. Truncating throws
away slides the author asked for; padding to reach the number is what RULE 9
forbids and costs more than being short does; re-asking is a fresh Codex
round-trip on a single-shot planner. It runs at `plan` — the moment before a
minute of TTS — at `build`, and in the server pipeline. It is NOT folded into
`verify()`, which is handed a built directory and has no preferences to compare
against.

### Measured

Through `emitDeck` on `demo/storyboard.json` cut to n beats, with the budget's own
`speechSeconds` as each beat's narration, against a 60-second target. edge-tts is
not on this machine, so the speech term is arithmetic rather than synthesised —
but without a speech term at all a beat is bounded by `authored × speed` and no
budget of any kind can reach a target, which is why the CLI build alone cannot
show this.

```
  beats returned    struck at 12 (before)    struck at n (after)
       12                 59.96s                  59.96s
       10                 49.96s                  59.95s
        9                 44.96s                  59.94s
        8                 39.96s                  59.95s
        5                 24.96s                  59.90s
```

The 12-beat row is the identity guarantee: a plan that hit its number does not
move. The `demo` build itself is unchanged — no duration target, so `durationPlan`
returns before it reads a count — and comes out at `data-duration="104"`, twelve
beats, PASS with the one pre-existing `connector_detached` warning.

Two CLI builds of the same eight-beat cut, no narration, read off `data-duration`:
28.773s at `speed 0.417` (what the old code derived) against 43.125s at
`speed 0.625` (what the new code derives). Same direction, and it is the whole
visible effect of the change on a silent deck.

`npm run check`: 1112 tests, 35 files, green — including the sweep receipt, which
needed no re-pinning.

### STILL OPEN after §17

- **Nobody has watched this.** No mp4 was rendered and no audio was synthesised,
  because edge-tts is not installed here. The measurement above is the emitter's
  own `data-duration` against a synthetic narration of exactly the budgeted
  length; a real run's segments are whatever edge-tts returns, and the deck
  follows THOSE. §8 of this document is about precisely this gap.
- **The regime flip is now reachable from a plan the user did not choose.** At a
  60s target a plan returning 6 or fewer beats pushes the beat past
  `FF_BEAT_SECONDS`, `fastEnough` leaves the fast-forward branch, and the rate
  drops `+10%` → `+0%`. `rate` is part of the TTS cache key, so that
  re-synthesises every segment (~25-30s for twelve beats) and it is audible.
  Pinned in `test/duration.test.ts` rather than left to be discovered.
- **The cut can still undershoot.** `planCut` drops beats below `minWeight`, over
  a format's budget, or refused by an emitter, all AFTER `speed` is fixed. This
  change closes the planner-consolidation case only.
- **`fillFactor` / `stretchAfter` are in §13 and not in `src`.** `grep` finds one
  hit, a comment at src/verify/index.ts:493 citing `fillFactor` as the reason
  `scanNarrationLead` is reachable. `stageScene` only calls `pace`. Anyone
  reasoning about how a re-derived speed interacts with the build filling its
  sentence is reasoning about code that is not there.
