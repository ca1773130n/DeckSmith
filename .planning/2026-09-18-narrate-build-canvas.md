# Narration staged at one canvas, built at another

Closes the `EXPERIMENT-011-reconcile.md` bullet "`narrate` and `build` must be given the
same canvas and nothing enforces it". Measured on `origin/main` at 3e5f90a (0.5.2), then
fixed on `fix/narrate-build-canvas`. The first fix compared canvases; review showed that
was wrong both ways, and it now compares each kept beat's stops. Both are recorded below.

## Was it already caught? No

The 0.3.1 refusal is `scanNarrationDrift` (`src/verify/index.ts`). It compares each
beat's joined segment text with `beat.narration`. A canvas mismatch keeps the words and
changes only how they are split, so the joined text matches and the scan passes.
`narration.json` held `voice` and `beats` and nothing else. `place` in
`src/render/timing.ts` clamped an out-of-range stop on purpose, and `assertFits` skips
clamped stops. Nothing after 0.3.1 compared canvases.

## Where staging actually differs

Every demo beat was emitted at the four presets, nine custom canvases (1325×745 up to
3840×2160, portrait and landscape) and each of those with the caption reserve. Where a beat
draws, its stop count was the same at all 26. Hold times were compared at seven of them
(three presets, 1600×900, 1080×1350, 2560×1440, 720×1280) and were also identical. The
count changes when a beat is **refused** at one canvas and drawn at the other. `stopsFor`
counts a refused beat as one stop, so `narrate` puts all its sentences on the landing.
At 1600×900, `b08` (stack) and `b11` (data-table) are refused. At 1920×1080 with
`--reserve-captions`, `b02`, `b10`, `b11`, `b13`, `b14` and `b15` are refused.

The refusal is the only mechanism on the demo storyboard, not a rule for every storyboard:
holds depend on params and `beat.seconds`, and nothing proves they never depend on the box.
That sweep was `lang: "en"`. For a CJK language the font face changes what fits too; see
the Korean case below.

## Measured through the real CLI, before the fix

Storyboard: demo beats `b01 b03 b08 b11`. edge-tts was an offline shell stub reached
through `DECKSMITH_EDGE_TTS`, and `ffprobe` was a stub on `PATH`. Nothing was synthesised.

| narrate | build | result |
| --- | --- | --- |
| `--width 1600 --height 900` | `--format deck-16x9` | **exit 0, `PASS — 0 error(s), 7 warning(s)`** |
| `--format deck-16x9` | `--width 1600 --height 900` | b08, b11 left out, narration for them unused; FAIL on an unrelated `apparent_type_floor` |
| `--format deck-16x9` | `--format deck-16x9` | exit 0, PASS (control) |

In the first row, `deck.html`'s narration island gave scene `s3` (b08) **one 20.35s
segment on stop 0** and `s4` (b11) one 16.97s segment. The control gave them four segments
each. Frames through `decksmith frames` at t=42.38s (s3 stop 0) and t=44.78s (s3 stop 3):
the first shows only the "Dense carrier" layer, the second all four layers. So the voice
described the queries, synchronisation and compact-state layers while the viewer saw the
carrier alone.

## The first fix, and why it was replaced

The first commits on this branch recorded `canvas: { format, width, height, captionReserve }`
and refused a build whose box differed. Review measured that proxy wrong in both
directions, and both findings held when re-measured here.

**It refused correct builds.** Full demo, stubbed TTS, library probe on the branch at
fd87ceb: narration made at `deck-16x9` threw at `short-9x16` and at `deck-16x9` with the
caption reserve. Among beats drawn at both canvases, 0 of 15 changed their stop count in
either pairing. Review had built both pairings through the CLI on main and got
`index.html`, `timing.json` and `deck.html` byte-identical to a matched build. That broke
three workflows README documents: fitting a short, `render --subtitles burn` over
`build --reserve-captions`, and rebuilding an unpacked `.deck` offline. The printed fix was
also wrong for the last one. It said re-narrating into the same directory is all cache
hits, but a pack carries the mp3s and not the cache sidecars (`audioNames` in `src/cli.ts`),
so review's re-narrate synthesised 43 of 43 sentences.

**It passed a real mismatch.** `stopsFor` staged with the bare `ink` theme. The build
stages with `deckLook`, which puts `"Noto Sans KR"` (or JP/SC/TC) first in `fontStack` for
a CJK `lang`. `faceOf` reads that, and a Hangul face measures Latin runs wider. Probe, demo
`b01 b02` with `lang: "ko"` at 1380×776: `stopsFor` said 1 stop for the `b02` callout and the
build's theme staged 4. `narrate` wrote one segment on stop 0, `emitDeck` accepted it, and
review's CLI build printed PASS with frames showing the CTM card alone at stop 0. An
earlier version of this document said the server and MCP could not mismatch because
`runPipeline` hands one `options.format` to both stages. That was wrong for the same
reason: one format, but two themes. The type comment calling the box "all staging reads"
was wrong too.

