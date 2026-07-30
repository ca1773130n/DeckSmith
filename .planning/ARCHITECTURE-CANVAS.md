# ARCHITECTURE-CANVAS — the verdict on abandoning the slide

**2026-07-27.** Synthesis of experiment 008 (five probes: `experiments/008-canvas/{camera,gap,products,pixi,planner}`).
Every number below was re-verified against the artifacts on disk before it was written down.

---

## 1. The verdict

**Keep the slide. Keep the stop. Lose the cut — selectively, and only where the source hands us a reason.** The
advice to abandon the concept of a slide is half right and the wrong half is the prescription. The strong half of
the claim is confirmed and is worse than it was stated: our scenes are isolated islands joined by
`el.style.display = showing ? "" : "none"` (`src/deck/runtime.ts:231`), and across the s2→s3 boundary of our own
demo there are **zero identical boxes and zero shared strings** — nothing carries, not even by accident. The weak
half is rejected outright. Not on taste, on three measurements. First, narration: `src/narrate/narrate.ts:47` is
`stopCount(emitScene(beat, ctx).holds)` — the TTS segmenter counts a beat's holds and lays one sentence per stop.
Stops are the unit of narration, and the feature being built this hour dies the moment stops dissolve. Second,
video: two renders of the camera deck are byte-identical
(`c43e620b…`, `12bc96f7…`, `a0a501c6…`, each pair verified by `shasum -a 256` on
`experiments/008-canvas/camera/renders/`), and they are byte-identical **because the camera is two `fromTo`s with
closed-form eases and nothing else** — the first version of that camera drove `viewBox` from an `onUpdate`, played
perfectly in a browser, and rendered 900 frames of a frozen `0 0 1920 1080` because `timeline.seek(t)` defaults to
`suppressEvents = true`. A continuous model that is not a pure function of `t` cannot ship to YouTube at all.
Third, the market already ran this experiment: Prezi shipped infinite-canvas-plus-camera in 2009 and its
number-one user complaint is motion sickness, with the standard expert mitigation being *place your objects closer
together so there is less zoom and swoop* — advice that converges, at its limit, on a deck.

**What survived of the continuity claim, precisely:** a camera moving through one shared coordinate space between
two beats is buildable, deterministic, and free at render time — measured at **20.3–21.8 ms/frame against the
baseline's 21.0–23.8 ms/frame**, where run-to-run variance on one project exceeds the difference between projects.
It reads as continuity rather than as a fancier crossfade **only when the source supplies a containment or
adjacency relation** between the two beats. The camera does not create that relation; it renders one that already
existed. Counting honestly over the twelve-beat demo, **two or three of eleven transitions** have one
(`b03→b04`, `b02→b03`, arguably `b05→b06`). A bar chart of parameter counts has no position inside the method's
diagram, and flying to it would be exactly the decorated cut the whole exercise is meant to avoid. So the
architectural consequence is not an infinite canvas. It is **one optional field on a beat** — *this beat happens
inside that element of that beat* — asserted by the planner when the source supports it, ignored otherwise.

**And continuity is not the expensive half of the answer, which is the finding that should change the roadmap.**
The camera probe's cross-scene world costs ~2× video bitrate (`481 kbps → 989 kbps`, from 1,622,449 B / 27 s to
3,710,068 B / 30 s), +16% composition bytes, a rewrite of `planTransition` and `paint()`, and a *reserved
interior* that most of our archetypes structurally do not have. The **in-scene** camera — the same mechanism, one
scene, no shared world, no runtime change at all — costs nothing and fixes the larger defect. Because the real
reason a generated deck of ours feels mechanical is not the boundary between slides. It is that we render **one
fixed wide framing, twelve times**, over a canvas that is roughly half empty, with a single ambient animation
below the perceptual threshold. The concept to abandon is not the slide. It is the fixed wide shot.

---

## 2. What we are actually missing

Look at `experiments/008-canvas/gap/sheet-slides.png` — all twelve demo slides at once — before reading the list.
The diagram sits in the upper third of most of them and the lower 30–50% of the frame is empty. That is what the
camera is really fixing.

