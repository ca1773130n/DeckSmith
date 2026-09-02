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

## PR 2 — focus camera per hold (shell + kit + check)

**What:** at each hold whose reveal named a part, the content region glides so
that part fills more of the frame, then rests; the next reveal glides on. The
headline and eyebrow never move (ARCHITECTURE-CANVAS: content region only,
landing k 1.55–1.75; here capped at **1.6**).

**Where the target comes from:** the SVG archetypes (pipeline, grid, stack,
bar-compare, line-chart, split-compare) know every part's rect at emit time in
reference px, so they return `Scene.focus?: { hold: number; rect: Rect }[]` —
no SEAM B measurement. HTML archetypes return none in this PR.

**Shell:** when a scene has `focus`, `composition.ts` wraps the content region
(the emitter's `#<sid>-<svg>` root) in `<div class="ds-focus">`
(`transform-origin: 50% 50%`, `position: relative`) and appends, per focus
entry, two `fromTo`s on `#<sid> .ds-focus` — `scale` and `x,y` — starting
0.8 s before the hold (or at the reveal's `at`, whichever is later) and landing
at the hold, `immediateRender: false` after the first, each `from` equal to the
previous `to`. `k = clamp(0.55 · min(W/w, H/h), 1, 1.6)`; below 1.12 the entry
is skipped (a glide that small reads as jitter). Eases: `power2.inOut` (k ≤ 1.6
does not need the log-space ease the dive uses). Times are pre-multiplied by
`speed` like the dive's.

**Gates:** `check.ts` regrades `canvas_overflow` / `panel_out_of_canvas` /
`text_occluded` to error unless inside a `data-ds-transit` window; a focused
scene declares `data-ds-focus="t0-t1"` for the span from its first glide to its
end, and those three findings inside it become `info`, the same mechanism as
transit. The type floor still checks declared sizes at every stop; the fidelity
ink floor still looks at frames.

**Interplay with the dive:** a scene that is dived into already carries the
`.ds-zoom > .ds-pan` rig; the focus wrapper sits inside the plate, and the last
focus entry restores to k = 1 before the dive's `t0` so the two never overlap
in time (no `overlapping_gsap_tweens`).

**Deck page:** glides are inside steps ≤ 2.5 s, so stepping plays them;
backward steps cut, as today; reduced motion cuts, as today.

### Tests (PR 2)

- `focus` rects inside the content box; k within [1.12, 1.6]; glide never
  overlaps another tween on the wrapper; last glide restores before a dive;
  `data-ds-focus` window covers every glide; `check` regrade unit test.

### Verification (PR 2)

- Filmstrip again; a two-render `drift` on the demo (psnr mode) to prove the
  glide is deterministic; `verify` clean on three themes; look at a seam where a
  focused scene hands off to a dive.

## Not in scope

Match-cut seams and cross-scene camera (ranked 4–5 in ARCHITECTURE-CANVAS;
after these two); planner involvement (no new storyboard fields); GSAP plugins;
particles, parallax, moving backgrounds (rejected on record).
