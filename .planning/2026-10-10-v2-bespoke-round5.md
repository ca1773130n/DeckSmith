# v2 bespoke scenes, round 5: shot grammars, two-layer pictures, readable labels, data builds

> Followed by [round 6](2026-10-10-v2-bespoke-round6.md): the picture moves (depth planes, rack focus, light), no animated UI, quiet type. The numbers below are round 5's.

2026-10-10. Branch `feat/bespoke-r5`, after
[`2026-10-09-v2-bespoke-round4.md`](2026-10-09-v2-bespoke-round4.md) (PR #112, merged). It
carries decksmith-71's device-pass commit (`assignDevices`, cherry-picked from
`feat/animate-piece`), because the camera grammar and the picture plan ride in that same
pass. Round 4 staged every illustrated scene in one grammar, drew a friendly robot in 34 of 38
pictures, set 44-56px names that read small in the whole view, and built every data beat the
same way. Preview: `~/.blackhole/DeckSmith/2026-10-07/preview/bespoke-r5/index.html`
(`http://localhost:8799/bespoke-r5/index.html`). It shows v2, round 4 and round 5 per beat
on one narration clock with audio, contact sheets per round, and the r4/r5 table below.

## What was built

1. **Shot grammars** (`src/bespoke/grammar.ts`, compiled in `src/bespoke/shots.ts`). There
   are seven, each a camera the shell owns:
   - `tour`: round 4's establish, push-ins, reveal.
   - `follow`: a push in, then a track of at least 2.4s along the subjects at one scale.
   - `rack`: A, a whip to B, back to A when there is time, then a held medium two-shot.
   - `zoom-out`: opens close on the detail and only pulls back.
   - `wipe`: the picture wipes on subject by subject while the camera stays wide.
   - `cutaway`: instantaneous cuts to close inserts and back.
   - `parallax`: a continuous lateral truck at 1.32x.

   A beat's rhetorical role (compare, cause, process, reveal, quantify, define) comes from its
   archetype and its narration's own words in en/ko/zh/ja. `chooseGrammar` picks the role's
   best fit that the deck has not used and that is never the previous grammar. It runs inside
   `assignDevices`, in deck order. Each later beat's `priorDevices` gets `camera-<grammar>`
   (and `build-<build>`). The shell stamps `data-ds-grammar` on the scene.

   Gates:
   - `shot_variety` reads the grammar back off the camera's 0.5s samples (a follow must
     track, a rack come back or hold a two-shot, a cutaway jump wide-to-close between two
     samples, a zoom-out never push in, a wipe wipe, a truck travel 12%), and checks that the
     backdrop moves less than the subjects.
   - `verify` refuses two consecutive illustrated scenes in one grammar (`grammar_repeat`)
     and warns under four distinct (`grammar_diversity`).

   A 200-scene randomized test holds every grammar to its own promise on any cue layout and
   shot list. That test found five compile bugs before the measured runs:
   - follow's float compare;
   - a 0.12s "cut" caught mid-move;
   - a two-shot at 1.7x;
   - late-named shots dropped instead of fitted;
   - neighbours framed onto one view at the box edge.
2. **Two-layer pictures, planned per deck** (`src/bespoke/art.ts`, `src/bespoke/sheet.ts`).
   One art call now draws two pictures. The first is a backdrop: the setting, with depth and
   no subjects. The second is the subjects, drawn with the tool's `transparent_background`
   and the backdrop as a reference image. The shell draws the backdrop behind the camera's
   wrapper and moves it at half the camera's zoom (parallax). The device pass also returns a
   `setting` and `subjects` per illustrated beat, planned together so no two are alike. Stock
   stand-ins (robots, mascots, brains, light bulbs, gears, screens) are forbidden unless the
   beat names one. A picture is redrawn once, told what the rest of the deck shows, if it
   draws a stock stand-in, shares a subject noun with another picture, or sits closer than
   `SIMILAR_MAX` (0.45) to one by macOS Vision's feature print.
