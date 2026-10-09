> Paths under `~/.blackhole/DeckSmith/2026-10-09/` are disposable scratch from the spike session and may no longer exist. Upstream: cth9191/animate @ 7e5eb56 (MIT).

# Spike report: a native animate piece as a DeckSmith figure

2026-10-09. Spike directory: `/Users/neo/.blackhole/DeckSmith/2026-10-09/spike-piece/`. Design under test: `/Users/neo/.blackhole/DeckSmith/2026-10-09/design-A.md` (figure kind `piece`, drawn by `claim-figure`).

Labels used below:
- **Measured:** a command was run and its output or the artifact was checked.
- **Inferred:** read from source or reasoned from measurements, but not reproduced.

Every claim here survived the skeptic pass (`LOG.md`, "Skeptic pass over Q1–Q4"). Nothing was refuted. Where the skeptic narrowed a claim, this report uses the narrowed version.

## The question

Can a 2D canvas piece built from the animate kit (cut-paper style) live inside a DeckSmith scene, driven only by a GSAP plugin tween? To count as yes, the deck must pass DeckSmith's gates, render correctly, render the same way every time, and fail loudly when the piece breaks.

## What was built

Everything is in the scratch directory. None of it is in the DeckSmith repo, which still shows only the `CLAUDE.md` change that was there before the session.

**Deck**
- Two scenes: a 3 s `title` and a 6 s `claim-figure` around a placeholder PNG. 9 s in total.
- `decksmith build … --no-narration` exited 0 with `PASS — 0 error(s), 0 warning(s)`.
- The first build failed: a hand-written `source.json` must contain `equations: []` and `tables: []`.

**Piece**
- `piece/piece.js` (58,945 B) is one strict IIFE: head, core, cut-paper, a scene, an empty `BRIDGES`, morph, and a footer that registers `DSAnimate.pieces['fig-piece']`.
- Settings: FPS 30, 1920x1080, 4 s, one era. Cut-paper shapes only. No `location.search`, no rAF loop.
- The kit files are byte-identical to upstream `7e5eb56`.
- `prove.mjs` in hyperframes' headless shell (152.0.7977.30) exited 0. Measured:
  - frames at 0.5 s and 2.0 s differ and are not blank;
  - drawing 2.0 s twice gives the same `toDataURL`, and so does seeking back to it;
  - no page errors.

**Injection** (`inject.mjs`)
- Patches a fresh deck in place and refuses to run on one that is already injected.
- Adds `vendor/ds-animate.js`. This is a stand-in runtime and GSAP plugin, not design-A's `animate-runtime.ts`.
- Copies the piece to `assets/pieces/`.
- Replaces the scene-2 `<img>` with `<canvas id="s2-pc">` plus `<script src>`.
- Mounts the canvas in a timeline builder that the ready gate waits for.
- Adds one tween with no callbacks: `tl.fromTo("#s2-pc",{dsAnimate:0},{dsAnimate:4,duration:4,ease:"none"},1)`.
- Moves the scene-2 holds to 5.3 s.
- Injecting a second fresh copy gives byte-identical output.
- `smoke.mjs` exited 0. Measured:
  - frame 0 shows before the tween starts;
  - the last frame holds after it ends, with no wrap back to frame 0;
  - seeking back gives the same pixels;
  - `fillText` on the mounted canvas throws.

**Two deliberate differences from design-A:**
- **Tween value.** The spike uses the piece's own time in seconds (`dsAnimate: 4`); design-A writes `dsAnimate: 1`. Design-A's `render(r,d)` multiplies by `d.end`, so a 0–1 value might also work. The implementation has to pick one convention and test it. This spike tested seconds only.
- **`morph.js` was not patched.** It still sets `window.renderFrame` and still falls back to `getElementById('c')`. Design-A invariant 3 says that fallback is removed. In this spike it is not, so two pieces on one page would overwrite each other (Inferred from source; not run).

## The four unknowns

### Q1. Does hyperframes accept a `<script src>` inside a scene clip, and does the real render animate the canvas?

**Answer: yes.** Measured. Confidence is High for this setup and Medium for generalising it.

Setup: hyperframes 0.8.43, macOS, Metal GPU, 1 worker.

**Gates**
- `hyperframes lint`: exit 0, 0 errors, 0 warnings. The skeptic re-ran it and got the same result. The `<script src>` is at `index.html:172`, inside `#s2`.
- `hyperframes check`: exit 0.
  - Lint, Runtime and Motion have no errors or warnings; contrast passes 42/42.
  - Layout has one warning, `content_overlap #s1-e inside #s2-e t=3.25-3.38s`. That is the s1→s2 handoff, which the un-injected build also reports.
