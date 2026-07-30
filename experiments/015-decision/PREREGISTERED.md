# 015 — PRE-REGISTRATION

Written and committed **before any generation run was launched**. Nothing below
was chosen after seeing a result. Every number in `README.md` is reported against
this file; where the two disagree, this file is the record and the disagreement
is the finding.

The reason this file exists is `.planning/VOCABULARY-REVIEW.md` §3.1: the previous
attempt computed four metrics, got three different winners, and reported the one
that favoured its hypothesis. That is not a mistake you can correct afterwards.
So the metric is fixed here, in advance, and the decision rule is arithmetic.

---

## 1. THE QUESTION

> Given the same source, the same task, and the same amount of human-written
> guidance, does an LLM behind a JSON schema produce a **buildable, gate-clean
> deck** as reliably from a compositional animation vocabulary — objects,
> transforms, a camera — as it does from the twelve-archetype menu DeckSmith
> ships today?

Expressiveness is not the question. Reliability is. A vocabulary with a higher
ceiling that validates and builds less often is a downgrade, and that is the
finding the owner needs either way.

**What this experiment cannot answer**, stated up front so no sentence in the
report drifts into it: whether a deck is *good*, whether a slide says anything
true, whether the vocabulary would raise the ceiling once a layout pass existed,
or what any of it costs to build. The gate is mechanics. `.planning/VOCABULARY.md`
§7 owns the cost; §4.2 of the review owns "green gates over wrong output".

---

## 2. THE TWO ARMS

Both arms are one `codex exec` call with `--output-schema`, spawned exactly the
way `src/plan/codex.ts` spawns it, with the same sandbox, the same model default,
and the same source document (`demo/source.json`).

| | arm MENU | arm VOCAB |
|---|---|---|
| schema | shipped `SCHEMA` (`src/plan/codex.ts`) — 12 archetypes, `beats[]` | `experiments/015-decision/vocab.mjs` — objects, anims, camera, `scenes[]` |
| guidance | shipped `systemPrompt(prefs)` (`src/plan/prompt.ts`) | `experiments/015-decision/prompt.mjs` — written for this experiment |
| task | identical text, §3 | identical text, §3 |
| source rendering | shipped `renderSource(source)` | the **same** shipped `renderSource(source)` |
| build path | shipped `node dist/cli.js build` | `experiments/015-decision/emit.mjs` |

### 2.1 Equal specification — the rule, fixed now

The review's §3.2 finding was that arm B got one third of arm A's specification.
The rule this experiment binds itself to:

- **Human-written, vocabulary-specific guidance is matched to within ±10% of
  bytes.** Measured: the shipped `systemPrompt(prefs)` is **13,122 bytes**, so
  arm VOCAB's guidance must land in **[11,810, 14,434]**. The measured value goes
  in the report whether or not it lands in range.
- The task text, the preferences block, the closing instructions and the rendered
  source are **byte-identical strings** in both arms.
- **Neither schema carries `description` strings.** The shipped `SCHEMA` has zero
  (measured), so adding them to arm VOCAB would hand it an information channel
  arm MENU does not use.
- **The schemas will not be equal in size and cannot be.** Arm MENU's is 18,265
  bytes because a menu's schema *is* its specification — twelve archetypes and
  sixty-eight fields enumerated. A grammar's schema is small because the grammar
  is in the prose. Both totals are reported. This asymmetry is a **named
  limitation of the experiment**, not a defect to be papered over, and it is the
  one place arm MENU still holds an advantage that could not be equalised.

### 2.2 The arm-VOCAB emitter, and the rule it obeys

Arm VOCAB has no shipped build path, so one is written: `emit.mjs`, a standalone
hyperframes composition emitter on the pattern of `experiments/014-seam-b/emit.mjs`.

**It must not repair its input.** It places every object at the fraction the plan
gave, at the `fontPx` the plan gave, in the order the plan gave. It does not
clamp a position into the stage, does not shrink type to clear the floor, does
not re-flow a label, does not drop an object that overlaps another. That
prohibition is the entire difference between the two vocabularies — arm MENU's
archetypes refit and seven of them throw; the algebra has nowhere to put it — and
an emitter that quietly fixed things would be the "harness that repairs its
inputs and then reports how well they did" that `scripts/score.mjs` was written
to refuse. Anything it *must* normalise for transport (null-stripping from
structured output, which arm MENU also needs) is recorded per plan.

### 2.3 The refutation control

An emitter written by the same person whose hypothesis it tests is exactly the
failure mode of the last attempt. So:

