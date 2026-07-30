/**
 * The animation planner: the stage DeckSmith does not have.
 *
 * Today an emitter decides the geometry AND the choreography, and it emits the
 * choreography as GSAP *source text*. The proof that this is the wrong seam is
 * `pace()` in src/emit/theme.ts: the only way to make `animationSpeed` work was
 * to run two regexes over generated JavaScript. Anything richer than a scalar
 * multiplier — a rhythm, an emphasis, a camera — would need a parser.
 *
 * So this file introduces the representation that should have been there.
 *
 *   emitter  ->  Figure { html, css, cues }      what is on screen
 *   planner  ->  Move[]                          how it arrives
 *   compiler ->  { tl: string[], holds: number[] }
 *
 * A `Cue` says *what an element is and when it belongs in the argument*. It
 * carries no time. A `Move` is fully timed but still structured. Only the last
 * step produces a string, and it produces exactly the `fromTo` form the deck's
 * seek-based navigation requires.
 *
 * Invariants this file is built to keep:
 *   - SEEK, NOT PLAY. Every Move is one `fromTo` with an absolute position. A
 *     Move is a pure function of the plan; nothing reads a clock.
 *   - DETERMINISM. No Date.now, no Math.random. All arithmetic is rounded at
 *     the same two/four places the existing emitters round at, so a planned
 *     scene is byte-stable across runs.
 *   - STOPS SURVIVE. `holds` falls out of the step grouping rather than being
 *     accumulated by hand — a stop is "the moment step k has finished arriving".
 *     A design that cannot produce stops is wrong, so stops are the primary
 *     output here and the tween list is the by-product.
 */

/* ------------------------------------------------------------------ Cues */

/**
 * What an element *is*. The planner maps a role to an entrance; an emitter
 * never names a duration, an easing or a distance.
 */
export type Role =
  /** Slide chrome. Arrives before the argument starts and owns no stop. */
  | "eyebrow"
  | "headline"
  /** A member of the series that *is* the explanation. One item, one stop. */
  | "item"
  /** Attached to an item — a caption, a leader, a numeral. Never its own stop. */
  | "tag"
  /** Between items — an arrow, a connector. Arrives just ahead of its target. */
  | "link"
  /** The tail. Its own stop, at the end. */
  | "note";

/** The direction an element travels in from. Geometry only the emitter knows. */
export type Dir = "up" | "down" | "left" | "right" | "in" | "none";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cue {
  /** Already scoped by `sid`, exactly as today. */
  sel: string;
  role: Role;
  /**
   * Stop group. Cues sharing a step arrive together and share one stop.
   * A negative step is prelude: it arrives before step 0 and owns no stop.
   */
  step: number;
  /**
   * Sub-order inside the step, in units of the rhythm's `trail`. `-1` leads the
   * step (a connector drawn into the box that is about to appear), `0` arrives
   * on it, `1` trails it (a caption under the plane it labels).
   */
  after?: number;
  dir?: Dir;
  /**
   * 0..1 — the emitter's opinion of which element is the point of the beat.
   * Today this exists only as "which selector gets `ambient()`", which is why
   * emphasis cannot be a preference.
   */
  weight?: number;
  /** Where this cue lives in the figure's own coordinate space, for the camera. */
  focus?: Box;
  /**
   * Escape hatch for motion no verb covers — `bar-compare`'s bar growth,
   * `pipeline`'s loop sweep, a `strokeDashoffset` draw-on. The planner still
   * owns *when* it happens, which is the part preferences need to reach.
   * Without this the vocabulary would have to cover all twelve archetypes
   * before any of it could ship.
   */
  custom?: { from: Vars; to: Vars; dur?: number };
}

export type Vars = Record<string, number | string>;

export interface Figure {
  html: string;
  css?: string;
  setup?: string[];
  cues: Cue[];
  /**
   * The camera's viewport and the element it transforms. `w`/`h` are the clipping
   * box; `safe` is the region that must stay fully visible at every framing —
   * the diagram's own content bounds.
   *
   * The first version of this proof put the whole slide on the camera layer and
   * the first screenshot showed why that is wrong: framing the bottom plane
   * pushed the eyebrow off the top of the frame and the right-hand notes off the
   * side. So the chrome is NOT on the camera. The headline is the beat's claim
   * and the audience needs it at every stop; the camera is the *diagram's*
   * viewport, not the slide's.
   *
   * `safe` is what makes the zoom ceiling a fact rather than a taste: the planner
   * can zoom no further than `min(w/safe.w, h/safe.h)`, and a figure whose
   * content fills its box therefore gets no camera at all. That is the honest
   * finding — camera room is something an archetype must budget for.
   */
  stage?: { sel: string; w: number; h: number; safe: Box };
}