3. **Picture floor** (`pictureFloor`, agreed with decksmith-71). The device model marked no
   beat for a picture in 4 of 4 decks of one run: every scene was pure motion graphics. When
   it marks fewer than min(art cap, 3, ceil(eligible/2)), the floor forces the next eligible
   beats, alternating. It names them in the report (`devices.note`, `pictureForced`). It
   fired in every measured run.
4. **Labels** (`src/bespoke/callouts.ts`). They are now 64px, shrinking to 52 (they were 56
   to 44). The top 120px is the caption band, where the scene draws its own words, and labels
   never go there. A label goes above its subject under the band, else below it, else across
   its top. Each label is held at 1/sqrt(s) of the camera's zoom, so on screen it grows by
   sqrt(s) in a push-in and is exactly its size in the whole view. `label_size` holds every
   label to 52px as rendered at every graded frame. `label_band` refuses a label in the band,
   or the scene's own words within 24px of one; the deterministic repair nudges the scene's
   words 26px clear.
5. **Sharpness cap** (`sharpMax`, `EFF_MIN` 0.6). The image tool exposes no size: it draws
   ~1.57 megapixels whatever it is asked (1672x941, 2048x768, 1915x821 all measured). So no
   push-in goes past the scale where a picture pixel spans more than 1/0.6 output pixels,
   creep included. The report gives each scene's effective resolution at its closest shot.
6. **Data builds** (`src/bespoke/databuild.ts`). There are four: a bar race, a line drawn
   with a callout, the delta highlighted, and small multiples. Each data beat of a deck gets
   its own build. The build is declared on the chart (`data-build`) and checked statically
   with its marks, and the camera must push in on the value named. `verify` refuses two data
   scenes of a deck that build alike (`build_repeat`).

## Measured: the same four decks, twice each, fresh caches

Built with `decksmith build --design v2 --bespoke`, one deck at a time, each run from an
empty cache. The Mac had 11-25% memory free. Round 4's two runs are re-measured with round
5's in-page probe (`measure.ts`: rendered label size, closest camera scale). Picture
similarity is Vision feature-print distance, with every picture laid on one grey ground;
higher means more different.

