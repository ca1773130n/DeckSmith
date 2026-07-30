# EXPERIMENT-007 — the framework sweep, and what DeckSmith is

**Date** 2026-07-27 · Six parallel investigations, ~60 frameworks, all measured on this
machine. Spikes live in `experiments/007-frameworks/{r3f,three-vanilla,motion-canvas,layout,charts,runtimes}/`.

This document decides. Section 1 is the whole answer; everything after it is the defence.

> **Reviewed 2026-07-27 — see `.planning/FRAMEWORKS-REVIEW.md`.** Four claims were
> corrected in place and are marked `[REVIEW 2026-07-27]` where they appear: §0.1 (the
> offline mechanism), §2.1 (hardware WebGL determinism), §3.1 (the seam survives
> unchanged), and §3.2 / the decision table (the opentype.js error figure). The
> adopt/reject verdicts are unchanged by all four. The WebGL determinism matrix, the
> bundle composition, the licences and the two gate-blindness findings were independently
> reproduced and hold.

---

## 0. The four findings that outrank every verdict

These emerged from more than one investigation, or from checking the repo against them.
They matter more than any adopt/reject call below.

**0.1 — A built deck does not currently play offline. Invariant 4 is false today.**
`src/emit/composition.ts:29-30` loads GSAP and KaTeX from `cdn.jsdelivr.net`. Three
independent agents tripped over this. It is not fixed by the `.deck` work in flight:
`src/pack/pack.ts`'s own header says a pack "carries the source and the storyboard, never
a built deck", so the container never sees the HTML that holds the CDN links. It is
roughly twenty lines to fix and it is not a framework question.

> **[REVIEW 2026-07-27 — mechanism corrected; the original claim was right about the
> priority and wrong about the reason.]** HyperFrames' compiler already rewrites
> external **scripts**. `node_modules/hyperframes/dist/cli.js` contains
> `inlineExternalScripts()`, which does `document.querySelectorAll("script[src]")`,
> fetches each, and replaces the tag with `/* inlined: ${src} */` + the source, logging
> `[Compiler] Inlined CDN script: …`. That log line appears in this sweep's own captured
> output (`three-vanilla/measure/buggy-report.txt`), where it names the exact GSAP URL —
> so the evidence was in hand and unread. Consequences, all verified in the shipped bundle:
>
> 1. **The video path is not a render-time network dependency.** GSAP and `katex.min.js`
>    are inlined at *compile* time, before the browser opens. The original text's
>    "invariant-2 violation (network at render time)" is **withdrawn** for this path.
> 2. **`<link rel="stylesheet">` is NOT inlined.** There is no "Inlined CDN stylesheet"
>    path anywhere in `cli.js` — `externalStyles` is a lint/parse structure, not an
>    inliner. So `${KATEX}.min.css` **is** fetched live by the capture browser on every
>    render of every deck containing an equation. *That* is the real invariant-2
>    violation, it is narrower than the original claim, and no agent found it.
> 3. **The failure mode is a warning, not an error.** The `else` branch of the inliner
>    calls `defaultLogger.warn("Failed to download CDN…")` and continues. A deck built on
>    a flaky network renders **without GSAP** and produces a silently frozen video. This
>    is a worse failure than the one §0.1 originally described.
> 4. **Invariant 4 stands as written** for the navigable path: `deck.html`, the step
>    layer, and `.deck` see the raw CDN links with nothing inlining them.
>
> Fix priority is unchanged. The fix is now better specified: vendor the KaTeX **CSS**
> first (it is the only true render-time fetch), and treat the inliner's warn-and-continue
> as a build-gate item.

**0.2 — The GSAP version pin is a licensing instrument, not just a determinism one.**
GSAP 3.14.2's `package.json` license field is the literal string
`Standard 'no charge' license: https://gsap.com/standard-license` — not SPDX, not OSI. The
hosted terms (Webflow, effective 2025-04-30) grant free commercial use including all former
Club plugins, and DeckSmith is squarely a Permitted Use. But §V permits termination at
Webflow's discretion and §VI.2 permits unilateral amendment by editing a web page — and
§VI.2 also contains the safe harbour: *"you may continue using previous versions of GSAP
Products under the applicable terms licensed to you prior to the effective date of the
revised GSAP License."* **A pinned version is a permanent grant.** The pin in
`composition.ts` must never become a range, the comment above it should say why in
licensing terms as well as determinism terms, and a copy of the license text should be
archived beside it because the npm package does not carry one.

The Prohibited Use is GSAP inside "tools that allow users to build visual animations
**without code**" that compete with Webflow's builder. Invariant 3 — no human in the loop —
is therefore also our licensing defence. **That makes "DeckSmith never ships a visual
animation editor" an architectural constraint with legal weight, and it should be written
into the invariants list rather than left as a design preference.** Any future preview or
step-layer UI must be a viewer over the storyboard, never a source of truth.

**0.3 — Every gate we own is blind inside a `<canvas>`, and two agents proved it
independently by different routes.**
The R3F spike shipped a slide where the highlight ring is around one stage and the label
inside the ring, in the largest type on screen, names a different one — `hyperframes check`
passed with zero errors, 10/10 contrast. I opened `snapshots/frame-03-at-8.6s.png` myself
and it is worse than the report said: "Multi-Head Attn" sits over stage one and "Patch
Embed" sits inside the ring over stage two, so the diagram reads with two labels swapped,
while "× 12 blocks", "196 × 768" and "residual + LN" are illegible against the geometry
they overlap. Six of twelve in-canvas labels measured under the 40px floor, two at half of
it. The contrast gate checked two DOM nodes and reported 10/10.

The vanilla three.js spike hit the same class from the other side: growing a `Line2` via
`setPositions()` is silently clamped by `geometry._maxInstanceCount`, frozen on whichever
frame a worker happened to paint first. That build **passed `check` clean and rendered
byte-identically twice** while losing the entire gradient-descent trail — the payload of
the slide.

So: **the byte-identical render test, this project's strongest regression test, cannot see
inside a canvas.** A canvas slide can be deterministic and wrong at the same time, which is
the worst combination available because it never fails twice differently. This is
EXPERIMENT-001's "every gate passed on slides that were unusable" recurring one level
deeper, and it is structural rather than a tuning problem.

**0.4 — HyperFrames has a deferred-content protocol we are not using, and it is the best
open lead on EXPERIMENT-006.**
I verified this in the shipped bundle rather than taking it on report. `node_modules/hyperframes/dist/hyperframe-runtime.js`
contains, in its readiness function:

