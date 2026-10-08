# v2 bespoke scenes, round 2: the look, and a third of the cost

2026-10-08. Branch `feat/v2-bespoke` (PR #112), after
[`2026-10-08-v2-bespoke.md`](2026-10-08-v2-bespoke.md) (round 1). The founder's bar: "I've
seen people create MUCH better animated slide decks." Round 1 worked mechanically but drew
plain technical diagrams with 40-56px labels, and cost 13-31 minutes and 540-705k tokens a
deck. Preview: `~/.blackhole/DeckSmith/2026-10-07/preview/bespoke-r2/index.html`
(`http://localhost:8799/bespoke-r2/`) — v2, round 1 and round 2 per beat on one narration
clock, contact sheets, and the numbers below.

## What changed

**Where the time and tokens went.** One round-1 draft prompt replayed through `codex exec`
four ways: default config at high effort 488s and 72k tokens (56,679 input over several
turns), default at medium 135s/61k, tools off at medium 166s/24k, tools off at high
371s/50k. With tools on, the agent's first turns were `cat` on the account's global
AGENTS.md and an animation skill. Bespoke calls now run with every tool feature, web
search and each configured MCP server off (`leanCodexConfig`), from the scratch dir (no
project AGENTS.md), at `bespoke.effort` (default medium), five in flight (three put a
five-beat deck's drafts in two waves).

**The look.** Grounded in Vector Prism (arXiv 2512.14336: semantic groups are what lets a
VLM animate parts coherently), Code2Video (2510.01174: anchors and examples, not
adjectives), TheoremExplainAgent (2502.19400: layout is the dominant failure; judge
against explicit criteria), and what 3Blue1Brown, Kurzgesagt-style motion graphics,
keynote reveals and Distill figures share:

- four hand-made reference scenes (`src/bespoke/references.ts`), two shown per beat by
  archetype, painted in the pack: route (particle flow, focus, counter), zoom (camera into
  one block), growth (traced curve, tracking dot, counter, gap MORPHS into the number),
  gather (one set of dots travels into a bell). Each passes every gate and the rubric
  probe in a real deck (`test/bespoke-references.test.ts`);
- motion-design rules with numbers in the prompt; text widths measured in the pack's font;
- `<g data-cue="N">` groups; MorphSVG registered for a deck only when a scene morphs.

**Gates (errors):** `stage_fill`, `type_hierarchy`, `stray_marker`, `early_reveal`,
`cue_groups`; `graphic_crosses_text` no longer lets a curve's bounding box act as a
label's plate; content clipped by a camera's `<svg>` is not off-frame. Overlap findings
carry the labels' boxes.

**The critique** scores a six-line rubric against the frames and the measures, and fixes.
**The rubric probe** skips it for a draft that passed every gate and is clean on the
measurable half: painted share >= 12%, under half dimmed at the end, a label >= 88px,
three motion kinds incl. flow/camera/counter/morph, every cue >= 0.5% change, no warning.

## Measured: the same 3 decks + 1 ja deck

Round 1's scenes re-measured with round 2's ruler (`preview.ts` probes both decks). "Paints"
is the share of the body box the settled frame paints (the frame minus the same frame with
the body hidden). Final run of the final code, one run per deck, fresh cache.

| deck | drawn | stage fill (bbox) | paints | largest label | kinds | gate findings r1 → r2 | calls | tokens | wall |
|---|---|---|---|---|---|---|---|---|---|
| ko blueprint | 5 → 4 of 5 | 87 → 89% | 7 → 33% | 64-96 → 96-120px | +morph, stagger | cue_groups 5, stray_marker 5 → 0 | 10 → 9 | 530k → 190k | 1017 → 398s |
| en signal | 5 → 3 of 5 | 89 → 89% | 11 → 64% | 52-96 → 104-120px | +counter, morph, stagger | type_hierarchy 1, cue_groups 5 → 0 | 10 → 7 | 542k → 133k | 1235 → 453s |
| zh atlas | 6 → 6 of 6 | 90 → 91% | 9 → 41% | 64 → 88-112px | +counter, morph, stagger | cue_groups 6, stray_marker 1 → 0 | 12 → 11 | 705k → 196k | 1947 → 617s |
| ja (new) | – → 4 of 5 | – → 94% | – → 32% | – → 88-112px | counter, flow, stagger … | – → 0 | 9 | 169k | 392s |

Every final build `verify`: PASS, 0 errors. Camera was never chosen by a generated scene;
morph in 3 decks, counters in 3, particle flow in all 4.

An earlier full run of the same code minus the mass/dimmed probe and the reference
mass fixes drew 4/5, 4/5, 6/6, 5/5 at 406/432/586/410s and 146-191k tokens: run-to-run
variance in fallbacks is about one beat per deck.

## What the numbers say, and do not

- `stage_fill` as specified (bounding box over the box) does NOT separate round 1 from
  round 2: round 1 already measured 82-90%. Round 1's thin diagrams were spread wide. The
  measure that does is the painted share (4-16% → 18-83%), which is why it is in the
  rubric probe; it is not a gate.
- Fallbacks went up: 0 of 16 → 4 of 21, all `text_overlap` / `graphic_crosses_text` after
  the critique round. Bigger type collides more, and the crossing gate is stricter. A
  fallback is the plain v2 archetype, never a broken deck.
- zh took 617s, over the 600s target by 17s (six beats, five critiques); the other three
  392-453s. Tokens 133-196k, all under 350k. "tokens" is the CLI's own `tokens used`, the
  same counter round 1 reported.
- The rubric probe is applied to drafts; a critique-round scene is kept on the gates alone,
  and three of them end mostly dimmed (zh s6/s8, ja s13).

## Against the founder's bar

Better, not there. Scenes now fill the stage with big, flat, coloured shapes, one focal
element per cue with the rest dimmed, numbers that count, shapes that morph, particles
that flow — none of round 1's hairline boxes. But most generated scenes still speak the
language of labelled cards and connectors, now with icons; illustration is rare and not
repeatable (a trial run drew en's task definition as a room with a view cone over its
objects; the final run drew the same beat as four icon cards). Nobody chose the camera. What is missing: illustration (objects drawn as
things, not boxes), choreography across cues (a scene that transforms one picture into the
next instead of adding cards), a real `render` of a bespoke deck to mp4, and a person's
review of whether each picture is the right picture for its sentence.