Three facts, all verified rather than reported:

- **One framing, twelve times.** `getComputedStyle(.scene).transform === "none"` on **12/12** scenes; every
  headline at x=110, 66px, ink width exactly 1700px on all twelve. Statically confirmed: the only `scale:` tweens
  in the twelve archetypes are entrance pops (`0.97→1`, `0→1`, and `equation-walk`'s `1→1.16`). No group ever
  moves.
- **Nothing is ever dimmed.** Across all twelve emitters there are 41 `opacity: 0 → 1` tween pairs and **not one
  tween that takes an element below 1**. The only sub-1 opacities in the codebase are static attributes
  (`annotated-figure.ts:404` halo fill 0.22, `grid.ts:395` leader stroke .62). "Highlight" is additive only, so it
  competes with a fully-lit frame instead of owning it.
- **The one aliveness mechanism we shipped is invisible.** EXPERIMENT-005 proved `ds-breathe` runs; nobody
  measured whether it is seen. On a held slide, `getAnimations().length === 1`, and two screenshots three seconds
  apart differ by **max delta 16 of 765** summed over RGB, on one 350×200 box. `gap/diff-hold.png` is that diff
  amplified 6× to make it visible at all.

### Ranked, by value over cost

| # | Work | Evidence it matters | Cost | Verdict |
|---|---|---|---|---|
| 1 | **In-scene camera** — a `.ds-cam` wrapper around the content region only, never the headline | `gap/cmp-p1-camera.png`, bottom row: the stage under discussion fills the frame instead of occupying 8% of it. `k = 1.55–1.75`, four shots | 1 wrapper div, 1 CSS rule, N `fromTo`s. `transformOrigin` is geometry the emitter already solved (`pipeline` has `cx(i)`, `grid` has every region rect) | **Do first** |
| 2 | **Figure morph** — tween between two crops of the same figure | `gap/cmp-p2-morph.png`: "Dense-Query Tokens", "Pixel-wise Dense Token Field", "DQ-CTM" go from illegible to readable *as motion*. Direct fix for EXPERIMENT-006's standing complaint | `annotated-figure.ts:504` already derives the plate rect from a crop. Morph = `scale = A.w/B.w`, `x = leftB−leftA`, `y = topB−topA`. Four numbers, one `fromTo` | **Do first** |
| 3 | **Spotlight / dim** | Nothing in the deck ever dims; see above | One `fromTo` per archetype over a "not this one" selector | **Do** |
| 4 | **Match-cut seam** — end beat N framed on the object beat N+1 opens on | `gap/seam-overlay.png` — a 50/50 blend across the boundary; the paper figure's DQ-CTM panel lands on our diagram's DQ-CTM box, words nearly superimposed | **Zero runtime change.** `paint()` still hard-swaps `display`; a cut you cannot see is not a cut. The planner already knows two beats are about the same object | **Do — this is the cheap half of "lose the cut"** |
| 5 | **Cross-scene camera over a shared world** | `camera/shots/strip-move2.png` — you pull back, the method reassembles with the box you just left still lit, you slide right, the next box opens. Verified in the shipped mp4, not just the browser (frames extracted at t=9.7 and t=20.5 from `dom-final-6.mp4`) | 2× bitrate, `planTransition` + `paint()` rewrite, an archetype capability that most archetypes lack | **Defer behind 1–4** |
| 6 | **Moving background** | Absent: `bodyBgImage: "none"`, 0 elements with any `background-image`, 12/12 scenes | One `fromTo` on a gradient | **Cheap, low value. Last** |

### Correctly skipped, and staying skipped

- **Parallax.** Built and measured in the camera probe at depth 0.42 on the dot field. It is visible, correct, and
  decorative — on a flat field it carries no information about where you are. It would only pay if the far layer
  said something (section structure, say). Not recommended as-is.
- **Particles.** Either wall-clock-driven (violates invariant 1) or a pre-baked deterministic field — a new
  subsystem for decoration, on a canvas with a 40px text floor.
- **Infinite canvas.** Collapses to a camera path the instant the deliverable is video, and costs the deep-linking
  (`#3.2`, Home/End) the education market needs.

### The finding under the finding

The camera reads so well partly *because* our canvases are half empty — there is nothing to lose by cropping. That
is a diagnosis, not a compliment. Two of the top four items above are motion fixes for a **layout and typography**
problem, and the layout problem is worth fixing on its own terms (§3).

---

## 3. The competitive read

**"The story engine is the moat" is still true, and it is truer than we claimed — it applies to the products, not
just to the renderers.**

Gamma, the product cited as proof that slides are over, was measured with Playwright against a live public deck
(`experiments/008-canvas/products/evidence/gamma-dom-measurements.json`; use `gamma.app/embed/<slug>`, `/docs/`
serves a bot an empty shell):

```
present mode, card-to-card:   transition: opacity 0.2s
.motion-present-mode-bg:      backgroundImage none · animationName none · 0 children · solid rgb(170,188,182)
elements with a running CSS animation: 0      canvas: 0      WebGL: false
```

The div literally named `motion-present-mode-bg` is the letterbox colour. The moving background attributed to
Gamma does not exist. Underneath it is Next.js + React + a **ProseMirror/TipTap document** whose complete node
schema is `card · cardLayoutItem · smartLayout · smartLayoutCell · gridLayout · gridCell · table · image ·
contributors`. **No chart node, no diagram node, no equation node, no annotation node.** Gamma cannot draw. Of 63
SVGs in an 18-card deck, 55 are Font Awesome icons. The only per-card design axis is `data-card-layout ∈ {left,
right, top, behind}` — where the picture goes. Its generation API's entire structural surface is `numCards` and
`cardSplit`: how many cards and where the text breaks. `exportAs: pptx | pdf | png`. **There is no video**, and
there is an open feature request just to preserve *animations* in the exports it does have.

Nobody in this market has a story engine. NotebookLM's structural output is a script plus an image prompt — its
slides are flat rasters from Nano Banana, which means a picture of a slide: unmeasurable, unretargetable to 9:16,
text-in-raster with documented typos, and diffusion-nondeterministic, i.e. forbidden by our invariants 1 and 2
outright. Napkin's is a structure classifier feeding a template picker (and it validates our
classify-then-select-an-archetype shape, while occupying only the still-diagram half, with a human choosing).
Beautiful.ai's is zero — a person types. **Combined with PRIOR_ART.md — PPTAgent, Paper2Video and Paper2Poster all
*place* the paper's existing figures and none redraws the method as motion — the seat is empty. Nothing to
soften.**

