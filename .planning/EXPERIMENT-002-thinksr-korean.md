# Experiment 002 — HyperFrames on real hypepaper output (Korean, ThinkSR/DQ-CTM)

**Date** 2026-07-26 · **CLI** hyperframes 0.7.71 (0.7.72 shipped mid-session)
**Project** `experiments/hf-thinksr/` · **Source** hypepaper analysis of DQ-CTM / ThinkSR

The real thing this time: Korean analysis prose, display LaTeX, 8 CDN figures, and two
data tables. 8 scenes, 63s.

## Results

| Test | Result |
|---|---|
| **Korean typography** | works — **after** shipping our own `@font-face` (see below) |
| LaTeX, non-trivial | works — `\mathcal{T}_{\theta}`, `\operatorname{Read}`, `\widehat`, super/subscripts |
| Term-level highlight | works again, on 3 equations |
| Extracted figures (aspect 1.42–4.35) | works once sized per-figure |
| Dense 8-column data table | works, legible at 23px, row highlighting animates |
| **Generated chart** (not a placed figure) | works — SVG line chart drawn via `stroke-dashoffset` |
| Render | 63s @1080p30 in **50s**, 4.8 MB |
| **Determinism** | **verified again** — byte-identical SHA-256 across two renders |
| **Deck mode (`present`)** | **did not work** — see below |

Font payload for the whole Korean deck: **39 KB**, via Google's `&text=` dynamic subset
against the deck's 260 distinct glyphs. Total assets 1.1 MB.

## Finding 1 — CJK is not in the auto-font allowlist

```
✗ font_family_without_font_face: Font family used without @font-face declaration:
  noto sans kr. These are not in the auto-resolved font list, so the renderer cannot
  supply them automatically. Text will fall back to a generic font.
```

HyperFrames auto-fetches and re-injects deterministic `@font-face` for fonts on a fixed
allowlist — Inter resolved with zero config in Experiment 001. Noto Sans KR does not.
**Every Korean deck must ship its own font.** Directly load-bearing for a Korean-language
education product.

The `&text=` subsetting trick makes this cheap and, better, deterministic and offline —
39 KB beats pulling ~120 unicode-range subsets. Worth making a DeckSmith ingest step.

Two sub-findings:
- `@font-face` in an **external** stylesheet satisfies `lint` but still trips
  `[StaticGuard] Invalid HyperFrame contract`. The two checkers disagree; StaticGuard
  doesn't follow `<link>`. It was a false alarm — Korean rendered correctly. Inlining the
  woff2 as a data URI would satisfy both and make the artifact self-contained.
- Google returns dynamic-subset URLs (`/l/font?kit=…`) with no file extension.

## Finding 2 — the layout gate earns its keep

It caught the Experiment-001 mistake before I could repeat it:

```
ℹ canvas_overflow #s2-cap overflowed bottom 200.55px
ℹ panel_out_of_canvas #s2-f overflowed bottom 157.55px
```

A 1.98-aspect figure at full bleed pushes its caption 200px off-canvas. Real defect,
precisely located, found without rendering a frame. Credit where due.

## Finding 3 — deck mode silently produced zero slides

The primary goal is *navigable web slides*, so this matters most.

Added the documented island — `<script type="application/hyperframes-slideshow+json">`,
8 slides, 12 fragments, Korean presenter notes — and gave every scene a
`data-composition-id` / `data-label` / `data-width` / `data-height`.

- `hyperframes lint` → **0 errors**
- `hyperframes present` → server up, presenter chrome mounted
  (`<hyperframes-slideshow>` wrapping `<hyperframes-player>`, with `present`,
  `openAudienceTab`, `wirePresenterNotes`, `wireHotspots`, cross-tab media sync)
- `player.scenes` → **0**. Arrow keys, real and synthetic, never moved `currentTime` off
  `0.00`. Reported `duration` 58.40s against a 63s composition.

The deck was structurally non-functional and **nothing said so**. Lint passed, the server
served, the chrome rendered. A silent failure.

Cause is mine: the skill's worked example makes each slide a top-level composition
wrapping an inner `section.clip`, with per-scene registered timelines. I conflated wrapper
and clip inside a single `#root` composition and used one absolute-time root timeline.
Adding `data-width`/`data-height` was not enough; it needs a real restructure. I stopped
rather than rewrite the animation layer.

**The lesson is not "deck mode is broken."** It is that deck mode has structural
requirements the linter does not check, so an agent that doesn't load `/slideshow` first
produces a deck that passes every gate and does nothing. For DeckSmith that argues for
generating the deck skeleton from the storyboard mechanically, never free-hand.

Also noted: the skill's own slide rules are **editorial** — "headline is a complete-sentence
claim", "one idea + one visual", "never below 40px for audience text". None are enforced by
`check`; they exist only as prose for the model. The taste layer is prompt-side and
unverified — the same gap Experiment 001 found, now confirmed to be deliberate.

## Corrections

- Experiment 001 said the math gap was overstated. Holds up: three harder equations, still
  no adapter needed.
- My deck violates the skill's own 40px minimum (20px captions, 21px notes, 23px table
  cells). Defensible for a dense analysis deck read on a laptop; wrong for a projected
  talk. Format-dependent — which is the retarget argument in `INITIAL_DESIGN.md` §4.

## Next

1. Rebuild this deck by installing and following `/slideshow` — confirm the structure is
   the whole difference, and get navigation working.
2. Inline the woff2 as a data URI; verify StaticGuard goes quiet and the file is portable.
3. Then, and only then, try the 9:16 retarget of the same content.
