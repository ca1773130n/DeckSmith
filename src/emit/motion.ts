/**
 * The v2 motion grammar: how a scene ARRIVES, how it HANDS OFF to the next one,
 * and what MOVES while the narrator is talking about it.
 *
 * v0.8.0 had one of each, measured over 124 HypePaper scenes: 114 opened with
 * the same eyebrow-then-headline fade-up, all 115 seams were one 0.4s
 * `power2.in` dissolve, two eases carried 85% of 1,591 tweens, and once a slide
 * had built, nothing on it moved while the voice explained it. That is the
 * founder's "the animation is always the same", and this module is the answer
 * for `design: "v2"` decks only. `classic` never reaches it, so every v0.8.0
 * byte and golden is unchanged.
 *
 * FOUR RULES EVERYTHING HERE OBEYS, each of them an AGENTS.md invariant:
 *
 * 1. Pure and seeded. Every choice is a function of the storyboard (`fnv1a` of
 *    the source id and the beat id), never of a clock or `Math.random`, so two
 *    builds of one storyboard are byte-identical (invariant 4).
 * 2. `fromTo` only, no callbacks. Every tween is a `Tween`, which cannot be
 *    written without its `from` (invariant 2), and nothing here hangs state off
 *    `onUpdate` (invariant 11). Emphasis and seam tweens carry
 *    `immediateRender: false` so they never paint at build time over an
 *    element's own entrance.
 * 3. Holds, `open` and scene lengths never move. A restyled entrance keeps every
 *    tween's position and duration, so `openSeconds`, `beatSeconds` and the
 *    timing manifest (`holdsFor` in src/render/timing.ts re-emits scenes WITHOUT
 *    this module) all still agree. Emphasis lives strictly inside a hold window
 *    and is back at rest before the window closes, so every frame a gate
 *    captures at a hold is the frame v0.8.0 would have captured there.
 * 4. Nothing is scaled. Emphasis is light (`glow`), so the type floor's declared
 *    sizes are the drawn ones at every hold.
 *
 * INTERFACE, for the other v2 tracks (player, fit, style, layout):
 *
 * - `planMotion(seed, beats)` → which entrance verb each scene uses (a fade),
 *   which seam joins each pair, and the order emphasis kinds are tried in. A
 *   style pack that wants to bias the grammar should filter `SEAMS` before
 *   calling it rather than post-edit its answer, so the no-repeat rules still
 *   hold.
 * - `restyleEntrance(scene, sid, verb)` rewrites an emitted scene's own
 *   entrance tweens. It only rewrites tweens it recognises (`isEntrance`), so an
 *   archetype added later is left alone rather than broken.
 * - `seamOut`/`seamIn` are the handoff tweens for the outgoing and incoming
 *   scene roots; `composition.ts` appends them where it used to append the one
 *   dissolve.
 * - `emphasize(...)` adds the during-narration motion and returns the
 *   `HoldWindow`s the deck player needs (`deck.html`'s
 *   `application/decksmith-motion+json` island, read by src/deck/motion.ts).
 */
import type { Archetype, BeatRole } from "../types.js";
import { ARCHETYPE_FAMILY } from "../types.js";
import { handoffStatement } from "./camera.js";
import { fromTo, type Scene, type Tween, type Vars } from "./kit.js";

/* ------------------------------------------------------------- vocabulary */

/**
 * How a scene's parts arrive: ONE verb, a quiet opacity fade, in place.
 *
 * There were six — rise, slide, snap (a pop from 0.9 with overshoot), focus
 * (out of a blur), wipe and mask (clip-path sweeps) — hashed per scene so no
 * two adjacent scenes arrived alike. The founder's verdict on the result
 * (2026-10-10): "graphic animation by animated UI elements is old-fashioned".
 * Plates, chips, cards and labels sliding, popping or being swept in WERE the
 * motion, and that is the thing he named. So a v2 archetype's parts now simply
 * appear, and what moves is the picture: the backdrop's drift and the camera
 * (src/emit/backdrop.ts, src/emit/camera.ts), the seams between scenes, and
 * things inside a figure that are its content (a probe travelling a curve, a
 * pulse travelling a pipeline). Those are not entrances and are never touched.
 */
export const ENTRANCES = ["fade"] as const;
export type Entrance = (typeof ENTRANCES)[number];