Two things to take from this that are not congratulatory:

**Tome is dead** (product shut 30 Apr 2025, decks deleted, team now builds a CRM). Its stated cause was
commercial, not format, so do not overclaim — but the AI presentation product that went furthest from the fixed
page is gone, and the one that kept the card leads the category. Against that, **scrollytelling is the existence
proof for our synthesis**: verified live on a Pudding piece — DOM + SVG, 100 SVGs, zero canvas, `position: sticky`
graphic, `[data-step]` markers, IntersectionObserver. A persistent graphic mutated by discrete ordered steps with a
continuous input between them. The practitioner consensus is that steppers give crisper animation *precisely
because* movement is discrete and triggered. A decade of practice landed on keep the stop, lose the cut. Its own
discipline's warning applies to us verbatim: scrollytelling is not scrolljacking, and a camera that moves the
viewer without the viewer asking is the same failure.

**And the uncomfortable one, which I checked by looking.** `evidence/gamma-card1-smartlayout.jpeg` is a serif
display heading over three tinted rounded boxes, one sentence each. It carries perhaps a twentieth of the
information of any slide in `gap/sheet-slides.png`. It also looks better, and the reason is not motion — it is
type, palette and whitespace applied with total consistency by a theme system. Our deck is dark, information-dense
and half empty; theirs is warm, thin and full. We are ahead on drawing and on deterministic video, and we lose a
side-by-side at the same size today. That is the cheapest quality-per-effort work available and it belongs in the
plan alongside the camera, not behind it.