```js
if (window.__hfTimelinesBuilding) { window.__renderReady = !1; yu(); return; }
```

where `yu()` installs a one-shot `hf-timelines-built` listener that removes itself and
re-runs the check. The runtime **sets `window.__renderReady = true` itself** the moment a
timeline binds — which means the flag `composition.ts` sets for image decode is overwritten
by the runtime, and that is a precise match for EXPERIMENT-006's symptom: `img.decode()`
"narrows the window but does not close it." `__hfTimelinesBuilding` is a state flag the
runtime polls, not a clock, so it is not the rAF mistake EXPERIMENT-006 warns against
repeating. Try it against the figure-deck determinism failure before trying anything else.

The same file also settles a design question for any future backend:

```js
typeof u.totalTime == "function" ? u.totalTime(m, E) : u.seek(m, E)   // E = suppressEvents
```

The runtime seeks with `suppressEvents` both true and false. **Anything hung off a GSAP
`onUpdate` can be suppressed and must not be load-bearing.**

---

## 1. THE DECISION TABLE

Stop here and you will act correctly.

### Adopt

| Framework | The sentence that decides it | Rubric item |
|---|---|---|
| **opentype.js** (MIT, build-time) | Real glyph advances replace a per-character unit table with **9.4% mean and 36.3% worst-case error on Latin** (see review note in §3.2 — the "12.5% / 36%" first reported here mixed two populations), at zero deck bytes — and because an advance is `units/unitsPerEm × fontSize` it stays **linear in fontSize**, which is the property `fitBoxes` needs to solve for a size instead of searching for one. | 6 — zero bytes, strictly better inputs |
| **GSAP** (incumbent, keep + pin hard) | ~1 ms direction-independent random access over 1,960 tweens is exactly what makes both HyperFrames capture and the step layer work, and the pin is a permanent licence grant; 28 KB gz is the cheapest line in the deck. | 4 — nothing else seeks this well |
| **KaTeX** (incumbent, keep) | Synchronous, deterministic, no reflow loop, produces selectable tweenable DOM; MathJax is 5× larger and slower for more LaTeX we do not need. | 5 |

### Adopt-partially

| Framework | The sentence that decides it | Rubric item |
|---|---|---|
| **three.js** (MIT) — approved, **not scheduled next** | It seeks frame-exactly, renders byte-identically, fits behind `Scene` unchanged and draws a loss surface 2D SVG genuinely cannot — but it deletes **zero** lines, costs a 122 KB-gz floor plus a bundling step, and introduces the deterministic-and-wrong failure class of §0.3, so it ships only after the canvas is no longer a gate blind spot. | 7 — adds capability, deletes nothing |
| **Observable Plot** (ISC, build-time) | Byte-identical SSR, no animation code at all, zero runtime bytes, and six new chart types for 1–3 lines of spec each — adopt as a geometry source **behind** a new archetype's emitter, never to replace `line-chart.ts` or `bar-compare.ts`. | 6 + 7 — free at runtime, but net-new only |
| **WAAPI** (native, zero bytes) | `animation.pause(); animation.currentTime = ms` is byte-identical across processes and needed no rAF settle, so a `tl` seam thin enough to target it is cheap insurance now against §0.2 later. | 2 — hedges the one licence we cannot control |
| **Lottie** (`lottie_light`, MIT) — approved, **unscheduled** | The only candidate where a program emitted the input, seeked an absolute frame, got byte-identical pixels across processes *and* across seek order, and dropped behind `Scene` untouched — but it buys designer-authored components, which is a product decision nobody has made. | 3 + 8 — passes cleanly, answers an unasked question |

### Steal the idea

| Framework | What to take | Why not adopt |
|---|---|---|
| **Motion Canvas** (MIT) | `all()`, `chain()`, `waitFor()`, `sequence(stagger, …)` as a combinator tree flattened at **emit** time into GSAP position parameters. Generators are what force replay; the vocabulary does not need them. | Seek is replay: `next()` calls == frame index, 100–300× slower than GSAP on an identical scene and degrading with deck position. Also cannot render headlessly, and `Latex` inflates the bundle 11×. |
| **Manim** (MIT) | `TransformMatchingTex` — morphing one equation into another by matching subexpressions. That is `equation-walk`, done better, over KaTeX DOM with **zero new dependencies**. The single most valuable idea in the sweep. | Python runtime, renders straight to frames, no random access. |
| **kiwi.js / Cassowary** (BSD-3) | Priority-ordered soft constraints as the vocabulary for `fitBoxes` — `strong` on type size, `medium` on gap *is* "whitespace is cheaper than legibility". | Reproduces `fitBoxes` exactly, then throws `unsatisfiable constraint` instead of returning `{ok:false, needed}`; 196 KB to replace ~35 lines. |
| **Vega-Lite** (BSD-3) | A JSON-Schema'd declarative chart spec in beat params — the planner already emits schema-constrained JSON, so this idea is nearly free. | 9.4 MB of build deps and 3.9× deck bytes for what Plot does in 1.46 MB and 1.6×. |
| **drei** (MIT) | Read it for the patterns, then write the thirty-five lines. `<Billboard>` is `obj.quaternion.copy(camera.quaternion)`. | Its value is convenience for humans typing JSX, and no human is typing JSX here. A third of it is unusable (clock-driven or CDN-fetching) and nothing marks which third. |
| **Excalidraw / roughjs** (MIT) | `roughjs` alone gives the hand-drawn look inside our existing SVG emitters, with no editor attached. | Excalidraw is a canvas editor — invariant 3. |
| **Motion Canvas's editor architecture** | Code is canonical; the editor is a seek-and-inspect viewer that never owns state. The right shape for the step layer, and it is what keeps invariant 3 and the GSAP licence intact. | — |

### Reject

