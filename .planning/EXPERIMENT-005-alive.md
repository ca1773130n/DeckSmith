# Experiment 005 — making a held slide alive

**Date** 2026-07-27 · Closes the two items EXPERIMENT-004 left open, and the visual
defects that surfaced while closing them.

## The problem

The deck navigated correctly and rendered correctly, and it was dead. Every stop was a
hard cut to a settled still, so a reveal authored as motion arrived as a jump. And a
slide held for a minute — the normal case for a presenter — was a frozen frame that read
as a screenshot rather than a live document.

## Two mechanisms, deliberately separate

**Transitions play.** `paint()` is ours, so a forward step is swept across frames with
`requestAnimationFrame` instead of cut: each frame seeks the scene's GSAP timeline, so
the authored reveal actually runs. `planTransition(fromT, toT)` is a pure function and
decides the policy — play forward at 1x, cut on anything backward, zero-length, over a
2.5s cap, or under `prefers-reduced-motion`. Backwards is cut because entrance tweens run
in reverse read as elements un-drawing themselves; the cap is because a longer span
crossed a slide boundary and is mostly the outgoing slide's hold, which is dead time
nobody should watch. Rapid arrow-mashing cancels any in-flight loop, so a navigation can
never be overwritten by an orphan settling on the old stop.

**Held slides breathe.** One focal element per archetype carries a slow, low-amplitude
CSS animation — the headline, the equation, the emphasised row, the last point on the
chart. Two keyframes (`ds-breathe` on `filter`, `ds-drift` on `transform`), 6–11s,
alternating.

`filter` rather than `opacity`/`transform` for most of it because a CSS animation outranks
inline style, so animating a property GSAP writes would cancel the entrance tween on the
same element.

## The design decision that made this safe

Ambient motion is gated behind a `.ds-live` class that **the composition never sets**.
The wrapper's runtime adds it to the composition's `documentElement` at present time;
`render`, `check` and `snapshot` see a still document.

This was chosen so the video path could not regress rather than hoping it wouldn't, and
it is why ambient could not be a GSAP tween on the scene timeline: a held stop is a
paused timeline, so anything that kept advancing would run into the next reveal.

**It worked exactly as intended.** Renders before this work and after it are the *same
file*:

```
c553ba9c85cd2f2c0c742fc5f5333f8ac03216395df0209e30090a11c5055edd   before, run 1
c553ba9c85cd2f2c0c742fc5f5333f8ac03216395df0209e30090a11c5055edd   before, run 2
c553ba9c85cd2f2c0c742fc5f5333f8ac03216395df0209e30090a11c5055edd   after ambient, run 1
```

Ambient motion changed zero rendered pixels. (The hash moved to `1165c428…` only once the
*layout* changed below — a real pixel change, still byte-identical across two runs.)

## Measured in a browser

| Claim | Evidence |
|---|---|
| forward step animates | 29 distinct intermediate colours on the highlighted row over a 700ms plan; first change +145ms, last +596ms |
| backward cuts | 2 states one frame apart, no intermediates |
| Home/End cut | single frame, ~68ms |
| held slide is alive | no input: `ds-breathe` `running`, `brightness(1.00095 → 1.04636)` monotonic, 12/12 samples distinct |
| reduced motion | both stop — `getAnimations()` empty, `filter: none`, transitions collapse to a cut |
| composition alone stays still | `documentElement.className === ""`, `getAnimations() === []` |

## Three defects found by looking, again

**1. Every archetype but the title was top-heavy** — content in the upper 40% above a
500–600px dead band. It passed all five gates and read as unfinished. Scenes are now
centred (`justify-content: center`); the gate still catches anything taller than the
canvas.

**2. The line chart sat 3.6px from clipping.** The right pad was derived with a
tabular-figure width (`0.58em`) applied to a *proportional* category name. Estimating the
value and the label separately, with explicit slack, takes the worst real label from
**3.6px to 72.7px** of clearance.

**3. `verify` scanned `deck.html` for render-time determinism.** The wrapper is a
presented page, never a rendered one, and its rAF loop legitimately reads a clock — so
the scan failed the build for code that is never rendered. The wrapper filename is now
single-sourced as `DECK_PAGE` and excluded. This is the third time a rule written for the
composition has been applied to the wrapper; the two artifacts have genuinely different
contracts and the code now says so in one place.

That makes it four experiments running where the gates were green and the output was
wrong. The pattern is stable enough to state as a rule: **the gates verify mechanics, and
a screenshot is part of the definition of done.**

## Planner: audited, then replaced

> **Superseded by the addendum below.** This section records the offline audit of the
> Anthropic-SDK planner, which has since been deleted in favour of the Codex CLI. Kept
> because the audit's one open question is exactly what the first live call answered.