/* --------------------------------------------------------------- Rhythm */

/**
 * A rhythm, as four independent numbers.
 *
 * This is the whole argument for the refactor in one type. `animationSpeed`
 * multiplies all of these at once, so it can only make the same rhythm happen
 * faster. Vary them against each other and you get genuinely different pacing at
 * the *same total length*: `staccato` snaps each element in over 0.18s and then
 * sits for 0.4s; `measured` takes 0.85s to arrive and 0.25s to settle. Same
 * duration, same geometry, different deck.
 */
export interface Rhythm {
  /** Silence before the first content step. */
  lead: number;
  /** Step to step, when the beat is exactly long enough. */
  gap: number;
  /**
   * How far the gap may open when the beat is longer than the plan needs.
   * `pipeline` says it in a comment — "fill the beat rather than always racing"
   * — and then implements it as one more bespoke clamp. It is a property of a
   * rhythm, not of a pipeline: `staccato` wants the extra second as silence
   * between snaps, `brisk` does not want it at all.
   */
  gapMax: number;
  /** One entrance. */
  dur: number;
  /** One unit of `Cue.after`. */
  trail: number;
  /** A stop sits this long after its step's last move ends. */
  settle: number;
  /** How far an entering element travels, in px/user units. */
  travel: number;
  ease: string;
}

export type Pacing = "even" | "brisk" | "measured" | "staccato";

/**
 * `even` is not a new invention — it is the numbers the twelve emitters already
 * hardcode, extracted. `stack` opens at 0.9s, enters over 0.55s with
 * `power2.out`, trails its caption by 0.2s and holds at `at + 0.62`; that is
 * `lead: 0.9, dur: 0.55, trail: 0.2, settle: 0.07`. Reproducing the current
 * output from the new representation is the migration's correctness test.
 */
export const RHYTHMS: Readonly<Record<Pacing, Rhythm>> = {
  even: {
    lead: 0.9,
    gap: 0.4,
    gapMax: 0.8,
    dur: 0.55,
    trail: 0.2,
    settle: 0.07,
    travel: 34,
    ease: "power2.out",
  },
  brisk: {
    lead: 0.5,
    gap: 0.28,
    gapMax: 0.4,
    dur: 0.3,
    trail: 0.08,
    settle: 0.05,
    travel: 18,
    ease: "power3.out",
  },
  measured: {
    lead: 1.2,
    gap: 0.9,
    gapMax: 1.6,
    dur: 0.85,
    trail: 0.3,
    settle: 0.25,
    travel: 52,
    ease: "power2.out",
  },
  staccato: {
    lead: 0.7,
    gap: 0.7,
    gapMax: 1.15,
    dur: 0.18,
    trail: 0.06,
    settle: 0.4,
    travel: 26,
    ease: "power4.out",
  },
};

export interface MotionStyle {
  rhythm: Rhythm;
  /**
   * `focal` gives the highest-weight cue a longer, further, overshooting
   * entrance and an extra gap in front of it — the deck pauses before the
   * punchline. `each` gives every step's lead cue a small overshoot.
   */
  emphasis: "none" | "focal" | "each";
  /**
   * `none` — no camera. `establish` — one push-out at the top. `follow` — the
   * camera pans to each step's focus box, so a stop is still a stop but arriving
   * at it is continuous rather than a cut. Requires `Figure.stage`.
   */
  camera: "none" | "establish" | "follow";
  /**
   * The camera may only ever zoom IN. Zooming out would scale audience text
   * below the 40px floor, which is the one rule no preference may break.
   */
  zoom: number;
}

export function style(
  pacing: Pacing,
  over: Partial<Omit<MotionStyle, "rhythm">> = {},
): MotionStyle {
  return { rhythm: RHYTHMS[pacing], emphasis: "none", camera: "none", zoom: 1.2, ...over };
}

/* ----------------------------------------------------------------- Moves */

/** A fully timed, still-structured tween. The last thing before source text. */
export interface Move {
  sel: string;
  at: number;
  dur: number;
  from: Vars;
  to: Vars;
  ease: string;
  /** Why this move exists. Carried so a plan can be inspected and tested. */
  why: "chrome" | "enter" | "emphasize" | "custom" | "camera";
}