/**
 * How one scene hands off to the next. `dive` is the existing camera move and is
 * never chosen here — a beat that is `inside` the previous one keeps it.
 *
 * | seam     | outgoing root                    | incoming root          |
 * |----------|----------------------------------|------------------------|
 * | dissolve | opacity → 0, power2.in (v0.8.0)  | —                      |
 * | push     | xPercent 0 → −4, opacity → 0     | xPercent 4 → 0         |
 * | lift     | yPercent 0 → −4, opacity → 0     | yPercent 4 → 0         |
 * | wipe     | clip-path closes left to right   | —                      |
 * | zoom     | scale 1 → 1.04, opacity → 0      | scale 0.96 → 1         |
 *
 * 4% is under the scene's own padding at every format (110px of 1920 is 5.7%,
 * 84px of 1080 is 7.8%), so a mid-seam frame never puts content off the canvas
 * for the layout gate's grid samples to find.
 */
export const SEAMS = ["dissolve", "push", "lift", "wipe", "zoom"] as const;
export type Seam = (typeof SEAMS)[number] | "dive";

/**
 * What moves while the narrator talks about a part: light, and only light. A
 * `pulse` (the part scaled up and back) and an `underline` (a rule faded in
 * under it) were the other two, and both are a UI element doing a move — the
 * thing the founder called old-fashioned (2026-10-10). A glow is the part being
 * lit, which is something a picture does.
 */
export const EMPHASES = ["glow"] as const;
export type Emphasis = (typeof EMPHASES)[number];

/** Every ease this module writes. A test pins that nothing else appears. */
export const MOTION_EASES = [
  "power3.out",
  "expo.out",
  "power2.in",
  "power2.inOut",
  "sine.out",
  "sine.inOut",
] as const;

/* -------------------------------------------------------------- the plan */

/**
 * FNV-1a, 32-bit. The seeded choice every v2 decision is made with: stable
 * across platforms and Node versions, which a `Math.random` with a seed is not.
 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** What `planMotion` needs to know about a beat. */
export interface MotionBeat {
  id: string;
  archetype: Archetype;
  role?: BeatRole | undefined;
  inside?: { beat: string } | undefined;
}

export interface MotionPlan {
  /** One per beat, in order. */
  entrances: Entrance[];
  /** One per adjacent pair: `seams[i]` joins beat `i` to beat `i + 1`. */
  seams: Seam[];
  /** Per beat, the order emphasis kinds are tried in (the first that fits wins). */
  emphases: Emphasis[][];
}

/**
 * The deck's motion, decided once for the whole storyboard.
 *
 * ENTRANCES: every beat fades (`ENTRANCES`). Variety between scenes is the
 * seams' and the pictures' job now, not the parts'.
 *
 * SEAMS are chosen by the RELATION between the two beats first, then varied:
 * same family (two quantity beats) → `push`, a lateral continuation; a role
 * boundary (`background` → `limitations`) → `zoom`, a chapter break; into or
 * out of a title → `lift`; any other family change → `wipe`; into the closing
 * beat → `dissolve`. A seam that would repeat the previous one is replaced by a
 * hashed pick from the rest. Then, for a deck of 10+ beats with fewer than three
 * kinds, the earliest replaceable seams are rotated through the missing kinds.
 * `inside` is the camera's and stays `dive`.
 */
export function planMotion(seed: string, beats: readonly MotionBeat[]): MotionPlan {
  const n = beats.length;
  const entrances: Entrance[] = beats.map(() => "fade");

  const seams: Seam[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = beats[i] as MotionBeat;
    const b = beats[i + 1] as MotionBeat;
    if (b.inside?.beat === a.id) {
      seams.push("dive");
      continue;
    }
    let want: Seam;
    if (i + 2 === n) want = "dissolve";
    else if (a.archetype === "title" || b.archetype === "title") want = "lift";
    else if (a.role !== undefined && b.role !== undefined && a.role !== b.role) want = "zoom";
    else if (ARCHETYPE_FAMILY[a.archetype] === ARCHETYPE_FAMILY[b.archetype]) want = "push";
    else {
      // A change of family is the common case (most adjacent pairs), so a single
      // answer for it would make that seam the deck's modal one. Hashed among the
      // three that read as "a new kind of thing" rather than a continuation.
      const turn = ["wipe", "zoom", "dissolve"] as const;
      want = turn[fnv1a(`${seed}|turn|${b.id}|${i}`) % turn.length] as Seam;
    }
    const prev = seams[i - 1];
    if (want === prev) {
      const rest = SEAMS.filter((s) => s !== prev);
      want = rest[fnv1a(`${seed}|seam|${b.id}|${i}`) % rest.length] as Seam;
    }
    seams.push(want);
  }
  if (n >= 10) ensureSeamKinds(seams, 3);

  const emphases = beats.map((): Emphasis[] => [...EMPHASES]);
  return { entrances, seams, emphases };
}

