# Renderer fit: does a compositional vocabulary change the renderer answer?

**No.** And the reason is measurable rather than architectural: DeckSmith's
animation vocabulary is *already* a pure function of `t`. GSAP is applying it,
not defining it. A 120-line evaluator with no GSAP reproduces every animated
value in a real twelve-archetype deck exactly. Remotion's frame-purity — the
one architectural thing it has that we do not — is a property we already have
and did not know we had.

The coupling that would make the renderer decision depend on the vocabulary
decision is **twelve non-comment lines** in 19,849 lines of TypeScript.

---

## 1. The spike: is `Scene.tl` a GSAP program, or data wearing a GSAP costume?

This is the question the whole area turns on. If a `tl` statement needs GSAP
semantics to mean anything, the host is load-bearing and every vocabulary
decision has to be taken with the host in mind. If it is a declarative tuple,
the host is a detail.

**Method.** Take the *built* deck (`demo/deck/index.html`, all twelve
archetypes, 117 `tl.fromTo` statements — not the emitters, so what is counted is
what shipped). In a browser, for each statement, seek the scene's real GSAP
timeline with `suppressEvents` — the capture path — and read back the value GSAP
actually applied. Independently, evaluate the *same statement text* with a
hand-written pure evaluator that never touches GSAP:
`v = from + (to − from)·ease(clamp((t − at − stagger(i))/dur))`. Compare.

Scripts: `classify-tweens.mjs`, `pure-eval.mjs` in this directory. The
comparison itself ran in-page (both evaluators in the same JS context, only one
of them with access to `gsap`).

### Result

| pass | checks | semantic mismatches |
|---|---|---|
| numeric props (`opacity, x, y, scale, scaleY, fillOpacity, strokeDashoffset`) | 1,756 | **0** |
| plugin-shaped props (`attr.width`, `textContent`+`snap`, `color`, `fontWeight`) | 64 | **0** |
| **total** | **1,820** | **0** |

8 sample points per tween per element, up to 6 elements per selector, across all
12 scenes.

**What this measurement counts, and what it does not.** It counts the *value
GSAP applied*, read back through `gsap.getProperty` — i.e. computed style. It
does **not** count rasterisation. 100 of the comparisons differed by ≤0.51 units
and were classified as readback quantisation, not semantics: computed
`strokeDashoffset` comes back integer-quantised, so a predicted 456.45 reads as
456. That is a property of the *readback*, not of the animation — if I had
counted those as mismatches I would have reported a 3.6% failure rate that
means nothing. This is the "check what your measurement counts" trap and it
caught me once: my first pass reported 36 mismatches, 30 of which were this.

**The one genuine semantic gap, and its size.** The naive evaluator got GSAP's
`stagger: { grid: [8,12] }` wrong — GSAP orders grid staggers by *euclidean
distance from the anchor*, not by array index. That is **one statement in the
whole deck** (`#s4 .gcell`), and the fix is 9 lines. After it, zero mismatches.

**Eases actually used, across the whole deck:** `power1.out` (the GSAP default,
69 statements — note it is *not* linear; getting that wrong is a ~4% mid-tween
error that looks like noise), `power2.out`, `power2.in`, `power3.out`,
`power2.inOut`, `back.out(2)`, `none`. All closed form, all reproduced in 12
lines. **Zero** callbacks, **zero** `keyframes`, **zero** `repeat`, in 117
statements.

### The camera, which is the hard case

The camera is the only part of the vocabulary that is not a plain lerp: its
target framing is *measured in the browser* (`getBoundingClientRect`) and its
eases are closed-form functions of that measurement. It is memoised on first
render — which under capture means the first `seek()`, at whatever `t` that
happens to be.

I built a deck with a dive (`b03 inside b02.stage1`, built into the scratchpad,
`hyperframes check` PASS) and probed the same six times in three orders:
forward, reverse, and scattered.

```
orderDependent: 0            (bit-identical across all three orders)
fresh page, first seek at the LANDING rather than the start: bit-identical
```

And the closed-form ease is reproducible outside GSAP given the one measured
scalar: at mid-dive, `scale = k^dsSmooth(0.5) = √2.7383 = 1.65478` against
1.6548 measured.

