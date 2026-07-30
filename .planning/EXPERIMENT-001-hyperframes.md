# Experiment 001 — HyperFrames smoke test on paper-analysis content

**Date** 2026-07-26 · **CLI** hyperframes 0.7.71 · **Host** M4, 10 cores, node 24.14, ffmpeg 8.1
**Project** `experiments/hf-paper-deck/` · **Verdict** build on it.

## What was tested

The intended source (`hypepaper.app/papers/fb1f717c-…`) is auth-walled — it 302s to
`/landing` and every API path falls through to the SPA shell. Substituted equivalent
content of the same shape: analysis prose, **real extracted figures + captions** scraped
from the arXiv HTML of 3D Gaussian Splatting (2308.04079), and **real LaTeX**.

Five scenes, 34s: title · pipeline figure + caption · covariance equation with
term-by-term highlight · projection equation · results figure.

## Results

| Test | Result |
|---|---|
| Extracted figures + captions | works, unremarkable — it is HTML |
| **Term-level LaTeX highlight** | **works** — `\htmlClass` + `trust:true`, then GSAP targets the classes |
| Gate stack | `lint · runtime · layout · motion · contrast` — real, fast, specific |
| Fonts | auto-fetched and re-injected as deterministic `@font-face`. No setup |
| Render | 1020 frames / 34s @1080p30 in **38.2s** (~1.1× realtime), 2.2 MB h264 |
| **Determinism** | **verified** — two independent renders, byte-identical SHA-256 |

```
7ed829e7a29fb4c44c8674aae86b331cc6e4cf82d2330d16aafc390b599dd424  render #1
7ed829e7a29fb4c44c8674aae86b331cc6e4cf82d2330d16aafc390b599dd424  render #2
```

Determinism was the load-bearing claim under the whole verify→repair loop. It is real.

## The finding that matters

**Every gate passed on slides that were unusable.**

First pass: `check` reported 0 errors, 39/39 WCAG AA contrast, 0 layout issues, 0 motion
issues. The frames it green-lit had 30px equations invisible on a 1080p canvas, half-empty
slides, and the results figure — a wide strip image — rendered as a postage stamp centred
in a 620px box. `object-fit: contain` did exactly what it was told; the slide communicated
nothing.

The gates verify **mechanics**: does it overflow, does it overlap, does it meet contrast,
does the timeline animate. Nothing in the stack asks whether the slide *teaches*. Fixing it
took a font-size and two layout rules — a planning-and-taste problem, not a rendering one.

This is the T2 gap from `INITIAL_DESIGN.md` §5, demonstrated instead of asserted, and it is
the clearest evidence so far that DeckSmith's product is the storyboard layer.

Related: `snapshot` writes a `contact-sheet.jpg` labelled "grid view for AI review" and has
a `--describe` flag for Gemini frame analysis. They anticipated the loop — but it critiques
frames in isolation, with no source to be accountable to. Provenance-backed fidelity
checking is still open ground.

## Corrections to earlier claims

1. **The math gap was overstated.** I called a KaTeX seek adapter "on the critical path".
   No adapter is needed — KaTeX renders static DOM per frame and GSAP animates it directly.
   Term-level highlighting is about five lines.

   One real upstream bug remains: KaTeX's hidden MathML a11y mirror (`.katex-mathml`) is
   read by the layout inspector as overlapping text — 6 phantom errors on two equations.
   Workaround `output:"html"`, which costs screen-reader MathML. That is fine for a rendered
   frame and **wrong for an interactive deck**. Upstream fix is one selector ignore; worth
   filing.

2. **"Compositions lock width/height" was too strong.** `init --resolution` ships
   `landscape · portrait (1080x1920) · square · 4k` presets. Canvas multi-format exists.
   The gap is *semantic reflow* between ratios, not canvas size. §4 should say so.

## Not yet tested

- The `slideshow` island — interactive deck nav, fragments, presenter mode.
- Self-contained single-file output (this test loads GSAP + KaTeX from CDN).
- Whether the layout gate holds up on a scene with real WebGL.