export interface Plan {
  moves: Move[];
  holds: number[];
  /** Where each stop came from. Not emitted; read by tests and by this report. */
  steps: { step: number; start: number; end: number; hold: number }[];
}

/* --------------------------------------------------------------- Planning */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** The offset a `dir` implies, given how far the rhythm says things travel. */
function offset(dir: Dir | undefined, travel: number): Vars {
  switch (dir) {
    case "up":
      return { y: r2(travel) };
    case "down":
      return { y: r2(-travel) };
    case "left":
      return { x: r2(travel) };
    case "right":
      return { x: r2(-travel) };
    case "in":
      return { scale: 0.92, transformOrigin: "center" };
    default:
      return {};
  }
}

/**
 * Plan a figure into moves and stops.
 *
 * `seconds` is the beat's own length. Every emitter today re-derives a step
 * spacing from it with its own hand-rolled clamp — `stack` uses
 * `min(0.8, max(0.4, (seconds - 2.4) / count))`, `pipeline` uses
 * `min(1.4, max(0.55, (seconds - 2.8) / stages))`. Here it is done once, and
 * done better: when the plan overruns, the GAPS compress and the durations do
 * not, because a squeezed gap reads as urgency and a squeezed duration reads as
 * a glitch. Only when the gaps hit their floor does everything scale.
 */
export function planFigure(fig: Figure, seconds: number, s: MotionStyle): Plan {
  const { rhythm } = s;
  const steps = [...new Set(fig.cues.map((c) => c.step))].sort((a, b) => a - b);
  const content = steps.filter((k) => k >= 0);

  // Which step carries the beat's point. `focal` spends time here rather than
  // spreading it evenly, which is the difference between emphasis and speed.
  const heaviest = fig.cues.reduce<Cue | undefined>(
    (best, c) => (c.weight !== undefined && (!best || c.weight > (best.weight ?? 0)) ? c : best),
    undefined,
  );
  const focalStep = s.emphasis === "focal" ? heaviest?.step : undefined;

  const gapAt = (k: number, gap: number) => (k === focalStep ? gap * 1.7 : gap);

  const durOf = (c: Cue) => {
    // A tag is supporting cast and arrives quicker than the thing it labels.
    const base = c.custom?.dur ?? rhythm.dur * (c.role === "tag" ? 0.75 : 1);
    const emphasised =
      (s.emphasis === "focal" && c === heaviest) || (s.emphasis === "each" && c.role === "item");
    return emphasised ? base * (s.emphasis === "focal" ? 1.6 : 1.15) : base;
  };

  /**
   * The stop is "the thing this step is about has landed" — so a caption still
   * fading in 50ms later does not push it. Anchoring stops to tags is how a
   * navigation stop drifts off the frame it was authored for.
   */
  const anchors = (k: number) => {
    const all = fig.cues.filter((c) => c.step === k);
    const led = all.filter((c) => c.role !== "tag");
    return led.length > 0 ? led : all;
  };

  const settleAt = (k: number, settle: number) => settle * (k === focalStep ? 2.6 : 1);

  /**
   * Step starts and stops, in one pass.
   *
   * A step never begins before the previous step's stop. Without that rule a
   * rhythm with a long settle and a short gap schedules the next entrance
   * *behind* the stop it has not reached yet, and the deck lands a navigation
   * stop on a slide with an element half-arrived. The first `staccato` render
   * did exactly that — the tail note was 40% faded in at the stop before it —
   * and no gate would ever have seen it.
   */
  const schedule = (lead: number, gap: number, trail: number, scale: number) => {
    const rows: Plan["steps"] = [];
    let t = lead;
    content.forEach((k, i) => {
      if (i > 0) t = Math.max(t + gapAt(k, gap), rows[i - 1]?.hold ?? 0);
      const end = Math.max(
        ...anchors(k).map((c) => t + (c.after ?? 0) * trail + durOf(c) * scale),
      );
      rows.push({ step: k, start: r2(t), end: r2(end), hold: r2(end + settleAt(k, rhythm.settle * scale)) });
    });
    return rows;
  };

  // Fit. Solve for the gap that lands the last stop inside the beat, floor it,
  // then fall back to a uniform scale if even the floor overruns.
  const room = seconds - 0.15;
  let { lead, gap, trail } = rhythm;
  let scale = 1;
  if (content.length > 0) {
    const measure = (g: number, sc = 1, ld = lead, tr = trail) =>
      schedule(ld, g, tr, sc).at(-1)?.hold ?? 0;
    const spread = content.slice(1).reduce((sum, k) => sum + gapAt(k, 1), 0);
    if (measure(gap) > room) {
      if (spread > 0) gap = Math.max(0.16, gap - (measure(gap) - room) / spread);
      const over = measure(gap);
      if (over > room) {
        scale = room / over;
        lead *= scale;
        gap *= scale;
        trail *= scale;
      }
    } else if (spread > 0) {
      // Room to spare: open the gap toward the rhythm's own ceiling. Never past
      // it — a five-beat stack in a ninety-second slide should look unhurried,
      // not abandoned.
      gap = Math.min(rhythm.gapMax, gap + (room - measure(gap)) / spread);
    }
  }
  const dur = (c: Cue) => durOf(c) * scale;
  const travel = rhythm.travel;
  const rows = schedule(lead, gap, trail, scale);
  const start = new Map(rows.map((r) => [r.step, r.start]));

  /* --- chrome. The prelude is a fixed fraction of the lead, so a fast deck
     does not spend 0.9s on an eyebrow the way a slow one does. --- */
  const moves: Move[] = [];
  for (const c of fig.cues.filter((x) => x.step < 0)) {
    const at = c.role === "eyebrow" ? lead * 0.17 : lead * 0.33;
    moves.push({
      sel: c.sel,
      at: r2(at),
      dur: r2(dur(c) * 1.05),
      from: { opacity: 0, ...offset(c.dir ?? "up", travel * 0.45) },
      to: { opacity: 1, x: 0, y: 0 },
      ease: rhythm.ease,
      why: "chrome",
    });
  }

  /* --- content --- */
  const stepRows = rows;
  for (const k of content) {
    const t0 = start.get(k) ?? 0;
    for (const c of fig.cues.filter((x) => x.step === k)) {
      const at = t0 + (c.after ?? 0) * trail;
      const d = dur(c);
      const emph = s.emphasis === "focal" && c === heaviest;
      if (c.custom) {
        moves.push({
          sel: c.sel,
          at: r2(at),
          dur: r2(d),
          from: c.custom.from,
          to: c.custom.to,
          ease: rhythm.ease,
          why: "custom",
        });
      } else {
        const dist = travel * (emph ? 1.7 : c.role === "tag" ? 0 : 1);
        moves.push({
          sel: c.sel,
          at: r2(at),
          dur: r2(d),
          from: { opacity: 0, ...offset(c.dir ?? (c.role === "tag" ? "none" : "up"), dist) },
          to: { opacity: 1, x: 0, y: 0 },
          ease: emph ? "back.out(1.4)" : rhythm.ease,
          why: emph ? "emphasize" : "enter",
        });
      }
    }
  }

  /* --- camera. Only the planner can compile a camera, because a chain of
     `fromTo`s is only seek-safe if each one states the state the previous one
     left — and no single archetype ever sees the whole chain. --- */
  if (s.camera !== "none" && fig.stage) moves.push(...cameraMoves(fig, s, stepRows, lead));

  const holds = clampHolds(
    stepRows.map((r) => r.hold),
    seconds,
  );
  return { moves: moves.map(round), holds, steps: stepRows };
}

