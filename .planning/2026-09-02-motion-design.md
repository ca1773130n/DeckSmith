# Motion that explains — design

**Status:** PR 1 implemented on `feat/motion` (2026-09-02); PR 2 (focus camera)
proposed. Neither changes a storyboard, a hold count, or the planner.

## The problem, measured

A filmstrip of the demo deck — twelve beats, six evenly spaced samples each —
shows motion finished by the second or third sample in every row and a still
for the remaining six to seven seconds. Every element in every archetype enters
the same way: `opacity 0→1` with `y 14→0` or `x −18→0`, `power2.out`, 0.3–0.9 s.
`.planning/ARCHITECTURE-CANVAS.md` already recorded the diagnosis (41 opacity
0→1 pairs, **nothing is ever dimmed**, one fixed framing twelve times) and
ranked the fixes: an in-scene camera on the content region, a spotlight, vector
morph. This design is those three, in that project's vocabulary and under its
invariants.

What "motion that explains" means here: the motion of a reveal should *be* the
idea of the reveal. A pipeline stage is reached by something travelling the
arrow; a grid region is found by a window sweeping the field; a stack layer is
read by a probe descending through it; a chart's next tick is a marker walking
the curve and finding a smaller step. Decoration (parallax, particles, moving
backgrounds) stays out, as decided.

## Constraints every tween must satisfy

- `fromTo` only, no callbacks, no plugins: the composition loads GSAP 3.14 core
  (`vendor/gsap.min.js`), so DrawSVG/MotionPath/MorphSVG are not available and
  are not added. Draw-on is `strokeDashoffset` (`drawFrom` in `src/emit/svg.ts`);
  travel is `x`/`y`; morph is crossfade plus transform.
- Selectors start with `#<sid>`; times rounded as today (`tween()` 2 dp).
- **Hold counts and hold rules unchanged** — `REVEALS` in `src/plan/prompt.ts`
  is a contract with narration (`stopCount`) and with the prompt tests. Reveals
  get denser, not more numerous.
- A step between two consecutive stops is ≤ 2.5 s (`MAX_SPAN`,
  `deck-runtime`), or the deck page cuts instead of playing it. Reveal spacing
  formulas (`step = clamp(...)`) stay; new motion fits inside the existing step,
  so hold times move by at most 0.2 s and the duration model
  (`MOTION_SHARE`, `LAST_HOLD_SECONDS`) is untouched.
- At most one immediate-render `fromTo` per (element, property). Every
  spotlight or focus tween after an element's first gets
  `immediateRender: false` and starts from the previous tween's end value.
- No `will-change: transform` on text subtrees; SVG parts transform with
  `svgOrigin`.
- One `.ds-live` ambient rule per scene, unchanged.
- Dimmed text must still pass the contrast gate and the type floor: dim to
  **0.62**, never lower, and never dim the headline or the eyebrow.

## PR 1 — reveal verbs and spotlight (emitters + kit)

### Kit additions (`src/emit/kit.ts` / `src/emit/svg.ts`)

```ts
/** Everything in `scope` except `keep` eases to DIM; the first call renders immediately, later ones do not. */
spotlight(sid, scope: string, keep: string, at: number, opts?: { restore?: boolean }): Tween[]
/** A dot travels a straight or elbow route: one x/y fromTo per segment, `ease: "none"` between corners. */
travel(target: string, route: {x:number;y:number}[], at: number, seconds: number): Tween[]
/** Restore everything in `scope` to full opacity — used once, at a scene's last hold. */
restore(sid, scope, at): Tween
```

`DIM = 0.62`. Spotlight selectors are `#<sid> .<class>:not(#<sid>-<part>)`
(starts with `#sid`, passes the hyperframes lint).

### Per-archetype verbs (hold counts unchanged)

What shipped in PR 1, per archetype:

| archetype | what moves now |
|---|---|
| **pipeline** | a dot rides each arrow from the box it leaves to the box it reaches, landing as that box **pops** (`scale .92→1`, `svgOrigin` at its centre); earlier stages dim; the loop's dashes **flow** one period while the sweep reveals it; all stages restore at the note |
| **stack** | a **probe** (rule with a dot at its tip) walks down the numeral spine in one continuous move, arriving at each slab as it rises; slabs below dim; restore at the note |
| **line-chart** | a **ring** walks the curve point to point over the 1.8 s the line takes to draw, then fades once the curve is whole |
| **grid** | the cell field dims to DIM behind the first region and restores at the note, so a region is read against a quiet field |
| **bar-compare** | at the settle, the focal bar stays lit and every other bar dims. **No restore** — a comparison ends on its answer, and the tail is 0.3 s later |
| **data-table** | non-highlighted rows dim and the light moves row to row with the argument; restore at the note |
| **equation-walk** | every term but the one being walked dims; restore on the last term |
| **split-compare** | the left side dims when the right lands; both restore for the note |
| **annotated-figure** | each previous label dims as the next note lands; restore at the last hold |
| **callout** | panel lines arrive staggered inside the panel; earlier panels dim; restore at the note |
| **title** / **claim-figure** | headline and claim arrive **word by word** (`.w` spans, stagger 0.06 / 0.05); the claim's figure **pushes in** 1→1.035 across the beat, chained after its entrance |