| Framework | The sentence that kills it | Rubric item |
|---|---|---|
| **React Three Fiber** | Solves a problem DeckSmith does not have — there is no component tree to reconcile in a scene regenerated from a storyboard every build — and charges 585 KB and a React runtime for JSX, while *defeating three.js tree-shaking* (702 KB vs 494 KB standalone). | 6 + 7 |
| **Theatre.js** | Its only differentiator is a studio invariant 3 forbids; 6,296 bytes of keyframe JSON to say what 1,034 bytes of GSAP source says, as a second animation runtime beside the one we already load. | 7 — purely additive, and worse |
| **@theatre/studio** | AGPL-3.0-only in a commercial product; the Apache-2.0 half is only the runtime. | 2 |
| **Remotion** | "Remotion for Automators — companies launching … **prompt-to-video apps**" at $0.01/render, $100/mo minimum; repo licence `NOASSERTION`. Re-verified today and the wording now names our category more explicitly than when we first rejected it. | 2 |
| **tldraw** | *"Not to use the Software in Production Environments"* absent a paid key, plus enforced watermark display and compliance telemetry. Remotion again. | 2 |
| **Revideo** | Fixes Motion Canvas's rendering problem — which we already solved by choosing HyperFrames — and inherits `PlaybackManager`'s replay-seek unchanged. | 4 |
| **ELK.js** | Given the beat as it reads, the default cycle-breaker destroys the reading order; given sizes we already solved, it reproduces our 4-line `tracks()` to 0.01px — 7.7 MB of EPL-2.0 for zero deleted lines. | 7 |
| **dagre** | ELK without the licence problem, doing the same nothing: it cannot fit four 430px boxes into 1696px, which is the only layout question this project has. | 7 |
| **Graphviz / viz.js** | The only engine that fits to a frame, and it does it by scaling type to 28px at six stages without saying so — plus 18%-narrow Korean metrics. | 7 + invariant 5 |
| **D2 / Mermaid** | Their value is a text syntax and we already have a typed `Storyboard`; the layout behind the syntax is the dagre and ELK above, and Mermaid measures text through a live DOM — the exact nondeterminism `svg.ts` exists to prevent. | 3 + 5 |
| **ECharts** | Emits its animation as wall-clock CSS `@keyframes` that `tl.time()` cannot move, and its SSR class names are a global ordinal counter so a second chart in the same process gets different markup. | 4 + 5 |
| **D3 (standalone)** | Net deletion ≈ 0 — `chartScale()`'s ≤4 ticks and non-degenerate domain for constant data are slide behaviours d3 lacks and we would write back on top; it arrives transitively with Plot anyway. | 7 |
| **Rive** | The only public `.riv` writer produces files the official runtime refuses to load as soon as an artboard holds two shapes, and it cannot write text at all — so "a program emits the input" is not currently true. | 3 |
| **Chart.js / uPlot / plotly.js** | Canvas: nothing for GSAP to select, redraw-per-frame instead of seek, own rAF loops. | 4 |
| **Recharts / visx / Nivo / LayerCake / billboard.js** | Each demands a component framework we do not have and should not acquire to draw a line. | 8 |
| **ApexCharts** | `"SEE LICENSE IN LICENSE"` is not a licence we verified. | 2 |
| **PixiJS / Konva / Fabric / Two.js / Paper.js** | WebGL or canvas scene graphs with no absolute-time setter (Konva's `Tween` is rAF-driven), or whose value is an interactive object model — a GUI feature. | 4 / 3 |
| **p5.js** | `draw()` is a wall-clock loop and the idiom is `frameCount`/`millis()`; LGPL besides. | 1 |
| **Babylon.js / PlayCanvas** | Both have genuinely correct seek — remember `AnimationGroup.goToFrame(n)` — but twelve 2D SVG archetypes do not need a 66 MB PBR renderer. | 6 |
| **Reveal.js / Spectacle / Slidev / impress.js** | Every one models a deck as discrete steps with CSS transitions: no timeline, no `seek(t)`, nothing for HyperFrames to capture. `src/deck/runtime.ts` already does the step layer *on top of* seekable timelines, which is strictly more powerful. | 4 |
| **JointJS** | 5.9 MB for the ~80 lines of `elbow`/`arrow` we hand-roll; the useful routing is in the commercial edition. | 7 |
| **MathJax** | 5× KaTeX's size and slower, for LaTeX coverage no source has needed. | 6 |
| **MathBox** | Unmaintained since 2023-05 and still on a release candidate; drags in three.js. | — |
| **Satori** | Genuinely good HTML→SVG with real flexbox and no browser, but we already lay out in Chromium and §0.4 is a better lead on the problem it would solve. | 7 |
| **troika-three-text** | Excellent SDF text, irrelevant once type stays in the DOM. | 8 |
| **anime.js** | Real `timeline.seek(ms)` and MIT — the named fallback if §0.2 ever bites, not a reason to migrate twelve emitters today. | — |
| **Framer Motion / motion** | Its proposition is declarative React components; we emit strings. | 3 |
| **popmotion** | Dead — last published 2022-08. | — |
| **ffmpeg.wasm** | `@ffmpeg/core` ships **GPL-2.0-or-later** at 61.7 MB; shipping it in a commercial product means shipping GPL, to do in-browser what native ffmpeg does in a subprocess. | 2 |
| **mediabunny / WebCodecs** | HyperFrames owns encoding, and hardware encoders are explicitly not bit-exact across machines — WebCodecs would break the byte-identical test outright. | 5 |

---

## 2. THE R3F + DREI + THEATRE.JS ANSWER

**Three.js yes, R3F no, Theatre.js no.** In those words. The measurements from both spikes
agree, and they agree for different reasons, which is what makes the answer safe.

### 2.1 Does WebGL capture deterministically under HyperFrames?

Yes, conditionally, and the conditions are not defaults.

Both spikes produced byte-identical mp4s. The R3F spike:
`bfb5708e…` twice under SwiftShader. The vanilla spike: `76afe230…` twice on hardware
ANGLE/Metal across 660 frames. But the two agents measured different axes and the
reconciliation is the actionable part:

| configuration | frames differing (of 360) |
|---|---|
| hardware Metal, no readiness gate | 162 |
| SwiftShader, no readiness gate | 3 |
| SwiftShader + gate | **0** |
| hardware + gate, same worker count | **0** |
| hardware + gate, 1 worker vs 4 workers | 85 (maxDelta 1) |
| SwiftShader + gate, 1 vs 4 workers | **0** |

So hardware is reproducible **only if the worker count is also pinned**, because changing
which Chrome process rasterised which frame changes the last bit of subpixels. SwiftShader
is reproducible unconditionally, at 3.3× realtime instead of 0.9×. HyperFrames' CLI default
is `browserGpuMode: "auto"`, and auto resolves to the host GPU. SwiftShader and Metal also
produce *different pixels* from each other — all 360 frames, up to 1.2% of subpixels — so
renders are not portable across backends.

> **[REVIEW 2026-07-27 — every row of the table above reproduces exactly; the conclusion
> drawn from it does not.]** I re-ran `analyze.mjs` over all six pairs and got 162 / 3 / 0 /
> 0 / 85 (all maxDelta ≤ 1) / 0 — identical to the table, which is the best-evidenced
> section of this document.
>
> But the table is PNG-sequence evidence, and the **mp4 artifacts this document cites in
> its own appendix contradict it end-to-end.** `renders/hw_1.mp4` and `renders/hw_2.mp4`
> are not byte-identical (`044e3e2e…` vs `245583ce…`, differing by 2,581 bytes). Decoding
> both with `ffmpeg -f framemd5`:
>
> | pair | decoded frames differing |
> |---|---|
> | `sw_1.mp4` vs `sw_2.mp4` | **0 of 360** |
> | `hw_1.mp4` vs `hw_2.mp4` | **252 of 360** |
>
> And the differences are not the sub-pixel kind the table reports: sampling frame 200,
> **14.78% of channels differ at maxDelta 22** (mean delta 2.22 over differing channels).
> Frames 3 and 100 were identical, so it is intermittent, not a uniform offset.
>
> These four mp4s were rendered *last* (09:03–09:04, after every PNG sequence), so they are
> the final state of the spike. **No render invocation was preserved** — there is no script,
> no log, and no config recording the flags — so it cannot now be determined whether
> `hw_1`/`hw_2` had a pinned worker count. Either they did, and the row "hardware + gate,
> same worker count → 0" is contradicted outright; or they did not, and the
> "1 vs 4 workers → 85 frames at maxDelta 1" row understates the real exposure by a factor
> of three in frame count and twenty-two in magnitude.
>
> **What is actually established:** SwiftShader is deterministic end-to-end, at the mp4
> level, twice. Hardware is deterministic *in a PNG sequence under conditions we can no
> longer reconstruct*, and non-deterministic in the only end-to-end artifact we have. The
> policy below (`--no-browser-gpu`) is therefore **more** justified than the text argues,
> and the "hardware is fine if you pin workers" reading must not be relied on. Any future
> WebGL work re-establishes the hardware result from a recorded command line or not at all.

**Policy, if any WebGL ever ships: pin `--no-browser-gpu` and pin the worker count, in the
build, not in a habit.** Also noted from the render log: `static-frame dedup: disabled
(canvas/webgl)`. Our decks hold for seconds at a time, and WebGL pays full rasterisation
for every held frame. For a commercial product with per-render cost that is a real line
item, not a footnote.

The three frames that differed under SwiftShader were not subtly different — they were
99.5% different, because one run had drawn the scene by frame 5 and the other still showed
a black canvas at frame 7. That is §0.4's bug, and fixing it is one flag.

### 2.2 What does React actually cost us here?

Measured twice, by two agents, with two build systems, and the numbers are consistent.

| | R3F + drei + Theatre | vanilla three + GSAP | delta |
|---|---:|---:|---:|
| minified | 1,313,140 B | 615,065 B | **+113%** |
| gzipped | 382,069 B | 169,273 B | **+126%** |

Composition of the R3F bundle: three.js 701,926 (53.5%) · **React stack 377,485 (28.8%)** ·
Theatre 108,033 · troika text 116,486 · **the actual scene 8,681 (0.7%)**.

Two facts do the deciding. The scene — the thing we are here to draw — is 0.7% of what
ships. And **three.js is 208 KB larger under R3F than standalone** (702 vs 494 KB) because
`extend()` names every three class against the whole namespace and defeats tree-shaking.
The independent spike confirmed this from the other direction: three has a ~122 KB gzip
floor and choosing addons moves it by ~10 KB, so *adopting three at all is the decision* —
but R3F cannot be tree-shaken at all, and costs **2.0× the gzip to render one third of the
scenes**.

React also buys us negative ergonomics on the axis we care about. The same point cloud is
**65 lines vanilla and 105 lines in R3F + drei** — 62% more, spent on `useMemo`,
`useLayoutEffect`, refs, and re-entering imperative code through `advance()`. The animation
is imperative either way; JSX wraps the part that was already easy.

And it fails the authoring question. R3F's input is JSX — *source that must be compiled* —
whereas DeckSmith emits HTML strings and GSAP statement text with no build step in the emit
path. That is survivable via pre-built per-archetype bundles, but it is a genuine
architectural import for zero deleted lines.

Worse, R3F actively fights capture. Its first frame after mount is **blank, and it is
exactly the frame capture wants**: on a correctly sized canvas the PNG is 58,790 chars at
mount, still 58,790 after 300 ms with no `advance()`, and 295,498 after one more `advance()`
with *identical state*. In the seek matrix that is the control's only mismatch — `t=0`
fresh vs `t=0` rewound differ by 2.4% of channels at maxDelta 254, blank canvas versus
scattered cloud, with identical tweened state. It also **defers the handle**: `createRoot().render()`
commits later, so `window.__3d[sid]` is not registered synchronously by `setup` and a `tl`
built in the same block tweens an object whose renderer does not exist yet. Vanilla three
has neither problem — `mount()` renders synchronously and its `t=0` matched all four seek
routes.

Finally, the flagship combination does not currently exist as a supported thing:
`@theatre/r3f@0.7.2` peers on `@react-three/fiber@^8.13.6` → `react >=18 <19`, and will not
install against fiber 9 / React 19 without `--legacy-peer-deps`.

**Reject R3F.** 585 KB, a React runtime, a blank-first-frame race, a deferred handle, and
62% more code, to delete nothing.

### 2.3 What does Theatre.js provide that a paused GSAP timeline does not?

Nothing. That is the whole answer, and it is not close.

Credit where it is due: Theatre's core is genuinely seek-friendly. `sequence.position = t`
is a synchronous setter and `obj.value` is a synchronous prism read, so an adapter can set
position and pull every value in one tick without waiting on Theatre's ticker. It is
frame-exact and deterministic as measured. A program *can* emit its state — the spike did,
with deterministic keyframe ids and no `Math.random`.

But both are keyframe interpolators with bezier easing and absolute seeking, and one of
them is already in the deck. The cost of the second one:

- **6,296 bytes of project-state JSON** for eight objects and ~24 keyframes, against
  **1,034 bytes of GSAP source** for the identical animation. Saying *"amount goes 0→1
  between 6.6 s and 7.6 s"* takes five nested fields, a `trackIdByPropPath` map and a
  `BasicKeyframedTrack` type tag.
- **108,033 B minified**, against zero for a library the deck already loads.
- A **second animation runtime** with two sets of times to keep in sync.
- It is not a GSAP timeline, so it is unreachable by `tl: string[]` at all — it cannot use
  the seam.
- **Last publish 2024-05-19, 26 months ago.**
- The studio — the entire reason the format exists — is **AGPL-3.0-only**, and it is the
  half that would be tempting to bundle into a preview build.

Theatre's value proposition is an editor. Invariant 3 says nobody opens it. Strip the
editor and what remains is a heavier, staler, non-seam-compatible way to express what
`.fromTo()` already expresses. **Reject.**

### 2.4 What survives: three.js, and only under conditions

The vanilla control passes on every rubric item that matters. It seeks by having no clock
at all — `renderer.render(scene, camera)` takes no time argument — and the load-bearing
wiring is one trick: **drive the render from a property setter, never from GSAP's
`onUpdate`**, because §0.4 shows the runtime seeks with `suppressEvents` both ways
(measured: 2 `onUpdate` calls vs 7 setter calls across the same four suppressed seeks).
Twenty-one frames × four seek routes plus a fifth `suppressEvents:false` pass gave **0
mismatches**. Two full renders were byte-identical. `hyperframes check` passed clean.

And I looked at both contact sheets rather than trusting either description. The difference
is not marginal. The R3F sheet has perspective-skewed labels crossed by their own leader
lines, attached to the wrong objects, wasting the top-right third of the frame. The vanilla
sheet — with **type in the DOM over the canvas** — looks like slides: crisp horizontal
pill-backed labels at consistent size, a scrim making contrast measurable, headlines the
layout gate can inspect. The 3D earns its keep in exactly the places 2D SVG cannot go: a
loss surface with a marker walking a precomputed descent path, five stages receding with
real depth.

**That comparison, not the byte counts, is the finding: the 3D layer should draw geometry
and nothing else, and every glyph should stay in the DOM.** Overlay type is gated,
contrast-checked, selectable, subtitle-able and translatable. In-canvas type is none of
those, and invariant 5 is literally unenforceable against it — a 2D emitter writes
`font-size: 42px` and a gate checks it, while a 3D emitter writes `fontSize={0.32}` and
nothing knows what that is in pixels until the camera arrives.

So the verdict on three.js is **adopt-partially, approved but not scheduled**, and the
blocker is §0.3 rather than anything about three.js itself. Two further constraints found
by measurement: **allocate every buffer at mount** and reveal with `instanceCount`, never
resize inside a render; and Chrome keeps **16 WebGL contexts** — of 40 requested, 16 lived
and 24 were silently killed oldest-first, so a deck with more than ~14 3D beats would lose
its opening scenes with no error. One shared renderer moved into the active scene fixes
that on the day it matters.

There is also a taste problem that is not a rendering problem. Three of five camera poses
needed hand-tuning to stop the camera flying through the geometry, and there is no gate for
"the camera is inside the diagram" either. Framing a 3D scene is a craft, the storyboard
LLM will do it blind, and every mistake it makes is one no current gate can catch. That is
planning-and-taste work, and it is the real reason this is a T2 item rather than a T1 one.

---

## 3. THE INTEGRATION SEAM

### 3.1 The Scene contract does not change

`Scene {html, tl, setup, holds, css}` survives every adopt and adopt-partially verdict
intact. That is the strongest structural result of the sweep and it is worth stating
plainly: **six investigations, ~60 frameworks, and nothing we are adopting demands a change
to the seam.** Plot and opentype.js are build-time and never reach it. three.js and Lottie
both fit through `setup` + `tl` unchanged. WAAPI sits behind `tl`.

> **[REVIEW 2026-07-27 — false for three.js and Lottie. This is the claim that fails when
> traced through the real code.]** I traced §3.5's proposed backend through
> `composition.ts` line by line. The *statement* half works: `sceneHtml()` emits
> `setup` inside an IIFE **before** `var tl = gsap.timeline({ paused: true })`, and
> `statement()` prefixes bare `.` lines with `tl`. So `setup: ["var h = DS3D.mount(…)"]`
> does put `h` in scope for `tl: [".fromTo(h.s, …)"]`. That much lands.
>
> **What does not land is `DS3D` itself.** `Scene` has exactly five fields and none of them
> can request a script. The head's tags are module constants (`GSAP_SRC`, `KATEX` at
> `composition.ts:29-30`). There *is* a per-archetype aggregation channel for CSS —
> `scene.css` is collected into `archetypeCss` and emitted once — but **there is no JS
> equivalent**. So an emitter cannot say "this scene needs the 3D bundle," and the options
> are all seam changes or worse:
>
> 1. add a field to `Scene` (e.g. `deps?: string[]`, mirroring how `css` already works) —
>    a contract change, small and symmetric, but a contract change;
> 2. hardcode the bundle in the head beside GSAP — every deck pays ~122 KB gz for a
>    capability most decks never use, and invariant 4 gets more expensive;
> 3. inline the bundle into `setup` — repeats it per scene.
>
> The same gap blocks Lottie, which also needs a runtime script. It does **not** affect
> Plot, opentype.js or WAAPI, which are build-time or native.
>
> The honest restatement: **the seam survives every framework whose output is markup or
> GSAP text, and fails for every framework that ships a runtime.** Both runtime adoptions
> in this document are in the second category. Option 1 is the right fix and it is cheap —
> but §5 must budget it, and §3.5 currently does not mention it at all.
>
> Note also that this is the *same* missing mechanism as §0.1: vendoring GSAP/KaTeX needs
> an asset-emission path from `emit` to the output directory, and `deps` is that path.
> Doing step 1 first therefore builds what step 9 needs, which is an argument for the
> existing ordering that §5 does not make.