---

## 4. The architecture change

**Adopt the animation planner's split as the target contract. Do not migrate to it now. Ship the three helpers
first.**

The gap the planner probe identified is real and its evidence is not an opinion about `stack.ts` — it is `pace()`
in `src/emit/theme.ts`, whose entire implementation is two regexes over generated JavaScript
(`TIMES`, `AT`). A scalar multiplier is the only preference expressible over a string. Rhythm, emphasis and
camera stay impossible while choreography is text. The proposed split is right: emitters return
`Figure{html, css, cues}` with geometry and no times; a planner produces `Move[]`; `compile` is the only thing
allowed to write a `fromTo`; and `holds` becomes *derived* from `Cue.step` rather than pushed by hand alongside a
tween written eight lines earlier. That inversion alone removes a class of silent bug — today
`holds.push(at + 0.62)` can drift off the tween it was authored for and no gate sees it. The proof is credible:
the `even` rhythm, extracted from `stack.ts`'s own constants, reproduces all five item stops exactly
(`[0,0,0,0,0,-0.08]`; the tail differs only because the original spends 0.6s on its note).

### But the smaller alternative captures nearly all of the *visible* value, so it goes first

Everything in §2 items 1–4 — camera, morph, spotlight, match-cut — is a `fromTo` on a timeline that already
exists, inside the `Scene` contract exactly as `src/emit/kit.ts` defines it today. The gap probe demonstrated all
three as **patches over the real built composition**, adding only one wrapper element, one CSS rule, and tween
statements. Nothing about them needs `Figure`, `Cue`, `Move`, or a migration. What the planner adds on top is
*preferences* (rhythm, emphasis, density) and the representation cross-beat carries will eventually need — both
worth having, neither worth blocking the camera on. So: **`kit.ts` grows three helpers that return `tl` strings;
the planner lands after, opt-in per emitter, when a preference is actually being asked for.**

### Three corrections to `planner/DESIGN.md` before any of it lands

**(a) `narrate.ts` is a second call site of `emitScene` and the design does not account for it.** DESIGN.md sizes
the integration at ~6 lines in `composition.ts`. There are two callers, not one: `src/emit/composition.ts:127`
(`pace(emitScene(beat, ctx), speed)`) and `src/narrate/narrate.ts:47`
(`stopCount(emitScene(beat, ctx).holds)`). Under the split a migrated emitter returns a `Figure` with no `holds`,
so `stopCount(undefined)` throws — and if it were made to degrade instead of throw, every migrated archetype would
report one stop and **silently desynchronise its narration**, which is the exact failure narrate.ts's own doc
comment says the module exists to prevent. Both call sites must go through the same `choreograph(figure, seconds,
style)` with the same `Prefs`. Corollary, and it is a hard constraint: **any preference that changes the number of
stops is forbidden** unless narration is regenerated with it. `density: "sparse"`, described in DESIGN.md §4 as "a
policy that splits a step into two", changes stop count and therefore changes which sentence lands on which frame.
Rhythm and emphasis are safe (they move stops in time, and `pace()` already scales `holds` the same way); density
is not.

**(b) Reject the safe-box camera budget. Adopt the cropping camera instead.** DESIGN.md pays for its in-scene
camera by inseting every figure 10% permanently, and the measured return is a zoom ceiling of **1.127**. Look at
`planner/out/shots/emphatic-hold0.png` next to `even-hold5.png`: a 12.7% zoom is not a camera, it is a nudge, and
the 10% tax is charged whether or not a camera is ever planned. The gap probe's model gets `k = 1.55–1.75` — a
framing that unmistakably reads — for zero geometry cost, by three rules: the camera wraps the **content region
only** (the headline is the beat's claim and the audience needs it at every stop, so chrome stays off the camera
layer); the scene gets `overflow: hidden`; and elements not under discussion are **allowed to leave the frame**.
That last rule is the whole difference, and it is legal because the type floor is a rule about what is *visible*,
not about what exists.