| deck run | bespoke | grammars (distinct) | adjacent repeats | print distance min / mean | effective px at closest shot | label px min / end | data builds | fallbacks | verify | calls + pictures | tokens | wall (pass) | deck |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| en r4a | 4/5 (4 pictured) | 1 of 4 | 3 | 0.52 / 0.57 | 0.60 | 44 / 44 | – | s2 graphic_crosses_text | PASS | 6+5 | 180k | 667s (579) | 5.1 MB |
| en r4b | 3/5 (3) | 1 of 3 | 2 | 0.55 / 0.66 | 0.60 | 44 / 44 | – | s2 graphic_crosses_text; s3 script_global (`sixty`) | PASS | 7+5 | 183k | 777s (675) | 5.1 MB |
| en r5a | 5/5 (3) | 3 of 3 rack, follow, wipe | 0 | 0.62 / 0.75 | 0.63 | 54 / 54 | – | none | PASS | 7+3+1 redraw | 268k | 638s (544) | 5.3 MB |
| en r5b | 5/5 (3) | 3 of 3 rack, follow, wipe | 0 | 0.68 / 0.73 | 0.60 | 52 / 52 | – | none | PASS | 6+3+1 | 233k | 596s (506) | 4.9 MB |
| ko r4a | 4/5 (4) | 1 of 4 | 3 | 0.58 / 0.67 | 0.60 | 56 / 56 | – | s7 graphic_crosses_text | PASS | 7+5+2 | 227k | 812s (730) | 5.1 MB |
| ko r4b | 4/5 (4) | 1 of 4 | 3 | 0.54 / 0.68 | 0.60 | 54 / 54 | – | s5 graphic_crosses_text | PASS | 5+5 | 178k | 577s (508) | 5.1 MB |
| ko r5a | 5/5 (3) | 3 of 3 follow, rack, cutaway | 0 | 0.76 / 0.83 | 0.69 | 64 / 64 | – | none | PASS | 8+3 | 250k | 615s (549) | 4.8 MB |
| ko r5b | 5/5 (3) | 3 of 3 follow, rack, cutaway | 0 | 0.83 / 0.87 | 0.58* | 64 / 64 | – | none | PASS | 9+3+1 | 251k | 789s (671) | 4.7 MB |
| zh r4a | 4/6 (4) | 1 of 4 | 3 | 0.55 / 0.66 | 0.60 | 56 / 56 | – | s6, s11 graphic_crosses_text | PASS | 8+6 | 225k | 711s (635) | 4.6 MB |
| zh r4b | 5/6 (5) | 1 of 5 | 4 | 0.55 / 0.66 | 0.60 | 56 / 56 | – | s6 graphic_crosses_text | PASS | 7+6+1 | 226k | 621s (501) | 4.7 MB |
| zh r5a | 5/6 (3) | 3 of 3 rack, follow, wipe | 0 | 0.74 / 0.82 | 0.69 | 56 / 56 | – | s11 graphic_crosses_text (its own shape over its own caption, after critique) | PASS | 9+3+1 | 293k | 689s (607) | 4.5 MB |
| zh r5b | 6/6 (3) | 3 of 3 rack, follow, wipe | 0 | 0.86 / 0.94 | 0.68 | 58 / 58 | – | none | PASS | 7+3+1 | 232k | 664s (534) | 4.5 MB |
| ja r4a | 5/5 (3) | 1 of 3 | 2 | 0.49 / 0.63 | 0.60 | 44 / 44 | grow, grow | none | PASS | 5+3+2 | 153k | 514s (402) | 4.2 MB |
| ja r4b | 5/5 (3) | 1 of 3 | 2 | 0.49 / 0.58 | 0.60 | 46 / 46 | grow, grow | none | PASS | 6+3 | 155k | 466s (380) | 4.2 MB |
| ja r5a | 5/5 (2) | 2 of 2 rack, cutaway | 0 | 0.88 / 0.88 | 0.63 | 60 / 60 | delta, line-callout | none | PASS | 6+2 | 166k | 486s (411) | 4.0 MB |
| ja r5b | 5/5 (2) | 2 of 2 rack, cutaway | 0 | 0.68 / 0.68 | 0.68 | 64 / 64 | delta, line-callout | none | PASS | 6+2 | 185k | 441s (391) | 4.0 MB |

\* ko r5b's 0.58 was a held shot's 3% creep taking it past the cap. The cap now leaves room
for the creep: the compiled framing is held under `sharpMax / 1.03` (tested). It is never
framed under 1.55x, though: a 1536x1024 picture would otherwise cap push-ins under the gate's
1.5x, and on such a picture staging wins over the last hundredths of sharpness. Both changes
came after the measured runs, which were not rebuilt for them; the unit tests and the
references' in-browser test cover them.

- **Fallbacks.** Round 5 had 1 in 42 beats over 8 runs (zh r5a s11: its own shape painted
  over its own caption, still there after the critique round). Round 4 re-read had 8 in 42.
  The target of at most one per deck per run is met in all 8 runs.
- **Variety.** Every pictured scene in every r5 run has its own grammar, with 0 adjacent
  repeats; round 4 had 2-4 per run. The picture print distance rose from a 0.49-0.58 closest
  pair to 0.62-0.88. No r5 picture shows a robot. 5 pictures were redrawn once: 2 as repeats
  (en a: a second "camera"; zh a: a second "press"), 2 for writing in them ("PI"; "1111"),
  and 1 because its subjects touched.
- **Labels.** The smallest label rendered over every graded frame went from 44-56px to
  52-64px.