The one thing that would have demanded a rewrite — Motion Canvas — is rejected, and its
good idea is a change *inside* `src/emit/kit.ts` that touches no invariant.

### 3.2 opentype.js — the one that deletes hand-rolled code cleanly

**Files:** `src/emit/svg.ts` (`charUnits`, `weightFactor`, `textWidth`), `src/source/fonts.ts`.
**Deletes:** the per-character unit table and its Latin-1 special case — roughly 40 lines of
guessing.
**Adds:** a build-time metric load and a cache.

The critical compatibility fact, which I checked in the source rather than assuming:
`textWidth`'s doc comment says it is *"Linear in `fontSize`, which is what lets `fitBoxes`
solve for a size instead of searching for one."* A real advance is
`advanceWidth / unitsPerEm × fontSize` — **also linear**. The closed-form solve survives.
Had it not, this adoption would be off the table.

Two caveats found the hard way in the spike: opentype.js 2.0 **throws** on Inter's `ccmp`
lookup via `getAdvanceWidth`, so sum `charToGlyph().advanceWidth` + `getKerningValue()`
manually; and it cannot parse WOFF2, so a TTF/OTF must sit beside the web font. Inter has
no Hangul — Korean must be measured against the CJK face separately, and given
EXPERIMENT-002 that is not optional. Graphviz's metrics were **18% narrow on Korean**
precisely because its Helvetica tables have no Hangul; we would be buying the same bug if
we measured Korean against Inter.

