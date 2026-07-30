/**
 * The shared stylesheet, the ambient gate, and the deck's pacing.
 *
 * The palettes themselves moved to `./themes/` once there was more than one;
 * this file stays the door to them, so nothing that imports `ambient` or `ink`
 * had to be touched to gain a registry.
 *
 * What is left here is everything a theme does NOT decide per-theme: the reset,
 * the scene box, the two ambient keyframes, and `pace`. Typography belongs to
 * the archetype that draws it, not to this file. Two stylesheets describing one
 * `.figwrap` is how a rule ends up being decided by emission order, so nothing
 * an emitter styles is styled here as well.
 */
import type { Format } from "../types.js";
import {
  PAD_X,
  PAD_Y,
  type Raw,
  refHeight,
  refWidth,
  type Scene,
  type Tween,
  type Vars,
  type VarValue,
  zoomOf,
} from "./kit.js";
import type { DeckTheme } from "./themes/index.js";

export {
  type DeckTheme,
  ink,
  mono,
  paper,
  resolveTheme,
  THEME_NAMES,
  THEMES,
} from "./themes/index.js";

/** Where `ingest` writes the subsetted font bundle, relative to the deck. */
export const FONT_BUNDLE_HREF = "assets/fonts/fonts.css";

/**
 * The two ambient motions, and the gate that keeps them out of a render.
 *
 * A held slide is a paused timeline, so ambient life cannot be a GSAP tween —
 * anything still advancing at a hold would run into the next reveal. It is CSS
 * animation instead, and it only runs when `.ds-live` is on the composition's
 * documentElement. The composition never sets that class; only the deck
 * wrapper's runtime does, at present time. `render`, `check` and `snapshot`
 * therefore see a still document and stay byte-identical.
 *
 * `ds-breathe` moves `filter`, which is the point: GSAP writes inline
 * `transform` and `opacity` for entrances, and an animation outranks inline
 * style, so a shared property would eat the entrance. `ds-drift` moves
 * `transform` and is only for elements no tween targets.
 */
const AMBIENT_KEYFRAMES = `      @keyframes ds-breathe { from { filter: brightness(1); } to { filter: brightness(1.12); } }
      @keyframes ds-drift { from { transform: scale(1); } to { transform: scale(1.012); } }`;

/** A luminance breath. Safe on an element an entrance tween already moves. */
export const BREATHE = "ds-breathe 6s ease-in-out infinite alternate";

/** A 1.2% swell. Only for an element no `fromTo` targets — it writes `transform`. */
export const DRIFT = "ds-drift 11s ease-in-out infinite alternate";

/**
 * One ambient rule for one focal element.
 *
 * `rest` is glued straight onto `#<sid>`, so the selector cannot escape its own
 * scene however the caller writes it — `" .dot:last-of-type"` and `"-r2 td"` are
 * both scoped. Reduced motion is the default: stillness needs no gate, motion
 * does.
 */
export function ambient(sid: string, rest: string, animation: string): string {
  return `@media (prefers-reduced-motion: no-preference){.ds-live #${sid}${rest}{animation:${animation}}}`;
}

export function baseCss(theme: DeckTheme, format: Format): string {
  return `      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${format.width}px; height: ${format.height}px;
        overflow: hidden; background: ${theme.bg};
      }
      body { font-family: ${theme.fontStack}; color: ${theme.fg}; font-weight: ${theme.bodyWeight ?? 400}; }

      /* Centred, not top-anchored. Top-anchoring left every archetype but the
         title sitting in the upper 40% above a 500-600px dead band — it passes
         every gate and reads as unfinished. Centring is safe here because the
         gate still catches anything taller than the canvas; it just now
         overflows symmetrically instead of only downwards. */
      .scene { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
               padding: ${PAD_Y}px ${PAD_X}px; display: flex; flex-direction: column;
               justify-content: center; }
${referenceSpaceCss(format)}
${AMBIENT_KEYFRAMES}`;
}

/**
 * THE ONE PLACE REFERENCE SPACE MEETS THE CANVAS.
 *
 * Everything an archetype emits — type sizes, gaps, radii, stroke weights, tween
 * offsets, SVG user units — is in reference px. Two rules turn the whole scene
 * into canvas px at once, and that is why none of the ~250 literals in the
 * vocabulary had to learn what format they are being drawn on.
 *
 * `zoom`, NOT `transform: scale()`, and the difference is the whole risk of this
 * design. EXPERIMENT-006 spent five hypotheses cornering a caligraphic `W` that
 * rasterised differently run to run, and the answer was a glyph-cache decision
 * inside Skia taken ON A SCALED OUTLINE. A transform puts every glyph in the deck
 * through that same path; `zoom` folds into the effective device scale, so glyphs
 * are laid out and rasterised at their final size the way they are on a high-DPI
 * screen. Measured, because the reasoning alone is worth nothing here: the
 * image-free portrait fixture renders 210/210 frames byte-identical twice, before
 * and after. Do not swap this for a transform without re-running that.
 *
 * On a deck WITH figures the honest answer is "no measurable change, on a
 * measurement too noisy to say much". Two `drift` runs of the twelve-beat demo at
 * 9:16, each side: before 2 and 427 of 5363 frames differing, after 975 and 426.
 * The baseline moves by two orders of magnitude between identical runs of
 * identical input, exactly as EXPERIMENT-006 recorded, so the count is not a
 * signal. The worst frame is, and it is stable and slightly BETTER after — 45-46
 * dB against 42.5 — and it sits in the KaTeX scene both ways, which is the
 * caligraphic `W` again rather than anything reference space introduced.
 *
 * Emitted only when the scale is not 1. At `deck-16x9` and `video-16x9` the
 * canvas IS the reference canvas, so the block is absent and those compositions
 * are byte-identical to every one built before reference space existed. That
 * property is the cheapest check that this did not quietly redesign the format
 * that ships today, and it is worth an `if`.
 *
 * The second rule is for the camera, and it names no camera class on purpose.
 * `rigHtml` nests a SECOND `.scene` — the plate — inside the first, and
 * `diveStatements` moves the rig between them by `format.width / 2 -
 * dsFramed.cx`, which is CANVAS px because `getBoundingClientRect` reports
 * canvas px whatever the zoom. A rig sitting inside the scaled subtree would
 * therefore pan short by exactly the scale factor and frame the dive off its own
 * subject. So a scene that merely CONTAINS a scene is a pass-through: canvas px,
 * no padding, no scale, and the plate inside it is the one that enters reference
 * space. `camera.ts` needs no knowledge of any of this, and a camera-free deck
 * still carries no camera rule.
 *
 * `:has` because the shell, not this file, decides whether a scene is wrapped,
 * and it decides per beat. Chrome has supported it since 105; the renderer and
 * the deck player are both far past that.
 */
