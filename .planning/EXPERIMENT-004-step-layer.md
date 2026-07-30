# Experiment 004 — wiring the step layer, and what the gates still cannot see

**Date** 2026-07-27 · Built during the v0 implementation. Closes the blocker both
review passes independently reported: the step layer existed, was unit-tested, and
never reached a deck.

## What shipped

`decksmith build` now emits two artifacts from one layout pass:

| File | What it is |
|---|---|
| `index.html` | the HyperFrames composition — what `check`, `snapshot`, `render` consume |
| `deck.html` | the navigable wrapper: hosts the composition in a player, repeats the island, inlines our step layer |

Plus `hyperframes-player.global.js`, copied out of the `hyperframes` package, so a
built deck navigates with no network.

The wrapper is why inlining the runtime into the composition would have been a no-op:
`start()` requires a `<hyperframes-player>`, and the composition has none. The player
element only ever exists in a wrapper page — which DeckSmith previously did not emit.

Verified against a 4-beat deck (title / equation-walk / data-table / callout) served
over http and driven with Playwright:

```
load #4       -> t=23.00      (slide 4 starts at 6+8+9 = 23) ✓
→ → → …       -> 7.5, 14.03, 16.03, 16.73, 17.93, 23.00, 24.45 …
← ← ←         -> steps back correctly
End / Home    -> 25.35 / 0.00
deep link #3.2 (real load)   -> t=16.73, counter "3 / 4"
hashchange to #2.1 (no load) -> t=8.40
```

`hyperframes check`: **PASS — 0 errors, 0 warnings.**

## Three defects the automated gates could not see

Every one of these passed `check` cleanly. Two were found only by taking a screenshot,
and the third only by reading the DOM.

**1. The deck rendered blank.** Navigation was exact and the frame showed nothing. A
slide's stop was its raw `data-start`, and seeking pauses on that frame — where every
entrance tween is still at its `from` state. The emitters already record a settled hold
after each reveal, so the raw start was a keystroke that displayed nothing by
construction. `buildStops` now lands a slide on its first settled fragment and falls
back to the start only for a scene with no reveals at all.

**2. The standalone player does not drive composition timelines.** Under `render`, the
engine seeks each scene's registered timeline and applies clip visibility. The bare
player bundle does neither — it moves its own clock and nothing else. A seeked deck
therefore showed all scenes stacked with every element at opacity 0. Upstream documents
this obliquely ("the composition must expose a seekable `window.__timelines.root`") in
`skills/slideshow/references/standalone-harness.md`, whose remedy is a different
composition shape than the one `render` requires.

Rather than fork the composition, the step layer now paints it: reach through the
player's iframe, hide the scenes outside the current window, and seek the active
scene's timeline to `t - start`. Scenes are addressed by the ids the island already
carries, so nothing is scraped from the DOM. The composition stays canonical for
`render`, and the presentation path is entirely ours — which it already had to be.

**3. `el instanceof HTMLElement` is always false across realms.** The iframe is a
separate realm with its own constructors, so the visibility branch silently never ran
while the timeline seek beside it did. The symptom was one scene's table rules bleeding
through the title slide — visible in a screenshot, invisible to every gate.

## The pattern, stated plainly

Three experiments in, the same thing keeps happening: **`check` verifies mechanics, and
mechanics are not communication.** It has now passed, in order, an unreadable slide
(001), a deck with zero navigable slides (003), and a deck that navigated perfectly
while displaying nothing (004). The gate stack is genuinely good at overflow, overlap,
contrast and motion. It has no opinion about whether a viewer sees anything.

That is the case for T2 fidelity verification in `INITIAL_DESIGN.md` §5, and it is now
evidence rather than argument. Until that exists, **a screenshot is part of the
definition of done** — for the tool and for whoever operates it.

## Also changed

`--strict` removed from `build` and `verify`. Upstream's `--strict` fails on warnings,
and every real deck emits `composition_file_too_large` (limit: 300 structural lines; a
seven-beat deck exceeds it). Its remedy — splitting into sub-compositions — is the exact
structure that makes a deck non-navigable. The flag could never pass, and a switch that
cannot succeed is worse than no switch.

## Still open

- **Nothing animates during navigation.** Each stop is a settled still; the reveals
  between stops are seeked past, not played. Playing forward from stop to stop is the
  next real improvement and is what would make this an *animated* deck rather than a
  well-typeset one.
- `deck.html` must be served over http — a `file://` iframe is a separate origin and
  cannot be painted. The runtime says so in the console instead of rendering blank.
