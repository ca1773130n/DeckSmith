# v2 bespoke scenes, round 3: illustration, camera, repair

2026-10-09. Branch `feat/v2-bespoke` (PR #112), after
[`2026-10-08-v2-bespoke-round2.md`](2026-10-08-v2-bespoke-round2.md). Round 2 filled the
frame but still spoke in labelled cards and connectors; real illustration appeared once,
no scene used the camera, 4 of 21 beats fell back on label collisions, and some scenes
ended dimmed. Preview: `~/.blackhole/DeckSmith/2026-10-07/preview/bespoke-r3/index.html`
(`http://localhost:8799/bespoke-r3/index.html`): v2, round 2 and round 3 per beat on one
narration clock with audio, contact sheets per round, every round re-measured with round
3's gates.

## The image path: the account's own Codex image tool

Founder rule: no paid API key. Three options were checked in order.

1. **Codex `image_generation` through the connected account** — chosen. codex-cli 0.160
   lists `image_generation` as stable; `codex exec` on the user's own login drew a
   1536x1024 or 1672x941 PNG. MEASURED 2026-10-09, three probes: with the shell and the
   `$imagegen` skill 36s and 25.5k tokens; tools off except the image tool, asked to
   inspect the picture and box its parts, 49s and 45k; tools off, no inspection, 42s and
   19k. The production call is the last shape; in the four decks below the calls took
   42-57s. The pictures are what the founder asked for: concrete subjects doing the
   method (robot arms lifting lids, a lens over three blocks, cups copying a stain), on
   the pack's flat ground, no text. The prompt asks for flat vector art; what comes back
   is closer to soft 3D toy renders — consistent within a deck, not flat.
2. LLM-written SVG illustrations — not needed. A text model asked for SVG draws the same
   cards with more paths; that is round 2's look.
3. A local open image model — not tried: this Mac had 9-23% memory free during the work,
   with another agent's renders running, and option 1 already worked.

HypePaper's `ai_accounts` (cliproxy) was read, not used: its config ships with
`disable-image-generation: false` and an `/v1/images/generations` route, but going
through it from DeckSmith would add a credential path; `codex exec` is the path the
scenes already use.

## What was built

- `src/bespoke/art.ts`: one picture per bespoke beat (cap `--bespoke-art`, default 6),
  before its draft; the beat fenced as untrusted; the picture read back only from
  `$CODEX_HOME/generated_images/` (realpath), only as a PNG, under 12 MB; cached by
  content; the scene places it with `<image data-art="1">` and the shell writes the href
  and feathers its edges. The draft call is shown the picture (`-i`).
- A fifth reference, "illustrated": masked wipe, drift, camera push-in, a spotlight
  (shade with a soft mask hole), callout drawn on, pan, vector nodes over the picture,
  home for a counter. Passes every gate in a real deck with a real picture.
- The shell's camera, `#sN-cam`: scale/x/y from the top-left; the body clips while it
  moves and is marked `data-ds-clip`, so `verify` stops calling what a push-in carries
  past the canvas off-canvas (it was failing every camera scene, which sent them to a
  critique that removed the camera).
- `src/bespoke/repair.ts` and `untangle.ts`, no model call: label nudges (constraint
  relaxation over every measured frame, at most 0.8 of the label's height), relight of a
  dimmed end, camera home, and untangling two tweens that fight over one property (the
  commonest `seek_order`). A failing draft that only needs a repair skips the critique.
- Gates: `end_dimmed` (parts lit earlier, left under 0.6 at the end), `camera_end`.
- Pass hygiene that measurably mattered: the machine's AudioContext error no longer fails
  every scene (it sent all five drafts of one deck to critique); a console error quoting a
  value found in one candidate fails only that one; path data must be path data.

## Measured: the same four decks, final code, fresh caches, one run each

| deck | drawn | illustrated | camera | fallbacks without → with repair | final `verify` | calls | tokens | pass | build wall | pictures |
|---|---|---|---|---|---|---|---|---|---|---|
| en signal | 3 → 5 of 5 | 5 | 0 → 5 | 0 → 0 | PASS 0 errors | 6 + 5 art | 214k | 480s | 644s | 7.0 MB |
| ko blueprint | 4 → 5 of 5 | 5 | 0 → 5 | 1 → 0 (s7, a label nudged) | PASS 0 errors | 8 + 5 art | 230k | 475s | 593s | 9.6 MB |
| zh atlas | 6 → 5 of 6 | 5 (6 drawn) | 0 → 5 | 1 → 1 (s6: the critique wrote a `<foreignObject>`) | PASS 0 errors | 9 + 6 art | 325k | 579s | 742s | 10 MB |
| ja journal | 4 → 5 of 5 | 5 | 0 → 5 | 0 → 0 | PASS 0 errors | 7 + 5 art | 215k | 507s | 611s | 10 MB |

"drawn" is round 2 → round 3. Fallbacks: 4 of 21 in round 2, 1 of 21 here. Under round 3's
gates round 2's kept scenes carry `end_dimmed` six times (lit-then-dimmed parts at the end
up to 70%); round 3's carry no finding. 12 of 20 kept scenes needed no critique call.

Earlier runs of this round, kept in `preview/bespoke-r3/prev-runs/`, are why the last
three bullets above exist: the first en run fell back on two beats because the critique
removed the camera to satisfy `canvas_overflow`, and a later one sent all five drafts to
critique over one draft's `d="M 95 240 H  sixty"` and, another time, over the AudioContext
error. Run-to-run variance is still about one beat per deck.

## What the numbers say, and do not

- Targets: tokens 214-325k (cap 350k) and the pass 475-579s are inside them. The whole
  `build` is 593-742s: only ko is under ten minutes. The 115-165s outside the pass is the
  build and `verify` of a deck carrying 7-10 MB of pictures; zh also has a sixth beat that
  waits for a lane (concurrency 5).
- Fallbacks ≤1/21: met in this run (1/21), not proven across runs.
- The pictures are PNGs at 1.3-2 MB each: 7-10 MB per deck. Not fixed here; a WebP pass
  would cut that by about ten.
- Not gated: text inside a picture (the prompt forbids it; none was seen in the 21 pictures at
  contact-sheet size, which would not show a small mark), whether a picture is the right picture for its sentence, and
  whether a label sits well on the picture (plates are asked for, not measured).

## Against the founder's bar

Closer: every kept scene is built on a real illustration of the idea in action, revealed
and toured by a camera, with spotlights, callouts drawn on, vector mechanisms on top and a
fully lit summary at the end. The best (en evaluation gap, ko positive/negative pairs, zh
exposure-bias cups) read as explainer motion design, not slides. Still short: the camera
mostly pans at 1.1-1.4x rather than staging a shot; labels are plates in a row along the
top more often than placed on the subject; some data beats paint a table over the picture
(ja latency) and look crowded; and the ten-minute wall is met by the pass, not the build.