function referenceSpaceCss(format: Format): string {
  const zoom = zoomOf(format);
  if (zoom === 1) return "";
  return `      .scene { width: ${refWidth(format)}px; height: ${refHeight(format)}px; zoom: ${zoom}; }
      .scene:has(.scene) { width: 100%; height: 100%; padding: 0; zoom: 1; }`;
}

/* -------------------------------------------------------------- Pacing */

/**
 * Every time in a finished scene, multiplied by `speed`.
 *
 * `prefs.animationSpeed` sits under `look` beside `theme` for a reason: it is
 * the same kind of decision, and this is the same place to apply it. It is
 * applied to the emitted Scene rather than inside `tween()` because half of a
 * timeline's arithmetic never passes through `tween()` — an emitter works out
 * `settled = rowsIn + stagger * rows + 0.45`, hands the result to `holdsWithin`,
 * and only the two endpoints ever reach a helper. Scaling the finished scene
 * catches the tween, its stagger and its position with one rule, and scaling
 * `holds` by the identical factor is what keeps a hold on the frame it was
 * authored for. A hold that drifts off its tween lands navigation on a
 * half-built slide, which no gate can see.
 *
 * This used to scale the emitted STATEMENT TEXT, and recovered the position
 * argument with `/,\s*(-?\d*\.?\d+)\s*\)\s*;?\s*$/` — a regex parsing GSAP out
 * of a string, on the path every deck's timing goes through. `Tween` is a typed
 * object now, so the position is a field and the durations are fields, and this
 * is the arithmetic it always wanted to be.
 *
 * The caller must scale the beat's own `seconds` by the same factor, or a
 * slowed deck cuts its last reveal off and a hurried one sits on a finished
 * slide. That is the shell's arithmetic, not a scene's, so it is not done here.
 *
 * Ambient CSS is left alone: it loops forever and nothing waits on it, so its
 * period is a property of the room rather than of the deck's pace.
 *
 * `speed === 1` returns the scene untouched — identity by construction, not by
 * arithmetic that happens to round back. That is what keeps a default deck
 * byte-identical to one built before this existed.
 */
export function pace(scene: Scene, speed: number): Scene {
  if (speed === 1) return scene;
  return {
    ...scene,
    tl: scene.tl.map((t) => paceTween(t, speed)),
    // THREE places for a hold, four for a duration, and the difference matters.
    // A duration needs the fourth (see `round` below); a hold is a TIME on the
    // deck timeline, and invariant 10 puts those at three — `emitIsland` and the
    // scene divs both publish `round3(start + hold)`. A hold kept at four places
    // survives that rounding differently depending on the scene start it lands
    // on, so `assertHoldsAgree` compared 87.200 against 87.199 and `planTiming`
    // threw. At `--speed 0.417` the demo produced no timing.json at all and
    // `render` refused, with every gate still reporting PASS.
    holds: scene.holds.map((h) => round3(h * speed)),
  };
}

/**
 * Keys whose value is a duration. Everything else in a `fromTo` payload is
 * geometry — `y: 22` must survive untouched — so this is an allowlist, never a
 * "scale every number" pass. `amount` is `stagger: { amount, grid }`'s, which is
 * also why a `stagger` holding an OBJECT is descended into rather than scaled:
 * `stagger: { amount: 0.55, grid: [3, 4] }` would otherwise multiply a grid.
 */
const TIMES = new Set(["duration", "delay", "stagger", "amount", "each", "repeatDelay"]);

function paceTween(t: Tween, speed: number): Tween {
  return {
    ...t,
    from: paceVars(t.from, speed),
    to: paceVars(t.to, speed),
    at: round(t.at * speed),
  };
}

/**
 * Recursive, because `stagger` and `snap` both nest, and because the text this
 * replaced was scanned end to end — a `duration` at any depth was scaled, and a
 * pass that only looked one level down would silently stop pacing the grid
 * stagger the moment someone nested it.
 */
function paceVars(vars: Vars, speed: number): Vars {
  const out: Record<string, VarValue> = {};
  for (const [key, value] of Object.entries(vars)) {
    out[key] =
      typeof value === "number" && TIMES.has(key)
        ? round(value * speed)
        : isVars(value)
          ? paceVars(value, speed)
          : value;
  }
  return out;
}

/** A nested payload — not an array, not `raw()`, not a scalar. */
function isVars(v: VarValue): v is Vars {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Raw).__raw !== "string"
  );
}

/**
 * Four places, so a 0.35s tween at 0.3x is still a tween and not `0.105000001`.
 * Accumulated float times print as `7.199999999999999`, and a render has to be
 * byte-identical twice running.
 */
function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Invariant 10's three places, for the times the deck timeline publishes. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
