# Product teardown — what actually shipped

Assignment: study the products, not the frameworks. Evidence is in `evidence/`:
`gamma-dom-measurements.json` (Playwright measurements against a live public Gamma
deck) and two screenshots I looked at.

---

## Headline

**Gamma — the product held up as proof that "slides are over" — is a slide model with a
200 ms opacity crossfade, rendered as DOM with zero canvas and zero WebGL, and it has no
video export at all.** Measured, not read.

The single most useful line in the evidence file:

```
present mode, card-to-card:   transition: opacity 0.2s
.motion-present-mode-bg:      backgroundImage none · animationName none · 0 children
elements with a running CSS animation: 0
```

That last div is named `motion-present-mode-bg` and it is a solid `rgb(170,188,182)`
rectangle — the letterbox colour behind a 16:9 card. The "moving background" attributed
to Gamma does not exist.

---

## Gamma

**Access note for whoever repeats this:** `gamma.app/docs/<slug>` serves an empty SPA shell
to an automated browser — every `_next` chunk 403s, 50 console errors, three `<div>`s,
no `__NEXT_DATA__`. **`gamma.app/embed/<slug>` renders fully.** Use `/embed`.

### Underneath

Next.js + React + Emotion + Chakra, and the document is **ProseMirror/TipTap**
(`data-node-view-wrapper` ×99, `react-renderer` ×92, one `node-<type>` class per PM node).
Gamma is a rich-text editor whose schema happens to contain a `card` node. That is the
whole architecture.

DOM + SVG. `canvas` = 0, WebGL = false. Of 63 SVG elements, **55 are Font Awesome icons**.
So roughly eight non-icon vectors in an eighteen-card deck.

### The complete node vocabulary, read off the DOM

```
card · cardLayoutItem · cardAccentLayoutItem · smartLayout · smartLayoutCell
gridLayout · gridCell · table · tableRow · tableCell · image · contributors · hardBreak
blocks: title · heading · paragraph · image · table · gridLayout · smartLayout
inline: title · heading · paragraph · callout · display
```

There is **no chart node, no diagram node, no equation node, no annotation node, no shape
node, no timeline node.** Gamma cannot draw. It can lay out text, place an image, and
render a table.

The only per-card design decision is `data-card-layout`, whose observed values are
`left · right · top · behind` — where the picture goes relative to the words.

### What an 18-card AI-generated deck actually contains

One block type per card. 8/18 cards are `smartLayout`; 6/18 are a bare image; 1 table,
1 grid, 3 plain text. `smartLayout` cell counts: **3, 6, 3, 3, 3, 3.**

I looked at the render (`evidence/gamma-card1-smartlayout.jpeg`): a serif display heading
over three tinted rounded rectangles, each with a bold two-word sub-head and one sentence.
That is the famous Gamma look, and it is a three-cell list.

### Where the visual quality comes from

Typography, colour and whitespace. Nothing else. A well-chosen serif/sans pairing, a
coherent warm palette applied through a theme, generous padding, consistent corner radius.
No motion, no diagrams, no illustration beyond stock/diffusion imagery dropped into a slot.

This is corroborated from outside: reviewers report Gamma "reuses the same designs for
every deck in different colors" and that decks "start to look repetitive."

### Video

`exportAs` enum in the public API is **`pptx | pdf | png`**. There is no video. There is an
open user feature request just to preserve *animations* in the PPTX/PDF export. Gamma has
not solved the video problem; it has not attempted it.

By the diagnostic in the brief — a product that renders video separately has solved our
problem, one that screen-records has not — Gamma is a third category: **it does not ship
video, and its entire motion budget is a one-shot CSS entrance transition that could not
be seeked even if it wanted to.**

### Does Gamma understand a document, or template one?

The generation API answers this without ambiguity. The whole surface is:

```
format:   presentation | document | social | webpage
textMode: generate | condense | preserve
cardSplit: inputTextBreaks | auto
numCards, themeId, textOptions, imageOptions, additionalInstructions
```

**There is no parameter anywhere for diagram type, chart type, layout archetype, reveal
steps, or animation.** The model's only structural output is *how many cards and where the
text breaks*. Everything visual is theme + smart-layout selection + an image model
(`gemini-3-pro-image`, `flux-2`, `luma-ray-2`, `leonardo-motion-2` …).

Gamma templates. It splits and compresses prose, then pours it into a fixed layout family.
It spends its visual budget on diffusion imagery rather than on drawing the content.

