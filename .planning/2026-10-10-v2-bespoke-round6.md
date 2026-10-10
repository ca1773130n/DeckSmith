# v2 bespoke scenes, round 6: the picture moves, not UI over it

2026-10-10. Branch `feat/bespoke-r6`, after
[`2026-10-10-v2-bespoke-round5.md`](2026-10-10-v2-bespoke-round5.md) (PR #113, not merged).
It carries decksmith-71's `5117f15` (`TYPE_SCALE`, cherry-picked unchanged). Preview:
`~/.blackhole/DeckSmith/2026-10-07/preview/bespoke-r6/index.html`
(`http://localhost:8799/bespoke-r6/index.html`): v2, round 5 and round 6 per scene on one
narration clock with audio, contact sheets, and the table below.

The founder on round 5: "your deck slides still suck. Graphic animation by animated UI
elements is fucking old-fashioned, and the fonts are too large." Round 6 is a change of
direction, not polish: the motion comes from the imagery; labels, plates, chips, pills,
leader lines and growing bars go; the type is quiet.

## Choosing the technique

Candidates, judged by what runs on this Mac (M4, often under 15% memory free) with no paid
API, deterministically, inside the existing seek-only capture and DOM gates:

| technique | evidence | verdict |
|---|---|---|
| Image-to-video diffusion (SVD, CameraCtrl, MOFA-Video, FloVD) | multi-GB weights, minutes per clip on a GPU; sampled, so not deterministic; ships video bytes | rejected: cannot run here, breaks `drift` |
| Keyframe pictures + interpolation (FILM/RIFE) | one more image call per beat (~80-100s each, the AI budget is over pace); two independently drawn keyframes wobble when morphed | rejected for this round |
| WebGL mesh displacement | the 2026-09-09 spike: deterministic on this machine, but Metal and SwiftShader differ by 39.7-41.8 dB, a canvas is invisible to every DOM gate, and three.js is 537 KB a deck | rejected: the gates would go blind |
| **Depth-estimated 2.5D camera (3D Ken Burns, Niklaus et al. 2019) as a multiplane image (Zhou et al. 2018; Tucker & Snavely 2020)** | Depth Anything V2 Small (Yang et al. 2024), Apple's Core ML F16 build: 1.5s and 156 MB a picture on the CPU, and a clean depth of round 5's flat vector rooms (spike image `sp1`). Round 5's pictures are already two layers, so the subjects need no inpainting behind them. For fronto-parallel planes a pinhole camera's homography is a scale and an offset: a CSS transform per plane, tweened like round 5's camera | **chosen** |
| **Layered illustration rig + light** (subjects on their own planes, breathing; rack focus; a light sweep) | free once the planes exist; a CSS `filter: blur()` cost 1.5s a frame in the gates' browser (measured below), so focus is a cross-fade to a blurred twin | **chosen** (with the above) |
| Local upscaling (Real-ESRGAN, Wang et al. 2021) | `realesr-animevideov3` x2 via its ncnn/Vulkan build: 1.6s and 129 MB a picture; crisp edges where Lanczos was soft (spike crop `cmp`) | **used**: pictures are upscaled before slicing |

HypePaper was searched first (3D photography, 3D Ken Burns, Depth Anything V2, 3D
Cinemagraphy, LayerAnimate, camera-controlled video diffusion, frame interpolation,
Real-ESRGAN); the primary papers above are the ones the choice rests on.

## What was built

1. **Depth planes** (`src/bespoke/depth.ts`, `src/bespoke/sheet.ts` `depthPlanes`). The
   kept picture's backdrop goes through Depth Anything V2 Small (a Swift helper, compiled
   once, CPU only); the backdrop is cut at its depth quantiles (0.5, 0.82) into up to three
   planes, never two closer than 0.12 in depth; each plane holds its band's pixels and,
   where a nearer band covers it, colours pushed and pulled in from its own band at quarter
   size (what a nearer plane uncovers as it slides); each subject is cut onto its own plane
   at the depth of its foot on the backdrop's floor, held in front of the farthest band
   (`referenceDepth`). Distances: the subjects' plane is 1, others 0.8-3. Both pictures are
   upscaled 2x first. Everything is optional: without the model or the upscaler (off macOS,
   CI) the backdrop is one plane at distance 2, and `bespoke.json` says why.
