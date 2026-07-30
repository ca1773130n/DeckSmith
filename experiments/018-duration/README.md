# 018 — duration control, the artifacts

Not an experiment: the rendered evidence for the duration-control feature. The
writeup is `.planning/HANDOFF-DURATION-CONTROL.md` §9. `renders/` is gitignored
by `experiments/*/renders/`, so these are scratch — regenerate with the commands
below, they are all cheap except the `plan`.

All four videos are the twelve-beat DQ-CTM demo at 1920×1080, `narration.density:
low`, `duration: 60`, derived `animationSpeed: 0.417`.

| file | length | playback factor | where its narration came from |
|---|---|---|---|
| `real-plan-57s.mp4` | 57.20s | **1.0** | a real Codex plan under the new prompt budget — the one that matters |
| `handwritten-59s.mp4` | 59.23s | **1.0** | narration written by hand to the 47-char budget, to isolate the arithmetic from the planner |
| `retimed-60s-1.361x.mp4` | 60.03s | 1.361 | the demo's own full-length sentences, so the retime had to close a 36% gap |
| `retimed-70s-1.167x.mp4` | 70.00s | 1.167 | the SAME capture as above, retimed to a second target with no re-synthesis and no rebuild |

The last two are one capture and two outputs — that pair is the evidence for
"a finished video can be retimed without re-synthesis or rebuild", and their
`.srt` timestamps differ by exactly the ratio of their factors.

The two at factor 1.0 are the interesting result: the plan-time character budget
hit a 60-second target on its own, so the playback retime never fired. Subtitle
p95 came out 16.31 cps on the real plan and 15.63 on the hand-written one, both
under the 17 cps broadcast practice.

## The frames

Checked against their captions, which is the only way this feature's failure mode
is visible — a 40%-out-of-sync deck passes every gate in the stack.

`r-s4-pipeline.png`, `r-s6-pipeline.png`, `r-s10-bars.png` are from
`real-plan-57s.mp4`. `r-s6` is the one that matters: its headline is
"ThinkSR runs through encoder, windows, ticks, and decoder" over a pipeline
showing only `Encoder` — the surviving instance that made `scanHeadlines` a
detector instead of a prompt rule.

`f-b02.png`, `f-b07.png`, `f-b12.png` are from `handwritten-59s.mp4` and are where
the headline finding was first seen.

## The reveals that were never on screen

`r-s6-pipeline.png` turned out to be showing TWO defects at once, and only the
headline was known. The owner, watching the mp4: "the resulting video shows
sudden showing all other three blocks at once."

He was describing dropped frames. On that beat the retimer played the first
stage, froze for the whole sentence, and then jumped to the assembled diagram —
**98 of 195 source frames never on screen, with all six holds inside the gap.**
Every gate was green, including `drift`, which compares two renders that are
identically wrong. `framePlan` now pays the last stop's freeze out of the dead
tail instead of out of the beat's own build; see the block above `if (!next)` in
src/render/timing.ts.

| file | what it is |
|---|---|
| `reveals-before-57s.mp4` | the same capture retimed by the OLD code |
| `reveals-fixed-57s.mp4` | the same capture retimed by the NEW code |
| `fx-s6-a-encoder.png` | 24.05s — `Encoder` alone, the frame the owner saw |
| `fx-s6-b-building.png` | 24.90s — three stages and their connectors, mid-build |
| `fx-s6-c-settled.png` | 25.75s — all four, settled, before the voice ends |

The two videos are ONE capture and two retimes, which is what makes them
evidence: same length to the millisecond (57.200s both), **byte-identical audio
stream** (`ffmpeg -map 0:a -f md5` agrees), and 1344 distinct frames before
against 1522 after. The fix moved no audio and changed no length; it only stopped
throwing away picture. The three `fx-` frames are the span that used to be a
single frozen frame followed by a jump.

## Regenerating

```sh
npm run build
node dist/cli.js plan demo/source.json --duration 60 --slides 12 \
  --narration-density low -o /tmp/sb.json          # ~1 min, needs Codex
node dist/cli.js narrate /tmp/sb.json --source demo/source.json \
  --narration-density low -o /tmp/a                # ~30s, needs edge-tts + network
node dist/cli.js build /tmp/sb.json --source demo/source.json \
  --narration /tmp/a/narration.json --duration 60 --narration-density low -o /tmp/d
node dist/cli.js render /tmp/d -o /tmp/d/video.mp4 --duration 60 --keep  # ~2 min
```

`--keep` leaves `.video.mp4.parts/raw.mp4`, which is what makes a second target
cheap: `render /tmp/d -o out70.mp4 --video /tmp/d/.video.mp4.parts/raw.mp4
--duration 70` takes seconds and needs no browser.

## The plans

`sb-real.json` is the Codex plan behind `real-plan-57s.mp4` (12 beats, mean 40.1
narration chars against a 47 budget). `sb-fix.json` is the run made with the
reverted RULE 8 sharpening in force — kept because it is the evidence that the
prompt fix did not work, and because `scanHeadlines` fires twice on it.
`sb-60.json` carries the hand-written narration.
