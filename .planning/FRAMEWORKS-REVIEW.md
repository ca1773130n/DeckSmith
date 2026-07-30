# Adversarial review of FRAMEWORKS.md

**Date** 2026-07-27 · Reviewer: seventh agent, reading after the six investigations and the
synthesis. Brief: assume a gate passed and the output is still wrong, because that has
happened five times on this project.

**Summary judgement.** The document is unusually well-evidenced. Its single most important
quantitative claim — the WebGL determinism matrix — reproduces exactly, row for row, on
re-run. Its two gate-blindness findings are real and I confirmed both by opening the
artifacts. Its licence work is correct against the actual `LICENSE` files. Its bundle
numbers come from a real esbuild metafile and are exact to the byte.

Four claims are wrong. One of them is the document's self-described "strongest structural
result." All four are corrected in place in `FRAMEWORKS.md`, marked `[REVIEW 2026-07-27]`.
**None of the four changes an adopt/reject verdict.** That is worth saying plainly: the
verdicts are better supported than the prose that defends them.

The most serious thing I found is not in the list of four. It is in §7.

---

## 1. Did the spikes actually run?

Yes — with one exception, and one provenance gap that matters.

| Spike | Artifacts on disk | Ran? |
|---|---|---|
| `r3f` | 10 × 360-frame PNG sequences (3,600 PNGs), 9 mp4s, 256 KB esbuild metafile, snapshots | **Yes**, expensively |
| `three-vanilla` | 4 mp4s, seek-report.json, 6 full-res snapshots, contact sheet, buggy-build gate log | **Yes** |
| `charts` | 3-panel comparison PNG, 9 timed shots, 12 coverage SVGs, run1/run2 SSR pairs | **Yes** |
| `layout` | 4 rendered variants + side-by-side, SVG outputs | **Yes** |
| `runtimes` | Lottie frames at 5 seek points, Rive A/B frames, metrics spike | **Yes** |
| `motion-canvas` | **No output artifacts at all** — source only | Ran, but saved nothing |

**Motion Canvas saved zero artifacts.** No JSON, no PNG, no log. Its numbers were
unverifiable from disk. I re-ran it (`vite --port 5199`, then `measure-heavy.mjs`) and it
reproduces the substance:

```
t=22s  → abs frame 1320 → 1320 next() calls → seek 105.4 ms
t=41s  → abs frame 2460 → 2460 next() calls → seek 265.9 ms
mean cost per generator advance: 0.098 ms/frame
```

`next()` calls == absolute frame index, and seek cost grows linearly with deck position.
"Seek is replay" is confirmed, and so is "degrading with deck position." Against GSAP's
~1 ms this is the claimed 100–300×. **Verdict stands; the evidence now exists.**

**The provenance gap.** No spike wrote a `FINDINGS.md`. I searched the whole repo — none
exist. The brief asked each agent for one. The synthesis is therefore the *only* surviving
prose, and every intermediate reasoning step is gone. That is how §2.1's contradiction below
survived to publication: the raw artifacts disagreed with the write-up and there was no
intermediate document in which anyone had to reconcile them.

**Also gone: the render invocations.** There is no script, log or config recording the flags
used to produce `r3f/renders/*.mp4`. This is what makes correction §2 unresolvable rather
than merely wrong.

---

## 2. Correction 1 — hardware WebGL determinism (§2.1). The most consequential.

**The table reproduces perfectly.** I re-ran `analyze.mjs` over all six pairs:

| configuration | doc | my re-run |
|---|---:|---:|
| hardware Metal, no gate (`seqA`/`seqB`) | 162 | **162** ✓ |
| SwiftShader, no gate (`swA`/`swB`) | 3 | **3** ✓ |
| SwiftShader + gate (`sw2A`/`sw2B`) | 0 | **0** ✓ |
| hardware + gate, same workers (`hw2A`/`hw2B`) | 0 | **0** ✓ |
| hardware + gate, 1 vs 4 workers (`hw2A`/`hw2C`) | 85, maxDelta 1 | **85, all ≤1** ✓ |
| SwiftShader + gate, 1 vs 4 (`sw2A`/`sw2C`) | 0 | **0** ✓ |

Six for six. This is the best-evidenced section of the document and it deserves the credit.