**(c) The 40px floor stops being checkable by construction and must move into a browser.** Today an emitter writes
`font-size: 40` and a static read of emitter output is proof, because render scale is exactly 1 everywhere,
forever. Under any camera the same 40 renders at 40px, 8px or 200px depending on the framing. The camera probe's
rewritten rule is the right one and is already implemented and passing (`camera/build/typefloor.mjs`, 14 stops,
0 violations, `minFinal = 40.0` exactly at every stop):

> At every stop time `t_s`, for every text node `n` intersecting the viewport:
> `effOpacity(n, t_s) == 0` **OR** `finalPx(n, t_s) >= 40`,
> where `finalPx = computedFontSize × screenScale` measured in the browser and `effOpacity` is the product of
> computed opacity to the root. **Transit is exempt**, and is exempt only because the deck never rests between
> stops — a coupling to the runtime rule below that must be revisited with it.

This is a genuine loss: the rule moves from "cannot be violated by construction" to "is verified after the fact",
and it costs one more browser pass on top of `hyperframes check`. Take the loss; it is the price of any framing
change at all.

### Two rules that must become lint, because both shipped green and both were wrong

1. **No `onUpdate`-driven motion, ever.** `seek()` passes `suppressEvents = true` (HyperFrames' own transport calls
   `totalTime(t, suppressEvents)`), so a callback camera plays perfectly in a browser and renders a frozen video,
   silently, with a passing gate.
2. **No `will-change: transform` on a text-bearing subtree.** Measured: promoting text to its own compositor layer
   and scaling it by a non-integer factor gives **3–5 distinct images for the same `t` over 5 revisits**. Deleting
   the one declaration gives 1 of 1 at every probe. A raster subtree is unaffected — the morph keeps it on the
   `<img>`.

Both belong beside the existing `unscoped_gsap_selector` and `fromTo`-only rules. They are the sixth and seventh
documented cases of a green gate over wrong output. (The fifth was a dropped `id` on a scene box in the camera
probe: `grid` scopes its stagger as `#s2 .gcell`, GSAP logged "target not found" to a console nobody reads, and the
slide rendered with every cell dark and looked plausible in a screenshot.)

### What changes in `src/deck/runtime.ts` — and when

Nothing, for items 1–4. In-scene cameras, morphs, spotlights and match cuts are tweens inside a scene's own
window; `glide()` already sweeps a forward step by seeking, so a camera move inside that span animates for free.

Item 5 (cross-scene camera) needs three changes, and one of them is not optional:

- **`MAX_SPAN = 2.5` deletes the entire feature.** It cuts any step longer than 2.5 s on the reasoning that a long
  span crossed a slide boundary and is mostly the outgoing hold — correct for isolated scenes, exactly wrong for a
  continuous one. Measured on the built island, the two camera moves are the two steps at spans **3.55** and
  **7.17**: in deck mode today they are precisely the two steps the runtime refuses to animate, so a presenter sees
  a hard cut between two 5× framings, strictly worse than the crossfade we have. The fix is not a bigger constant —
  the deck must publish `entry: { start, end }` per slide and `planTransition` must return a piecewise plan
  (cut to `move.start`, play `move.start → move.end` at 1×, cut to the stop). `MAX_SPAN` then disappears.
- **`paint()` assumes scene ids name clips.** On a continuous deck the ids name plates whose visibility is owned by
  the timeline, so `display` toggling would hide the plate the overview framing exists to show. One branch on a
  `continuous: true` flag the island already has room for: seek every registered timeline at `t − data-start`,
  touch no `display`.
- **Backward must play the camera in reverse while cutting the plate content.** A camera move played backwards is
  just a camera move, and it is the single most valuable thing to reverse because it re-establishes where you are.
  This requires camera and content to be separable — which means the camera lives on the **root** timeline and
  plates on per-plate timelines, i.e. keep today's two-level structure and add the camera above it. The camera
  probe flattened everything onto one timeline and calls that its one structural mistake; do not repeat it.

