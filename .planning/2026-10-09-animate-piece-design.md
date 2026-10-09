> Paths under `~/.blackhole/DeckSmith/2026-10-09/` are disposable scratch from the spike session and may no longer exist. Upstream: cth9191/animate @ 7e5eb56 (MIT).
> Amended by `2026-10-09-animate-piece-spike.md`: its seven conditions override this design wherever they disagree.

# Design: an animate piece as a figure kind, `kind: "piece"`, drawn by `claim-figure`

Nothing was run, modified or rendered. The design rests on reading DeckSmith at `aaea2d7` and animate at `7e5eb56`. Line references are read, not executed.

## 0. Seam choice

**Recommended: a third figure kind, `"piece"`, not a new archetype.**

| | Figure kind `piece` (recommended) | New archetype `animate` |
|---|---|---|
| Precedent | `types.ts:24-43` "A CLIP IS A FIGURE": what differs is "one branch at emit". A piece is a rectangle with intrinsic pixels, a caption and a duration (`seconds`, `types.ts:82`). | Archetype recipe, README:1231 |
| Tables touched | `figureSchema.kind` enum, 1 emitter branch, 5 refusal guards | Union `types.ts:596`, `DIAGRAMMATIC` :674, `ARCHETYPE_FAMILY` :709, `emitters` index.ts:25, planner prose prompt.ts:669, sweep corpus, `archetypes.test` `beats` fixture |
| Claim text | Reuses claim-figure's DOM claim. That is what lets the canvas carry **no text** (§4, invariants 5 and 9). | Needs its own title/claim chrome |
| Risk | Every `kind === "clip"` guard silently treats a new kind as an image (below) | More code, but no hidden fallthrough |

**Hidden fallthrough to fix.** Each of these treats "not a clip" as "an image". Each must become `kind !== "image"`, or gain an explicit `piece` branch:
- `claim-figure.ts:297` (`if (fig.kind !== "clip") return img(...)` would emit `<img src=x.js>`)
- `split-compare.ts:136`
- `annotated-figure.ts:688`
- `look.ts:390`
- `source/assets.ts:59` (`imageSize` would drop a `.js` file)
- `plan/prompt.ts:809,830,837`

## 1. What an author writes

`source.json` gets a figure entry. It is hand-written: the markdown dialect cannot express `kind`, same as clips, index.ts:54.

```json
{ "id": "fig-loop", "kind": "piece", "src": "pieces/loop.js",
  "width": 1920, "height": 1080, "seconds": 6, "caption": "The feedback loop" }
```

The beat is unchanged: `{"archetype":"claim-figure", ..., "figureId":"fig-loop"}`.

`assets/pieces/loop.js` is an animate `scenes.js` plus `bridges.js`, with a slimmed head. It must define:
- `ERA_LIST`
- `SHOTS`
- `ERA_BG`
- `BRIDGES`
- `pieceCam`
- its scene functions

It must **not** define `FPS/W/H/HAND/DURATION/NFRAMES/TIMELINE`; DeckSmith injects those. It may not draw text (§4). In v1 the style is fixed to `cut-paper`.

## 2. Files

**Vendored, MIT** (`LICENSE` copyright 2026 cth9191) into `src/emit/animate/`:
- `core.js` (28,964 B)
- `morph.js` (9,520 B)
- `cut-paper.js` (17,537 B)
- `LICENSE`, copied verbatim
- `NOTICE`: upstream URL, SHA `7e5eb56`, and the patch list:
  - `morph.js:79`: drop the `getElementById('c')` fallback
  - `morph.js:130-131`: drop the `window.renderFrame` and `window.anchorAt` writes

Only cut-paper ships in v1. It and `core.js` call `getImageData` zero times (counted), so the GPU-to-CPU raster flip (`.planning/2026-09-06-canvas-seek-purity.md`) cannot happen. Riso and pixel read back pixels and are deferred. Isometric's `SANS` (`kit.js:18`) would need a patch.

**New: `src/emit/animate-runtime.ts`** (about 60 lines). It mirrors `morph-runtime.ts:605-640`:
- `DSAnimate.pieces[id] = factory`, filled by each piece file.
- `DSAnimate.mount(canvas, id)`, called from `measure`:
  - calls `getContext('2d',{willReadFrequently:true})` once
  - asserts `document.fonts.check(...)` for nothing, because the canvas has no text
  - runs the piece's factory with `fillText` and `strokeText` throwing on every 2D context (as implemented: `withoutText`, below)
  - stores `{rf, n, fps}` in a `WeakMap` keyed by the canvas