No credential existed in this environment, so the first live plan had not happened. The
offline half was hardened instead:

- **`MAX_TOKENS` 32k → 64k.** Thinking is on by default on `claude-opus-5` and shares
  `max_tokens` with the response, so a long storyboard at `effort: high` could have spent
  the budget reasoning and truncated mid-object.
- Request shape confirmed: adaptive thinking, `output_config.effort`, structured output
  from `storyboardSchema`, streaming, and none of the parameters that 400 on this model.
- Every failure a first live run will hit now has an actionable message: no credential,
  schema mismatch, dangling ids, `max_tokens`, refusal (checked before reading content).
- 14 tests drive the real parse/validate/integrity path over recorded bodies, including
  negatives for a dangling id, an archetype/params mismatch, truncation and refusal.

**To judge a storyboard** (still the right checklist, whichever planner produced it): what no gate can check — whether **weights** actually rank
(all above 0.8 means nothing was ranked, and the short formats will keep everything),
whether the **archetype mix** is varied (mostly `callout` means it failed to find the
figure or equation carrying each point), whether **intent** states an understanding
rather than a topic, whether beats that assert something carry **evidence**, and whether
the limitations the source admits to survived into a beat at all.

## Known, not fixed

- Sid-scoping the ambient rules defeats the shell's CSS dedup, so shared archetype CSS
  now repeats per scene and the composition grows linearly in beats. Byte-identical
  duplicate rules, so cascade and determinism are unaffected — it is size only. The fix
  is a separate `ambientCss` field on `Scene`.
- The line chart's `readout` floats unconnected to the plot.
- The line chart's `readout` floats unconnected to the plot. (The Anthropic credential
  caveat that stood here is moot — that planner is gone.)

---

## Addendum — the planner runs on Codex, and the first live call earned its keep

Metered API tokens were the wrong trade for a step whose entire design is that a human
reads and edits it. `decksmith plan` now shells out to the **Codex CLI already installed
on the machine** (`codex exec`), under an existing subscription. The Anthropic SDK and
its planner are deleted; `@anthropic-ai/sdk` is gone from `package.json`, leaving seven
dependencies, all of which are local computation.

`codex exec --output-schema` gives the same guarantee the API's structured outputs did —
the final message is schema-conformant JSON written to a file, with no prose or code
fences to strip. Sandbox `read-only`, `--ephemeral`, and a prompt on stdin rather than
argv (a paper-length source will exceed the argument limit). `assertRefsResolve` moved to
`src/plan/refs.ts`, since it is a property of the storyboard/source pair and `build`
re-checks it on hand-edited storyboards no planner ever touched.

**The first live call found what the offline audit explicitly could not.** That audit
flagged one open question: whether structured outputs require every property to appear in
`required`. It does — and leaving an optional key out is a 400, not a permissive default:

```
invalid_json_schema: 'required' is required to be supplied and to be an array
including every key in properties. Missing 'eyebrow'.
```

Optionality is now expressed the only way strict mode allows: every key is required, and
a formerly-optional value may be `null`, with `stripNulls` turning those back into
`undefined` before zod sees them. Two regression tests pin it.

That is the whole argument for running the thing rather than reasoning about it. Four
experiments found defects that passed every gate; this one found a defect that passed
every gate *and* a careful offline audit of the exact API rules.

## The first real storyboard, and what reading it changed

Six beats, 35 seconds, no key. Mechanically perfect — every id resolved, and the weights
genuinely ranked (0.9 down to 0.45). Reading it exposed three defects that no schema
could:

1. **Three consecutive `data-table` beats on the same three-row table** — the same visual
   repeated to say one more small thing each time. Padding, and it reads as padding.
2. **Headlines were labels in Title Case** — "Three Methods, Two Reported Measures".
3. **A beat about the planner's own constraints** — headline "What The Source Supports",
   claim "No claim-figure beat is possible." It broke the fourth wall to explain what it
   could not find.

Three rules added to the system prompt: a headline is a complete-sentence claim in
sentence case; one object gets one beat with several holds, never several beats; and
never make a beat about the source, the plan, or your own constraints — a thin source
yields a short deck, not a beat apologising for it.

Re-running cost nothing and took 29 seconds. Six beats became **three**: the three table
beats collapsed into one with three holds, the meta-beat was gone, and the headlines read
"Compact thought collides with dense output" and "CATANet is smallest and scores highest
here". Built, gated `PASS — 0/0`, and checked on screen.

The loop that matters is now closed and free: plan, read the JSON, fix the prompt, re-run.
The storyboard being a file a human reads is what made all three defects visible in under
a minute — before a single frame was rendered.