/**
 * Rotate missing seam kinds into the earliest positions where the swap keeps
 * both neighbours different and does not remove the last use of a kind.
 * In place; deterministic because it walks in index order.
 */
export function ensureSeamKinds(seams: Seam[], want: number): void {
  const kinds = () => new Set(seams.filter((s) => s !== "dive"));
  for (const missing of SEAMS) {
    if (kinds().size >= want) return;
    if (kinds().has(missing)) continue;
    for (let i = 0; i < seams.length; i++) {
      const cur = seams[i];
      if (cur === "dive" || cur === undefined) continue;
      if (seams[i - 1] === missing || seams[i + 1] === missing) continue;
      if (seams.filter((s) => s === cur).length < 2) continue;
      seams[i] = missing;
      break;
    }
  }
}

/* ------------------------------------------------------------- entrances */

/** Every transform an entrance may have arrived with; a fade keeps none of them. */
const TRAVEL = ["x", "y", "scale", "scaleX", "scaleY", "svgOrigin", "transformOrigin"] as const;
const ENTRANCE_KEYS = new Set<string>(["opacity", ...TRAVEL]);

/**
 * A tween this module may restyle: an opacity 0 → 1 reveal whose `from` only
 * moves opacity and position/scale. Dims, restores, draw-ons and colour turns
 * are someone else's and stay exactly as emitted.
 *
 * `immediateRender: false` reveals COUNT. They used to be skipped as "someone
 * else's", and they are mostly a panel's lines or a card's words staggering in
 * after their card — the same sliding-in the founder objected to, one level
 * down. A fade only removes keys, so it cannot become a second writer of
 * anything the tween did not already write.
 */
export function isEntrance(t: Tween): boolean {
  if (t.from.opacity !== 0 || t.to.opacity !== 1) return false;
  return Object.keys(t.from).every((k) => ENTRANCE_KEYS.has(k));
}

function without(v: Vars, keys: readonly string[]): Record<string, Vars[string]> {
  const out: Record<string, Vars[string]> = {};
  for (const [k, val] of Object.entries(v)) if (!keys.includes(k)) out[k] = val;
  return out;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);

/**
 * One scene's entrances, re-voiced in `verb`. Positions and durations are
 * untouched (rule 3 at the top), so this cannot move a hold or the voice.
 */
export function restyleEntrance(scene: Scene, sid: string, verb: Entrance): Scene {
  if (scene.ownEntrances) return scene;
  const tl = scene.tl.map((t) => {
    if (!isEntrance(t)) return t;
    const mine = targetsOf(t);
    const others = scene.tl.filter((o) => o !== t && targetsOf(o).some((x) => mine.includes(x)));
    // A part that goes back to 0 later is a TRANSIENT — pipeline's travelling
    // pulse, split-compare's divider highlight — not an arrival. Its motion is
    // its meaning; leave it exactly as drawn.
    if (others.some((o) => o.to.opacity === 0)) return t;
    const chrome = t.target === `#${sid}-e` || t.target === `#${sid}-h`;
    return chrome ? clearOfSeam(revoice(t, verb)) : revoice(t, verb);
  });
  return { ...scene, tl };
}

/**
 * When the incoming chrome may start, in unpaced seconds: once the outgoing
 * scene's handoff (`HANDOFF_SECONDS`, 0.4) has taken it below half opacity,
 * which a `power2.in` fade does at 0.32.
 *
 * WHY. v0.8.0's eyebrow starts at 0.15 on GSAP's default `power1.out`, which is
 * still under 0.5 opacity by the time the old scene fades past half. v2's eases
 * are faster off the mark — `expo.out` is at 0.75 a fifth of the way in — so an
 * eyebrow starting at 0.15 is legible over the outgoing headline, the collision
 * `HANDOFF_SECONDS` warns about. So the chrome's START moves to here and its END
 * stays where it was: `openSeconds` reads only the ends, so the voice starts at
 * the same instant. `test/motion.test.ts` checks every verb against every seam.
 */