2. **The camera through the planes** (`src/bespoke/shots.ts`). Every camera tween has a twin
   on each plane at `planeFrame` — the exact pinhole projection of the camera's framing at
   that plane's distance. No plane ever needs enlarging to cover the frame: a plane's edge
   lands outside the frame's exactly when the camera's own framing covers the box (proved
   in `planeFrame`'s comment, held by a 500-case test). Rack focus: each plane cross-fades
   with a blurred twin by its distance in dioptres from the subject framed (`softAt`). A
   light sweeps once; the subjects breathe a few px at their own periods, home before the
   end. A `wipe` lights the subjects in turn instead of clipping the picture.
3. **Full-frame scenes** (`src/bespoke/scene.ts`). The picture covers the frame behind the
   deck's headline, which keeps its place and its entrance over a soft scrim; a lower scrim
   sits under the subtitles. The shot comes before the headline in the document, so nothing
   the picture paints is "over" it.
4. **No animated UI, quiet type.** The shell's label plates and leader lines
   (`src/bespoke/callouts.ts`) are deleted. A scene's own layer is fixed to the frame, holds
   at most two short phrases or one number at 40-56px, fading in place; the draft prompt says
   an empty layer with good shots is a complete answer. New gates: `ui_motion` (the scene's
   GSAP timeline animates no label, plate, chip, card or bar into place — read off its
   tweens' targets and properties) and `type_scale` (no word renders above the 56px
   headline, its camera's zoom included), both as errors; static `type_scale` in the
   contract. Deleted: round 2's 64px `type_hierarchy`, `label_size`, `label_band` and the
   end-of-scene `label_anchor` requirement.
5. **Pictures on every bespoke beat**: every beat with two cues, data beats included (the
   illustrator is told the subjects ARE the quantities, in proportion); the art prompt asks
   for 16:9, a lit setting with near/middle/far layers (on a dark pack: night but visible),
   and subjects composed in depth, not in a row. A picture whose subjects merged into one is
   staged as a zoom-out.

## Measured: the same four decks, twice each, fresh caches

Built with `decksmith build --design v2 --bespoke`, one deck at a time, each from an empty
cache, at `79f63be`; the Mac had 13-23% memory free. Both rounds are measured by round 6's
probe (`harness/measure6.ts`): **imagery-driven motion** is the share of the kept bespoke
scenes' tween-seconds that move the picture (the shell's camera on a pictured scene, its
planes, their focus twins, the breathing, the light, a wipe) rather than labels, plates or the
scene's own overlay; **UI-overlay animations** is the `ui_motion` gate's list summed over a
deck (round 5's are mostly its label plates' scale tweens and leader-line tags); **largest
scene word** is the biggest word a bespoke scene renders at any graded frame (the headline,
in brackets, is the deck chrome's, which decksmith-71's branch is bringing to 56px).

| deck run | bespoke (with imagery) | imagery-driven motion | UI-overlay animations | largest scene word (headline) | effective px, closest shot (min) | camera grammars | fallbacks and causes | verify | calls + pictures | tokens | wall | deck (pictures) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| en r5a | 5/5 (3) | 24% | 32 | 125px (70px) | 0.65 | rack, follow, wipe | none | PASS — 0 error(s) | 7+3 | 268k | 638s | 5.3 MB (296 KB) |
| en r5b | 5/5 (3) | 26% | 28 | 112px (70px) | 0.61 | rack, follow, wipe | none | PASS — 0 error(s) | 6+3 | 233k | 596s | 4.9 MB (236 KB) |
| en r6a | 4/5 (4) | 100% | 0 | no words (70px) | 0.88 | rack, follow, parallax, cutaway | s4: shot_variety: a wipe never wipes: the picture shows 0% at the start and 50% at the end | PASS — 0 error(s) | 6+5 | 231k | 696s | 6.5 MB (1596 KB) |
| en r6b | 5/5 (5) | 100% | 0 | no words (70px) | 0.88 | rack, follow, wipe, parallax, cutaway | none | PASS — 0 error(s) | 5+5 | 157k | 507s | 6.4 MB (1456 KB) |
| ko r5a | 5/5 (3) | 20% | 34 | 120px (60px) | 0.71 | follow, rack, cutaway | none | PASS — 0 error(s) | 8+3 | 250k | 615s | 4.8 MB (508 KB) |
| ko r5b | 5/5 (3) | 22% | 37 | 168px (60px) | 0.60 | follow, rack, cutaway | none | PASS — 0 error(s) | 9+3 | 251k | 789s | 4.7 MB (372 KB) |
| ko r6a | 5/5 (5) | 100% | 0 | no words (60px) | 0.88 | follow, wipe, rack, parallax, cutaway | none | PASS — 0 error(s) | 5+5 | 200k | 431s | 6.8 MB (1964 KB) |
| ko r6b | 5/5 (5) | 100% | 0 | no words (60px) | 0.88 | follow, wipe, rack, parallax, cutaway | none | PASS — 0 error(s) | 6+5 | 213k | 570s | 6.6 MB (1740 KB) |
| zh r5a | 5/6 (3) | 22% | 34 | 115px (68px) | 0.71 | rack, follow, wipe | s11: graphic_crosses_text: #s11 at c1z (6.31s): a shape painted over text — s11-shape2 over s11 | PASS — 0 error(s) | 9+3 | 293k | 689s | 4.5 MB (408 KB) |
| zh r5b | 6/6 (3) | 17% | 35 | 153px (68px) | 0.70 | rack, follow, wipe | none | PASS — 0 error(s) | 7+3 | 232k | 664s | 4.5 MB (456 KB) |
| zh r6a | 6/6 (6) | 100% | 0 | no words (68px) | 0.88 | rack, follow, wipe, cutaway, parallax, tour | none | PASS — 0 error(s) | 6+6 | 237k | 522s | 7.2 MB (2872 KB) |
| zh r6b | 5/6 (5) | 100% | 0 | no words (68px) | 0.88 | rack, follow, wipe, cutaway, tour | s8: shot_variety: a parallax truck stays at a medium scale, but the camera is at 1.574 at  | PASS — 0 error(s) | 7+6 | 229k | 692s | 6.6 MB (2200 KB) |
| ja r5a | 5/5 (2) | 23% | 25 | 160px (62px) | 0.65 | rack, cutaway | none | PASS — 0 error(s) | 6+2 | 166k | 486s | 4.0 MB (244 KB) |
| ja r5b | 5/5 (2) | 18% | 18 | 154px (62px) | 0.70 | rack, cutaway | none | PASS — 0 error(s) | 6+2 | 185k | 441s | 4.0 MB (276 KB) |
| ja r6a | 5/5 (5) | 100% | 0 | no words (62px) | 0.88 | rack, cutaway, parallax, zoom-out, tour | none | PASS — 0 error(s) | 5+5 | 223k | 440s | 5.6 MB (1620 KB) |
| ja r6b | 5/5 (5) | 100% | 0 | no words (62px) | 0.88 | rack, cutaway, parallax, zoom-out, tour | none | PASS — 0 error(s) | 5+5 | 229k | 460s | 5.4 MB (1320 KB) |

`en r6c` (838s, built at `efb0e1a` with the fixes below, while the measurements ran on the
same machine): 5/5 with imagery, 100%, 0 UI animations, no words, 0.88, rack, follow, wipe,
parallax, cutaway, no fallback, verify PASS, 6+5 calls, 187k tokens, 7.3 MB.

- **Motion from the imagery.** 100% of round 6's bespoke tween-seconds move the picture,
  against 17-26% in round 5; 0 UI animations against 18-37 per deck. No round-6 scene drew a
  single word of its own: the narration and the subtitles carry them.
- **Scenes with imagery**: 4-6 per deck (every bespoke scene but a fallback), against 2-3.
  Every grammar was used somewhere (tour, follow, rack, zoom-out, wipe, cutaway, parallax);
  round 5's decks never showed zoom-out or parallax. ja's two data beats were pictured in
  both runs (the other decks' bespoke picks had no data beat).
- **Sharpness**: 0.88 picture px per output px at the closest shot, against 0.60-0.71.
- **Fallbacks**: 2 in 42 scenes over 8 runs (round 5: 1 in 42). en r6a s4, a wipe whose
  steps lit only the subject they named (fixed, below; en r6c's wipe passes); zh r6b s8, a
  picture whose four subjects merged into one, trucked by the parallax grammar (fixed: such a
  picture is staged as a zoom-out). 7 pictures were redrawn over the 8 runs (refusals:
  writing 4, shading 1, touching subjects 3, repeats 3).
- **Cost**: 157-237k tokens against 166-293k; 431-696s a build against 441-789s; 5-6 Codex
  calls plus 5-6 pictures against 6-9 plus 2-3 (more pictures, and drafts of ~25s with almost
  no critique calls, since a scene on a picture writes almost nothing). The depth cut
  (upscale, depth, slicing) took 5-26s a picture, 48-56s for those queued behind others
  (the models run one at a time). Decks are 5.4-7.2 MB against 4.0-5.3: the planes, their soft twins and the
  2x pictures are 1.3-2.9 MB.
- **The gates' cost**: a CSS blur on the planes made one deck's motion gates take 672s (2.2s a
  frame against 0.55s without, measured in the gates' SwiftShader browser); the soft-twin
  cross-fade brought a 5-scene draft round back to 129s.

## Found after the measured runs, fixed in `efb0e1a` and after

- A depth wipe lit only the subject a step named (en r6a s4: half the subjects dark at the
  end). A step now lights every subject it has reached from the left; the last lights the rest.
- `type_scale` multiplied an SVG word's size by the camera's zoom twice (getScreenCTM already
  carries it: a 48px word under a 1.3x camera read 81). Only an HTML word is multiplied now.
  No measured scene drew a word, so no measured result moved.
- The push-pull fill sampled its parent level by nearest neighbour and left 2^k-px blocks
  where a foreground plane slid off (ja r6a s12, a running track). It samples bilinearly now.
- An `overscan` search proved to be dead: a plane covers the frame exactly when the camera's
  framing does, at any distance; it is gone and a 500-case test holds the property.
- A one-subject picture in the parallax grammar (zh r6b s8) is staged as a zoom-out, as the
  follow, rack and cutaway grammars already were.
- The shell's subject and depth-plane ids were `sN-s1` and `sN-d1`, which a scene's own markup
  uses (the references did): they are `sN-subj1` and `sN-plane1` now.
- The four diagram references (shown to a beat whose picture failed) still slid plates in,
  grew bars and zoomed a word to 62px; `ui_motion` and `type_scale` caught all of it in the
  reference test. They are rewritten to fade in place at the quiet scale.

## Every new gate and test fails with its change reversed

`~/.blackhole/DeckSmith/2026-10-10/r6-scratch/reverse.py` reverses 27 round-6 changes
one at a time and runs the test that should catch each. All 27 are caught: the
`ui_motion` and `type_scale` graders and their in-page probes (a chip that pops and slides, a
bar that grows, a word zoomed past 56px, each in a real deck), the static type check, cue groups
not asked of a picture scene, the pinhole projection (zoom and truck), the soft twins and
the rack focus, every plane moved with every camera move, the wipe lit subject by subject and
spatially, a one-subject picture's grammar, the push floor for an un-upscaled picture, the
optional depth model's fallback, the subjects held in the scene, the near-plane bound, the
cut separation, pictures on data beats and on every eligible beat, the rubric's type check,
the planes' overflow flag, the shot before the headline, and the depth prompt (no references,
the UI-motion rule).

The first pass missed two, and both taught something: reversing the camera multiplier in
`type_scale` changed nothing because the multiplier was double-counting (above), and
reversing `overscan` changed nothing because it never did anything (above). Not covered by a
test: the smoothness of the push-pull fill (it was looked at, not measured).

## Against the founder's bar

Would the founder still call it old-fashioned UI animation? **For the bespoke scenes, no
longer — measured and seen.** Nothing animates into place: 0 UI animations in 8 runs (round 5:
18-37 a deck), every bespoke tween-second moves the picture, no scene drew a word, and the
pictures are lit, deep settings a camera travels through with focus pulled to what the voice
names (preview: en s2's rack through a sitting room, ko s5's subjects lit in turn in an arched
hall). That is the direction he asked for.

**Would he call it cinematic? Honestly, not yet.** What moves is a camera over a three-plane
paper diorama:

- **The subjects do not act.** They breathe a few pixels; nothing in a picture changes state.
  Between camera moves a scene can sit nearly still for 5-8 seconds (ko s5 after its reveal,
  ko s8's slow truck over a quarry with small subjects). It reads as a living illustration, not
  video. Keyframe pictures (the same scene in a changed state) or image-to-video are the next
  step, and both cost more image calls or a model this Mac cannot run.
- **Some pictures draw UI iconography themselves**: zh s4's subject is an orange "image" icon
  card with a mountain and a sun, and documents, film strips and cards recur. The motion is not
  UI, but the picture can be. The illustrator's stock list does not name icons yet.
- **Three planes is coarse depth.** On flat vector art the parallax reads as layered paper; a
  near plane at 0.8 can still swing large on a push (round 6's first deck, at 0.6, filled half
  the frame with a blurred wall).
- **Explanation moved entirely to the voice.** With no labels and no words, a picture of
  "a kettle, a tin and a tray" explains a method only through the narration and subtitles. That
  is what was asked, and it is also a risk the founder should judge on the preview.
- **The rest of the deck is not this.** 10-11 of each deck's 15-16 beats are decksmith-71's
  archetypes, and the headline is still 60-70px until that branch's 56px scale merges.

Also short: decks are ~1.5 MB heavier; the en r6c build took 838s while the measurements ran
beside it (the eight measured builds took 431-696s); not measured: an mp4 render or `drift` of
a round-6 deck (the gates' seek-only browser was used throughout), and the depth model off
macOS (it reports `flat`, tested).
