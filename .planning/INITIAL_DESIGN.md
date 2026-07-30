# DeckSmith — Design v2

Oneshot generation of animated explanations, from a source document to every format
they need to ship in.

Supersedes v1. See `PRIOR_ART.md` for the survey that forced the rewrite.

---

## 0. What changed, and why

v1 designed a runtime: a `Visual.seek()` protocol, a kit system, a deterministic
headless exporter, an agent-facing typed surface. The survey found
**`heygen-com/hyperframes`** (37.6k★, Apache-2.0, four months old, releasing daily) had
already shipped every one of those, plus a `slideshow` skill with discrete slides,
fragment reveals, branching, presenter mode, and speaker notes.

Building any of it now would be writing a worse copy of a moving target.

**Roughly 70% of v1 is deleted.** What survives is the part v1 spent the least ink on
and the part the whole field is worst at: turning a document into a *good explanation*.
Rendering was never the moat.

The v1 instinct that held up: **generated code beats a scene schema.** HyperFrames made
the same call independently — compositions are HTML, animation is a seek adapter, and
correctness comes from lint + render gates rather than from a constraining schema.

---

## 1. What DeckSmith is

**An explanation compiler.** One source document, one storyboard, many formats.

```
paper · docs · repo · product page · course notes
        ↓  ingest
   Source            structure, figures, equations, claims, provenance
        ↓  plan                                  ← the product
   Storyboard        beats: intent · evidence · visual archetype · narration
        ↓  realize                                ← agent writes HyperFrames HTML
   Composition(s)
        ↓  emit
   16:9 navigable deck · 9:16 short · 1:1 post · MP4 · self-contained HTML
```

Two businesses, one pipeline: explanation decks and course media for the education
product, and 30-second cuts of the same storyboard for marketing and branding. The
storyboard is what makes those the same job instead of two.

## 2. The only thing DeckSmith owns: the Storyboard

v1 rejected a JSON scene schema, and that still holds — enumerating *entity types*
(`cameras`, `point_clouds`, …) is how a schema grows a key per domain forever. A
**storyboard** is a different object: it describes pedagogy, not geometry. Beat-level
intent is a finite, domain-blind vocabulary; scene geometry is not.

```ts
type Beat = {
  id: string
  intent: string            // what the viewer should understand after this beat
  claim?: string            // the source sentence or equation this is accountable to
  evidence: Ref[]           // provenance into the Source: figure, equation, table, quote
  visual: { archetype: string; params: unknown }   // archetype = a registry key
  narration: string
  weight: number            // salience — drives what survives a 30-second cut
  dwell: { deck: 'manual'; video: number }
}
```

Three properties earn their keep:

- **Format-independent.** A beat says what must land, not how wide the frame is.
  Retargeting is a projection of the storyboard, not a crop of a video.
- **Accountable.** `claim` + `evidence` point back into the source, so a later pass can
  ask "does this animation actually say what the paper says" (§5). Without provenance
  that check is impossible, which is why nobody currently runs it.
- **Editable.** It is the human checkpoint. Fixing a plan is cheap; fixing twelve
  realized slides is not.

`visual.archetype` is a string resolved against a registry. The core never learns what
a camera frustum is — or an orderbook, an attention head, a protein, a Turing machine
tape. That was the whole point of the original probe, and it is answered by a package
registry rather than a core module.

## 3. Layers

```
ingest/     Docling (MIT) or Marker (Apache-2.0) → Source. ScholarAI optional, for fetch/metadata.
plan/       Source → Storyboard. The product. Human-editable checkpoint.
vocab/      explanatory archetypes as HyperFrames blocks — published to their registry
realize/    agent writes a HyperFrames composition per beat, against the vocab + their skills
verify/     lint → render → fidelity (§5) → repair
emit/       format profiles → deck · short · post · MP4
```

Everything below `realize/` is **bought, not built**: compositions, frame adapters,
determinism, headless capture, FFmpeg encode, the player. Upstream, pinned.

**Except the step layer.** EXPERIMENT-003 found deck navigation broken upstream at
0.7.71/0.7.72 — reproduced on HeyGen's own reference example: `player.scenes` never
populates, so `SlideshowController` never binds and every key press is a no-op. But
`player.seek(t)` works exactly as documented. So the smallest honest version of design v1's
step machine — read the island, map steps to times, drive `seek()` — is ~100 lines, is
ours, and unblocks the primary deliverable instead of waiting on someone else's roadmap.
Video is production-ready today; the navigable deck is not.

**Distribution follows the same logic.** DeckSmith ships as a HyperFrames skill pack
plus a CLI — `npx skills add` puts it in front of an existing 37k-star audience.
Fighting that distribution to run our own runtime would be paying twice.

### Upstream gaps we need, and should contribute rather than fork

Grepping their slideshow skill found no math, no vertical format, no PDF, and deck→MP4
export explicitly deferred. All four are on our critical path:

1. ~~**Math** — a KaTeX seek adapter.~~ **Retracted, see EXPERIMENT-001.** No adapter is
   needed: KaTeX renders static DOM per frame and GSAP animates it directly, so term-level
   highlighting is ~5 lines. The only real upstream bug is that the layout inspector reads
   KaTeX's hidden MathML a11y mirror as overlapping text. One selector ignore; file it.