export const SEAM_CLEAR = 0.3;

function clearOfSeam(t: Tween): Tween {
  const end = t.at + num(t.to.duration, 0.5);
  if (t.at >= SEAM_CLEAR || end - SEAM_CLEAR < 0.25) return t;
  return { ...t, at: SEAM_CLEAR, to: { ...t.to, duration: r3(end - SEAM_CLEAR) } };
}

/** Each verb's ease — also what a part that cannot take the verb's path still gets. */
const VERB_EASE: Readonly<Record<Entrance, string>> = {
  fade: "sine.out",
};

/**
 * One entrance tween in `verb`: the same opacity reveal at the same time and
 * length, with no travel, no scale and no overshoot.
 */
function revoice(t: Tween, verb: Entrance): Tween {
  return {
    ...t,
    from: without(t.from, TRAVEL),
    to: { ...without(t.to, [...TRAVEL, "ease"]), ease: VERB_EASE[verb] },
  };
}

/* ------------------------------------------------------------------ seams */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The OUTGOING half of a seam: tweens on `#sid` starting where its slide ends
 * (`at`) and running `over` seconds into the next scene's window, exactly where
 * the v0.8.0 dissolve ran. `dissolve` is byte-for-byte `handoffStatement`'s
 * tween, so a v2 deck whose plan says dissolve hands off as v0.8.0 did.
 */
export function seamOut(
  kind: Exclude<Seam, "dive">,
  sid: string,
  at: number,
  over: number,
): Tween[] {
  const d = r3(over);
  const t0 = r3(at);
  const root = `#${sid}`;
  const done = { duration: d, ease: "power2.in", immediateRender: false };
  switch (kind) {
    case "dissolve":
      // THE v0.8.0 tween, by calling the function that wrote it, not a copy of it.
      return [handoffStatement(sid, at, over)];
    case "push":
      return [fromTo(root, { opacity: 1, xPercent: 0 }, { opacity: 0, xPercent: -4, ...done }, t0)];
    case "lift":
      return [fromTo(root, { opacity: 1, yPercent: 0 }, { opacity: 0, yPercent: -4, ...done }, t0)];
    case "zoom":
      return [fromTo(root, { opacity: 1, scale: 1 }, { opacity: 0, scale: 1.04, ...done }, t0)];
    case "wipe":
      return [
        fromTo(
          root,
          { clipPath: "inset(0% 0% 0% 0%)" },
          {
            clipPath: "inset(0% 0% 0% 100%)",
            duration: d,
            ease: "power2.inOut",
            immediateRender: false,
          },
          t0,
        ),
      ];
  }
}

/**
 * The INCOMING half, on the next scene's own timeline from its 0. Settles by
 * `firstHold - 0.05`, so the frame at the first stop is the frame v0.8.0 drew
 * there; a scene that holds sooner than `over` gets no incoming move at all.
 */
export function seamIn(kind: Seam, sid: string, over: number, firstHold: number): Tween[] {
  const d = r3(Math.min(0.9, firstHold - 0.05));
  if (d < over) return [];
  const root = `#${sid}`;
  switch (kind) {
    case "push":
      return [fromTo(root, { xPercent: 4 }, { xPercent: 0, duration: d, ease: "expo.out" }, 0)];
    case "lift":
      return [fromTo(root, { yPercent: 4 }, { yPercent: 0, duration: d, ease: "power3.out" }, 0)];
    case "zoom":
      return [fromTo(root, { scale: 0.96 }, { scale: 1, duration: d, ease: "expo.out" }, 0)];
    default:
      return [];
  }
}

/* ---------------------------------------------------------------- emphasis */

/** A narrated stop's quiet stretch, scene-relative. See `emphasize`. */
export interface HoldWindow {
  /** Stop index within the scene (the narration segment's `stop`). */
  stop: number;
  /** The hold itself: where the deck lands for this stop. */
  at: number;
  /** Where this stop's sentence starts on the scene's clock (may be < `at`). */
  from: number;
  /** The first moment after `at` that belongs to the next stop's reveal, or the scene's end. */
  to: number;
}

/** What `emphasize` needs to know about a narration segment. */
export interface SpokenSegment {
  stop: number;
  seconds: number;
  cues: readonly { start: number }[];
}

