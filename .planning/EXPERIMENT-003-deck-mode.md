# Experiment 003 — deck mode, done properly (and a control)

**Date** 2026-07-26 · **CLI** 0.7.71 and 0.7.72 · `experiments/hf-thinksr/`, `experiments/hf-demo-control/`

Experiment 002 concluded deck mode failed because I hand-authored the structure wrong.
**That conclusion was half right and the important half was wrong.** Rebuilt it against
HeyGen's own reference example, then ran their unmodified example as a control.

## What the reference actually requires

Read `registry/examples/slideshow-demo/index.html` rather than guessing from the skill prose.
Differences from my Experiment-002 attempt:

| | Exp 002 (wrong) | Reference |
|---|---|---|
| scene attrs | `data-track-index="1"`, per-scene `data-width/height` | neither — only `data-composition-id/start/duration/label` |
| timelines | one root `main` timeline, absolute times | **one paused timeline per scene**, registered under its own composition id, times **relative** to that scene |
| root | no dummy tween | `tl.to({}, { duration: N })` spanning the deck |
| tweens | `.from()` ×30 | **`fromTo` ×17, `from` ×0** |
| island | top of body | after the root div |

The `from()` → `fromTo()` point is the substantive one. `from()` captures its end state at
instantiation, so it is not safe under arbitrary seeking — which is precisely what deck
navigation does. The reference uses zero `from()` calls. Linear MP4 render hid this.

Also worth noting: the skill says keep the island "near the top of the `<body>`, before the
scene divs"; the reference puts it last. Harmless, but the docs and the example disagree.

## Restructuring switched on lint rules that had nothing to bind to before

Immediately after the rebuild, a rule fired that had never appeared:

```
✗ unscoped_gsap_selector: Timeline "s6" uses unscoped selector ".trow" that will target
  elements in ALL compositions when bundled, causing data loss (opacity, transforms, etc.)
```

Three of them (`.trow`, `.pv`, `.dv`). **Experiment 002's "lint passed, 0 errors" was
passing because the per-composition rules had no compositions to check.** A green gate on a
structurally wrong file meant nothing. Scoping the selectors to `#s6 .trow` etc. cleared it.

Post-rebuild: `0 errors`, layout 9 samples clean, contrast 109/109, visuals pixel-equivalent
to before, and determinism holds on the new structure — two renders, byte-identical
`f718f354…`. Render cost rose from 50s to ~94s for the same 63s deck (~1.9×), the price of
8 nested compositions.

Evidence the structure fix landed: reported deck duration went **58.40s → 63.00s**, matching
the composition.

## The control settles it

Navigation still did not work. So I ran HeyGen's own `slideshow-demo`, downloaded
unmodified into a clean project:

| | our deck | official slideshow-demo |
|---|---|---|
| `lint` | 0 errors | 0 errors |
| `duration` | 63.00 ✓ | 32.00 ✓ |
| `player.scenes` | **0** | **0** |
| ArrowRight → `currentTime` | **0.00** | **0.00** |
| `player.seek(8)` | — | **8.00 ✓** |

Same on **0.7.71 and 0.7.72**.

The player is seekable and correct — `seek(8)` moves to 8.00. The island parses (8 slides);
`present` even duplicates it into the wrapper as documented. The presenter chrome mounts
with `present`, `openAudienceTab`, `wirePresenterNotes`, `wireHotspots`, cross-tab sync.
What never happens is `player.scenes` populating, so `SlideshowController` has no
slide→time map to bind and every key press is a no-op.

Upstream already knows. A comment in the reference example:

> Browser runtime resolves them via `player.scenes` (populated from the "timeline"
> postMessage after runtime injection at ~1s — see **Task 7 timing-risk note in
> progress.md**).

And the skill concedes the engine-hosted path is unshipped: *"`hyperframes preview
--slideshow` / studio present mode will host the composition over the real HyperFrames
engine… That path is coming; prefer it once it ships."*

**Conclusion: deck navigation is broken upstream at 0.7.71/0.7.72, not mis-authored.**
Experiment 002 blamed me; the control disproves that. My structure *was* wrong and worth
fixing — it enabled real lint rules and corrected the duration — but fixing it did not and
could not fix navigation.

## What this means for DeckSmith

1. **The primary output — a navigable animated web deck — is not deliverable on HyperFrames
   today.** Video is production-ready; the deck is not. That inverts the plan's assumption
   that both came free.
2. **Do not treat a green `check` as evidence of a working artifact.** Twice now the gates
   passed on something broken: once on unusable slides (Exp 001), once on a deck with zero
   navigable slides. The gates verify mechanics of what they can see, and only see what the
   structure exposes.
3. **Generate deck structure mechanically from the storyboard.** Every failure here was
   structural, invisible to lint, and would recur in any free-hand generation. Beats →
   scenes → island should be emitted by code, with `fromTo`-only and scoped selectors as
   invariants of the generator.
4. **Options, in order:** wait for the engine-hosted path; or drive `player.seek()`
   ourselves from the island — `seek` demonstrably works, so a ~100-line step layer over
   the player is viable now and is exactly the "step machine" of design v1 §1, reduced to
   its smallest form; or ship video-only first.

Option 2 is the interesting one: it is small, it is ours, and it stops the primary
deliverable from being blocked on someone else's roadmap.

## Corrections to Experiment 002

- "Cause is mine … deck mode has structural requirements the linter does not check" —
  the second clause holds, the first does not. Corrected above.
- Added: `from()` is unsafe under seeking; restructuring activates dormant lint rules;
  nested compositions ~1.9× render cost.