So even the camera is `pure(t) ∘ measure_once`. The `measure_once` is not
GSAP's fault and Remotion does not remove it — a React component that needs an
element's laid-out rect measures it in a ref effect and holds a render with
`delayRender`, which is the same shape of seam with a different name.

### What follows

Invariant 11 exists because the GSAP *API* offers `onUpdate`, and someone
reached for it. It is a guardrail against a footgun, not evidence of a broken
model. The vocabulary that shipped never fires a callback; it is 117
declarative tuples. Remotion removes the footgun by not having it — genuinely
worth something — but it does not make the vocabulary any more frame-pure than
it already measurably is.

**A compositional vocabulary would be *more* of this, not less.** A `Transform(a,
b)` between two structures is an interpolation between two structures: more of
the deck becomes data, less becomes statements. The direction of travel reduces
the host's leverage rather than increasing it.

---

## 2. What we would lose, specifically

Not "HyperFrames is good". Item by item, with what survives a move.

| What | Lost? | Detail |
|---|---|---|
| `hyperframes check` — 5 passes (lint, runtime, layout, motion, contrast) in one Chrome | **Yes, really** | Our adapter is 274 lines (`src/verify/check.ts`); the *gates* are someone else's. Remotion has no equivalent. Rebuilding layout/motion/contrast passes is the single largest uncounted cost of a move. |
| `lint`'s `unscoped_gsap_selector` (invariant 3) | Lost, but **obsolete** | It enforces scene-scoped selectors. In a component model a scene's styles are structurally its own — the rule becomes unnecessary rather than unenforced. Net zero. |
| `lint`'s `slideshow_unresolved_ref` (invariant 8) | Lost | Real. It caught the overlapping-slide problem the handoff work is built around. |
| The slideshow island format | Lost, **neutral** | It is HyperFrames' schema. The *concept* (slides + fragments + holds) is ours, and we already ship our own narration island beside it precisely because adding fields to someone else's schema is a bet you lose on their next release. |
| `drift` — byte-identical double render | **Survives** | `src/verify/drift.ts` is ours; it shells `hyperframes render --format png-sequence`. Remotion renders PNG sequences. The gate ports. **The evidence it has accumulated does not** — see §4. |
| CSP-sandboxed deck serving | **Survives** | `src/server/http.ts` is ours end to end. A Remotion Player bundle is static JS and serves fine under `allow-scripts allow-same-origin`. |
| "A built deck is a directory of static files with no React runtime" | **Partly true today** | Measured: `index.html` 69,689 B, `deck.html` 27,978 B, player 58,215 B, our runtime 11,703 B. But the shipped `index.html` still carries `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/...">` and the KaTeX JS. HyperFrames inlines those at *compile* time for capture; a browser opening the served deck fetches them from jsdelivr. **A built deck is not offline-capable today.** So the advantage over a Remotion Player bundle is smaller than it sounds — it is ~70 KB of self-contained HTML plus two CDN fetches, against a React bundle. |
| Apache-2.0 | **Lost** | See §3. |
| The step layer / player | Lost, **and good** | 783 lines in `src/deck/runtime.ts` that exist only because HyperFrames' deck navigation was dead at 0.7.71. Of those, only ~93 (`frameOf`, `whenReady`, `readIsland`, `paint`, the `ISLAND` selector) are HyperFrames plumbing; the rest — stops, hash routing, transition planning, narration voice, chrome — is ours and would port. |