/**
 * The zoom this stage can actually afford. Never below 1: zooming out would
 * scale audience text under the 40px floor, and there is no preference worth
 * breaking that for.
 */
export function zoomCeiling(stage: NonNullable<Figure["stage"]>): number {
  return Math.max(1, Math.min(stage.w / stage.safe.w, stage.h / stage.safe.h));
}

/**
 * Transform the stage so `b` sits as near centred as the safe box allows. Pure
 * arithmetic over numbers the layout solver already produced: no measurement, no
 * reflow, no clock, so the same plan renders the same pixels every time.
 */
function frame(b: Box, stage: NonNullable<Figure["stage"]>, zoom: number) {
  const { w, h, safe } = stage;
  // Floored, not rounded: `r2(1.127)` is 1.13, which is over the ceiling, and a
  // camera one hundredth past its ceiling crops the label it was framing.
  const z = Math.floor(Math.min(Math.max(1, zoom), zoomCeiling(stage)) * 100) / 100;
  const vw = w / z;
  const vh = h / z;
  // The window must sit inside the stage AND contain the safe box. The second
  // range is non-empty exactly because `z` was capped above.
  const axis = (c: number, span: number, v: number, s0: number, sw: number) => {
    const lo = Math.max(v / 2, s0 + sw - v / 2);
    const hi = Math.min(span - v / 2, s0 + v / 2);
    return Math.min(Math.max(c, Math.min(lo, hi)), Math.max(lo, hi));
  };
  const cx = axis(b.x + b.w / 2, w, vw, safe.x, safe.w);
  const cy = axis(b.y + b.h / 2, h, vh, safe.y, safe.h);
  return { scale: z, x: r2(w / 2 - z * cx), y: r2(h / 2 - z * cy), transformOrigin: "0px 0px" };
}