- `DSAnimatePlugin`, `name:"dsAnimate"`:
  - `init` throws if the host was never mounted, the same check as `morph-runtime.ts:619-623`
  - `render(r,d)` calls `d.rf(Math.min(r*d.end, (d.n-1)/d.fps), d.canvas)`. The clamp prevents the `% NFRAMES` wrap (`morph.js:81`) from snapping the last frame back to frame 0.
  - As implemented (spike conditions 1, 2, 6): the draw runs inside `withoutText`, which swaps `fillText`/`strokeText` on the `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D` prototypes for the length of the call, so morph's offscreen `layer(0)` is covered too; an error is passed to `reportError` (a `page_error` in `hyperframes check`, so `verify` exits 1) and rethrown; and a draw is skipped when `round(t·fps)` equals the frame the canvas last finished drawing. Tested in `test/animate-piece.test.ts`, including `decksmith verify` on each failure.

**Changed:**

| file:line | change |
|---|---|
| `types.ts:44` | `z.enum(["image","clip","piece"])`; doc comment on `seconds` :82 says "clip or piece" |
| `composition.ts:117-120` | `PLUGINS.dsAnimate = {src:"./vendor/ds-animate.js", global:"DSAnimatePlugin"}`. The door check at :632 already enforces it. |
| `scripts/build.mjs:87-96` | a second esbuild entry, `animate-runtime.ts` → `dist/ds-animate.js`; also copy `src/emit/animate/*` → `dist/animate/` |
| `build/files.ts:131-139` | `wanted("ds-animate.js")` branch, like the ds-morph one |
| `build/files.ts:166-196` `copyAssets` | for a `piece` figure, write the **assembled** `out/assets/<src>` instead of a raw copy (below). The containment check at :191 is unchanged. |
| `claim-figure.ts:297` `plate()` | piece branch: `<canvas id="${sid}-pc" width=W height=H>`, `el:"canvas"` |
| `claim-figure.ts:~549` return | for a piece, add:<br>`measure:["DSAnimate.mount(document.getElementById('${sid}-pc'),'${id}')"]`<br>`plugins:["dsAnimate"]`<br>one tween `tween('#${sid}-pc',{dsAnimate:0},{dsAnimate:1,duration:dur,ease:"none"},at)`<br>holds `holdsWithin([at+dur+0.3], beat.seconds)`<br>Throws by name if `at+dur+tail > beat.seconds` |
| `<script src="assets/<src>">` | emitted by the piece branch in `html` |
| `verify/index.ts:1057-1075` | `readCompositions`, or a sibling feeding only `scanDeterminism`, also reads `assets/**/*.piece.js`. Otherwise the scan at :116 is blind to the only file holding author code. |
| the five guards in §0 | refuse `piece` by name, as clips are refused |
| `plan/prompt.ts:809-837` | inventory line: "piece: claim-figure only" |

**Assembled piece file.** Each piece becomes one IIFE, so pieces cannot collide in global scope (invariant 3):

```
(function(){"use strict";
 const W=1920,H=1080,FPS=30,DURATION=<seconds>,HAND=<theme family>,CX=W/2,SAFE={...16:9};
 <core.js><cut-paper.js><author piece>
 const NFRAMES=Math.round(DURATION*FPS),LOOP_T=NFRAMES/FPS,
       TIMELINE={shots:SHOTS.map(...)};
 <morph.js>
 DSAnimate.pieces["<id>"]=(cv)=>({rf:renderFrame,n:NFRAMES,fps:FPS});})();
```

`FPS=30` is the render default (`cli.ts:963`). On twos, that steps evenly at 15 Hz, which avoids the 24-to-30 judder.

## 3. What is excluded from animate, by design

- `head.html`: reads `location.search`
- `board.js`
- `score-head/score.js/score-tail`: `requestAnimationFrame` plus `performance.now` at `score-head.js:9-21`, and the OfflineAudioContext
- `build.mjs`
- all `tools/*`: Playwright, `export.mjs`, beats, voice

DeckSmith keeps its own narration, timing and render path.

## 4. Invariants

1. **Seek.** `renderFrame` is pure in t (`morph.js:81-88`) and repaints from a clean sheet (:65). It is called only from the plugin's `render`, which runs during the seek. With no `?export` there is no rAF, because score-head is not assembled.
2. **fromTo.** One `tween()` → `tweenText`, typed (`kit.ts:336-370`).
3. **Scoped.** The target is `#${sid}-pc`. All piece globals live inside the IIFE, and `getElementById('c')` is patched out.
4. **No clock, random or network.** The kit is clean (seeded mulberry32, `core.js:10-36`). The assembled file is scanned by the extended `scanDeterminism`. The script is a local relative path, as `vendor/` already is.
5. **≥40px.** The canvas carries **no text**, and `fillText`/`strokeText` throw at runtime on any canvas while the piece runs. That covers `core.js:415` and cut-paper's `handText` (:21), and so `monoText`, `tag`, `yearTag`, `capStrip` and `cat`. It does NOT cover `handwrite` (`core.js:433`), which draws letterforms as `ink` strokes; nothing refuses it. The claim stays DOM text, so `scanTypeFloor` and `apparent.ts` still apply. This is the condition the WebGL spike already set (no text in canvas).
6. **Ambient.** The canvas changes only inside the tween window. Holds and slide edges are static frames. No CSS animation is added.
7. **deck.html.** Untouched. `emitDeckPage` never sees the piece.
8. **Holds in window.** `holdsWithin` plus the emitter's throw when the piece does not fit. `emitIsland` (:39) stays the backstop.
9. **Fonts.** No canvas text means no canvas font. `HAND` is injected as the theme family only so that `handW`'s `measureText` (cut-paper :29) cannot reach an undeclared family.
10. **3dp.** `at` and `dur` are rounded with `Math.round(x*1000)/1000` before `tween()`.
11. **No callbacks.** Plugin `render` only. A test asserts the substrings `onUpdate` and `onComplete` never appear in the piece branch's output.