**But the mp4s the document cites in its own appendix contradict it.** `hw_1.mp4` and
`hw_2.mp4` are not byte-identical. Decoding both:

```
sw_1 vs sw_2 :   0 of 360 decoded frames differ
hw_1 vs hw_2 : 252 of 360 decoded frames differ
```

And not subtly. Sampling frame 200: **14.78% of channels differ at maxDelta 22**, mean
delta 2.22. Frames 3 and 100 were identical — so it is intermittent, not a uniform offset.
This is two orders of magnitude beyond the "maxDelta 1" the table reports for the
worker-count axis.

Those four mp4s were rendered *last*, at 09:03–09:04, after every PNG sequence. They are
the spike's final state. Because the invocations were not preserved, we cannot tell whether
they had a pinned worker count — so either the "same worker count → 0" row is contradicted
outright, or the "1 vs 4 workers → 85" row understates the exposure by 3× in frame count
and 22× in magnitude.

**What is actually established:** SwiftShader is deterministic end-to-end, at the artifact
level, twice. Hardware is deterministic in a PNG sequence under conditions we can no longer
reconstruct, and **non-deterministic in the only end-to-end artifact that exists.** The
document's `--no-browser-gpu` policy is *more* justified than its own text argues. The
reassuring "hardware is fine if you pin the worker count" reading must not be relied on.

---

## 3. Correction 2 — the seam does not survive unchanged (§3.1)

The document's self-described strongest structural result:

> "six investigations, ~60 frameworks, and nothing we are adopting demands a change to the
> seam. … three.js and Lottie both fit through `setup` + `tl` unchanged."

I traced §3.5's proposed backend through `src/emit/composition.ts`. **The statement half
works.** `sceneHtml()` emits `setup` inside an IIFE before
`var tl = gsap.timeline({ paused: true })`, and `statement()` prefixes bare `.` lines with
`tl`. So `setup: ["var h = DS3D.mount(…)"]` genuinely does put `h` in scope for
`tl: [".fromTo(h.s, …)"]`. Credit where due — that part was checked and is right.

**`DS3D` itself has no way to exist.** `Scene` has exactly five fields. The head's script
tags are module constants at `composition.ts:29-30`. There is a per-archetype aggregation
channel for **CSS** — `scene.css` collects into `archetypeCss` and emits once — and **no JS
equivalent**. An emitter cannot say "this scene needs the 3D bundle."

So three.js needs one of: a new `Scene` field (a contract change), an unconditional
~122 KB gz head script on every deck, or the bundle inlined per scene. Lottie needs the
same. Plot, opentype.js and WAAPI are unaffected — they are build-time or native.

**Honest restatement: the seam survives every framework whose output is markup or GSAP
text, and fails for every framework that ships a runtime.** Both runtime adoptions in the
document are in the second category.

The fix is cheap and symmetric — a `deps?: string[]` field mirroring `css`. Two things
follow that the document does not say: §5 must budget it, and **it is the same mechanism
§0.1 needs** (an asset path from `emit` to the output directory). Doing step 1 first builds
what step 9 needs. That is a real argument for the existing ordering that the document
never makes.

---

## 4. Correction 3 — the offline mechanism (§0.1)

The document's #1 priority item. The priority is right. The mechanism is wrong, and the
real defect is narrower, nastier and unidentified.

**HyperFrames already inlines external scripts.** `node_modules/hyperframes/dist/cli.js`
contains `inlineExternalScripts()`: `querySelectorAll("script[src]")`, fetch each, replace
the tag with `/* inlined: ${src} */` + source, log `[Compiler] Inlined CDN script: …`.

That log line is **in this sweep's own captured output** —
`three-vanilla/measure/buggy-report.txt` line 15 names the exact GSAP URL. An agent
captured it, pasted it into a file, and nobody read it.

Consequences:

1. **The video path is not a render-time network dependency.** GSAP and `katex.min.js` are
   inlined at compile time, before the browser opens. The "invariant-2 violation (network at
   render time)" claim is withdrawn for this path.
2. **Stylesheets are not inlined.** No "Inlined CDN stylesheet" path exists in `cli.js`;
   `externalStyles` is a lint structure, not an inliner. So `katex.min.css` **is** fetched
   live by the capture browser on every render of every deck with an equation. That is the
   real invariant-2 violation.