/** Rise, hold, settle: the shape of one emphasis. Total `EMPH_TOTAL` seconds. */
const EMPH_UP = 0.35;
const EMPH_HOLD = 0.7;
const EMPH_DOWN = 0.45;
export const EMPH_TOTAL = EMPH_UP + EMPH_HOLD + EMPH_DOWN;
/** Shortest window the deck player is told about. Below this there is nothing to see. */
const MIN_WINDOW = 0.5;
/** A part is emphasised only once its own entrance has had this long to settle. */
const SETTLED = 0.2;

/** The selectors a (possibly comma-listed) tween target names. */
function targetsOf(t: Tween): string[] {
  return t.target.split(",").map((s) => s.trim());
}

function durationOf(t: Tween): number {
  return num(t.to.duration, 0.5);
}

/** `#rrggbb` → `rgba(r, g, b, a)`, or undefined for anything else. */
export function rgba(hex: string, a: number): string | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1] as string, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * The part a stop is ABOUT: of the entrances that land in this stop
 * (`(previous hold, this hold]`), the id-targeted one with the longest
 * entrance — the stage, not the arrow before it; the figure, not its caption.
 * A word-split headline (`#sid-t .w`) stands for its container. Chrome is never
 * the subject. Parts that end the stop invisible (a transient highlight) are
 * not either.
 */
