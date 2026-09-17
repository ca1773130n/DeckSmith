# Narration staged at one canvas, built at another

Closes the `EXPERIMENT-011-reconcile.md` bullet "`narrate` and `build` must be given the
same canvas and nothing enforces it". Measured on `origin/main` at 3e5f90a (0.5.2), then
fixed on `fix/narrate-build-canvas`.

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

MCP submits a job to the same `runPipeline` as the server. The server passes one
`options.format` object to both `narrate` and `buildDeck`, so neither can mismatch.

## The fix

- `narrate` records `canvas: { format, width, height, captionReserve }` in
  `narration.json` (`narrationCanvas`, `src/types.ts`).
- `assertNarrationCanvas` throws when the recorded box differs from the build's. It names
  both canvases and the `narrate` flags that stage for the build's. It runs in `planCut`,
  which covers `emitDeck`, `emitComposition` and so `buildDeck`, and again in `planTiming`.
  CLI `build` also calls it before it writes anything.
- The id is not compared. `deck-16x9` and `video-16x9` are the same box and stage the same.
- `narrate --reserve-captions` exists now. The reserve changes staging, and without the flag
  a `build --reserve-captions` could never be paired with narration.
- The CLI's `loadNarration` and the server pipeline carry `canvas` through, and the pack
  schema is `narrationSchema`, so packs keep it.

After the fix, same storyboard and stubs, rebuilt `dist/cli.js`:

| narrate | build | result |
| --- | --- | --- |
| `--width 1600 --height 900` | `--format deck-16x9` | exit 1 with the output directory still empty: "staged for 1600×900, but this deck is laid out at deck-16x9 at 1920×1080 … Re-run `decksmith narrate` with --format deck-16x9" |
| `--format deck-16x9` | `--width 1600 --height 900` | exit 1, names `--width 1600 --height 900` |
| `--format deck-16x9` | `--format deck-16x9 --reserve-captions` | exit 1, names `--format deck-16x9 --reserve-captions` |
| `--format deck-16x9` | `--format deck-16x9` | exit 0, PASS, 15 segments |
| `--format deck-16x9` | `--format video-16x9` | check passes (same box), PASS |
| `--format deck-16x9 --reserve-captions` | same | check passes, b11 left out as before, PASS |
| 0.5.2 file, no canvas, staged at 1600×900 | `--format deck-16x9` | builds, PASS, prints "the narration records no canvas … Re-run `decksmith narrate` with --format deck-16x9 to record it" |

## Backward compatibility: a decision

**Narration with no `canvas` is accepted, and the CLI says it was not checked.** Refusing it
would make every `narration.json` and every pack written so far unbuildable until it is
re-narrated. A pack carries the mp3s but not the TTS cache sidecars, so for an unpacked
deck that means synthesising every sentence again over the network. The server wrote most
of those packs and always gave both stages one format. The cost of this choice is the last
row above: an old mismatched file still builds wrong, with a warning. The library path
(`emitDeck`, `buildDeck`) accepts such a file silently, because it has no channel to warn
on. Tests: "narration written before the canvas was recorded" in
`test/narration-canvas.test.ts`.

## Considered and not done

Recording each beat's stop count instead of the canvas would refuse only when staging
really differs. It would also catch a params edit that changes the count without changing
the words, which neither check catches today. It was not done here because the bullet is
about the canvas, and because a canvas refusal is cheap to fix: when the split does not
change, re-narrating into the same directory is all cache hits. It would be a separate change.

## Tests that fail with the check removed

Three runs, each restored with `git checkout -- src` afterwards:

1. The calls in `planCut` and `planTiming` removed: four tests in
   `test/narration-canvas.test.ts` fail (emitDeck, emitComposition, planTiming, caption
   reserve). The CLI test still passed, because `dist/cli.js` was not rebuilt and the CLI
   has its own early call.
2. The `planTiming` call, `canvas` in `narrationSchema` and the carry in `loadNarration`
   removed together: the planTiming test, the schema test and the CLI test fail. The CLI
   test failed at its own schema parse of `narration.json`, so this run does not isolate
   the loader.
3. Only `loadNarration`'s carry removed, dist rebuilt: the CLI test fails. The build ran
   the gates and exited 0.