`buildStops`, `parseHash`, `formatHash` and `findStop` need no change: every stop lands on its framing to within
**9.6e-6 in scale and 5 milli-pixels in centre**, and seek-order independence was proved over 61 sample times in
ascending, descending and fixed-seed-shuffled orders across three browser sessions, 0 mismatches.

### Compatibility with what is landing now

- **TTS narration synchronised to stops** — preserved, and improved: `holds` derived from cues cannot drift off
  its tween. The one hazard is (a) above; treat it as a blocker on the planner, not on the helpers.
- **Generation preferences** — the helpers are orthogonal (`pace()` scales a camera `fromTo` like any other). The
  planner is what makes rhythm/emphasis expressible at all, and is the reason to do it eventually.
- **Theme templates** — orthogonal, and per §3 the highest-value work in the repo right now.
- **`.deck` container** — orthogonal. Cameras are DOM+CSS+GSAP, self-contained and offline, no new asset class.

---

## 5. What Pixi and WebGL are for

**One future archetype. Not a renderer, and not now.**

Pixi is orthogonal to the claim under test — it is a rasteriser, not an architecture. It says nothing about camera
paths or continuity and it does not help with isolated islands. Against SVG for text and vector diagrams it loses
on every axis that matters here: metrics disagree with the layout engine by up to **1.5%** so you cannot position
Pixi text with DOM math; the 4K path silently blurs unless Pixi is re-initialised at the capture DPR; and,
decisively, **`hyperframes check` goes blind inside a canvas** — both Pixi compositions fail the layout gate with
`sweep_static — Timeline did not advance under seek` despite provably frame-exact motion (adding one moving DOM
element flips it back to 0 issues, so the cause is confirmed, not assumed). It also **falls back to a Canvas2D
renderer silently** with zero errors and zero warnings, drawing a plausible-looking frame that differs in 7.96% of
subpixels. Paying 137 KB gzip — 5× the whole GSAP runtime — to make typography slightly worse and delete our
automated verification is not a trade.

The one case that survives is genuinely good: **high-cardinality data that cannot be DOM nodes.** At 60,000 points
SVG is 40.7 ms/frame against Pixi's 1.6 ms — 25×, i.e. a presented deck at 25 fps — and 2.5× the cost per captured
frame. Below ~5,000 elements SVG is free and Pixi buys nothing; the crossover is 10–20k. WebGL does capture
deterministically under HyperFrames (60/60 and 64/64 frames byte-identical across renders; 9/9 across independent
processes, cold and warm). So: reserve one `swarm` emitter that returns a `Scene` whose `html` is a `<canvas>` and
whose `tl` drives `render(t)`; typography stays in the DOM above it; blast radius one archetype. Preconditions if
it ever ships: never use `Application`; stop `Ticker.shared` **and** `Ticker.system`; re-init at capture DPR; and
hard-fail on `renderer.name !== "webgl"`. Nothing in the current demo needs 10,000 elements. Not scheduled.

---

## 6. The sequenced plan

Each step names the observation that would prove it wrong. A screenshot someone actually looked at is part of the
definition of done for every one of them.