- **Sharpness.** It did not really improve, and that is measured. Round 4's push-ins sat at
  1.65x (frameOn's floor plus the creep) on 1672x941 pictures, 0.60 picture px per output px.
  Round 5's wider 2048x768 pictures cover the box at k≈0.84 and land at 0.58-0.69. The tool
  will not draw bigger, so a push-in close enough to read as one will always upscale a
  little. The cap only guarantees the floor.
- **Wall.** Builds took 441-789s. 3 of 8 were under ten minutes (en b, ja a, ja b) and 7 of 8
  under 11.5. ko r5b was 789s: a critique and a repair round. Tokens are up 0-35% (166-293k
  against 153-227k). The extra cost is the device call, two-picture art calls (~80s each,
  against ~60s), and the repetition redraws (~85s on the critical path each).
- **Size.** Decks are 4.0-5.3 MB. Pictures are 236-508 KB per deck (two layers each).

Two measured series were thrown away, and both are kept under `aborted-*` in the deck dirs.
In the first, the device model gave 0 pictures in en and ko, which led to the picture floor.
In the second, en a fell back on a follow that never tracked, which led to the compile fixes
and the randomized test.

## Every new gate and test fails with its change reversed

`~/.blackhole/DeckSmith/2026-10-10/r5-scratch/reverse.py` reverses 45 round-5 changes one at
a time and runs the test that should catch each one. All 45 are caught.

The changes reversed:
- each of the six grammars compiled as `tour`;
- the backdrop zooming with the camera;
- no sharpness cap, or a creep past it;
- grammars allowed to repeat;
- no grammar, or no `camera-…` entry in `priorDevices`, in the device pass;
- data builds repeating, or needing no camera or marks;
- the deck variety gates blind;
- `label_size` / `label_band` never firing;
- each grammar's read-back blind, and the depth check blind;
- the rubric asking push-ins of every grammar;
- labels at 56/44 again, in the caption band, or not held against the zoom;
- the rendered size ignoring the camera, which needs `dist/` and the illustrated reference in
  a real deck;
- no backdrop asked for;
- stock or shared subjects allowed, the illustrator not told what the deck shows, and
  pictures claimed after an await;
- no backdrop layer, it not moving, no grammar stamp, a CSS feather on a cutout, or a cutout
  not laid on the ground;
- neighbours framed onto one view, and late shots not fitted;
- no picture floor;
- `label_band` not repaired.

The first full pass missed four. Two were equivalent mutants (a redundant guard in
`chooseGrammar`, and an early claim the later one covered): both were removed as dead code.
Two were gates whose test was shadowed by another check (a zoom-out that pushes back in, a
wipe that never uncovers): each got its own test.

## Against the founder's bar

Closer on variety and on readability, measured. Neighbouring scenes now move differently: a
rack weighing two things, a camera travelling a process, a picture wiped on as it is named,
cuts to the thing measured. No robot was drawn in 8 runs. The pictures stand in settings.
Names read at 52-64px in the whole view. Two data beats build differently and push in on the
number. Still short, honestly:

- **Pictured scenes are fewer.** The device pass gives 2-3 pictures a deck (round 4 gave
  3-5); the rest are pure motion graphics by design. The model's own illustrate choice was 0
  in most decks, and the floor did the picking.
- **Subjects still stand in a row.** The subjects detector needs empty ground between them,
  so they do not touch, and a few pictures read as a catalogue of tiles (ko s7: cat and
  rabbit cards). "Interacting" is said by pose, not by contact.
- **Backdrops are quiet and dark** in the dark packs. They are barely visible behind the
  subjects, and the parallax is real but subtle.
- **Grammars repeat across decks.** The first pictured beat is a `rack` in 3 of 4 decks,
  since compare is the commonest role there. `zoom-out` and `parallax` were never chosen in
  these decks; they are tested, not seen.
- **Sharpness is limited by the tool**, as above.
- **Ten minutes** was met in 3 of 8 builds.
- **Not measured:** an mp4 render or `drift` of a bespoke deck, and the text and print checks
  off macOS (they report `unchecked`).