### Deviations from the design as written

Recorded rather than quietly dropped:

- **No rail marker on bar-compare** and **no scan bar on data-table**. The bar's
  own growth already is a marker; a table row's pitch is browser-laid-out, and a
  scan bar off by a few pixels looks like a defect. Both got the dim instead,
  which is the part that carries the meaning.
- **No clip-path fill sweep on grid**, **no divider-highlight travel or blurred
  figure crossfade on split-compare**, **no plate push on annotated-figure**, and
  the pipeline's arrows still fade in rather than drawing. Each is additive and
  none was needed to make the beat read; they are candidates for a later pass.
- `spotlighter` grew a **class keeper** (`lit(".t-a", …)`) so archetypes whose
  parts carry classes rather than ids — equation terms, table rows, bars — can
  use the same history-tracking helper instead of hand-rolling the dim.

### Two bugs the gates could not see, found by looking at frames

- The pipeline's dot was handed the arrow's **absolute** endpoints, but `x`/`y`
  on an SVG element is a transform that **adds** to the drawn `cx`/`cy`: it flew
  159 px below the arrow it was supposed to ride. Every test passed.
- The stack's probe was drawn centred on its group, so the walk put its dot half
  a rule below every slab it pointed at.

Both are the same shape of failure this project keeps recording: a green gate
over wrong output. Routes are now relative, and the probe's dot is its anchor.

### Tests

- Keep every structural pin (hold counts, ascending, within window, `#sid`
  prefixes, one ambient rule, `svgOrigin` symmetry).
- Update the shape pins the emitter map lists (`themes.test.ts:188-193`
  title tween text; `arch-pipeline.test.ts` arrow-before-stage and sweep
  `from` keys; `arch-bar-compare.test.ts` schedule; `archetypes.test.ts`
  line-chart dash regex) to the new shapes, each with a one-line reason.
- New, per archetype: the verb exists (pulse tweens exist and end at the stage's
  `at`; dim tweens carry `immediateRender: false` after the first; a restore
  tween exists at the last hold; nothing dims below 0.62; no tween targets the
  headline/eyebrow with opacity < 1).
- `npm run sweep` re-pin.

### Verification (PR 1), 2026-09-02

- `npm run check` green: 35 files, 1140 tests. `npm run sweep` re-pinned
  (48 ok, 5 refused over 53 cells, 11/11 known defects still fixed).
- Demo deck built at `ink`, `mono` and `paper`: PASS, 0 errors, and the same
  warning count as `main` builds of the same demo. `verify` PASS.
- Filmstrip before and after (12 beats x 6 evenly spaced samples): motion is
  visible in samples 1-4 of every row and settled by the last, against a
  before-strip where every row was still by sample 3.
- Positions of the three moving elements read back from the browser at real
  times: the dot's centre on the arrow's centre line, the probe's dot on the
  slab it names, the ring on the curve's last point.
- Only two shared test pins changed, both in `test/themes.test.ts`, both for the
  title's word-by-word reveal; the `pace` test proves the stagger scales with
  `animationSpeed`.

## PR 2 — focus camera per hold: TRIED, AND REFUSED ON EVIDENCE

**Status: not built, and should not be built as specified.** A working prototype
was written and measured on 2026-09-02; what it measured is why it was reverted.

The design above proposed gliding the content region so the part being spoken
about fills more of the frame. Built as `focusOn` in `kit.ts` and wired into
`pipeline`, it produced two findings:

1. **A "fill both axes" rule never fires on the diagrams that need it.** A
   pipeline's row is exactly as tall as its boxes, so the largest zoom that keeps
   the box inside the frame is `k = 1.01` — no move at all. Every archetype sizes
   its diagram to `contentW` by construction, so the same is true of most of them.
2. **A width-driven rule fires, and turns the layout gate red.** At `k = 1.45`
   the demo's pipeline reported six `canvas_overflow` errors — stage labels
   pushed outside the canvas at `t=10.35s` and `t=11.75s`. The deck went from
   PASS to FAIL.

The second is the real objection, and it is not a tuning problem. `check.ts`
regrades `canvas_overflow` to an error unless the sample lies inside a
`data-ds-transit` window, and that exemption exists for the DIVE, whose flight is
transient and whose landing is a full frame. A focus glide is different in kind:
it holds at zoom, so the exempted frames are **settled frames with content
cropped**, which is the thing the gate is for. Buying this feature costs the
project its most valuable layout check, on the archetypes where diagrams are
densest.

`.planning/ARCHITECTURE-CANVAS.md` records a zoom ceiling of 1.127 for a
cropping camera and treats "elements not under discussion may leave the frame"
as a decision to be made deliberately, not a side effect of a feature.

**What to do instead, if this is wanted:** make the crop a decision rather than
an exemption — an explicit safe box the archetype guarantees (a diagram that
draws itself into 80% of the content box has 1.25x of camera for free, with
nothing to crop), or emphasis without a camera (the focused part holds its size
while its neighbours ease down). Both are additive to PR 1 and neither needs the
gate to look away.

## Not in scope

Match-cut seams and cross-scene camera (ranked 4–5 in ARCHITECTURE-CANVAS;
after these two); planner involvement (no new storyboard fields); GSAP plugins;
particles, parallax, moving backgrounds (rejected on record).