3. **The failure mode is a warning.** The inliner's `else` branch calls
   `defaultLogger.warn("Failed to download CDN…")` and continues. A deck built on a flaky
   network renders **without GSAP** and produces a silently frozen video that will pass a
   byte-identical check against another equally frozen render.
4. **Invariant 4 stands** for the navigable path — `deck.html`, the step layer and `.deck`
   see raw CDN links.

Point 3 is a better example of this project's documented failure mode than either of the two
the document found.

---

## 5. Correction 4 — the opentype.js error figure (§3.2)

Re-running `spike-metrics.mjs` gives `mean |err| = 12.5%   worst = 52.6%`. The document
reported **12.5% mean and 36% worst**. Both numbers appear in that output; neither is what
was quoted.

The spike measures 14 strings. One is `"역전파 알고리즘"`, and `real()` computes width via
`font.charToGlyph(c)` **against Inter**, which has no Hangul — so every syllable resolves to
`.notdef` and `real = 234.0` is not a Korean width. That row scores 52.6% and is invalid.

The 12.5% mean is over all 14 rows **including** the invalid one; the 36% worst is over the
13 Latin rows **only**. A mean over a set and a maximum over a subset, presented as one
measurement.

| population | mean \|err\| | worst |
|---|---|---|
| all 14 (incl. invalid Korean row) | 12.5% | 52.6% |
| **13 Latin (the valid measurement)** | **9.4%** | **36.3%** |

Verdict unchanged — 36% error on `"i"` and `"lll"` is a real systematic over-reservation,
MIT, zero deck bytes. But note what the invalid row actually shows: **opentype.js against
Inter is exactly as blind to Korean as the table it replaces.** Given EXPERIMENT-002, the
Korean face is not a caveat to this work — it is half of it, and the spike never measured it.

---

## 6. What I checked and found sound

**The WebGL matrix** — six of six, above.

**Licences, read from the installed `LICENSE` files, not summaries:**

| package | `package.json` | actual file | doc |
|---|---|---|---|
| `@theatre/studio` | AGPL-3.0-only | GNU AFFERO GPL v3 | ✓ |
| `@theatre/core` | Apache-2.0 | Apache License | ✓ |
| `three` | MIT | MIT | ✓ |
| `@react-three/drei` | MIT | MIT | ✓ |
| `@react-three/fiber` | MIT | **no LICENSE file** | not claimed |
| `opentype.js` | MIT | present | ✓ |
| `@observablehq/plot` | ISC | present | ✓ |
| `@lume/kiwi` | BSD-3-Clause | no file | ✓ |
| `vega-lite` | BSD-3-Clause | present | ✓ |
| `gsap` 3.14.2 | `Standard 'no charge' license: https://gsap.com/standard-license.` | **no LICENSE file** | ✓ |

The GSAP claim is exactly right, including that the package carries no licence text — the
directory holds `README.md` and no `LICENSE`. **§0.2's recommendation to archive the licence
text beside the pin is correct and I would raise its priority**, because there is currently
no local record of the terms we are relying on.

**Bundle numbers — from a real esbuild metafile, exact to the byte.** I recomputed the
composition from `out/meta.json` independently:

- three 701,926 (53.5%) ✓ · Theatre 108,033 ✓ · troika 116,486 ✓ · scene 8,681 (0.7%) ✓
- "React stack 377,485" ✓ — reproduces exactly as react + react-dom + scheduler + fiber +
  drei + its-fine + zustand + suspend-react + use-sync-external-store + @babel/runtime +
  three-stdlib + react-use-measure + camera-controls. The last three are drei's
  dependencies rather than React's, which is a defensible attribution, but worth knowing.
- gzip: I measure 378,881 / 167,663 vs the document's 382,069 / 169,273 — a compression-level
  difference. **The ratio is identical: +126%.** ✓

**The tree-shaking claim is real, and I verified the mechanism rather than the number.**
`@react-three/fiber/dist/react-three-fiber.esm.js` contains `import * as THREE from "three"`
— a namespace import, which is exactly what prevents esbuild from proving which members are
dead. three measures 701,926 under R3F against 494,225 vanilla in the *same* build system
(and 521,462 in the independent spike). This is the strongest single argument in §2.2 and it
holds up under inspection, not just measurement.