- `decksmith verify`: exit 0, `PASS — 0 error(s), 0 warning(s)`, plus one info line for the same overlap. The fidelity check ran. This Mac has WebGL, so this result says nothing about Q4.

**Render**
- `decksmith render -w 1`: exit 0, 270 frames, `drawelement capture · hardware gpu`. Self-verify PSNR was 65.2, 49.4, 48.7 and 47.5 dB.
- The only warning is a blank-frame suspect at frame 12. A control render of the un-injected deck gives the same warning at the same frame.

**What the mp4 shows** (stills at 3.6, 4.5, 5.0, 6.0, 7.0, 7.9 and 8.5 s, all looked at; the tween runs 4.0→8.0 s):
- The plate fades in.
- The sun, box and ball move steadily from left to right.
- The last pose holds at 7.9 and 8.5 s, with no wrap back to frame 0.

**Frame-to-frame change on the canvas area, frames 145–240**
- Values alternate between about 1.4–2.6 and about 0.17, with no gaps and no spikes.
- The alternation is expected (Inferred from source, High). `morph.js:82-83` changes pose only every second frame, and the small in-between change is the plate's slow push-in.

**`decksmith frames` against the mp4, at the same seven instants**
- Same pose at every instant.
- PSNR is 40.4–41.6 dB on the canvas crop and 30.7–31.0 dB on the full frame.
- The skeptic traced the low full-frame score to text edges, which score 25–27 dB.
- The rest of the difference is probably h264 loss (Inferred, Medium). No lossless render was made to check this.
- Unlike motion driven from GSAP callbacks (AGENTS.md invariant 11), the plugin-driven canvas looks the same in `frames` and in the render.

**Reproducibility**
- `decksmith drift --workers 1`: exit 0, `270/270 frames byte-identical`.
- A second render matched the first: 0 of 270 frames differ, and the two mp4 files have the same md5.

**Skeptic: confirmed.** It noted two things the original write-up left out:
- Both the injected and the control render logs print hyperframes' "slideshow island … MP4 will be truncated to slide 1" warning. The warning is wrong here: the mp4 has all 270 frames.
- The plate's hidden stretch starts at frame 103, not 105.

### Q2. Is a throw inside the piece loud?

**Answer: no for a throw while drawing; yes for a throw while the script loads, and only by accident.** Measured, High.

**Throw inside the plugin's `render()`** (fires from 6.067 s, frame 182)
- Every command succeeded:
  - `hyperframes lint` exit 0;
  - `hyperframes check` exit 0, with Runtime clean;
  - `decksmith verify` exit 0, `PASS — 0 error(s), 0 warning(s)`, including the fidelity stop at 8.3 s;
  - `decksmith render` exit 0, with a 270-frame mp4.
- The error text appears in none of the six logs.
- The only trace is a render warning, `drawElement self-verify failed at frame 203: 22.9dB < 32dB`, after which the renderer switches to screenshot capture. The warning gives its reason (the PSNR check failed) but does not mention the page error.
- **Cause:** the hyperframes runtime catches the error in its transport seek, `catch(P){L("runtime.init.transport.seek",P)}`.
  - `L` reports only to `__hf.onSwallowed`, which the page has to install itself, or to `console.debug` when a debug flag is set.
  - The skeptic confirmed this in the runtime source.
  - A bare `tl.seek` does throw, so the swallowing is hyperframes', not GSAP's.
- **Output:** from frame 182 the piece freezes on its last good pose. The frame is fully painted and looks normal.
  - PSNR against the Q1 render drops to 36.05 dB at frame 182 and to 22.32 dB at frame 240.
  - 88 frames are below 40 dB.
- **The freeze spreads to the rest of the scene.** Tweens that run after the plugin tween in the same scene timeline freeze too.
  - The plate's push-in stays at x=721 from frame 186 to 240.
  - It jumps back into line once the plugin tween ends at 8.0 s.
  - The cause is Inferred, Medium.
- Which stale frame shows depends on seek order. On the gate path, seeking to 7.0 s right after 5.0 s shows the 5.0 s pose.

**Throw at script load, before the piece registers**
- `check`: exit 1, with `page_error: q2UndefinedAtLoad is not defined`, then `DSAnimate.mount: no piece registered…`.
- `verify`: exit 1.
- `render`: exit 1 after about 53 s, with `sub_timeline_script_failure … still unregistered: s2`; no mp4 written.
- This is loud only because `mount` then throws and scene 2's timeline never registers.
- A load-time throw after the piece has registered was not tested.