**The honest summary of the loss column:** it is smaller than loyalty suggests.
Two items are real (`check`'s gates, the licence), one is a re-do of accumulated
evidence rather than of code, and the rest either survives or was never an
advantage.

---

## 3. What a move costs — counted

### The coupling, measured

Every non-comment line in `src/` that mentions `gsap`, `tl.fromTo`, or
`__timelines`:

```
src/emit/archetypes/title.ts:225   return `tl.fromTo("${target}", ${from}, ${to}, ${sec(at)});`;
src/emit/composition.ts:476,477,480,717,721,723   (timeline registration, x2 sites)
src/emit/camera.ts:148,274,275,284               (the dive's 3 statements + the handoff fade)
src/deck/runtime.ts:203,205                      (reading window.__timelines)
```

**12 lines. 0.06% of the codebase.** The twelve archetypes contain *zero* — all
56 of their animation call sites go through one 3-line adapter, `tween(target,
from, to, at)` in `title.ts`.

That adapter returning a `{target, from, to, at}` object instead of a string
would make the entire archetype layer renderer-neutral, and it is a one-line
change plus a consumer.

### So: is it the twelve emitters, the shell, the runtime, or all three?

**The shell and the runtime. Not the emitters.**

| Layer | Total lines | Code lines | Verdict |
|---|---|---|---|
| 12 archetypes | 4,556 | 2,838 | **Survives.** Geometry, type-setting, budget arithmetic, HTML/SVG strings. Zero GSAP, zero HyperFrames. |
| `src/emit/svg.ts` | 427 | 255 | **Survives untouched.** 0 mentions of gsap/react/hyperframes. Text metrics, wrapping, path building. |
| `src/emit/kit.ts` (reference space, `REF_PULL`) | 229 | 71 | **Survives untouched.** A change of unit, not of host. |
| `src/emit/theme.ts` | 202 | 61 | Mostly survives; `paceStatement`'s regex over statement *text* dies — and good riddance, it exists only because `tl` is a string. |
| `src/emit/camera.ts` | 332 | 89 | Eases and framing math survive; the 4 emitted statements change. |
| `src/emit/composition.ts` | 765 | 388 | **Changes.** `renderComposition` (58), `sceneHtml` (48), `emitDeckPage` (35), `buildingFlag`+`readyGate` (~30 code), `narrationIsland` (23) ≈ 200 lines are the HyperFrames document shape. `layout` (148), `planCut` (32), `withCamera` (38), `beatSeconds`, `enteredParts` — the actual scheduling — survive. |
| `src/deck/runtime.ts` | 783 | — | ~93 lines of HyperFrames plumbing change; ~690 (stops, hash, voice, chrome) port. |
| `src/verify/check.ts` | 274 | — | **Adapter dies; the gates behind it have to be rebuilt.** |
| `src/render/*`, `src/verify/drift.ts` | 2,151 | — | Two subprocess invocations change. The retimer, ffmpeg graph, captions, `framePlan` are untouched. |
| `src/plan/*`, `src/source/*`, `src/narrate/*`, `src/pack/*` | ~2,500 | — | Untouched. |

**Tests:** 29 files. 50 lines assert on GSAP statement text (10 files), 34 on
HyperFrames document structure. Everything else — geometry, scales, budgets,
selection, wrapping — is host-blind. (I counted 617 `it(`/`test(` call sites
against the brief's 784 executed tests; the difference is parameterised tests,
and it does not change the ratio.)

### Cost band

**From counted lines: 900–1,400 lines touched.** That is the mechanical port —
shell, runtime plumbing, the `tween` adapter, the two subprocess call sites, the
84 coupled test assertions. Call it **2–3 engineer-weeks.** I have reasonable
confidence in this number because it is a line count, not a feeling.

**From a guess called a guess: 3–5 weeks** to rebuild what `hyperframes check`
gives free. I did not build a spike for this and I am not confident in it. The
five passes are lint, runtime, layout, motion, contrast; we consume all five and
have no replacement.

**From a guess with a bad prior: 2–6 weeks, upper tail open,** to re-establish
render determinism on the new host. The basis for calling this the risky one is
the project's own history: EXPERIMENT-006 spent itself on scaled-glyph
rasterisation drift and did not fully close it; EXPERIMENT-007 established the
SwiftShader/WebGL result; the `readyGate` note documents four renders producing
three distinct hashes and the conclusion that the next thing to test is worker
count. That is three separate investigations into "does the same input render
to the same bytes", and none of their conclusions transfer to a different
capture path.

**Total: 7–14 engineer-weeks, with the upper bound soft.**

Against which: a better player (real), and a frame model we have now measured
we already have (not real).

---

## 4. The licence, and where the ambiguity actually bites

Taking the given facts as given: LICENSE.md permits free use by individuals,
non-profits, evaluation, and for-profit companies with ≤3 employees; commercial
video-making on the free tier is explicitly allowed; above 3 employees a paid
Company License applies; and you may not sell a derivative that *is*
substantially Remotion.

**Sold as a service (DeckSmith hosts the render).** The bite is not the licence
text, it is the SKU behind it. This repo's own `PRIOR_ART.md` records
*Remotion for Automators* — "companies launching applications and systems; such
as video editors, **prompt-to-video apps**" — at $0.01/render with a $100/mo
minimum. That phrase names our category. Below 4 employees this costs nothing
and the free tier explicitly covers commercial output. The moment we are four
people it converts to a per-render marginal cost on a product whose unit
economics are currently dominated by the planner LLM and TTS. $0.01/render is
not large next to those; **the $100/mo floor is the part that bites a
pre-revenue product**, and the per-render metering is the part that bites a
free tier.

**Sold as a framework (users run their own renders).** This is where it bites
hardest and it is not a cost question, it is a *distribution* question. DeckSmith
is MIT and `npm i decksmith` today obligates the installer to nothing. On
Remotion, every user with more than 3 employees inherits a licence obligation
they did not choose and we cannot discharge on their behalf. That is not a bill;
it is a reason for a company to not adopt. The current planning docs already
reached this conclusion ("passes the license question to every open-source
user") and I did not find a reason to overturn it.

**Where it is genuinely ambiguous, and it is one place.** "Not allowed to copy
or modify Remotion code for the purpose of selling … your own derivative of
Remotion." DeckSmith-on-Remotion would be a *document-to-deck* product with
Remotion as its renderer — building on, not selling. That is clearly fine. But
the product the owner is describing — an animated-presentation *framework* with
a composable vocabulary — is, viewed unkindly, a video framework sold on top of
a video framework. I do not think that clause reaches it. I also would not want
to be the one arguing it while raising, and "Remotion 5.0 changes the terms" is
the sentence that turns a manageable ambiguity into an unmanageable one: the
risk is not today's text, it is that a dependency at the bottom of the stack
gets to rewrite our licence obligations on their schedule.

**Apache-2.0 (HyperFrames) has none of this shape.** That is the single largest
thing HyperFrames gives us, and it is worth more than the renderer.

---

## 5. Recommendation, and the sequencing

### Recommendation: do not move the renderer. Move the seam instead.

Spend **2–4 days**, not 7–14 weeks, on the one change that has all the option
value:

> Make `tween()` return a `Tween` object rather than a GSAP statement string,
> and have `composition.ts` serialise it. One 3-line function, one consumer,
> 56 call sites unchanged.

That single change:

- kills `paceStatement`'s regex-over-source-text (`theme.ts`), which is the
  ugliest thing in the emit layer and exists *only* because `tl` is a string;
- makes the 50 GSAP-text test assertions structural instead of textual;
- makes `Scene` renderer-neutral, so a Remotion (or canvas, or WebGPU) backend
  becomes an *additional consumer* of the same emit layer rather than a fork of
  it;
- lets the type checker see the animation vocabulary, which today is opaque
  string content.

It is also exactly the refactor a compositional vocabulary needs anyway, for its
own reasons. If the vocabulary work happens, this is not speculative — it is a
prerequisite that happens to also be the renderer hedge. **That is the cheapest
thing in this document and I would do it whatever else is decided.**

### Sequencing: vocabulary FIRST, renderer AFTER — with one bit pulled forward

The renderer decision should be made **after** the vocabulary decision, and the
measurement says why: the coupling runs one way and it is 12 lines wide. A
richer vocabulary makes the deck *more* data and *less* statement, which reduces
the host's leverage further. Deciding the renderer first would be optimising the
cheap half of a seam we are about to redesign, and would burn the 7–14 weeks
before knowing whether they buy anything.

**The one exception, and it is the owner's actual ask.** He named "3d graphics,
even embedding generated image and video." That is the one axis on which the
host genuinely differs, because of two given facts: WebGL under our capture is
deterministic only on SwiftShader at ~3.3x, and HyperFrames disables
static-frame dedup for canvas so held frames pay full rasterisation — which is
worst precisely for a stop-driven deck that holds a lot. Remotion has
first-class `<OffthreadVideo>` and `delayRender`-gated media, which is exactly
the "embed generated video" problem.

So pull **one bit** of the vocabulary decision forward, not the whole thing:

> **Is the new vocabulary DOM/SVG-shaped, or canvas/WebGL-shaped?**

- **DOM/SVG-shaped** (mobject-algebra over vector primitives, `Transform` as
  structural interpolation — what a Manim-vocabulary port actually wants):
  the renderer decision is **independent** and the answer is *stay*. Everything
  measured above applies. Revisit in a year.
- **Canvas/WebGL-shaped, or media-heavy:** the renderer decision is **coupled**
  and must be made *with* the vocabulary. Then the real comparison is not
  HyperFrames-vs-Remotion, it is *our capture pipeline vs any pipeline* on
  deterministic WebGL and embedded media, and the licence question has to be
  paid for or designed around rather than avoided.

Answering that one bit costs an afternoon of vocabulary sketching. Answering
the whole renderer question costs 7–14 weeks. **Get that bit, then stop
thinking about the renderer.**

### The uncomfortable part

The owner asked what our advantage over Remotion is on renderer and player, and
the honest answer given was "none worth defending." I agree on the player, and I
would sharpen the renderer half: our advantage is not architectural, it is
**accumulated evidence** — eight documented cases of green gates over wrong
output, each one closed. That is real, it is expensive, and it is why a move
costs what it costs. It is also completely non-transferable and worth nothing to
a customer. It is a switching cost, not a moat.

The moat, if there is one, is upstream of both: it is whether a planner behind a
JSON schema can reliably generate a vocabulary worth watching. Nothing in the
renderer layer moves that number, which is the strongest argument in this
document for not spending 7–14 weeks there.

---

## 6. What I measured, built, assumed, and could not verify

**Measured** (all reproducible from this directory):
- 117 `tl.fromTo` statements in a real 12-archetype deck. 0 callbacks, 0
  keyframes, 0 repeats. 7 distinct eases, all closed form.
- 1,820 value comparisons, GSAP-applied vs pure-evaluator, across 12 scenes:
  **0 semantic mismatches**; 100 differences ≤0.51 units attributable to
  computed-style readback quantisation.
- Camera dive under three seek orders and a fresh-page landing-first seek:
  **bit-identical**. Closed-form ease verified analytically (√2.7383 = 1.6548).
- 12 non-comment lines of GSAP coupling in 19,849 lines of TypeScript;
  0 in the twelve archetypes; 56 call sites through one 3-line adapter.
- 31 non-comment lines of HyperFrames coupling across 10 files.
- Artifact weights: index.html 69,689 B; deck.html 27,978 B; player 58,215 B;
  our runtime 11,703 B; `node_modules/hyperframes` 22 MB.
- Test coupling: 50 lines on GSAP text, 34 on HyperFrames structure, of 29 files.
- A built deck still fetches `gsap.min.js` and `katex.min.js` from jsdelivr at
  load; only the KaTeX *CSS* is vendored.

**Built:**
- `classify-tweens.mjs` — balanced-paren statement scanner + host-semantics
  classifier over a built deck.
- `pure-eval.mjs` — 130-line GSAP-free evaluator (parser, 6 eases, stagger,
  lerp).
- A camera-dive deck (`b03 inside b02.stage1`) built into the scratchpad,
  `hyperframes check` PASS. **Nothing under `src/` was modified.**

**Assumed:**
- The demo deck's 117 statements are representative of the vocabulary. Basis:
  it exercises all twelve archetypes. It does *not* exercise every code path in
  every archetype, so a statement shape could exist that I never sampled. The
  grep of `src/emit` for raw `tl.` (5 sites, all accounted for) is the check
  that makes me think not.
- Remotion's `useCurrentFrame` model behaves as documented. I did not install
  or benchmark Remotion — see below.

**Could not verify:**
- **Remotion's actual render throughput and determinism on our content.** I did
  not install it. Every claim here about Remotion is architectural or from the
  given licence facts, never measured. If the decision goes toward moving, a
  render-and-diff-twice spike on one archetype is the first thing to do and it
  would be cheap.
- **How much of `hyperframes check`'s five passes we would actually miss.** I
  read the adapter, not the gates. The 3–5 week estimate for rebuilding them is
  a guess and I have flagged it as one.
- **Whether Remotion 5.0's terms are better or worse.** Given as a fact that
  they change; I did not fetch them, per the brief.
- **Whether the CDN-fetch finding is true of a `hyperframes render` capture.**
  The composition source carries CDN `<script src>`; the compiler is documented
  to inline them at compile time. I verified the *source*, not the *captured
  page*. It matters for the "static files" claim about the presented deck, which
  I did verify, and not for invariant 4.
