# Moving the hyperframes pin, 0.7.90 to 0.8.27

**Date** 2026-09-04. Issue #35 asked for four checks beyond CI, "because CI does
not render, and every structural failure so far has been invisible to `lint`".
All four were run. Three pass outright; the fourth cannot be met by EITHER
version, and finding out why corrected a claim in `.planning/2026-09-04-
invariant-11-under-beginframe.md`.

## 1. Build one deck, gates clean — PASS

The demo deck builds `PASS — 0 error(s), 9 warning(s)` on 0.8.27. Same verdict,
same nine `content_overlap` infos, at the same nine timestamps, as 0.7.90.

Typecheck, lint and 1272 unit tests pass on the new pin with no source change.

## 2. The emitted deck is unchanged — PASS

Built the same storyboard on both pins and compared. Identical structure: 12
scenes, 37 holds, 12 slides, 37 fragments, 12 speaker notes, and byte-identical
`vendor/gsap.min.js` and `vendor/katex.min.js`.

**A near-miss worth recording.** The first comparison showed `timing.json` at
17,246 bytes against 2,029 and `deck.html` at 29,520 against 17,378, which reads
as the bump gutting the output. It was not the bump. The main working tree has a
`demo/audio/` directory left by an earlier `narrate` run and a fresh worktree does
not, so one build was a 211-second narrated deck and the other a 104-second silent
one. **Compare builds from trees whose sidecar directories match, or the diff is
measuring the tree rather than the pin.**

## 3. `player.seek()` still behaves — PASS

Issue #35 singles this out because the step layer in `src/deck/` rests on it. No
unit test opens a browser, so a probe does: read the slideshow island's fragment
stops out of `deck.html`, seek each one, and fingerprint every scene's inline
style after each seek.

The check is not "seek did not throw" — a seek that silently no-ops leaves every
gate green and stops the deck stepping. It is that the document MOVES.

| pin | fragment stops | transitions that moved the document |
| --- | --- | --- |
| 0.7.90 | 37 | 13 of 13 |
| 0.8.27 | 37 | 13 of 13 |

The 0.7.90 row is the control, and it is the reason the 0.8.27 row means
anything.

## 4. Two renders byte-identical — NEITHER VERSION PASSES

```
0.7.90   11 of 3120 frames differ, worst 43.53 dB at frame 1161
0.8.27  166 of 3120 frames differ, worst 83.90 dB at frame 1905
```

Both fail `drift --identical`. **This is not a regression the bump introduced** —
the control fails too, on a deck built from the same storyboard by the same
command.

Read on the gate that actually runs, the 40 dB PSNR floor, 0.8.27 is the better
of the two by a wide margin:

| pin | frames differing | worst | margin over the floor |
| --- | --- | --- | --- |
| 0.7.90 | 11 | 43.53 dB | **3.5 dB** |
| 0.8.27 | 166 | 83.90 dB | **44 dB** |

More frames differ under 0.8.27, and every difference is far milder. Fifteen times
the count, at a fortieth of the severity. If one number has to be the gate, the
worst frame is the one that decides whether a build fails, and 0.8.27 moves it
from three and a half decibels of headroom to forty-four.

**So issue #35's fourth requirement describes a deck that no longer exists.** It
should be rewritten to ask for the PSNR floor, which is what `drift` defaults to
and what the README already says is the honest gate for a deck carrying images —
this one carries two.

## 5. Invariant 11, re-run — UNCHANGED

`.planning/2026-09-04-invariant-11-under-beginframe.md` pinned its result to
0.7.90 and said to re-run it with this bump, because capture semantics are exactly
what moves across thirty minor versions. Re-run, on the same emitted-case deck —
a band painted only from a GSAP `onUpdate` inside scene `s3`'s own timeline
construction:

| | `frames` | `snapshot` | render: first red | mid-ramp frames | max |
| --- | --- | --- | --- | --- | --- |
| 0.7.90 | (11,13,17) | (143,4,5) | frame 474 | 72 | 205 |
| 0.8.27 | (11,13,17) | (143,4,5) | frame 474 | 72 | 205 |

Identical, frame for frame. The render log still reports
`"captureMode":"beginframe"` and `"forceScreenshot":false`, so the mechanism the
finding rests on is the same one. **Everything in that note stands at 0.8.27** and
its "pinned to 0.7.90" caveat can be dropped.

## What this corrected elsewhere

Running the control is what exposed the error corrected in PR #50: an earlier note
claimed a callback-driven tween "costs byte-identity", against a plain deck quoted
as 3120 of 3120. The plain deck is 3109 of 3120, and the 43.53 dB worst frame
belongs to the deck rather than to any callback — identical figure, identical
frame, present in the control.

The css3d spike reports the same 3120 of 3120 baseline and should be re-read with
that in mind.

## Not established

- **Whether byte-identity is flaky or was lost.** The css3d spike measured 3120 of
  3120 on this deck hours earlier the same day. Today it is 3109. Either something
  in the PRs between changed it, or byte-identity on this machine flips between
  runs under load. Not determined. Either way `--identical` is not a property this
  deck currently has.
- **Anything about 0.8.x's own new surface.** This checks that what DeckSmith
  already does still works. It does not explore what thirty minor versions added.