**Determinism note:** this changes every golden hash once, because every box gets a
slightly different size. That is a one-time expected break, and it should land in its own
commit with the goldens regenerated in the same commit so the diff is reviewable.

> **[REVIEW 2026-07-27 — the headline error figure mixed two populations. Verdict
> unchanged, number corrected.]** I re-ran `runtimes/spike-metrics.mjs`. It reproduces:
> `mean |err| = 12.5%   worst = 52.6%`. Note the worst — the document reported **36%**.
>
> Both numbers are in that output and neither is what was quoted. The spike measures 14
> strings, one of which is `"역전파 알고리즘"`, and `real()` computes width via
> `font.charToGlyph(c)` **against Inter** — which has no Hangul, so every Hangul syllable
> resolves to `.notdef` and `real = 234.0` is not a Korean width at all. That row scores
> 52.6% and is meaningless.
>
> So: the **12.5% mean is over all 14 rows including the invalid one**, while the **36%
> worst is over the 13 Latin rows only**. Taking a mean over a set and a maximum over a
> subset and presenting them as one measurement overstates the case for the adoption.
>
> | population | mean \|err\| | worst |
> |---|---|---|
> | all 14 strings (incl. invalid Korean row) | 12.5% | 52.6% |
> | **13 Latin strings (the valid measurement)** | **9.4%** | **36.3%** |
>
> Use 9.4% / 36.3%. The verdict does not change — a 36% error on `"i"` and `"lll"` is a
> real defect, the direction is systematic over-reservation, and the adoption is MIT and
> costs zero deck bytes. But note what the invalid row actually demonstrates: **opentype.js
> against Inter is exactly as blind to Korean as the table it replaces.** The Korean face
> is not a caveat to this work, it is half of it, and the spike never measured it.