**§0.3, gate blindness — both routes confirmed.**

I opened `r3f/snapshots/frame-03-at-8.6s.png`. The document is right and slightly
understates it. A ViT runs Patch Embed → Multi-Head Attention → MLP → Class Head. The image
shows **"Multi-Head Attn" on stage one and "Patch Embed" inside the highlight ring on stage
two** — the two labels are swapped, and the ringed stage is captioned "Attention is
all-to-all" while being labelled "Patch Embed" in the largest type on screen. `× 12 blocks`,
`196 × 768` and `residual + LN` are illegible against the geometry they overlap. The
top-right third of the frame is empty.

I read `three-vanilla/measure/buggy-report.txt`. The `Line2` build:

```
◆  Checking out-buggy
  0 error(s), 0 warning(s), 2 info(s)
  ◇ 20/20 text checks pass WCAG AA
◇  Check passed
```

and `buggy-1.mp4` == `buggy-2.mp4` (`87c4228c…`, byte-identical) while the slide had lost
its entire payload. **Deterministic and wrong, confirmed.** §0.3 is the most valuable
finding in the document and it is fully supported.

**§0.4, the HyperFrames protocol** — verified in the shipped bundle. `__hfTimelinesBuilding`
present; `__renderReady=!0` appears exactly once, so the runtime does set it itself;
`hf-timelines-built` present. The document's quote is reformatted from
`__hfTimelinesBuilding){window.__renderReady=!1,yu()` but semantically accurate.

One detail the document missed, which supports its own conclusion: the seek is a *double*
seek — `n.totalTime(i+.001,!0), n.totalTime(i,r)`. The runtime nudges forward with
`suppressEvents` hard-coded `true`, then settles back with the caller's flag. Anything hung
off `onUpdate` fires at `t+0.001` as well as `t`. "Never drive the render from `onUpdate`"
is more strongly justified than stated.

**Other confirmations:** `seek-report.json` gives `suppressed: {viaCallback: 2, viaSetter: 7}`
— the document's "2 vs 7" is exact, and the GL string confirms hardware
(`ANGLE Metal Renderer: Apple M4`). Plot / Vega-Lite / ECharts SSR are byte-identical
run-to-run. `sw_1` == `sw_2` and `van_1` == `van_2` byte-identical. `composition.ts` CDN
links confirmed (at lines 29-30, not 22-23 — corrected). Fonts are **not** a CDN dependency:
`bundleFont()` vendors subsetted woff2 into the output and caches by content hash.

**The charts comparison** — I opened `COMPARISON.png`. Panel C has indeed lost all four
delta annotations while keeping the headline "Each extra tick buys less than the one before
it." The rhetorical-emptiness argument is fair and well made.

---

## 7. What all seven of us missed

**Not one spike ran DeckSmith.**

Every investigation built a standalone directory with its own `package.json`, its own
bundler, its own HTML page and its own harness, and asked "could this fit behind `Scene`?"
Every one answered by reasoning about the contract rather than by emitting through it. There
is no spike anywhere in `007-frameworks/` that calls `emit()`, produces a real composition,
and renders it.

That single habit explains three of the four corrections above:

- The **missing script channel** (§3) is invisible until you try to get a bundle into
  `composition.ts`'s `<head>`. Nobody did, so seven people concluded the seam was unchanged.
- The **CDN inlining** (§4) was sitting in a log file that a spike captured and saved. Read
  from inside the pipeline it is obvious; read as a framework question it is invisible.
- The **hardware/mp4 contradiction** (§2) required comparing an artifact from the start of a
  session against one from the end. Each spike validated its own frames, and no one
  validated the deliverable.

And it explains the strategic gap. The document's central assertion — arrived at across
~60 frameworks and stated as the sweep's main result — is:

> "The moat is not the renderer. It is the layer that decides."