---

## NotebookLM Video Overviews

Slides are **generated as flat raster images by Nano Banana** (Gemini Flash Image;
Nano Banana 2 Lite for the newer 60-second vertical Short Video Overviews), then strung
into a sequence with TTS narration. Styles are picked from a fixed set — Whiteboard,
Watercolor, Retro print, Heritage, Paper-craft, Anime — and formats from Brief | Explainer.
Notably it does **not** use Veo: no video model, no animated graphics, just illustrated
stills in sequence.

It renders video properly (server-side pipeline, not a screen recording), so on the video
question Google is ahead of Gamma. But the mechanism has consequences that matter to us:

- The slide is a **picture of a slide**. No DOM, no text nodes, no structure. It cannot be
  edited, re-flowed, re-targeted to 9:16 without regenerating, or measured by any contrast
  or type-size gate.
- Text lives inside the raster. Documented complaints: typos and incorrect information in
  the generated graphics; "requires precise prompting to achieve mediocre and inauthentic
  results."
- It is a diffusion model, so it is **inherently non-deterministic**. Two runs are not the
  same video. Our invariants 1 and 2 forbid this approach outright.

Google chose an image model over a layout engine. That is a real fork in the road, and it
is the opposite of ours.

---

## Tome — dead

Announced the pivot October 2024, confirmed sunset March 2025, **shut the presentation
product down 30 April 2025**; user decks not exported were deleted. The team now builds
Lightfield, an AI-native CRM. AngelList bought the brand.

Their stated reason was commercial ("failed to find a sustainable path"; free/$10 users),
not format — do not overclaim. But the fact remains that the AI presentation product which
went furthest from the slide (Tome's vertical scrolling tile format, no fixed page) is the
one that is gone, and the one that kept the card is the category leader.

---

## Napkin AI

The closest published relative to our archetype layer, and the honest comparison.

Mechanism: paste prose, hit Spark, and it classifies the text's structure — sequence,
hierarchy, comparison, timeline — then **offers a palette of candidate visuals to pick
from**. Output is real SVG (also PNG/PDF/PPTX). Its icon library is large and its visuals
are pre-authored templates fitted to detected content structure.

Two things follow. First, **the classify-then-select-an-archetype approach is validated by
a shipping product** — that is exactly what our emitters do. Second, Napkin's visuals are
**static and standalone**: no motion, no reveal ordering, no deck, no video. A human picks
from the palette, which puts it outside our invariant 3 anyway.

Napkin is the strongest evidence that our archetype vocabulary is the right shape. It is
also evidence that our differentiator inside that shape has to be *motion and sequencing*,
because the still-diagram niche is occupied.

---

## Beautiful.ai

A constraint-based layout engine with **300+ Smart Slide layouts** (data, comparisons,
quotes, timelines, image grids). Content is entered by a human; the engine re-solves
spacing, alignment and hierarchy on every edit and deliberately refuses freeform overrides
so the user cannot break the design.

Useful calibration: their catalogue is 300+ layouts, ours is 12 archetypes. But theirs are
*static arrangements filled by a person*; ours are *drawn from the source's own content and
revealed in stages*. Different axis. The number is not directly comparable — though it does
suggest 12 is early, not finished.

---

## Prezi — the experiment already ran, and this is the important one

Prezi is the infinite-canvas-plus-camera product. It shipped in **2009**. It has had
seventeen years and tens of millions of users. The verdict is in and it is not good:

- **Motion sickness is the number one complaint in user reviews.** Nausea, dizziness,
  headaches from the panning and zooming; reported as worse for older audiences; often not
  disableable.
- The structural criticism is sharper than the physical one: *"Prezi's canvas format forces
  a spatial relationship where none exists."*
- And the expert mitigation advice is the tell. It is: move left-to-right or top-to-bottom
  rather than around the canvas, and **place your objects closer together so there is less
  zoom and swoop.** Follow that advice to its limit and you have converged on a sequence of
  same-scale framings — a slide deck.

If someone proposes we adopt Notebook → Infinite Canvas → Story Flow → Camera → Animation,
the first question is what we know that Prezi did not learn in seventeen years.

---

## Scrollytelling

Verified the mechanism on a live piece (Pudding, "Women's Pockets are Inferior"): DOM +
SVG, 100 SVG elements, **zero canvas**, d3, `position: sticky` graphic, `[data-step]`
markers, ~11 viewport-heights of scroll. Scrollama drives it with IntersectionObserver, not
scroll listeners.

The form's own literature says the useful thing directly. Scrollama's three primitives are
**step triggers** (fire when an element crosses a threshold), **step progress** (0–100%
within a step), and a **sticky graphic** helper. And on the discrete-vs-continuous
question, the practitioner consensus is that **steppers give crisper animation precisely
because movement is discrete and triggered**, and that custom annotation is only tractable
when the steps are discrete — while continuous scroll wins when the goal is sustained
engagement with no decision point.

So the closest published relative of "infinite canvas driven by story flow" is not an
infinite canvas at all. **It is a fixed graphic that persists while discrete, ordered steps
mutate it, with a continuous input driving the transition between them.** A decade of
practice landed on: keep the stop, lose the cut.

Note also the discipline's own warning: scrollytelling is not scrolljacking, and hijacking
the scroll mechanic is considered bad practice. A camera that moves the viewer without the
viewer asking is the same failure.

---

## The strategic read

### 1. "Remotion and Motion Canvas are 결국은 렌더러일 뿐" — TRUE, and stronger than claimed

It is not only true of the renderers. **It is true of the products too.** Gamma's entire
LLM output surface is *how many cards and where to break the text*; the design is a theme
lookup. NotebookLM's is a script plus an image prompt. Napkin's is a structure classifier
feeding a template picker. Beautiful.ai's understanding is zero — a human types.

Nobody in this market has a story engine. They have a formatter with an LLM in front of it.

### 2. Does Gamma understand a document? No. It templates one.

Evidence, in descending order of strength: the generation API has no structural parameter
at all; the node schema contains no chart, diagram, equation or annotation type; a real
generated deck resolves to 8 identical three-cell layouts and 6 bare images; and reviewers
independently report every deck looking the same in a different colour.

### 3. Has anyone built the story engine? No.

Combined with `PRIOR_ART.md`'s finding that every research system (PPTAgent, Paper2Video,
Paper2Poster) *places the paper's existing figures* and none redraws the method as motion,
and with the fact that the "paper → animated explainer" tools that surface in search
(Mootion and friends) are 3D-character narrative video generators wearing an academic SEO
page — **the seat is empty.** Nothing to soften. That is the finding.