function subjectOf(scene: Scene, sid: string, lo: number, hi: number): string | undefined {
  let best: { target: string; d: number; at: number } | undefined;
  for (const t of scene.tl) {
    if (!(t.from.opacity === 0 && t.to.opacity === 1) || t.to.immediateRender === false) continue;
    const end = t.at + durationOf(t);
    if (end <= lo + 1e-3 || end > hi + 1e-3) continue;
    let target = t.target.trim();
    const words = /^(#[\w-]+)\s+\.w$/.exec(target);
    if (words) target = words[1] as string;
    if (!/^#[\w-]+$/.test(target)) continue;
    if (target === `#${sid}-e` || target === `#${sid}-h`) continue;
    const d = durationOf(t) + num(t.to.stagger) * 4;
    if (!best || d > best.d || (d === best.d && t.at < best.at)) best = { target, d, at: t.at };
  }
  return best?.target;
}

/**
 * Whether `prop` on `target` is free and at rest over `[t0, t1]`: no other
 * tween writing it overlaps that span, and the last one to write it before
 * `t0` left it at `rest`. That is `overlapping_gsap_tweens` and "a later tween's
 * `from` equals the earlier tween's `to`" (kit.ts `Spotlight`) checked before
 * emitting rather than by lint after.
 */
function free(
  tl: readonly Tween[],
  target: string,
  prop: string,
  rest: unknown,
  t0: number,
  t1: number,
): boolean {
  let last: { end: number; value: unknown } | undefined;
  for (const t of tl) {
    if (!targetsOf(t).includes(target) || !(prop in t.to)) continue;
    const end = t.at + durationOf(t);
    if (t.at < t1 && end > t0) return false;
    if (end <= t0 && (!last || end >= last.end)) last = { end, value: t.to[prop] };
  }
  return last === undefined || last.value === rest;
}

/** The tween-level shape of one emphasis on `target` at `t`, or undefined if it does not fit. */
function emphasisTweens(
  kind: Emphasis,
  tl: readonly Tween[],
  target: string,
  t: number,
  accent: string,
): { tl: Tween[]; css?: string } | undefined {
  const t1 = t + EMPH_TOTAL;
  const down = r3(t + EMPH_UP + EMPH_HOLD);
  const at = r3(t);
  const quiet = { immediateRender: false };
  switch (kind) {
    case "glow": {
      const off = rgba(accent, 0);
      const on = rgba(accent, 0.85);
      if (!off || !on) return undefined;
      if (!free(tl, target, "filter", undefined, t, t1)) return undefined;
      const shadow = (px: number, c: string) => `drop-shadow(0px 0px ${px}px ${c})`;
      return {
        tl: [
          fromTo(
            target,
            { filter: shadow(0, off) },
            { filter: shadow(18, on), duration: EMPH_UP, ease: "sine.out", ...quiet },
            at,
          ),
          fromTo(
            target,
            { filter: shadow(18, on) },
            { filter: shadow(0, off), duration: EMPH_DOWN, ease: "sine.inOut", ...quiet },
            down,
          ),
        ],
      };
    }
  }
}

/**
 * Motion DURING the narration hold, timed to what is being said.
 *
 * There is no word timing, so the clock is the narration's own cue boundaries:
 * each segment speaks about its stop's subject (`subjectOf`), and the subject is
 * emphasised at the first cue boundary — the sentence's start counts — at which
 * it is on screen and settled, inside a stretch where nothing else is arriving.
 *
 * THE STRETCHES. After stop `k`'s hold the scene is quiet until the first tween
 * that starts later (the next stop's reveal); after the LAST hold it is quiet to
 * the scene's end, which is where most narration lands because the reveals play
 * under the voice (`speechPlan`). An emphasis for stop `k` may use any stretch
 * from `k` on — in the video every part is still there — and must be back at
 * rest before the stretch closes, so every hold frame is untouched (rule 3).
 *
 * `windows` is the deck player's half. A presented deck holds still at each stop
 * while its audio plays; `src/deck/motion.ts` seeks the scene through the
 * stop's own stretch on the audio's clock, `from + audio.currentTime`, so the
 * same emphasis lands on the same word there. Only a stop's OWN stretch is
 * offered, because seeking into a later one would show the next reveal early.
 */
export function emphasize(
  scene: Scene,
  sid: string,
  opts: {
    segments: readonly SpokenSegment[];
    /** `speechPlan(open, holds, segments).starts` — where each segment starts. */
    starts: readonly number[];
    /** The scene's slide length (before any handoff or camera tail). */
    end: number;
    /** Per-scene try order, from `planMotion`. */
    kinds: readonly Emphasis[];
    accent: string;
  },
): { scene: Scene; windows: HoldWindow[] } {
  const holds = [...new Set(scene.holds.filter((h) => Number.isFinite(h) && h >= 0))].sort(
    (a, b) => a - b,
  );
  if (holds.length === 0 || opts.segments.length === 0) return { scene, windows: [] };
  const stretch = holds.map((h, k) => {
    if (k === holds.length - 1) return { lo: h, hi: opts.end };
    let hi = holds[k + 1] as number;
    for (const t of scene.tl) if (t.at > h + 1e-3 && t.at < hi) hi = t.at;
    return { lo: h, hi };
  });

  let tl = [...scene.tl];
  const css: string[] = [];
  let turn = 0;
  for (const [j, seg] of opts.segments.entries()) {
    const k = Math.min(seg.stop, holds.length - 1);
    const s = opts.starts[j] ?? 0;
    const subject = subjectOf(
      scene,
      sid,
      k === 0 ? -1 : (holds[k - 1] as number),
      holds[k] as number,
    );
    if (!subject) continue;
    const boundaries = [0, ...seg.cues.map((c) => c.start)].map((c) => s + c);
    let placed = false;
    for (const b of [...new Set(boundaries)].sort((x, y) => x - y)) {
      if (placed || b >= s + seg.seconds - 0.3) break;
      if (b < (holds[k] as number) + SETTLED) continue;
      const room = stretch.slice(k).find((w) => b >= w.lo && b + EMPH_TOTAL <= w.hi - 0.05);
      if (!room) continue;
      for (let q = 0; q < opts.kinds.length && !placed; q++) {
        const kind = opts.kinds[(turn + q) % opts.kinds.length] as Emphasis;
        const got = emphasisTweens(kind, tl, subject, b, opts.accent);
        if (!got) continue;
        tl = [...tl, ...got.tl];
        if (got.css) css.push(got.css);
        placed = true;
        turn++;
      }
    }
  }

  const windows: HoldWindow[] = [];
  for (const [j, seg] of opts.segments.entries()) {
    const k = Math.min(seg.stop, holds.length - 1);
    const w = stretch[k] as { lo: number; hi: number };
    if (w.hi - w.lo < MIN_WINDOW) continue;
    // A sentence that starts after its stop's stretch has closed would only
    // jump the deck to the stretch's end on arrival — nothing to watch, so the
    // stop holds still as it always did.
    if ((opts.starts[j] ?? 0) >= w.hi - MIN_WINDOW) continue;
    if (windows.some((x) => x.stop === k)) continue;
    windows.push({ stop: k, at: r3(w.lo), from: r3(opts.starts[j] ?? 0), to: r3(w.hi) });
  }
  const added = css.length ? { css: [scene.css ?? "", ...css].filter(Boolean).join("\n") } : {};
  return { scene: { ...scene, tl, ...added }, windows };
}