### 3.3 Generalised `fitBoxes` — the largest deletion available anywhere in this sweep

Not a framework. `fitBoxes` is DeckSmith's only fixed-frame solver, it is 87 lines, and
**exactly one archetype uses it.** `stack.ts:134-142`, `split-compare.ts:128` and
`bar-compare.ts`'s `ITEM_SIZES = [42, 41, MIN_FONT]` each re-derive their own
size-against-available-width cascade inline.

Generalising it into the one place that answers *"what type size fits N things in W px, and
report when it cannot"* would delete more hand-rolled layout code than every library
evaluated in this experiment combined. Borrow kiwi.js's vocabulary — priorities, where
`strong` on type and `medium` on gap encodes "whitespace is cheaper than legibility" — and
none of its 196 KB, because Cassowary throws `unsatisfiable constraint` where we need
`{ok:false, needed}`.

**Files:** `src/emit/svg.ts`, then `stack.ts`, `split-compare.ts`, `bar-compare.ts`.
**Conflict risk: high** — those are archetype files the live workflow may be editing. Sequence
this after that work lands.

### 3.4 A `chart-plot` archetype — net-new, and honest about it

Do **not** rewrite `line-chart.ts` or `bar-compare.ts`. I looked at `charts/out/COMPARISON.png`
myself and the tuned Vega-Lite slide is the typographically cleanest of the three and
**rhetorically empty**: it has lost all four delta annotations (+0.97, +0.30, +0.20, +0.09),
so its headline — "Each extra tick buys less than the one before it" — makes a claim its
chart no longer supports. Its zero collisions are an artefact of having 16 texts to our 20.
The tuned Plot slide carries the full annotation set and looks genuinely close, and
overflows its own SVG box by 7.6px at the top, which `hyperframes lint` reports as
`container_overflow`. **Ours is the only one of the three that would pass our gates as
emitted.**

So the shape is: `beat → emitter → [Plot: data → scaled SVG geometry] + [ours: ids,
annotations, slide layout, choreography, holds, CSS] → Scene`. Plot runs at build time
inside the emitter against a `linkedom` document; `html` does not care who produced the
string; `setup` stays unused. Budget ~10 lines of DOM stamping because Plot's output is not
addressable — only `aria-label="line"|"dot"` on mark groups — and reparsing the `d`
attribute to recover point coordinates Plot computed and discarded.

**Prerequisite, and it is the valuable part:** extract the choreography helpers out of
`line-chart.ts` into something shared first. The seven `fromTo()` statements transplanted
onto Plot's and Vega's SVG **with only selector strings changed**. That refactor is worth
doing whether or not Plot ever lands.

### 3.5 A `scene-3d` backend — the design, held until §0.3 is closed

`src/emit/archetypes/scene-3d.ts`, plus an esbuild IIFE step (`format:"iife",
globalName:"DS3D"`) because `composition.ts` emits classic `<script>` and three has had no
UMD build since r150. esbuild is already a devDependency.

```ts
setup: [`var h = DS3D.mount('${sid}', ${json(spec)});`],   // same slot katex.render() uses
tl:    [`.fromTo(h.s, { walk: 0 }, { walk: 1, duration: 4.2, ease: 'power1.inOut' }, 2.2)`],
```

`h.s` is a plain object of numbers whose setters call `render()` — never `onUpdate`, per
§0.4. Planner-side the beat is `{kind, spec, labels[], moves[{prop,from,to,at,dur,ease}]}`:
a closed enum of backends and one animation vocabulary, which keeps the storyboard schema
constrainable.

Text is DOM, positioned by projecting 3D anchors, over a scrim — because a 3D backdrop has
no fixed luminance and the scrim is what makes contrast checkable at all. In the spike the
existing contrast and layout gates then found two real problems the author had not seen by
eye (a kicker at 1.24:1 over a bright surface; five captions stacked in 80 px), which is the
proof that keeping type in the DOM keeps the gates working.

**Explicit determinism policy, because silence here is how §0.3 happens again:**

1. A deck containing a `scene-3d` beat is rendered with `--no-browser-gpu` **and a pinned
   worker count**. Both, not either.
2. The golden-hash regression fixture stays image-free and 3D-free. It is valid for what it
   covers and must not be extended to cover what it cannot see.