**0. Move the type floor into the browser.** `src/verify/` gains a stop-by-stop seek that evaluates
`effOpacity == 0 OR finalPx >= 40` per visible text node. Port `camera/build/typefloor.mjs`.
*Cost:* half a day. *Risk:* one more browser pass per check; the guarantee weakens from structural to verified.
*Falsified if:* it flags the current demo. It must pass 12/12 unchanged before anything else moves — that is the
regression baseline. (It passed 14/14 stops on the camera probe's decks with `minFinal = 40.0` exactly.)

**1. Two lint rules.** Reject `onUpdate`/`onComplete`-driven motion in emitted `tl`; reject `will-change:
transform` on any subtree containing a text node. *Cost:* an hour. *Risk:* none. *Falsified if:* an existing
archetype trips either — it would mean we already ship a frozen or flickering frame, which is worth knowing
immediately.

**2. `kit.ts` gains `camera()`, `spotlight()`, `morph()`.** Each returns `{ wrap?, css, tl }` in the shape the
`Scene` contract already defines. Wire the camera into `pipeline` and `grid` first (both already compute the
region rects the camera needs), the morph into `annotated-figure` (already derives its plate from a crop), the
spotlight into `data-table` and `bar-compare`. *Cost:* 2–3 days. *Risk:* the camera crops something the audience
needed; step 0 catches it at every stop and transit is exempt by design. *Falsified if:* side-by-side stills of
the same beat with and without the camera do not look better to a person who was not told which is which — the
`gap/cmp-*.png` comparisons are the format. Watch the bitrate on the resulting mp4; if an in-scene camera also
doubles it, the video cost is a property of motion rather than of continuity and item 5 gets more expensive, not
less.

**3. Typography and whitespace pass on the theme.** Not motion. `evidence/gamma-card1-smartlayout.jpeg` beside any
frame of `gap/sheet-slides.png` at the same size. *Cost:* 2–3 days, no architecture. *Risk:* none technical.
*Falsified if:* the side-by-side still favours Gamma afterwards — in which case the problem is layout solvers, not
styling, and that is a bigger and more important piece of work than any of this.

**4. Match-cut seams.** The storyboard already knows when two adjacent beats concern the same object; end beat N
framed on it and open beat N+1 on it at the same screen rect. No runtime change. *Cost:* 1–2 days once step 2
exists (it is step 2's camera used at a boundary). *Risk:* the solver picks a match that is coincidental rather
than semantic and produces a jarring near-miss. *Falsified if:* a 50/50 seam blend (`gap/seam-overlay.png` is the
method) shows the two objects landing more than a few percent apart on more than the occasional beat.

**5. `Figure` / `Cue` / `Move`, opt-in per emitter.** Ship `motion.ts` plus one migrated archetype; eleven emitters
keep returning `Scene` through `pace()` and stay byte-identical. Fix the `narrate.ts` call site in the same commit.
Migration test per archetype: does the `even` rhythm reproduce the stops the hand-written timeline produced?
*Cost:* ~193 choreography lines across 12 emitters, 6 of which need the `Cue.custom` escape hatch; budget an
afternoon each for `bar-compare`, `annotated-figure` and `equation-walk`, under an hour for the rest.
*Risk:* narration desynchronisation (§4a) — the one that must be gated. *Falsified if:* migrating the second and
third archetypes takes longer than the first, meaning the vocabulary is not generalising and a helper layer would
have been enough.

**6. Cross-scene camera, gated on a planner-asserted containment relation.** Requires `Scene` to gain a way to name
its enterable regions — a change to the seam in `kit.ts` and the largest single piece of work implied here — plus
the `planTransition` / `paint()` / two-level-timeline changes in §4. *Cost:* 1–2 weeks. *Risk:* the archetype
vocabulary has to declare which archetypes can be *entered*; `pipeline` has box interiors that serve as ports,
`bar-compare`, `line-chart` and `data-table` do not and could not be given one without changing what they draw.
*Falsified if:* over a corpus of real storyboards the planner asserts a containment relation on fewer than ~20% of
transitions, or the 2× bitrate proves unacceptable for YouTube delivery. On the demo it is 2–3 of 11, which is
already close to the line.

**Never:** infinite canvas, particles, parallax on a flat field, Pixi as the deck renderer.

### One thing to check that is not on this plan

The planner probe found that two decks agreeing on the computed style *and every attribute* of all 72 nodes at a
stop can still produce PNGs differing in 286 of 2,073,600 pixels — and that on a **fresh load**, seeking straight
to the stop makes them identical. The difference is compositor state left behind by the path through the timeline,
not content. Which means our strongest regression test — "two renders are byte-identical" — holds because both
renders take the *same path*, and that is a weaker guarantee than "the frame at time `t` is a function of `t`". The
camera probe's shuffled-order purity test is the shape of the check that would close the gap. Worth running against
the real render path independently of anything above.