**Before any generation run is launched**, `control/` holds hand-written
compositional plans covering the same task. They are built through the same
`emit.mjs` and put through the same gate.

- If a control plan is **not gate-clean**, the emitter is broken, and no
  arm-VOCAB number may be reported until it is fixed and the controls pass.
- If an error rule appears in **≥ 80% of arm-VOCAB plans and also in a control**,
  it is attributed to the emitter, reported separately, and the primary metric is
  recomputed with and without it. Both numbers appear.

This is the control that could refute the whole arm-VOCAB result, and it is named
before the result exists.

---

## 3. THE TASK — identical text, both arms

`experiments/013-vocabulary/planner/prompts.mjs:MATCHED_TASK`, verbatim, plus one
added paragraph so that the camera — which the question names and which the 013
schema had no way to express — is demanded of both arms rather than left to
chance. The addition is recorded here as a deviation from 013, and it is the only
one.

```
Produce exactly THREE beats, in this order, and nothing else:

  1. THE METHOD FLOW. The four stages ThinkSR runs an image through — encode,
     window, the DQ-CTM thought process, decode — with the recurrence shown as a
     loop that returns to the thought stage itself, not around the whole flow.
     Note that parameters are shared across ticks.
  2. THE CARRIER EQUATION. Equation eq-carrier, walked one symbol at a time:
     the encoder that turns the low-resolution image into a dense feature field,
     and the window partition that keeps every token.
  3. THE PARAMETER COMPARISON. The five methods in tbl-bench compared on
     parameter count in millions, smallest first, with DQ-CTM-SR distinguished.
     Its 1.129M is the second largest of the five, and the deck must say so
     rather than claim the method is cheap.

CAMERA. Somewhere in this deck, close in on one part of a picture already on
screen so the audience sees it filling the frame, then leave it. Use the camera
your vocabulary gives you for exactly this and nowhere else.
```

The two vocabularies express that camera differently — arm MENU with a beat
carrying `inside: {beat, element}`, arm VOCAB with a scene-level `camera` — and
that is the point: each is asked for the move its own vocabulary provides.

---

## 4. THE PRIMARY METRIC — one number per arm

> **GATE-CLEAN RATE.** The proportion of launched runs that produce a built deck
> on which the shipped gate reports **zero errors**.

The gate is **one function applied to both arms' deck directories**:

```
check(dir)                       src/verify/check.ts — npx hyperframes check --json,
                                 five passes: lint, runtime, layout, motion, contrast,
                                 with the shipped camera-transit regrade
scanTypeFloor(index.html, …)     src/verify/typefloor.ts — invariant 5, the 40px floor
```

Both are shipped code, imported (not re-implemented) through
`out/bits.mjs`. Zero errors from the union is gate-clean. Anything else — invalid
JSON, schema-invalid, an emitter that throws, one `canvas_overflow`, one label at
38px — is not gate-clean.

**Why this gate and not `decksmith build`'s full verdict.** `decksmith build`
additionally runs DeckSmith's narration, budget and diagrammatic scans, which
take a `Storyboard` and have no arm-VOCAB counterpart. Including them would put
gates on one arm only, which is precisely the §3.3 incommensurability that made
the last comparison unusable. `hyperframes check` is 5.78 s of the 5.81 s
`decksmith build` costs (`VOCABULARY-REVIEW` §9.1), so this is nearly the whole
shipped verdict, and it is the same five passes over both arms. Arm MENU's full
`decksmith build` verdict is reported as a secondary and **cannot change the
decision**.

**The denominator is runs launched**, not runs that returned parseable JSON. A
plan that cannot be built is the loudest possible result and must not be dropped
out of the bottom of the fraction. The one exception, fixed here: a run for which
the Codex CLI exits non-zero or writes nothing at all is an **infrastructure
loss** — it measures the CLI, not the vocabulary — and is excluded from the
denominator and reported separately by count. It is **not re-run**.

---

## 5. SECONDARY METRICS — named as secondary

None of these can change the decision in §7. They are reported because they are
what the next person needs.