function cameraMoves(fig: Figure, s: MotionStyle, rows: Plan["steps"], lead: number): Move[] {
  const stage = fig.stage as NonNullable<Figure["stage"]>;
  const rest = { scale: 1, x: 0, y: 0, transformOrigin: "0px 0px" };
  // A figure with no room gets no camera, silently and correctly.
  if (zoomCeiling(stage) <= 1.001) return [];
  if (s.camera === "establish") {
    const b: Box = { x: 0, y: 0, w: stage.w, h: stage.h };
    return [
      {
        sel: stage.sel,
        at: 0,
        dur: r2(lead + rows.length * 0.3),
        from: frame(b, stage, s.zoom),
        to: rest,
        ease: "power2.out",
        why: "camera",
      },
    ];
  }
  // follow: one move per step whose cues declare a focus box. Each starts from
  // the framing the previous one ended on, so any seek lands somewhere real.
  const out: Move[] = [];
  let prev: Vars = rest;
  for (const row of rows) {
    const boxes = fig.cues.filter((c) => c.step === row.step && c.focus).map((c) => c.focus as Box);
    if (boxes.length === 0) continue;
    const b = boxes.reduce((a, x) => ({
      x: Math.min(a.x, x.x),
      y: Math.min(a.y, x.y),
      w: Math.max(a.x + a.w, x.x + x.w) - Math.min(a.x, x.x),
      h: Math.max(a.y + a.h, x.y + x.h) - Math.min(a.y, x.y),
    }));
    const to = frame(b, stage, s.zoom);
    if (same(prev, to)) continue;
    // The camera leads its step: the framing is in place as the element lands,
    // so the move is over by the stop and the stop is still a settled frame.
    out.push({
      sel: stage.sel,
      at: r2(Math.max(0, row.start - 0.35)),
      dur: r2(Math.max(0.45, row.end - row.start + 0.35)),
      from: { ...prev },
      to,
      ease: "power2.inOut",
      why: "camera",
    });
    prev = to;
  }
  return out;
}

function same(a: Vars, b: Vars): boolean {
  return ["scale", "x", "y"].every((k) => a[k] === b[k]);
}

function round(m: Move): Move {
  return { ...m, at: r4(m.at), dur: r4(m.dur) };
}

/**
 * The same clamp `holdsWithin` does today, kept identical on purpose: a hold
 * outside its own slide window fails `emitIsland`, and a hold that drifts off
 * its tween lands navigation on a half-built slide.
 */
export function clampHolds(times: number[], seconds: number): number[] {
  const last = r2(Math.max(0, seconds - 0.15));
  return [...new Set(times.map((t) => Math.min(r2(t), last)))].sort((a, b) => a - b);
}

/* -------------------------------------------------------------- Compiling */

function vars(v: Vars): string {
  const body = Object.entries(v)
    .map(([k, x]) => `${k}: ${typeof x === "string" ? `"${x}"` : x}`)
    .join(", ");
  return `{ ${body} }`;
}

/**
 * Moves to the statements `composition.ts` already knows how to write.
 *
 * `fromTo` is not a stylistic choice here: `from()` records its end state when
 * the timeline is built, which is wrong the moment the deck seeks — and seeking
 * is all deck navigation does. Making Move the only thing that can become a
 * statement is how that stops being a convention every emitter must remember.
 */
export function compile(moves: Move[]): string[] {
  return [...moves]
    .sort((a, b) => a.at - b.at || a.sel.localeCompare(b.sel))
    .map(
      (m) =>
        `tl.fromTo("${m.sel}", ${vars(m.from)}, ${vars({ ...m.to, duration: m.dur, ease: m.ease })}, ${m.at});`,
    );
}

/** The whole stage, end to end. This is what `emitScene` would call. */
export function choreograph(
  fig: Figure,
  seconds: number,
  s: MotionStyle,
): { tl: string[]; holds: number[]; plan: Plan } {
  const plan = planFigure(fig, seconds, s);
  return { tl: compile(plan.moves), holds: plan.holds, plan };
}
