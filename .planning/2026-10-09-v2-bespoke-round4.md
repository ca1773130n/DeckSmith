# v2 bespoke scenes, round 4: staged shots, labels on subjects, flat pictures

2026-10-09. Branch `feat/v2-bespoke` (PR #112), after
[`2026-10-09-v2-bespoke-round3.md`](2026-10-09-v2-bespoke-round3.md). Round 3 built every
kept scene on a real illustration, but its camera drifted at 1.1-1.4x, its labels were
plates in a row along the top, one data beat painted a table over its picture (ja s12),
the pictures were soft 3D toy renders although flat art was asked for, nothing checked a
picture for text, three builds of four ran over ten minutes, and the pictures added
6-7 MB of PNG a deck. Preview: `~/.blackhole/DeckSmith/2026-10-07/preview/bespoke-r4/index.html`
(`http://localhost:8799/bespoke-r4/index.html`): v2, round 3 and round 4 per beat on one
narration clock with audio, contact sheets per round, every round re-measured with round
4's gates.

## What was built

1. **Staged shots** (`src/bespoke/shots.ts`). An illustrated scene no longer moves the
   camera; it names `shots` (cue, share of the cue, subject) and the shell compiles them
   in one grammar: an establishing shot of the whole picture for at least 1.6s, a push in
   (1.1s, power3.inOut) that frames the named subject and its label at 1.6-2.2x, a move
   straight to the next subject, a 3% creep while a shot is held, a reveal to the whole
   picture at the last cue. Every camera tween is a `fromTo` with explicit from-values and
   none touch (the first build had a creep end on the instant its move began: a lint
   warning on every scene and 1.5-2.9k px `seek_order`). Gate `shot_variety`: the camera
   is sampled every 0.5s (a seek and a read, no screenshot); a push-in counts when two
   consecutive samples hold 1.5x or closer on one point; a scene must open wide and hold
   push-ins on at least two subjects. Shots naming a missing cue or subject are dropped,
   and an `at` past 1 is read as seconds — two of five scenes of one run had fallen back
   on `"at": 3.2`.
2. **Labels on their subjects** (`src/bespoke/inspect.ts`, `src/bespoke/callouts.ts`). The
   subjects are found locally: the connected regions of the picture that are not its flat
   ground (~20-80ms). The picture is placed by the shell under a 120px band, so every
   subject has room for a label above it. The first run let the scene place its own labels
   on the subjects: they landed there (3-4 of 3-4 within 96px) and four scenes of five
   then failed on their own plates and leader lines crossing their own text. So the scene
   now says what each subject is called (`labels`) and the shell sets each name in a zone
   just above its subject — as wide as half the gap to each neighbour, 56px shrinking to
   44 then two lines — with a leader line to a dot on the subject, entering as the camera
   arrives. Gate `label_anchor`: a label naming a subject (`data-subject`) within 96px of
   its box, over no other subject by more than a quarter of itself, and at least two
   subjects named that way at the end.
3. **Data beats** (line-chart, bar-compare, data-table) get no picture and a prompt section
   for the chart that builds with the voice; the "growth" reference leads. Gate
   `data_over_picture`: five or more numbers on an illustration. ja s12 is now a building
   bar chart with its numbers counted in, no robot under it.
4. **Flat pictures.** The art prompt names the look by what it is made of (solid fills,
   hard edges) and forbids, by name, gradients, shading, shadows, gloss, 3D, clay and toy
   renders; subjects are drawn bigger and apart. Each picture is scored for flatness (the
   share of its subjects' pixels in their 16 commonest colours, minus the share that is
   soft shading) and redrawn once under 0.52. Calibration in the next section.
5. **Text in pictures**: macOS Vision through a Swift helper compiled once into
   `~/.cache/decksmith/tools`, one recognition pass per script (en, ko, ja, zh — one
   pass with all four read only Latin). A picture with writing is redrawn once with the
   writing quoted back; one with writing is never kept. Off macOS: `unchecked`.
6. **Speed and size.** All of a deck's pictures are asked for at once; the deck's copy is
   a WebP with its edges feathered into transparency (30-75 KB a picture instead of
   1.3 MB) — the CSS mask that feathered the PNG made every probe screenshot of its scene
   ~0.7s slower (13.5s against 4.1s for one scene's 13 frames); `build` skips the full
   motion probe on scenes the pass already gated at the same id (`gatedAt`); probe rounds
   draw their contact sheets in one Chrome; `bespoke.json` and the log carry each stage's
   wall clock. `seek_order` now counts changed AREAS (a pixel whose 8 neighbours also
   changed): a picture's first paint is rasterised a hair differently from later ones, an
   outline round every subject (12,698px raw, 2 runs in 3, identical DOM), which counted
   309 that way; v2's equation-walk leak is still caught. A plate too small for its text
   (rect or circle, also inside a translated group) is grown by the repair pass instead of
   sending the scene to critique.
7. **Variance**: one shot grammar and one label grammar for every scene, and every deck
   built twice from fresh caches.

The rubric probe no longer asks an illustrated scene for an 88px focal word (its focus is
the picture; asking sent clean drafts to a ~100s critique), and `type_hierarchy` does not
apply to one.

## Measured: the same four decks, twice each, fresh caches

Built with `decksmith build --design v2 --bespoke`, each deck twice (runs a and b), each run
from an empty cache, one build at a time; this Mac had 9-23% memory free throughout, with
other sessions' work running. Round 3 is its one run. "Push-ins" are the distinct push-ins
the camera holds in each illustrated scene (sampled every 0.5s); "labels" are subjects named
by a label within 96px of their box, against the two wanted (all were 30-37px away).

| deck | bespoke r3 → r4 (a / b) | illustrated | push-ins per scene, opens wide | labels on subjects | flat pictures (redraws) | text-in-picture rejections | fallbacks (a / b) | final `verify` | calls + pictures | tokens | build wall (pass) | pictures in the deck |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| en signal | 5/5 → 4/5 / 3/5 | 4 / 3 | 2,2,2,3 / 2,2,3, all wide | 3-4 of 3-4 / 3 of 3 | 5/5 (0) / 5/5 (0) | 0 / 0 | s2 / s2, s3 | PASS / PASS | 6+5 / 7+5 (r3 6+5) | 180k / 183k (r3 214k) | 667s (579) / 777s (675) (r3 644s) | 172 / 128 KB (r3 6.2 MB) |
| ko blueprint | 5/5 → 4/5 / 4/5 | 4 / 4 | 2,2,2,2 / 3,2,2,3, all wide | 2-3 of 3 / 3 of 3-4 | 5/5 (2 style) / 5/5 (0) | 0 / 0 | s7 / s5 | PASS / PASS | 7+7 / 5+5 (r3 8+5) | 227k / 178k (r3 230k) | 812s (730) / 577s (508) (r3 593s) | 288 / 188 KB (r3 6.7 MB) |
| zh atlas | 5/6 → 4/6 / 5/6 | 4 / 5 | 3,2,3,2 / 3,2,3,1*,2, all wide | 3 of 3 / 3 of 3 (1 of 1*) | 6/6 (0) / 6/6 (1 style, 1 touching) | 0 / 0 | s6, s11 / s6 | PASS / PASS | 8+6 / 7+7 (r3 9+6) | 225k / 226k (r3 325k) | 711s (635) / 621s (501) (r3 742s) | 276 / 348 KB (r3 6.5 MB) |
| ja journal | 5/5 → 5/5 / 5/5 | 3 / 3 (+2 data beats as charts) | 2,2,3 / 2,2,2, all wide | 3-4 of 3-4 / 2-4 of 3-4 | 3/3 (1 text, 1 style) / 3/3 (0) | 1 ("9002") / 0 | none / none | PASS / PASS | 5+5 / 6+3 (r3 7+5) | 153k / 155k (r3 215k) | 514s (402) / 466s (380) (r3 611s) | 148 / 148 KB (r3 6.2 MB) |

\* a picture whose inspection found one subject: one push-in is all it has.

Run a kept 17 of 21 beats, run b 17 of 21 (round 3: 20 of 21). The eight fallbacks, by
cause: a plate or token disc too small for its own text (en s2 twice — a disc —, ko s5, ko
s7, zh s6 in run a), the shell's leader line running through words the scene drew on its
subject (zh s11 in a, zh s6 in b), a word in a script (`sixty`, en s3 in b). After the two
measured runs the repair learned to grow a disc as well as a rect, inside a translated group
too, and the leaders were shortened to end just inside the subject's top edge. A
confirmation run of en and zh on that code kept 5 of 5 and 6 of 6 (en 544s, 209k tokens;
zh 718s, 243k); zh's final `verify` then failed on nothing but the machine's AudioContext
error, which `verify` now reports as a warning (the motion gates already did). One run each:
not proof that the fallback rate is back to round 3's.

**Variance.** Between runs a and b the bespoke count moved by one beat on en and zh and not
at all on ko and ja; every illustrated scene in both runs opened wide and held two or three
push-ins, and every one named at least two subjects on them; flat pictures 100% both runs.
The wall clock moved by 49-235s a deck, almost all of it in the Codex calls (the pictures
stage alone took 64-190s across runs: one image call 60-120s, a redraw another 60s).

**Size.** The pictures a deck carries went from 6.2-6.7 MB of PNG (measured in the round-3
decks' `assets/bespoke/`; round 3's note said 7-10 MB, counting its cache) to 128-348 KB
of WebP (target 1.5 MB); a whole deck is 4.3-5.3 MB, most of it narration audio and figures.

**Speed.** Build walls 466-812s; 3 of 8 measured builds under ten minutes (ko b, ja a, ja
b), plus the en confirmation run. Where a pass goes, from the stage clocks now in
`bespoke.json` (median of the eight): pictures 150s, drafts done at 260s, draft gates
~120s (of which the motion probe 65-145s and the deck `verify` 23-64s), critiques ~100s,
final gates 46-104s; then `build` emits in seconds and verifies in 62-119s. The two code
changes that cut the most: the WebP's baked-in feather (the CSS mask made every probe
screenshot of an illustrated scene ~0.7s slower: 13.5s against 4.1s for one scene's 13
frames) and `build` skipping the full motion probe on scenes the pass already gated
(~16s a scene). What is left is Codex latency on a shared account and Chrome screenshots on
a machine with little free memory; neither is fixed here.

## Calibration

- **Flatness** (`FLAT_MIN`): round 3's 21 renders scored 0.04-0.46 and one 0.557; 58 round-4
  pictures 0.48-0.84. Set first at 0.57, it refused two pictures at 0.56 and 0.565 that are
  flat by eye, each a 60s redraw; the 0.48 picture has soft shading on its figures. Now
  0.52: 20 of 21 renders refused, no flat picture seen refused. Thin margin both ways.
- **Text** (`isWriting`): with one Vision pass per script, the 21 round-3 pictures read no
  writing; "Loss", "step 3", 학습 단계, 学習の流れ and 训练过程 drawn onto one of them were
  all read; guesses on shapes (爪 on a tripod, ^, 4겹0ih) came back at confidence 0.3-0.5
  and one or two characters, under the bar. In the runs: one picture refused for "9002",
  redrawn clean.
- **Subjects**: boxed correctly on every round-4 picture looked at; pictures whose subjects
  touch merge into one box (round 3's shadows did that), which is why such a picture is
  redrawn.

## Every new gate and test fails with its change reversed

`~/.blackhole/DeckSmith/2026-10-09/r4-scratch/reverse.py` reverses 24 changes one at a time
(the shot thresholds and the held-shot rule, the establishing check, the label distance and
end coverage, data over picture, data beats illustrated again, the flatness and writing
checks and their redraws, WebP, pictures waiting for lanes, the script touching the
camera, labels and shots required, label fitting, the area-based seek count, the type
exemption, the label band, camera tweens touching, the CSS feather on a feathered picture,
plate and disc growth, long leaders, and — with `dist/` rebuilt — the shell's camera and
the shell's labels against the illustrated reference in a real deck): all 24 caught. Two
were missed at first (a camera in transit; `data_over_picture` asserted at the threshold
plus four) and their tests were tightened.

## Against the founder's bar

Closer. Every illustrated scene is now staged the way an explainer is cut: the whole
picture, a push in on the thing the voice names with its name landing on it, the next
thing, the whole again for the summary; labels sit on their subjects with a leader to a dot;
the pictures are flat vector art, clean of writing; the one data beat that painted a table
over a robot is a building bar chart. Still short, honestly:

- **Fallbacks went up**, 4 of 21 a run against round 3's 1, because the gates got stricter
  and the shell's labels added a way to collide. The fixes after the runs went 11 of 11 in
  one run each on two decks; that is a hint, not a rate.
- **Repetition.** One shot grammar for every illustrated scene means every one of them
  moves alike — establish, two or three push-ins, reveal. That is the grammar asked for,
  and it is also the "same animation every card" the founder dislikes, one level up. No
  second grammar (a slow pan along a process, a reveal that starts close) exists yet.
- **Pictures**: flat, but iconic — the illustrator reaches for the same friendly robot in
  most beats, and the pictures are spot illustrations on a plain ground rather than scenes.
  At 1.6-2.2x a 1672px picture is upscaled on a 1080p frame and the push-ins look soft.
- **Words**: the shell's names are 44-56px and read small in the reveal's whole view; scenes
  still draw some words of their own in the label band (en s7's "GPT-4o", "answer"), which
  then compete with the names.
- **Data beats** are clean charts that build, but plain: no camera, no picture, the same
  bar-growth verbs.
- **Ten minutes**: 3 of 8 measured builds; the rest 621-812s.
- Not measured: an mp4 render or `drift` of a bespoke deck; the text check off macOS (it
  reports `unchecked`).