## The fix

- **`narrate` stages with the build's look.** `deckLook` moved from `src/emit/composition.ts`
  to `src/emit/theme.ts`, and `planCut`, `layout`, `planTiming` and `narrate` all call it.
  `planTiming` had its own copy, and `narrate` had none.
- **`narration.json` records what the sentences were split over**: `stops` (each narrated
  beat's staged stop count, before the density cap), `speakingStops` (the cap, absent at
  `density: "high"`) and `canvas`.
- **A build compares speaking stops per kept beat, not canvases.** `assertNarrationStaging`
  (`src/narrate/narrate.ts`) takes each beat the deck draws and its stop count at this
  staging. It compares `speakingStopCount(text, stops, cap)`, which is
  `min(stops, cap, sentences)`, the number `planSegments` splits over, against the recorded
  count. Equal counts mean identical segments. `planCut` runs the check over `cut.kept`, so
  a beat the budget or an emitter refusal leaves out cannot refuse the deck. `planTiming`
  runs it over the beats it lays out. The canvas is used only to word the error: it says
  whether the canvas differs or the beats themselves moved (a params edit, or another
  DeckSmith version), and which `narrate` flags stage for this build.
- The error no longer promises cache hits. It says unchanged sentences are cached only in
  the directory the narration was made in, and that an unpacked `.deck` re-synthesises
  everything.
- `narrate --reserve-captions` stays. Without it, narration for a reserve build whose
  staging differs could never be recorded.
- `loadNarration` and the server pipeline now spread the whole record rather than copying
  fields one by one, so a new field cannot be dropped on the way to the check.

After, rebuilt `dist/cli.js`, stubbed edge-tts that logs every synthesis, full demo:

| narrate | build | result |
| --- | --- | --- |
| default (`deck-16x9`) | `--format short-9x16` | not refused. `index.html` and `timing.json` byte-identical to the build narrated with `--format short-9x16`. Both end `FAIL — 1 error(s)` on the same unrelated `text_box_overflow` at t=58.75s |
| default | `--reserve-captions` | not refused, PASS. `index.html`, `timing.json` and `deck.html` byte-identical to the build narrated with `--reserve-captions` |
| default, then `pack` / `unpack` | `--format short-9x16` from the unpacked dir | not refused, 0 synthesis calls. `index.html` and `timing.json` byte-identical to the matched short build |
| `--width 1600 --height 900` | `--format deck-16x9` | exit 1, no `index.html`: "for 2 beat(s): b08 (narrated over 1, 4 here), b11 (narrated over 1, 4 here). It was staged for 1600×900, and this deck is laid out at deck-16x9 at 1920×1080 …" |
| `lang: "ko"` `b01 b02`, `--width 1380 --height 776` | same | PASS. `stops` records `b02: 4`, and `b02` has segments on stops 0, 1, 2 |

Frames from `decksmith frames` on that Korean deck, at the `b02` holds (7.45s, 8.35s,
9.25s, 10.2s), all opened: stop 0 shows the CTM card, stop 1 adds Window-wise, stop 2 adds
This work, and stop 3 adds the footer. The three sentences sit on stops 0 to 2: the
landing line, then the CTM/window-wise sentence, then the one-query-per-position sentence.
Stop 3 is silent. Before the fix, all three were one segment over the CTM card alone.

## Backward compatibility: a decision

**Narration with no `stops` builds unchecked, and the CLI says so** (`uncheckedNarration`).
Refusing would make every `narration.json` and every pack written so far unbuildable until
re-narrated, which for an unpacked pack means synthesising every sentence again. The cost is
that an old file staged differently still builds wrong, with a warning. The library path
(`emitDeck`, `buildDeck`) accepts such a file silently, because it has no channel to warn
on. Tests: "narration written before its staging was recorded" in
`test/narration-canvas.test.ts`.

## Tests that fail with the check broken

Four mutations on c3dd3f8, each restored with `git checkout -- src`, run over
`test/narration-canvas.test.ts` and `test/narrate.test.ts`:

1. `narrate` back on the bare `ink` theme: 1 fails (the Korean callout is narrated over the
   build's stops).
2. The `planCut` call removed: 6 fail (emitDeck, emitComposition, same-canvas wording,
   budget-kept, density cap, Korean refusal).
3. Raw stop counts compared instead of speaking counts: 1 fails (the density-cap test).
4. `loadNarration` copying only `voice`, `dir` and `beats`, dist rebuilt: the CLI test
   fails. The unchecked build ran the gates and exited 0.

## Not covered

- `assertInsideResolves` (`src/plan/refs.ts`) still emits with the bare `ink` theme at
  `deck-16x9`. It checks element ids, not stops, and whether the face changes what it sees
  was not measured.
- `build --theme` is not passed to `narrate`. All three themes have the same `fontStack`
  today, so it cannot change staging. If a theme ever does, the per-beat check refuses the
  build rather than letting it through.