2. **Vertical / multi-format** — `init --resolution` already ships landscape/portrait/
   square/4k presets, so the canvas is not the problem. The gap is **semantic reflow**
   between ratios: re-laying-out a beat, not rescaling a frame.
3. **Deck → MP4** — a navigable deck currently renders truncated.
4. **PDF export** — table stakes for education customers.
5. **CJK fonts** (EXPERIMENT-002) — auto font resolution has a fixed allowlist; Inter
   resolves with zero config, Noto Sans KR does not. Every Korean deck must ship its own
   `@font-face`. Make `&text=` glyph subsetting an ingest step: 39 KB for a whole deck,
   deterministic and offline. Also: `@font-face` in an external stylesheet satisfies
   `lint` but still trips `StaticGuard` — the two checkers disagree.

Contributing these upstream buys goodwill and distribution and avoids maintaining a
fork. Apache-2.0 keeps the fork available if that goes badly.

## 4. Multi-format is a projection, not a crop

Every existing tool reframes finished video. DeckSmith re-realizes from beats.

| Profile | Beats | Pacing | Interaction | Constraints |
|---|---|---|---|---|
| `deck-16x9` | all | manual, human-paced | orbit / scrub / probe | presenter notes, PDF |
| `short-9x16` | top-K by `weight` | forced, tight | none | safe areas, burned captions, hook in first 2s |
| `post-1x1` | 3–5 beats | forced, medium | none | silent-autoplay legible |
| `video-16x9` | all | scripted `dwell` | none | narration track |

The same beat renders as a slow explorable panel in a lecture deck and as a two-second
punch in a reel, because the beat records *intent*, and layout is a profile decision.

## 5. Verification: correctness, not just aesthetics

Prior art verifies that slides look plausible. Nothing verifies that the animation is
*true to the source*. That is the differentiator, and provenance in the beat makes it
mechanical:

- **T0 — lint.** `hyperframes lint` plus the determinism contract.
- **T1 — render.** Every step renders: non-blank, no overflow, text inside safe areas,
  no NaN transforms, step N differs from step N−1.
- **T2 — fidelity.** A VLM compares the rendered frames against the beat's `intent` and
  the cited `evidence`. Does the picture assert what the claim asserts? Does the arrow
  point the right way? Is the axis the one the figure used?
- **T3 — deferred.** Human review queue for anything T2 flags as low-confidence.

Failures re-enter `realize/` with the error and the frame attached. Beats are
independent, so repair is per-beat, not per-deck — which is what makes oneshot tractable
at all.

## 6. Build / buy

| Concern | Decision |
|---|---|
| Runtime, adapters, determinism, capture, encode | **Buy** — HyperFrames, Apache-2.0, pinned |
| Player, slideshow controller, presenter mode | **Buy** — HyperFrames `slideshow` |
| PDF/LaTeX/figure extraction | **Buy** — Docling (MIT) or Marker (Apache-2.0) |
| Math adapter, vertical profile, deck→MP4, PDF | **Contribute upstream**, fork only if refused |
| Source → Storyboard planning | **Build** — this is the product |
| Explanatory visual vocabulary | **Build**, publish into their registry |
| Fidelity verification | **Build** — nobody has it |
| Remotion | **Rejected** — custom license, $100/mo minimum for exactly our use case, and it pushes that question onto every open-source user |
| MinerU | **Rejected** for now — license is NOASSERTION; revisit if CJK layout forces it |

## 7. MVP cut

1. **`decksmith ingest`** — PDF/LaTeX/md → `source.json` via Docling. Figures to webp,
   equations to LaTeX, everything carrying a provenance ref.
2. **`decksmith plan`** — `source.json` → `storyboard.json`. Editable. Stop here and
   look at it; this is where quality is won or lost.
3. **`decksmith build --profile deck-16x9`** — per-beat composition generation through
   the HyperFrames skills, T0 + T1 gates, one repair round, slideshow island emitted.
4. **One real deck, end to end, on a paper outside 3D vision.** A domain-blind design
   only proves itself when the domain changes.

Deferred: retarget profiles, T2 fidelity, narration/TTS, registry publishing, the
education product surface, anything resembling a hosted service.

## 8. Risks

- **HyperFrames is four months old**, adapter API is v0/experimental with breaking
  changes expected before v1, 262 open issues, multiple releases per day. Pin hard, test
  against upgrades, keep vendoring `packages/engine` as a live option.
- **HeyGen is a company** and could pivot. Apache-2.0 plus 3.5k forks is real insurance,
  but it means owning an engine we chose not to build.
- **Planning quality is the whole product** and it is the hardest part. If the storyboard
  is mediocre, no amount of rendering fidelity saves the output. Budget accordingly.
- **Token cost per artifact** scales with beat count and repair rounds. Measure early.
- **Math is missing upstream** and research content is unshippable without it. Treat the
  KaTeX adapter as MVP-adjacent, not deferred.

## 9. Open questions

- Does `plan/` stay a single model pass, or become plan → critique → replan? Prior art
  (planner + coder agents) suggests the split helps, at real cost.
- Is the education product a CLI, a hosted app, or a template library? It changes almost
  nothing below `emit/`, and everything about the business — but it can wait until one
  deck exists.
- How much interactivity do explanation decks actually need? Orbit is nearly free under
  HyperFrames' `interactive` mode; a real inspector is not, and no evidence yet says
  learners want one.