**That layer was never measured.** Not one spike ran the planner, exercised the storyboard
schema, or tested whether an LLM chooses archetypes well. Every one of ~60 frameworks was
evaluated on whether it can *draw* and *seek* — and the conclusion drawn is about *deciding*.
The document even names the risk in §2.4 ("the storyboard LLM will do it blind") and in
step 9 ("the unbudgeted planning work of teaching a storyboard LLM to frame a camera")
without noticing that this is the one claim in the document with zero measurements behind it.

The sweep was structured to evaluate frameworks *beside* DeckSmith rather than *inside* it,
and it therefore produced excellent evidence about everything except the thing it concluded
was the product.

**A smaller instance of the same blindness, visible in the sweep's own image.** In
`COMPARISON.png` panel A — DeckSmith's *shipped* emitter, the one the document holds up as
"the only one of the three that would pass our gates as emitted" — `+0.09` and `30.47`
collide into `+0.0930.47`, and `+0.20` runs into `30.38`. Our current output has a
legibility defect that no gate catches and that seven agents looked past while using that
image to argue we are better than Vega-Lite. §0.3 is more general than the document claims:
it is not that gates are blind *inside a canvas*. It is that **nobody looks at the pictures**,
and the canvas is merely where that is guaranteed rather than likely.

---

## 8. Remaining unverified

Listed as unverified rather than passed along:

- **SwiftShader 3.3× realtime vs hardware 0.9×** — no timing log preserved.
- **Chrome's 16-WebGL-context limit** (40 requested, 16 lived) — plausible and matches
  Chrome's documented behaviour, but no artifact.
- **"6 of 12 in-canvas labels under 40px, two at half"** — `probe.mjs` exists; I confirmed
  the *illegibility* by eye but did not re-run the measurement.
- **Remotion's and tldraw's licence wording** — quoted from the web, not re-fetched. Given
  the commercial stakes these two should be re-read and archived before launch, as §0.2
  recommends for GSAP.
- **The layout spike's numbers** — ELK's 2104px, `tracks()` to 0.01px, Graphviz's 28px and
  the 18%-narrow Korean metrics. Artifacts exist; I did not re-run.
- **Rive's writer failing at two shapes**, and the Lottie seek/determinism results. Frames
  exist for both; I did not re-derive.
- **`@theatre/r3f` peer-dependency conflict** — not reproduced (the package is not installed;
  the spike used `@theatre/core` directly).
- Whether `hw_1`/`hw_2` were rendered with a pinned worker count. **Unresolvable** — the
  invocations are gone.

---

## 9. Should DeckSmith use React Three Fiber, drei and Theatre.js?

No — and the document reaches the right answer, though one of its three rejections is
better argued than the evidence strictly supports. **Theatre.js is the clearest no:** its
entire value is an editor that invariant 3 forbids anyone from opening, its runtime is a
second keyframe interpolator beside a paused GSAP timeline that already does absolute
seeking, it is unreachable by `tl: string[]` so it cannot use the seam at all, it costs
108,033 measured bytes to say in 6,296 bytes of JSON what GSAP says in 1,034 bytes of
source, it has not published in 26 months, and the half that makes it worth having is
AGPL-3.0-only in a product meant to be sold. **R3F is a no for a quieter reason than the
document gives:** the honest R3F-only cost is not the +698 KB headline — that figure carries
Theatre and troika, which the document separately rejects and deprecates — but it is still
~355 KB of React plus 208 KB of three.js that stops tree-shaking because
`react-three-fiber.esm.js` namespace-imports the whole namespace, and it buys reconciliation
of a component tree that a storyboard regenerates from scratch every build, which is not a
problem this project has. The blank-first-frame race and the deferred handle are real and I
would weigh them more heavily than the bytes, because they are capture correctness rather
than cost. **drei is a no by inspection rather than by measurement** — it contributed 5,500
bytes to the bundle and its value is convenience for a human typing JSX, and there is no
human typing JSX; read it for patterns and write the thirty-five lines, exactly as the
document says. What survives is three.js, and the document is right to approve it and right
to refuse to schedule it — but I would sharpen the reason: not "wait until a gate can see
inside a canvas," which is an open research problem that may never close, but **"wait until
someone commits to looking at every 3D frame, in writing, in the archetype checklist."**
The prettiest build in this entire sweep was factually wrong about the architecture it
depicted, ten out of ten contrast checks passed on it, and the only reason we know is that
one reviewer opened a PNG.
