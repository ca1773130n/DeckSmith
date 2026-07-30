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

### STILL OPEN, and it is the next real problem

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