The nearest occupant is Napkin, and it takes only the still-diagram half, with a human in
the loop.

### 4. What this says about the canvas hypothesis

The claim's strong half survives and its weak half is now supported by shipped evidence.

- **Strong half confirmed, and worse than stated.** Gamma's cut is 200 ms of opacity.
  Nothing carries across a card boundary in any product examined. Our isolated-island
  problem is the industry's isolated-island problem — which means fixing it is available
  differentiation, not table stakes.
- **Weak half now has a corpse and a survivor.** Prezi ran the infinite-canvas experiment
  and its top user complaint is nausea. Tome ran the no-fixed-page experiment and is gone.
  Gamma kept the card and leads the category. Meanwhile scrollytelling, the one place
  continuous motion genuinely works, works by driving *discrete steps* with a continuous
  input — and it never moves the camera without the reader's hand on it.
- **The synthesis holds.** Keep the stop, lose the cut. Scrollytelling is the existence
  proof; Prezi is the counterexample for what happens when you lose the stop as well.

### 5. Where we are ahead and where we are behind

Ahead: we draw. Twelve archetypes that generate vector graphics from the source's content
and reveal them in stages is more explanatory machinery than Gamma, NotebookLM, Tome and
Beautiful.ai have between them. We also render deterministic video, which none of the
DOM-based products do at all.

Behind, and it is the thing to take seriously: **Gamma's output looks better than ours and
the reason is not motion.** It is type, palette and whitespace applied with total
consistency by a theme system. That is cheap for us to close and it is the highest
quality-per-effort work available. A twelve-archetype deck with our current styling loses a
side-by-side against three tinted boxes with good typography, and we should not pretend
otherwise until we have looked at both at the same size.

---

## Method note

Everything about Gamma above is a measurement from a live public deck via Playwright
(`evidence/gamma-dom-measurements.json`), plus its published OpenAPI schema. The Pudding
finding is likewise measured. The Prezi, Tome, NotebookLM, Napkin and Beautiful.ai findings
are from published sources, not measured, and are labelled as such where it matters.

I could not reach Napkin's own site with an automated browser (bot-blocked), so Napkin's
mechanism is reported second-hand and its SVG output is not independently verified. That is
the weakest link in this document and the one worth re-checking by hand.