3. A byte-identical result on a canvas deck is **not** evidence of correctness and may not
   be cited as such. The `Line2` bug passed that test while losing the slide's payload.
4. No 3D beat ships without a visual proof pass. Until a gate can see inside the canvas,
   the reviewer is the gate, and that must be written into the archetype's checklist rather
   than assumed.

The same policy paragraph applies verbatim to any Lottie beat.

### 3.6 The WAAPI hedge

Not a migration. One indirection: emitters build a small tween description and
`kit.ts` compiles it to GSAP statement text — which is the same change §4 wants for the
combinator vocabulary, so the two arrive together. WAAPI covers opacity/transform/filter,
which is most of what the emitters do; `anime.js` v4 is the named fallback for the rest
because it keeps the timeline abstraction. The cost today is a few dozen lines. The cost of
not having it, on the day §0.2 changes, is twelve emitters.

---

## 4. THE REVISED STRATEGY

### 4.1 What the sweep actually established

Every framework that could *draw* could not *decide*.

The two comparison images are the same result reached from opposite directions. ELK answers
"given these box sizes, how large a canvas?" and returns 2104px for a 1696px slide; we ask
"given 1920×1080, what sizes?" Those are dual problems, and nobody else solves ours because
nobody else has both a fixed frame and a legibility floor. Graphviz is the only engine that
fits to a frame and it does so by scaling type to 28px and reporting nothing. Meanwhile the
chart libraries, given the same eight lines of attention a real emitter would spend, draw an
equally good *plot* — and still do not draw the *slide*, because no library in the
evaluation has a primitive for annotating the segment between two consecutive points. That
is a narrative act, not a statistical one, and it was the entire argument of the slide.

**The moat is not the renderer. It is the layer that decides.** Concretely: a fixed frame, a
legibility floor that refuses rather than scales, an archetype vocabulary a planner can
choose from, choreography that makes an argument about which datum matters, and gates that
say no. All of that lives above the seam. Everything the sweep recommends adopting lives
below it (geometry, text metrics) or beside it (a 3D backdrop).

The corollary is uncomfortable and worth stating: **the parts of DeckSmith that are hardest
to build are not the parts that are hard to copy.** HyperFrames capture, GSAP seeking, SVG
emission — a competent team reproduces those in a month. The archetype vocabulary, the
planner prompt that chooses among archetypes, the `text_heavy_deck` gate, and the accumulated
taste in `fitBoxes` and `chartScale` are what took the six prior experiments, and they are
the only assets here that compound.

### 4.2 What stays hand-rolled because it *is* the product

- **`fitBoxes`, `MIN_FONT`, and `{ok:false, needed}`.** Refusing to emit a bad slide, and
  saying by how much it failed, is the product. kiwi.js throws; Graphviz silently shrinks;
  we report. That 87 lines is the most differentiated code in the repo.
- **`chartScale()`.** Thirteen lines encoding ≤4 tick labels at 40px on a 600px plot, and a
  non-degenerate domain for constant data — where `d3.scaleLinear().nice()` returns 6 ticks
  and a zero-width domain that divides by zero.
- **The choreography.** Dash-draw at `ease:"none"` (constant speed, not the constant *rate*
  a chart transition uses); `step = min(0.45, 1.8/n)` so a 5-point and a 12-point sweep take
  the same wall time; the endpoint singled out by size, tone and `BREATHE`; the delta
  annotations. No library in the sweep has an opinion about any of it.
- **The archetype vocabulary itself**, and the planner prompt that chooses among a closed set.
- **The gates**, including `text_heavy_deck`.
- **`svg.ts`'s primitives and `tracks()`.** Four lines that ELK reproduces to 0.01px.

### 4.3 What was just work we did before we knew better

- **`textWidth`'s unit table.** 12.5% mean error, 36% worst case, systematically
  over-reserving — which is why layouts look loose *and* still occasionally clip. Replace it.
- **`tl: string[]` as the emitter-facing API.** It forces every archetype to compute absolute
  times by hand, arithmetic both LLMs and humans get wrong. Motion Canvas's combinators
  (`all`, `chain`, `waitFor`, `sequence`) express relative structure, and — the extractable
  insight — **that vocabulary does not require generators.** Generators are what force
  replay. A declarative tree flattened at emit time into GSAP position parameters gives
  identical ergonomics with O(1) seek intact, because the emitter is a program and can
  flatten statically. `Scene.tl` stays exactly what it is: compiled output.
- **One archetype using the fixed-frame solver while three others re-derive it inline.**
- **CDN script tags.** §0.1.
- **`equation-walk`'s current transitions**, next to `TransformMatchingTex`.

### 4.4 What changes about the roadmap

**No renderer swap, and the question is closed.** HyperFrames + GSAP + SVG + DOM stands.
Six investigations went looking for a replacement and the only candidate that would have
forced one — Motion Canvas — trades O(1) seek for replay-from-zero, which is precisely
backwards for a random-access artifact. Stop re-litigating this.

**Promoted to near-term, none of which is a framework adoption:** the offline fix, the
`__hfTimelinesBuilding` experiment, opentype.js, the generalised solver, and
`TransformMatchingTex` for `equation-walk`. Four of those five are pure deletion or pure
correction of our own code.

**Demoted:** 3D. It is approved and designed, and it is behind a gate-blindness problem and
a camera-framing taste problem that are both T2 planning work. The best argument for
delaying it is its own spike: the prettiest 3D build in the experiment was factually wrong
and every gate said it was fine.

**New standing rule from §0.3:** a byte-identical render is evidence about the *pipeline*,
not about the *slide*, and it is evidence about nothing at all inside a canvas or a raster.
Where a gate cannot see, a human looks — and that is written into the archetype checklist,
not left to memory. EXPERIMENT-006 already found six defects that way; the sweep found two
more the same way.

**New standing rule from §0.2:** DeckSmith does not ship a visual animation editor. Any UI
is a viewer over the storyboard. This is now simultaneously invariant 3, our GSAP licence
compliance, and the reason Theatre.js and tldraw are rejected.

### 4.5 Compatibility with the work in flight

TTS narration, generation preferences, themes and `.deck` are landing in `src/` now. Nothing
in this document conflicts, but two items must be coordinated rather than started blind:

- **§0.1 (offline)** touches `composition.ts`'s head and needs vendored assets copied into
  the output directory — which overlaps directly with whoever owns `pack/` and the asset
  pipeline. Hand it to that workflow rather than opening a second front on the same files.