| # | metric |
|---|---|
| S1 | schema-valid rate (structured output parses and validates against the arm's own zod schema) |
| S2 | emit rate — a deck directory was produced at all |
| S3 | error count per plan, and the error `rule`s by class, per arm |
| S4 | arm MENU's full `npm run score` verdict (shipped `decksmith build`), from `experiments/score/ledger.json` |
| S5 | median wall clock per run; output JSON bytes per unit |
| S6 | whether the plan used the camera at all, and the gate-clean rate split by that |
| S7 | the 40px floor in isolation: how many plans per arm fail `type_below_floor` and nothing else |
| S8 | measured specification bytes per arm (§2.1) |

---

## 6. SAMPLE SIZE, AND WHAT IT CAN AND CANNOT SUPPORT

**n = 20 per arm. 40 Codex runs.** Launched as **one batch per arm**, with no
interim analysis and no stopping rule — there is nothing to stop, because the
batch size is fixed here. No result is looked at until both batches are done.

Basis for 20: 013 measured a median of 36 s for the archetype arm and 168 s for
the compositional arm at 3-way concurrency; at 5-way, 40 runs is 20–35 minutes.
Builds are ~6 s each and the gate dominates them, so 40 gate runs at 4-way is
another ~2 minutes. That fits the budget; 40 does not.

**What n = 20 per arm can detect.** Fisher exact, two-tailed, α = 0.05:

| difference | example | p |
|---|---|---|
| 50 pp | 19/20 vs 9/20 | ≈ 0.002 — detected |
| 40 pp | 18/20 vs 10/20 | ≈ 0.014 — detected |
| 30 pp | 17/20 vs 11/20 | ≈ 0.08 — **not** detected |
| 20 pp | 16/20 vs 12/20 | ≈ 0.30 — not detected |

So this experiment can settle a difference of roughly **35 percentage points or
more, and nothing smaller**. That is stated before the result so that no
conclusion can be drawn past it. "Underpowered, here is the direction, and here
is the n that would settle it" is a legitimate outcome and §7 has a branch for
it. The exact p-values in the report are computed, not looked up from this table.

**A ceiling effect is possible and is anticipated here.** `experiments/score/ledger.json`
currently records **24 of 24** plans PASSing the shipped gate, including all
eight 013 arm-MENU captures and the two camera fixtures that used to fail. If arm
MENU comes back 20/20 the gate is not discriminating on that arm, and the primary
metric then measures arm VOCAB's absolute reliability against a ceiling. That is
a legitimate reading, it is written down now rather than discovered later, and
§7's rules are already expressed in a form that survives it.

---

## 7. THE DECISION RULE

Let `pA` be arm MENU's gate-clean rate, `pB` arm VOCAB's, `Δ = pB − pA`, and `p`
the Fisher exact two-tailed p-value on the 2×2 table.

Exactly one branch fires. They are exhaustive and mutually exclusive.

| | condition | conclusion |
|---|---|---|
| **R1** | `pB ≥ 0.60` and `Δ ≥ −0.10` | **BUILD THE VOCABULARY AND EXPOSE IT TO THE PLANNER.** It is reliable in absolute terms and within a 10-point margin of the menu. n = 20 cannot certify a 10-point margin, so R1 is a *direction* result: it says reliability is not the reason to refuse, and the decision then rests on the cost figures in VOCABULARY.md §7, which this experiment does not revisit. |
| **R2** | `Δ ≤ −0.25` and `p < 0.05` | **DO NOT EXPOSE IT TO THE PLANNER.** A measured, significant reliability downgrade. Build the algebra inside the emitters if the cost case stands on its own; the planner keeps a menu. |
| **R3** | `Δ < −0.10` and R2 does not fire | **DO NOT EXPOSE IT YET, on direction.** The vocabulary is behind and this n cannot say by how much. Report the direction, the interval, and the n that would settle it. Do not call it measured. |
| **R4** | `Δ ≥ −0.10` and `pB < 0.60` | **NEITHER ARM IS RELIABLE.** The finding is about the pipeline, not about the vocabulary, and this experiment does not decide exposure. Report what both arms failed on. |

`Δ ≥ −0.10` is an equivalence margin and it is deliberately asymmetric: the
burden is on the *new* thing. A vocabulary that is 15 points less reliable than
the menu does not get to be called "roughly the same".

**If I later want a different metric, that is a new experiment, and this file
says so.** No number in §4 or §7 may be renegotiated after a result is in hand.
A metric that seems better once the data exists is exactly the metric that made
6/8-vs-3/8 reverse.

---

## 8. WHAT GETS REPORTED, WHETHER OR NOT IT HELPS

1. The raw counts. `k/n` per arm, and the per-run table.
2. The primary metric, `Δ`, and the exact Fisher p.
3. The branch of §7 that fired, quoted.
4. The measured specification bytes, both arms (§2.1).
5. The control result (§2.3), and any rule attributed to the emitter.
6. **Two real outputs opened and looked at: one good, one broken**, as PNG frames
   from the built decks, with what is wrong in the broken one named.
7. Every arm-MENU plan through `npm run score`, receipted in
   `experiments/score/ledger.json`, so no plan in this experiment is one nobody
   built.