## 5. Gates and tests

- `test/arch-claim-figure.test.ts`:
  - the piece branch emits a canvas, exactly one scoped fromTo with `dsAnimate`, `plugins:["dsAnimate"]`, and holds inside the window
  - throws when the beat is too short
  - throws when there is no `seconds`
- Refusal tests in `split-compare` and `annotated-figure` for `kind:"piece"`.
- `test/wiring.test.ts`:
  - pin the `dist/ds-animate.js` hash
  - a deck with no piece is byte-identical (no `ds-animate` tag, nothing in `vendor/`)
  - the vendored kit passes `NONDETERMINISM`
  - `LICENSE` and `NOTICE` exist in `dist/animate`
- Verify test: an author piece containing `Math.random(` fails `scanDeterminism`.
- Browser test, in the style of `capture-parity`: on a fixture piece, screenshots after a forward seek and after a reverse seek match (animate's `tile.mjs` idea, using screenshots, not `toDataURL`); and a piece that calls `fillText` makes the page error.
- `scripts/sweep-perturbations.mjs`: add `b11-claim-figure-piece`, then `npm run sweep` and commit `ledger.json`. This is mandatory for any `src/` change.
- **Human gate.** Render the fixture deck, run `drift` (PSNR floor 40 dB), and **watch the mp4**. Per AGENTS.md, a green gate is not evidence.

## 6. Risks and limits

- **No text on the canvas.** animate's captions, tags and DEFER overlays (`cut-paper/kit.js:179-180`) are unusable: `handText`, `tag`, `yearTag`, `capStrip`, `monoText` and `cat` fail `verify`; `handwrite` is not caught and must not be used. Labels go in claim-figure's DOM. A canvas type-floor probe could lift this later (animate `textcheck.mjs:15-30`). Not in v1.
- **One style.** Riso and pixel do readbacks, so the raster flip is unmeasured for them. Others need font patches.
- **Bytes.** About 56 KB of kit per piece, because each IIFE inlines it. Two pieces cost about 112 KB.
- **Draw cost.** The spike measured three draw passes per render frame, from hyperframes' transport seek. The frame memo makes that one (browser-tested: 5 draws on a fresh page's first seek without it, 1 with it); render time with the memo is not measured. Cut-paper stipple runs up to 4,500 points per call.
- **`hyperframes check` cannot see into a canvas** (`sweep_static`, ARCHITECTURE-CANVAS §5). Layout and contrast gates cover only the DOM around it.
- **A checker without WebGL used to refuse any `<canvas>`**, a piece's 2D one included, so `frames` failed and `verify`/`build` skipped the whole fidelity gate under a `not_measured` warning (spike Q4). Fixed (spike condition 3, option A): `claim-figure` marks a piece's canvas `data-ds-piece` (`PIECE_ATTR`, src/emit/animate-runtime.ts), it is 2D by construction because `mount` takes its 2D context first, and `openDeck` exempts it. Every unmarked canvas is still refused. Measured 2026-10-09 with the spike's `--disable-3d-apis` wrapper: GL-less `frames` writes the piece mid-motion, and GL-less `verify` reports the same findings as the normal browser, with no `not_measured`. `test/animate-piece.test.ts` holds it, with the unmarked deck as control. A real GL-less Chrome (the puppeteer 145 fallback) is still not tried.
- **`render --fps 24`** brings the judder back, because the piece is baked at 30.
- **Whether hyperframes lint accepts an external `<script src>` inside a scene clip is unverified.** If it does not, the piece must be inlined into `index.html` instead (same IIFE, bigger composition).
- **Author authoring is manual.** No planner generation of pieces, no ingest path, no beat or score integration. The piece's loop wrap and bridges work only within one scene.
- **Cross-platform.** The Canvas2D raster differs between Metal and SwiftShader. `drift` is valid only on one backend (2026-09-09 spike).

## 7. Effort

Roughly **24 h ± 6, medium confidence**:

| work | hours |
|---|---|
| vendor and patch | 2 |
| runtime and plugin | 3 |
| schema and guards | 2 |
| claim-figure branch | 3 |
| copyAssets assembly | 3 |
| scan extension | 1 |
| unit and browser tests | 5 |
| sweep and ledger | 1.5 |
| render, drift, watching the mp4, measuring draw cost | 3 |
| README | 0.5 |

Most of the uncertainty is in whether hyperframes accepts the external script and in the unmeasured draw cost.