**Mitigation tested:** the plugin catches the error, re-raises it with `setTimeout(()=>{throw e})`, then rethrows.
- `check` and `verify` then exit 1, with 17 page errors between 6.125 s and 8.5 s.
- `render` still exits 0 and only prints `[Browser:PAGEERROR]`.
- So the gate that catches this is `verify`, not `render`.

**Skeptic: confirmed, with one gap.**
- The probe's render-path check failed on every seek with `window.__hf.seek is not a function`, and `LOG.md` did not record this.
- So the probe measured the swallowing only on the gate path (`suppressEvents:true`).
- That the render path swallows too is Inferred, High. The evidence: the render exited 0 with frozen frames, and in `cli.js` the renderer calls `hf.seek(t)` with no options, which reaches `renderSeek`.

### Q3. What does drawing cost?

**Answer:** cost per call was measured on Metal and on SwiftShader, and through real renders on Metal. During a render the piece draws three times per seek, and design-A gives the wrong reason for that. Confidence is High for the pass counts, call counts and their causes, and Medium for the extrapolations.

**Where the dots come from** (Measured from source and call counts)
- `cut-paper.js:43-47`: `grainIn` draws `min(4500, area/170·k)` points per `stipple()` call. Each `cut()` makes two stipple passes unless `grain:false` is set, plus `pencil` with up to 1500 points.
- `STYLE.post` (`core.js:259`) adds a full-frame grain of 2×3000 dots every frame.
- No `getImageData` or `putImageData` appears anywhere in core, cut-paper or morph, and none was counted at runtime.
- Per frame, the tiny scene makes about 25k `rect` calls.
- The heavy scene is upstream's own cut-paper example `history-of-ai` (60 s, 15 eras, 13 morphs). It makes 32–45k `rect` calls and up to 383 `fill` calls per frame.

**One `renderFrame` call** (120 evenly spaced times; median / p95 ms; context created with `willReadFrequently`, as `mount` does)

| | Metal | SwiftShader |
|---|---|---|
| tiny | 6.4 / 7.0 | 18.0 / 25.6 |
| heavy | 17.8 / 29.3 | 47.1 / 74.8 |

**Draw passes per seek** (Measured)
- Building the timeline costs 1 pass.
- The first seek on a fresh page costs 3 passes (`[0,0,t]`), from GSAP rendering the `fromTo` start. This is the cause design-A gives, but it happens only once per page.
- The 3 passes that cost render time come from hyperframes.
  - Its transport seek calls `totalTime(N,false)`, then `totalTime(N+.001,true)`, then `totalTime(N,true)` whenever events are not suppressed. That is every frame of a render.
  - This happened on 52 of 54 painting seeks in both injected decks.
  - The renderer calls `__hf.seek(t)` with no options, so the extra passes apply during a render (Inferred from source, High).
- The gate path (`suppressEvents:true`, used by `frames` and `verify`) costs 1 pass per seek.
- Cost per painting frame through the real runtime on Metal: tiny 15.6 / 31.6 ms, heavy 60.3 / 124.5 ms.

**Renders** (1 worker, Metal, two runs each; all exited 0 and passed self-verify)

| deck | capture time (ms) | added per painting frame |
|---|---|---|
| control | 5953 / 6657 | — |
| tiny | 7144 / 7306 | +5–10 ms |
| heavy | 11066 / 14426 | +43–65 ms |

- One 4 s piece adds about 5–8 s for heavy and 0.6–1.2 s for tiny.
- Stills from both mp4s were looked at:
  - the heavy piece shows a different era at each sample, one of them mid-wipe, and holds its last frame;
  - the tiny piece animates, then holds.

**Extrapolated to a 60 s piece painting every frame at 30 fps** (Inferred, Medium)
- Heavy adds about 77–117 s on Metal, roughly 2.8–3.7 times the capture time without a piece.
- Tiny adds about 10–28 s.
- Heavy on software GL would add about 254 s.
- These are upper bounds from a heavy deck that is portrait, runs 15 times faster than normal (tween value 60 over 4 s), and has its text stubbed out.

**Memory** (Measured, Medium; one machine, noisy runs)
- The page's renderer process uses 91–125 MB with the tiny piece and 132–189 MB with the heavy one.
- The JS heap is 10–12 MB.
- Peak RSS of any render process was 528–669 MB, with no difference attributable to the piece.

