# PRE-REGISTRATION — decision re-run at n = 32, fidelity as primary

Written before any plan was generated. Experiment 015's own pre-registration said
that changing the primary metric makes a new experiment, so this is one, and 015's
numbers are not re-interpreted here.

## 1. The question

Can an LLM behind a JSON schema reliably compose a **compositional animation
vocabulary** (objects, transforms, a camera) as against picking from the
**twelve-archetype menu** it uses today — where "reliably" now includes *the
diagram actually appearing*?

## 2. Why this re-run exists

015 answered the reliability question at n = 20 and could not separate the arms:
MENU 19/20 against VOCAB 16/20, Fisher p = 0.661, powered only for a 35-point gap.
(19, not the 18 first reported: the `transitWindow` fix turned `menu-10` from 13
errors to PASS, and an 80-plan attribution control moved exactly that one verdict.)

But 015 then found, by opening frames no metric asked about, that **four of arm
VOCAB's sixteen gate-clean decks render their main diagram as nothing** — a
20-point effect, larger than the effect the primary metric was measuring, and
invisible to lint, runtime, layout, motion, contrast, the 40px floor and drift.

`src/verify/fidelity.ts` now measures it: rendered ink below the caption at every
declared stop, against a 0.15% floor derived from the area of one 40px label. On
015's corpus it scored TP 4 / FP 0 / TN 37 / FN 0 over 41 decks and 466 stops, and
it fails an all-opacity-0 copy of the demo that every other gate passes with zero
findings.

## 3. Arms

* **MENU** — the shipped twelve-archetype schema and prompt.
* **VOCAB** — 015's compositional schema and prompt, unchanged.

Guidance bytes must stay inside 015's pre-registered band (0.85–1.15×); `run.mjs`
refuses to launch otherwise. Schemas cannot be equalised (18,265 B against 3,588 B)
and that remains a residual advantage arm MENU keeps, stated rather than corrected.

## 4. Primary metric — ONE, fixed now

**A plan is clean iff the built deck has zero errors from `gate()` AND zero errors
from `fidelity()`.**

`gate()` is unchanged from 015 §4: `check` (five passes, with the shipped camera
transit regrade) plus `scanTypeFloor`. `fidelity()` is the shipped gate at its
shipped default floor. Both run over the built deck directory, so both arms are
graded by the identical thing.

Every plan is BUILT. A plan that is schema-valid and does not build is not clean.

## 5. Secondary, named as secondary

S1 schema-validity rate. S2 dangling-reference rate. S3 wall clock and JSON bytes
per plan. S4 `npm run score`'s full shipped verdict, arm MENU only, since it has no
VOCAB counterpart. S5 fidelity failures alone, so the new gate's contribution is
separable from `check`'s.

## 6. Sample size and what it can support

**n = 32 per arm.** 015 measured that 32 per arm detects the 30-point gap its
post-hoc fidelity reading showed (90% against 60%) at conventional power. It does
NOT detect a 10-point gap; that needs ~199 per arm and is out of scope.

So: a gap at or above ~25 points is detectable here. A smaller one is not, and if
the result is smaller than that the honest conclusion is "still unresolved, and
n = 199 is what would settle it" — not a winner.

## 7. Decision rule, committed in advance

* **D1 — VOCAB within 10 points of MENU** (Fisher p > 0.05): reliability is not the
  obstacle. Proceed to build the algebra internally as VOCABULARY.md §7 items 1–5,
  and re-open exposure to the planner after that.
* **D2 — VOCAB more than 25 points below MENU** (p ≤ 0.05): a measured downgrade.
  Do not expose the vocabulary. The menu's archetypes carry intent the planner
  cannot be trusted to compose, and that is the finding.
* **D3 — between 10 and 25 points, or p > 0.05 with a gap that large**:
  underpowered. Report the direction, name n = 199, and do not decide.
* **D4 — VOCAB above MENU**: the ceiling argument is free; proceed, and say so.

## 8. What would make this experiment invalid

Any of these voids the result rather than adjusting it:

* Tuning the fidelity floor, the prompt, or the schema after seeing arm scores.
* Repairing a plan by hand before building it.
* Dropping a run for any reason other than a named infrastructure failure, which
  must be counted and reported.
* Grading the arms with different code.

015's own report recorded that its instrument was wrong three times, each time in
its author's favour, and the headline moved 8/20 → 10/20 → 16/20 as the emitter was
fixed. Emitter bugs found DURING this run are fixed and the whole run is redone
from scratch — never patched mid-flight.