- **§3.3 (generalised solver)** touches `stack.ts`, `split-compare.ts` and `bar-compare.ts`.
  Sequence it after the theme work lands, since themes touch the same emitters.

Everything else — opentype.js, the combinator layer, `TransformMatchingTex`, the readiness
experiment — is either build-time or confined to files the other workflow is unlikely to be
in.

---

## 5. SEQUENCED NEXT STEPS

**1. Vendor GSAP and KaTeX into the built deck.** ~20 lines + an asset copy.
*Cost:* half a day, plus ~100 KB per deck. *Risk:* low; overlaps the in-flight asset
pipeline, so coordinate rather than race. *Wrong if:* the `.deck` workflow is already doing
exactly this — check first, in which case this is a five-minute confirmation instead.

**2. Try `__hfTimelinesBuilding` + `hf-timelines-built` against EXPERIMENT-006.** Set the
flag before the image-decode gate, clear it and dispatch after.
*Cost:* an hour to try, and it either fixes the top open item or it does not.
*Risk:* none — it is the runtime's own documented-by-implementation protocol.
*Wrong if:* raster nondeterminism is decode *timing* rather than decode *completion*, in
which case the flag narrows it further without closing it and we have learned where the
remaining window is. Measure with the four-render comparison EXPERIMENT-006 already used.

**3. Comment the GSAP pin as a licensing instrument; archive the licence text; add "no
visual animation editor" to the invariants.**
*Cost:* an hour. *Risk:* none. *Wrong if:* legal counsel reads §VI.2's grandfather clause
differently than we do — which is exactly why a written confirmation before commercial
launch is cheap insurance.

**4. Replace `textWidth`'s unit table with opentype.js advances.** Build-time, zero deck
bytes, MIT.
*Cost:* one to two days including the Korean face and the `ccmp`/WOFF2 workarounds.
*Risk:* medium — it regenerates every golden hash once, so it must land alone with the
goldens in the same commit. *Wrong if:* per-character advance summing diverges from
Chrome's shaped width enough to matter — ligatures, kerning pairs, and any complex script.
The check is to measure both against the live DOM on the existing fixtures before deleting
the old path, and to keep the estimator behind a flag until that passes.

**5. Extract the choreography helpers out of `line-chart.ts` into `kit.ts`, and add the
combinator layer (`all`/`chain`/`waitFor`/`sequence`) that flattens to GSAP positions at
emit time.**
*Cost:* two to three days. *Risk:* medium — it is the emitter-facing API, so it touches
every archetype eventually; do it additively and migrate one archetype at a time.
*Wrong if:* the absolute-time arithmetic turns out not to be a real defect source — check
the last few emitter bugs for timing errors before committing. The refactor is worth it for
the `chart-plot` prerequisite regardless.

**6. Port `TransformMatchingTex`'s subexpression matching into `equation-walk` over KaTeX
DOM.**
*Cost:* three to five days; this is a real algorithm, not a wiring job.
*Risk:* medium-high on quality, zero on architecture — no new dependencies, no new bytes.
*Wrong if:* KaTeX's DOM does not expose stable enough subexpression boundaries to match on,
which is the first thing to spike. Highest quality-per-byte item in the sweep.

**7. Generalise `fitBoxes` and delete the three inline cascades in `stack`,
`split-compare`, `bar-compare`.**
*Cost:* two days. *Risk:* high conflict risk with the in-flight theme work — sequence after
it lands. *Wrong if:* the three cascades encode genuinely different policies rather than the
same one written three times; read all three before generalising, and if they differ, the
answer is three named policies over one solver, not one solver.

**8. Add a `chart-plot` archetype backed by Observable Plot, only when the storyboard needs
a chart type we lack.** Not before.
*Cost:* two days once step 5 is done. *Risk:* low; zero runtime bytes.
*Wrong if:* Plot's Node-side margin estimation cannot be made to stop overflowing the SVG
box — it estimates glyph widths with no font loaded, and our 7.6px `container_overflow` came
from exactly that. Step 4 gives us real metrics to hand it, which may be the fix.

**9. Build the `scene-3d` backend — after a gate can see inside a canvas, or after the
visual-proof requirement is written into the archetype checklist and honoured.**
*Cost:* a week for the backend, plus the unbudgeted planning work of teaching a storyboard
LLM to frame a camera. *Risk:* the highest in this list, and the risk is not technical —
three.js measured clean on every rubric item. It is that a 3D slide can be deterministic,
gate-passing, beautiful and wrong, and the only current detector is a person looking.
*Wrong if:* the archetype gaps 2D still has turn out to matter more to real decks than depth
does — which is the more likely outcome, and the reason this is ninth rather than second.

**Not scheduled, deliberately:** Lottie (waiting on a product decision about
designer-authored components), the WAAPI hedge (arrives free with step 5's indirection),
roughjs, and anything three.js beyond step 9.

---

## Appendix — where to reproduce

| Claim | Command / file |
|---|---|
| WebGL determinism, both backends, worker-count sensitivity | `experiments/007-frameworks/r3f/analyze.mjs`, `renders/{sw,hw}_{1,2}.mp4` |
| R3F bundle composition (esbuild metafile) | `experiments/007-frameworks/r3f/build.mjs` |
| The mislabelled 3D slide that passed every gate | `experiments/007-frameworks/r3f/snapshots/frame-03-at-8.6s.png` |
| Vanilla three: seek matrix, byte-identical render, `Line2` bug | `experiments/007-frameworks/three-vanilla/measure/{seek,bisect,diff}.mjs` |
| The DOM-text-over-canvas result, by eye | `experiments/007-frameworks/three-vanilla/snapshots/contact-sheet.jpg` |
| Motion Canvas seek is O(frames) | `experiments/007-frameworks/motion-canvas/spike/measure-heavy.mjs` |
| ELK destroys the pipeline's reading order | `experiments/007-frameworks/layout/side-by-side.png` (panel B) |
| Chart libraries vs the shipped emitter at 1920×1080 | `experiments/007-frameworks/charts/out/COMPARISON.png` |
| Lottie: program-emitted, seekable, deterministic, behind the seam | `experiments/007-frameworks/runtimes/{gen-lottie,spike-seam}.mjs` |
| Rive's writer cannot write two shapes | `experiments/007-frameworks/runtimes/bisect-rive.mjs` |
| `textWidth` error vs real Inter advances | `experiments/007-frameworks/runtimes/spike-metrics.mjs` |
| HyperFrames readiness protocol | `node_modules/hyperframes/dist/hyperframe-runtime.js`, grep `__hfTimelinesBuilding` |