**Skeptic: confirmed, with two caveats.**
- For the tiny piece, the render path measured 15.6 ms against 17.0 ms for the gate path (8.4 ms in run 1). So per-seek timing does not show a threefold cost for tiny. Only heavy shows it: 60.3 ms against 17.7 ms.
- The 1800-frame figures are upper bounds from the modified heavy deck described above.

### Q4. Does a checker without WebGL refuse a deck whose only canvas is 2D?

**Answer: yes, and the refusal is a false positive.** It is loud in `frames` and quiet in `verify`. Measured, High.

**How the check works** (`src/render/capture.ts`, `openDeck`; the probe and throw are at about lines 265–281)
- It creates a fresh test canvas and asks it for `webgl2`, then `webgl`.
- It refuses whenever the page has any `<canvas>` and the test canvas gets no context.
- It never looks at which kind of context the deck's own canvas uses, so it tests the browser, not the canvas.

**Setup:** the checker was made GL-less without changing the repo. `DECKSMITH_CHROME` pointed at a wrapper that runs hyperframes' headless shell with `--disable-3d-apis`; the launch log confirms the flag.

| Command | Browser | Exit | Result |
|---|---|---|---|
| `decksmith frames deck-piece --at 6` | GL-less | 1 | Named refusal ("cannot create a WebGL context, so the capture would be of an empty rectangle"); output folder empty |
| same | normal | 0 | PNG written; piece drawn |
| `decksmith frames deck-plain` (no canvas) | GL-less | 0 | PNG written; the check fires only when a canvas is present |
| `decksmith verify deck-piece` | GL-less | 0 | `warning fidelity not_measured …` then `PASS — 0 error(s), 1 warning(s)` |
| `bypass.mjs` (`openDeck`'s steps without the refusal) | GL-less | 0 | probe `gl:false, twoD:true`; 21,378 opaque samples and 70 colours on the deck canvas; no page errors |

The GL-less bypass frame scores 113.06 dB against the normal frame (the skeptic recomputed this). The "empty rectangle" the error message predicts would not have happened.

**Which commands reach the check**
- `frames` reaches `openDeck` through `captureFrames` and does not catch the error.
- `verify` and `build` reach it through `gate()` → `fidelity()`. That turns the error into a `not_measured` warning, and a warning does not fail the gate (`cli.ts:1228`, `check.ts:282`).
- `render` never reaches `openDeck`.
- That `build` behaves like `verify` is Inferred, High, because both use the same `gate()`. It could not be run, because `build` regenerates the deck and drops the injection.

**What the quiet path costs:** the whole fidelity gate is skipped, not just the canvas scene. Scene 1, which has no canvas, went unmeasured too. No ink, fill, overprint or apparent-size findings were produced, and the run still printed PASS.

A real GL-less checker would most likely come from `resolveChrome` falling back to puppeteer's Chrome 145 (comment at `capture.ts:36-41`). That is Inferred, Medium, and was not reproduced.

**Skeptic: confirmed.** The only correction is the line range: the cited 254–275 has drifted to about 265–281.

## Other findings

1. **The `fillText` trap does not cover text drawn inside a scene.**
   - `morph.js:62-63` draws each era on a plain offscreen canvas (`layer(0)`).
   - The stand-in runtime traps only the mounted canvas (`ds-animate.js:22-23`).
   - So the trap fires only for the overlays drawn later on the mounted canvas (`yearTag`, `capStrip`).
   - With `handText` stubbed out, the heavy piece still made 47 `fillText` calls per frame at piece time 55 s (`monoText`), and none threw. Measured.
   - That those 47 calls land on the offscreen layer is Inferred, High, because the counter covered every canvas.
   - Design-A invariant 5 says the trap covers cut-paper's `handText`. As specified, it does not.
2. **The text trap and the swallowed errors combine badly.** With upstream's text left in, the heavy piece threw on 48 of 120 seeks. Every throw was swallowed, so those frames stopped drawing partway through. As specified, the design's text guard produces exactly the silent failure Q2 describes. Measured.
3. **A drawing error freezes the rest of the scene,** not just the canvas (Q2). Measured; cause Inferred, Medium.
4. **`render` exits 0 even with page errors in its log.** Even with the re-raise mitigation, only `check` and `verify` fail. Measured.
5. **Canvas motion driven by the plugin looks the same in every tool.** `frames` and the mp4 show the same pose; motion driven from GSAP callbacks does not (AGENTS.md invariant 11). Measured on one deck.
6. **Two tool messages are misleading.** Measured:
   - `drift --workers 1` still says "at different worker counts", which is wrong for that run.
   - hyperframes' "MP4 will be truncated to slide 1" warning is false for this deck.
7. **A hand-written `source.json` needs `equations: []` and `tables: []`,** or `decksmith build` fails. Measured.

## Recommendation for design A: go, with conditions

The core mechanism works. A `<script src>` piece inside a scene clip passes lint, check and verify. Its motion in the render matches `frames`. At 1 worker, two renders are byte-identical.

What does not hold is how the design assumes failures will behave. Three of its statements are also wrong or incomplete: the cause of the three draw passes, how far the text trap reaches, and treating the WebGL refusal as out of scope.

Conditions, each traced to a measurement above:

1. **An error in the plugin's `render` must fail a gate.**
   - Two ways to do it. The runtime can catch, record and re-raise the error; the `setTimeout` re-raise was measured to make `check` and `verify` fail. Or it can install `__hf.onSwallowed` and set a flag that `verify` reads.
   - `verify` is the gate that must catch it.
   - Whether `render` should also fail on page errors is a separate decision; today it exits 0.
   - Add a throw-in-`render` case to design-A's browser test. Today that test only covers `fillText`.
2. **The text trap must also cover morph's offscreen layers,** not just the mounted canvas. Otherwise text inside a scene slips past invariant 5 without any error.
   - Condition 1 has to land first. Without it, the trap produces swallowed, half-drawn frames.
   - How to do it was not measured. Options are patching `layer()` or wrapping every context created inside the IIFE.
3. **Fix the false refusal on GL-less checkers before pieces ship, not as a later change.**
   - Option A: only refuse for canvases that actually hold a WebGL context, or exempt pieces.
   - Option B: make `verify` fail on `not_measured` when the deck has a canvas.
   - Without either, a CI checker without WebGL would skip the whole fidelity gate on every deck with a piece and still print PASS.
   - Neither option was measured; choosing between them is a policy call.
4. **Limit v1 to one piece per deck, or patch `morph.js`.** The patch covers `window.renderFrame` and the `getElementById('c')` fallback, as invariant 3 claims. If you patch, test two pieces on one page. The spike did neither.
5. **Write down the tween-value convention.**
   - The spike used seconds (`dsAnimate: 4`). Design-A writes `dsAnimate: 1` and multiplies by `d.end`.
   - Pick one and test the clamp at the last frame. The spike checked the clamp only with seconds.
6. **Correct the draw-cost risk in design-A.**
   - The three passes per render frame come from hyperframes' transport seek, not from the fresh-page `fromTo` start.
   - Budget a heavy piece at about 43–65 ms extra per painting frame on Metal.
   - Skipping the redraw when `round(t·fps)` has not changed would cut this to one pass. That fix is untested.
7. **Keep the human gate:** render, run `drift`, and watch the mp4. In Q2 every automated gate passed a frame that was stale but fully painted and normal-looking.

## What remains unmeasured

- **The real implementation:** `animate-runtime.ts`, the `claim-figure` piece branch, `build`/`copyAssets`, and `scanDeterminism` over `assets/**/*.piece.js`. The spike used a hand injection and a stand-in runtime.
- **Other render setups:**
  - renders with more than one worker, and `drift` at its default 1-vs-3 workers (skipped because the memory rule allows one browser at a time);
  - Linux, and capture through `beginFrame`;
  - a full render on SwiftShader (only per-call timings exist).
- **A real checker without WebGL** (the Chrome 145 fallback), as opposed to `--disable-3d-apis`.
- **Holds and narration retiming with a piece** (`framePlan` in `src/render/timing.ts`). The spike had no narration, so the mp4 ran at composition time 1:1.
- **Swallowing on the render path, measured by a probe.** Today it is inferred from the render's output and from `cli.js`.
- **Other failure cases:** a load-time throw after the piece registers, and a throw on the tween's first frame.
- **Two pieces on one page.**
- **The frame-memo fix** for the three passes.
- **`render --fps 24`** with a piece built at 30 fps.
- **Styles other than cut-paper.** Riso and pixel read pixels back from the canvas.
- **Whether the remaining `frames`-vs-mp4 difference is all h264 loss** (no lossless render was made).
- **`decksmith build` on an injected deck,** which cannot keep a hand injection.

## Processes and cleanup

- `PIDS.md` lists 43 PIDs: 4 from setup, 7 from Q1, 13 from Q2, 14 from Q3 and 5 from Q4.
- Each was checked with `ps -p` at 2026-10-09 12:40. None is running, and nothing was killed.
- Chrome processes that `PIDS.md` records as belonging to another session (including 69735, parent 59744) were left alone.
- `git status` on DeckSmith shows only the `CLAUDE.md` change that was already there.
- The scratch directory is kept as evidence for this report.