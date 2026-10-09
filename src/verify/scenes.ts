/**
 * Three gates on a scene's MOTION, which no other gate here looks at, run in
 * the renderer's own browser at the narration's cue boundaries.
 *
 *  1. `static_hold` — the picture must change during every narration cue. A
 *     v2 archetype finishes building in about five seconds and then holds still
 *     for fifteen to twenty seconds of speech (spike, 2026-10-07: 0 px changed
 *     between cue ends on two of four beats). A bespoke scene exists to keep
 *     explaining while the voice does, so for one this is an error.
 *  2. `graphic_crosses_text` (with `text_overlap`, `bespoke_type_floor`,
 *     `off_canvas`) — a drawn stroke must not run through a label, and a filled
 *     shape painted later must not cover one. The spike's worst defect was a
 *     giant stray arc across a whole diagram that every gate passed, including a
 *     text-on-text overlap check; strokes were simply not text. Strokes are
 *     sampled along their geometry and their dash pattern, so a line drawn by
 *     DrawSVG is checked only where it is visible at that instant.
 *     Round 2 adds what round 1's frames showed a person and no gate: the
 *     settled drawing must span `STAGE_FILL` of its box (`stage_fill`) and carry
 *     one label of `KEY_TYPE_PX` or more (`type_hierarchy`); an arrowhead must
 *     not show where its line is not drawn (`stray_marker`); and a group the
 *     scene tags `data-cue="N"` must not show before cue N starts
 *     (`early_reveal`, with `cue_groups` failing a scene that tags nothing).
 *  3. `seek_order` — the frame at time t must not depend on which times were
 *     seeked before it. Capture shards a render across workers and the deck
 *     player jumps around, so a frame that depends on history is a frame that
 *     differs between two renders of one input. Ascending, descending (after
 *     jumping past the scene), a fixed scramble, and a cold page are compared.
 *     This is what found v2's equation-walk bug: a `fromTo` authored with
 *     `immediateRender` set its from-state at BUILD time, so a cold seek showed
 *     a swollen term that a warm seek did not.
 *
 * The graders are pure and take what the browser measured, so each is tested
 * without one; `probeScenes` is the one place a browser is opened.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ART_BAND } from "../bespoke/shots.js";
import type { DeckPage } from "../render/capture.js";
import type { Timing } from "../render/timing.js";
import type { Finding } from "../types.js";
import { decodePng, type Frame } from "./fidelity.js";

/** A pixel counts as changed when its RGB moved by more than this, summed. Same as the spike's. */
export const PIXEL_DELTA = 24;
/**
 * Fewer changed pixels than this between two seeks of one instant is rasterising,
 * not state. MEASURED: a never-seeked page against a warm one differs by up to
 * 644px on a scene that looks identical — antialiasing along the headline's
 * glyphs, which the shell's own entrance had moved — and a KaTeX glyph by 529px.
 * The leaks this gate exists for are an order of magnitude past it: 13,958 and
 * 22,037px for the equation-walk bug, a dimmed label in the test at several
 * thousand.
 */
export const SEEK_TOLERANCE_PX = 1500;
/** Bump whenever a gate's verdict can change: cached rejections from another version are retried. */
export const GATES_VERSION = "gates-5";
/**
 * A cue whose picture changes by less than this share of the frame held still:
 * about 310 px at 1080p. A frame that does not move renders to the same bytes,
 * so the floor only has to clear antialiasing; a 14px dot crossing a wire
 * changes ~1,200 px and passes, which is right — that dot IS the explanation.
 * Whether the motion is worth watching is the critique round's question and a
 * person's, not a pixel count's.
 */
export const MIN_CHANGE = 0.00015;
/** Cues shorter than this are exempt from `static_hold`: there is no room to show anything. */
export const MIN_CUE_SECONDS = 1.2;
/** Below this the text is not text the audience can read (AGENTS.md invariant 5). */
export const TYPE_FLOOR_PX = 39.5;

/** One narration cue on a scene's own clock. */
export interface SceneCue {
  t0: number;
  t1: number;
  text: string;
}

/** A scene to probe, with the cues spoken over it. */
export interface SceneWindow {
  sid: string;
  beatId?: string;
  /** Absolute composition seconds. */
  start: number;
  duration: number;
  cues: SceneCue[];
}

/* -------------------------------------------------------------------- graders */

export interface CueChange {
  sid: string;
  cue: number;
  t0: number;
  t1: number;
  changed: number;
  total: number;
}

export function gradeStillCues(rows: readonly CueChange[], min = MIN_CHANGE): Finding[] {
  return rows
    .filter((r) => r.t1 - r.t0 >= MIN_CUE_SECONDS && r.changed / r.total < min)
    .map((r) => ({
      severity: "error" as const,
      gate: "motion",
      rule: "static_hold",
      message: `#${r.sid} cue ${r.cue + 1} (${r.t0.toFixed(2)}–${r.t1.toFixed(2)}s): the picture changed by ${((100 * r.changed) / r.total).toFixed(3)}% while the narration spoke — under ${(100 * min).toFixed(1)}%, so the scene holds still over its own sentence.`,
    }));
}

/**
 * The settled frame's drawing must span this share of the body box (the
 * bounding box of everything drawn, over the box's area). Round 1's scenes sat
 * at 55-70%: a diagram in the top-left two thirds with the right third or the
 * bottom band empty, at a size the founder called small.
 */
export const STAGE_FILL = 0.8;
/** The settled frame's largest label, px at 1080p: one thing on the stage is read first. */
export const KEY_TYPE_PX = 64;
/** A cue group may appear this long before its cue starts (the prompt's own sync window). */
export const EARLY_SLACK = 0.5;
/**
 * At the settled frame, at most this share of a scene's parts may be ones it
 * showed lit (>= `LIT`) earlier and has left dimmed (< `DIM`). Round 2 kept
 * three scenes that ended on a frame of ghosts; the founder's rule is that the
 * last cue ends with the whole scene lit. A part that was never lit — a halo, a
 * translucent cone — is not counted: it is drawn that way, not dimmed.
 */
export const END_DIMMED = 0.1;
export const LIT = 0.85;
export const DIM = 0.6;

/** A label as the repair pass sees it: its address, the unit a nudge moves, its box in body px. */
export interface GeoLabel {
  /** `tag:index` among the body's elements, in document order. */
  a: string;
  /** The unit a nudge would wrap (the text, or its plate group); null when it cannot move. */
  u: string | null;
  /** Document order (paint order). */
  o: number;
  /** x, y, w, h in body px. */
  b: [number, number, number, number];
  /** Screen px per unit of the unit's parent (a camera zoom makes it > 1). */
  s: number;
  fs: number;
  /** One of the shell's subject labels (round 5): never moved, kept `BAND_GAP` clear of. */
  c?: 1;
}

/** What one frame of a bespoke scene looks like to the repair pass. */
export interface Geo {
  w: number;
  h: number;
  /** The shell camera's scale at this frame (1 when it has none). */
  cs?: number;
  labels: GeoLabel[];
  /** Filled shapes and pictures: address, owning label unit, paint order, box. */
  boxes: Array<{ a: string; u: string | null; o: number; b: [number, number, number, number] }>;
  /** Visible stroke samples, body px, with the label unit they belong to. */
  points: Array<[number, number, string | null]>;
  /** Each visible part's opacity and what dims it (`tag:index`, `#id` appended when it has one). */
  parts: Array<{ a: string; al: number; dim: string[] }>;
}

/** What the page measured at one frame of one scene. */
export interface Layout {
  sid: string;
  key: string;
  t: number;
  crossings: string[];
  occlusions: string[];
  overlaps: string[];
  small: string[];
  off: string[];
  /** Markers painted where their line is not (an arrowhead on an undrawn path). */
  strays?: string[];
  /** Bounding box of what is drawn in the body box, over the box's area. Bespoke scenes only. */
  fill?: number;
  /** Share of a 6x4 grid over the body box that something is drawn in. Reported, not graded. */
  cells?: number;
  /** The largest visible label in the body box, px. */
  maxType?: number;
  /** Share of the body box the settled drawing paints (`paintedShare`). Reported; the rubric probe reads it. */
  mass?: number;
  /** Share of the drawn labels and shapes in the body box at under 0.6 opacity. */
  dimmed?: number;
  /** Distinct `data-cue` numbers the scene's groups declare. */
  groups?: number[];
  /** The cue groups showing at this instant. */
  revealed?: Array<{ id: string; cue: number }>;
  /** Scene seconds each cue starts at, so `early_reveal` can be graded off this row alone. */
  cueStarts?: number[];
  /** Where the camera is when it is not home (bespoke scenes). Graded at the end only. */
  camOff?: string;
  /** Repair geometry, when the probe asked for it. */
  geo?: Geo;
  /** End row: the share of parts lit earlier and left dimmed (`END_DIMMED`). */
  litDimmed?: number;
  /** End row: the elements dimming those parts, as `tag:index[#id]`. */
  relight?: string[];
  /** The shell's camera at this instant: scale, x, y, and the box's width and height. */
  shot?: [number, number, number, number, number];
  /** How many subjects the scene's illustration has (0 or absent: not an illustrated scene). */
  subjects?: number;
  /** Each visible label that names a subject: its gap to that subject (box px) and how much of it another subject covers. */
  anchors?: Array<{ id: string; k: number; d: number; o: number }>;
  /** Labels with digits in them sitting on the illustration. */
  onPicture?: number;
  /** The smallest of the shell's subject labels as rendered at this instant, px (`label_size`). */
  labelPx?: number;
  /** The shell's labels inside the caption band, or crowding the scene's own words (`label_band`). */
  bandHits?: string[];
}

/**
 * A label that names a subject sits within this many box px of that
 * subject's box (0 = on it). A leader line may bridge the gap; a row of plates
 * along the top of the box, round 3's habit, is 150-400px away.
 */
export const ANCHOR_PX = 96;
/** A label may cover at most this share of itself with ANOTHER subject's box. */
export const ANCHOR_OVERLAP = 0.25;
/**
 * The smallest a subject's label may RENDER, px at 1080p, at any graded frame
 * (the shell sets them at 52-64px and holds them against the camera's zoom).
 */
export const LABEL_RENDERED_MIN = 51.5;
/** This many numbers on the picture is a table or a chart painted over it (ja s12, round 3: nine). */
export const NUMBERS_ON_PICTURE = 5;
/** A shot at this scale or closer is a push-in; under `WIDE` it is the whole picture. */
export const CLOSE = 1.5;
export const WIDE = 1.1;
/** Two close shots whose centres are nearer than this share of the box are the same shot. */
const SAME_SHOT = 0.12;
/** The camera is sampled this often (scene seconds) for `shot_variety`: no screenshot, a seek and a read. */
export const CAM_STEP = 0.5;

/** The shell's camera at one instant of one scene (`probeScenes` samples it every `CAM_STEP`). */
export interface CamSample {
  sid: string;
  t: number;
  /** scale, x, y, and the box's width and height. */
  shot: [number, number, number, number, number];
  /** How many subjects the scene's illustration has. */
  subjects: number;
  /** The camera grammar the shell stamped on the scene (src/bespoke/grammar.ts). */
  grammar?: string;
  /** The backdrop's scale, x, y (round 5's second layer), when it has one. */
  plate?: [number, number, number];
  /** How much of the box's width a wiped-on picture shows, 0..1, when it is wiped. */
  wipe?: number;
}

/** Where a shot points: the point at the centre of the view, as shares of the box. */
function aim([s, x, y, w, h]: CamSample["shot"]): [number, number] {
  return [(w / 2 - x) / s / w, (h / 2 - y) / s / h];
}

/**
 * The distinct shots a scene's camera HOLDS: a push-in counts when two
 * consecutive samples (one `CAM_STEP` apart) are both at `CLOSE` or closer and
 * aimed within `SAME_SHOT` of each other — a camera passing through on its way
 * somewhere is not a shot. Push-ins aimed within `SAME_SHOT` of one already
 * counted are the same shot.
 */
export function shotsOf(samples: readonly CamSample[]): {
  wide: boolean;
  close: Array<[number, number]>;
} {
  let wide = false;
  const close: Array<[number, number]> = [];
  const list = [...samples].sort((a, b) => a.t - b.t);
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as CamSample;
    if (c.shot[0] < WIDE) wide = true;
    const n = list[i + 1];
    if (!n || c.shot[0] < CLOSE || n.shot[0] < CLOSE || !c.shot[3] || !c.shot[4]) continue;
    const a = aim(c.shot);
    const b = aim(n.shot);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= SAME_SHOT / 2) continue;
    // Where the hold settles: the later of the pair. The earlier can be the
    // tail of the push still zooming, whose aim drifts as the scale grows
    // (a push held to the box's edge read 0.32 for a shot that holds at 0.27).
    if (!close.some(([x, y]) => Math.hypot(x - b[0], y - b[1]) < SAME_SHOT))
      close.push([Math.round(b[0] * 100) / 100, Math.round(b[1] * 100) / 100]);
  }
  return { wide, close };
}

/**
 * Whether the camera did what its grammar says (src/bespoke/grammar.ts), read
 * off the samples alone — so a shell that compiled every grammar to round 4's
 * tour would fail here, not pass on the stamp.
 */
export function grammarBroken(grammar: string, list: readonly CamSample[], t0 = 0): string[] {
  const out: string[] = [];
  const aimOf = (r: CamSample) => aim(r.shot);
  const dist = (a: CamSample, b: CamSample) => {
    const p = aimOf(a);
    const q = aimOf(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  };
  const pairs = list.slice(1).map((r, i) => [list[i] as CamSample, r] as const);
  if (grammar === "follow") {
    // A TRACK: three or more samples in a row, close, the aim travelling at one scale.
    let run = 0;
    let best = 0;
    for (const [a, b] of pairs) {
      const moving =
        a.shot[0] >= CLOSE - 0.1 &&
        b.shot[0] >= CLOSE - 0.1 &&
        Math.abs(a.shot[0] - b.shot[0]) < 0.08 &&
        dist(a, b) >= 0.02;
      run = moving ? run + 1 : 0;
      best = Math.max(best, run);
    }
    // Four moving pairs in a row is 2s of travel: a push's 1.1s move spans three at most.
    if (best < 4)
      out.push("a follow never tracks: no stretch where the camera travels at one close scale");
  }
  if (grammar === "rack") {
    // A RETURN: a close shot held again after the camera held another.
    const held = shotsHeld(list);
    const back = held.some((h, i) =>
      held.slice(0, Math.max(0, i - 1)).some((e) => Math.hypot(e[0] - h[0], e[1] - h[1]) < 0.06),
    );
    // Or the two-shot: both subjects held together at a medium scale, after both alone.
    const lastClose = list.reduce((k, r, i) => (r.shot[0] >= CLOSE ? i : k), -1);
    // Or the two-shot: both subjects HELD together at a medium scale (three samples,
    // a second, steady), after both alone — not a reveal passing through it.
    const two =
      held.length >= 2 &&
      list.slice(lastClose + 1).some((r, i, a) => {
        const run = [r, a[i + 1], a[i + 2]];
        return run.every(
          (x) =>
            x !== undefined &&
            x.shot[0] >= 1.1 &&
            x.shot[0] < CLOSE &&
            Math.abs(x.shot[0] - r.shot[0]) < 0.05,
        );
      });
    if (!back && !two)
      out.push(
        "a rack never comes back: no subject is held again after the camera held another, and no two-shot holds both",
      );
  }
  if (grammar === "cutaway") {
    const cut = pairs.some(([a, b]) => a.shot[0] < WIDE && b.shot[0] >= CLOSE);
    if (!cut)
      out.push(
        "a cutaway never cuts: the camera never jumps from the whole picture to a close shot between two samples",
      );
  }
  if (grammar === "zoom-out") {
    const rise = pairs.find(([a, b]) => b.shot[0] > a.shot[0] + 0.05);
    if (rise)
      out.push(
        `a zoom-out only pulls back, but the camera pushes in at ${rise[1].t.toFixed(2)}s (${rise[0].shot[0]} → ${rise[1].shot[0]})`,
      );
  }
  if (grammar === "wipe") {
    const shown = list.filter((r) => r.wipe !== undefined);
    const start = shown.find((r) => r.t >= t0);
    const end = shown[shown.length - 1];
    if (!start || !end || (start.wipe ?? 1) > 0.7 || (end.wipe ?? 0) < 0.99)
      out.push(
        `a wipe never wipes: the picture shows ${Math.round(100 * (start?.wipe ?? 1))}% at the start and ${Math.round(100 * (end?.wipe ?? 0))}% at the end`,
      );
    const close = list.find((r) => r.shot[0] >= CLOSE);
    if (close)
      out.push(
        `a wipe keeps the camera wide, but it is at ${close.shot[0]} at ${close.t.toFixed(2)}s`,
      );
  }
  if (grammar === "parallax") {
    // A truck, not a push: never a close shot.
    const close = list.find((r) => r.shot[0] >= CLOSE);
    if (close)
      out.push(
        `a parallax truck stays at a medium scale, but the camera is at ${close.shot[0]} at ${close.t.toFixed(2)}s`,
      );
    const mid = list.filter((r) => r.shot[0] >= WIDE && r.shot[0] < CLOSE);
    const xs = mid.map((r) => aimOf(r)[0]);
    const travel = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    if (travel < 0.12)
      out.push(
        `a parallax truck travels ${Math.round(100 * travel)}% of the box at a medium scale; at least 12% wanted`,
      );
  }
  // THE DEPTH: wherever there is a backdrop, it moves less than the subjects.
  const deep = list.filter((r) => r.plate && r.shot[0] > 1.05);
  const flat = deep.find((r) => (r.plate as [number, number, number])[0] >= r.shot[0] - 0.01);
  if (flat)
    out.push(
      `the backdrop zooms with the subjects (${(flat.plate as [number, number, number])[0]} against ${flat.shot[0]} at ${flat.t.toFixed(2)}s): no parallax`,
    );
  return out;
}

/** The close shots a camera holds, in order (consecutive samples at `CLOSE` aimed alike), repeats kept. */
function shotsHeld(list: readonly CamSample[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const c = list[i] as CamSample;
    const n = list[i + 1] as CamSample;
    if (c.shot[0] < CLOSE || n.shot[0] < CLOSE) continue;
    const a = aim(c.shot);
    const b = aim(n.shot);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= SAME_SHOT / 2) continue;
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - b[0], last[1] - b[1]) >= SAME_SHOT) out.push(b);
  }
  return out;
}

/**
 * `shot_variety`: an illustrated scene is staged — it OPENS on the whole
 * picture (every sample in the first second of its first cue is wide), and the
 * camera HOLDS push-ins on at least `min(2, subjects)` different subjects
 * (`shotsOf`); that it comes back is `camera_end`'s. `opens` is each scene's
 * first cue start.
 */
export function gradeShots(
  samples: readonly CamSample[],
  opens: ReadonlyMap<string, number> = new Map(),
): Finding[] {
  const out: Finding[] = [];
  const bySid = new Map<string, CamSample[]>();
  for (const r of samples) bySid.set(r.sid, [...(bySid.get(r.sid) ?? []), r]);
  for (const [sid, all] of bySid) {
    const list = [...all].sort((a, b) => a.t - b.t);
    const n = Math.max(0, ...list.map((r) => r.subjects));
    if (n === 0) continue;
    const grammar = list.find((r) => r.grammar)?.grammar ?? "tour";
    const { close } = shotsOf(list);
    const want = Math.min(2, n);
    const t0 = opens.get(sid) ?? 0;
    const first = list.filter((r) => r.t >= t0 && r.t <= t0 + 1);
    const say: string[] = [];
    // How it OPENS: on the whole picture, except a zoom-out, which opens close.
    if (grammar === "zoom-out") {
      const wide = first.find((r) => r.shot[0] < CLOSE);
      if (wide)
        say.push(
          `a zoom-out opens close on its detail, but the camera is at scale ${wide.shot[0]} at ${wide.t.toFixed(2)}s`,
        );
    } else {
      const early = first.find((r) => r.shot[0] >= WIDE);
      if (early)
        say.push(
          `it opens pushed in (scale ${early.shot[0]} at ${early.t.toFixed(2)}s), not on the whole picture`,
        );
    }
    // What it HOLDS: push-ins on the subjects, for the grammars that push in.
    if (["tour", "follow", "rack", "cutaway"].includes(grammar) && close.length < want)
      say.push(
        `the camera holds ${close.length} distinct push-in(s) at ${CLOSE}x or closer where ${want} are wanted — it pans or idles instead of staging shots`,
      );
    say.push(...grammarBroken(grammar, list, t0));
    if (say.length)
      out.push({
        severity: "error",
        gate: "motion",
        rule: "shot_variety",
        message: `#${sid}: ${say.join("; ")}.`,
      });
  }
  return out;
}

export function gradeLayout(rows: readonly Layout[]): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, r: Layout, what: string[], say: string) => {
    if (what.length === 0) return;
    out.push({
      severity: "error",
      gate: "layout",
      rule,
      message: `#${r.sid} at ${r.key} (${r.t.toFixed(2)}s): ${say} ${what.slice(0, 4).join("; ")}${what.length > 4 ? ` (+${what.length - 4})` : ""}`,
    });
  };
  for (const r of rows) {
    add("graphic_crosses_text", r, r.crossings, "a stroke runs through text —");
    add("graphic_crosses_text", r, r.occlusions, "a shape painted over text —");
    add("text_overlap", r, r.overlaps, "text prints over text —");
    add("bespoke_type_floor", r, r.small, "text under 40px —");
    add("off_canvas", r, r.off, "drawn outside the frame —");
    add("stray_marker", r, r.strays ?? [], "a marker without its line —");
    const starts = r.cueStarts ?? [];
    const early = (r.revealed ?? []).filter((g) => {
      const t0 = starts[g.cue - 1];
      return t0 !== undefined && r.t < t0 - EARLY_SLACK;
    });
    add(
      "early_reveal",
      r,
      early.map((g) => `${g.id} (cue ${g.cue}, which starts at ${starts[g.cue - 1]?.toFixed(2)}s)`),
      "shown before the cue that introduces it —",
    );
    // Labels ON their subjects (round 4): near the subject they name, not over another.
    const anchors = r.anchors ?? [];
    add(
      "label_anchor",
      r,
      anchors
        .filter((a) => a.d > ANCHOR_PX)
        .map((a) => `${a.id} is ${a.d}px from subject ${a.k} (at most ${ANCHOR_PX})`),
      "a label sits away from the subject it names —",
    );
    add(
      "label_anchor",
      r,
      anchors
        .filter((a) => a.o > ANCHOR_OVERLAP)
        .map((a) => `${a.id} (subject ${a.k}) is ${Math.round(100 * a.o)}% over another subject`),
      "a label covers another subject —",
    );
    // Round 5: the shell's names read in the whole view and in every shot.
    if (r.labelPx !== undefined && r.labelPx < LABEL_RENDERED_MIN)
      add(
        "label_size",
        r,
        [`${r.labelPx}px rendered`],
        `a subject's label renders under ${LABEL_RENDERED_MIN}px —`,
      );
    add("label_band", r, r.bandHits ?? [], "a label is where the scene's own words go —");
    if ((r.onPicture ?? 0) >= NUMBERS_ON_PICTURE)
      add(
        "data_over_picture",
        r,
        [`${r.onPicture} numbers`],
        "a table or chart is painted over the illustration — a data beat gets its own chart, not a picture under it:",
      );
    if (r.key === "end" && (r.subjects ?? 0) > 0) {
      const near = new Set(anchors.filter((a) => a.d <= ANCHOR_PX).map((a) => a.k));
      const want = Math.min(2, r.subjects ?? 0);
      if (near.size < want)
        add(
          "label_anchor",
          r,
          [`${near.size} of ${r.subjects} subjects named on the picture, ${want} wanted`],
          'the labels are not tied to the picture\'s subjects (data-subject="K" on a label group within reach of subject K) —',
        );
    }
    if (r.key !== "end" || r.fill === undefined) continue;
    // The settled frame is the summary: the whole scene, lit, at full view.
    if (r.camOff)
      add("camera_end", r, [r.camOff], "the camera has not come back to the whole scene —");
    if ((r.litDimmed ?? 0) > END_DIMMED)
      add(
        "end_dimmed",
        r,
        [`${Math.round(100 * (r.litDimmed ?? 0))}% of its parts`],
        "the last frame leaves dimmed what the scene had lit —",
      );
    // The settled frame: the stage, the hierarchy and the cue groups.
    if (r.fill < STAGE_FILL)
      add(
        "stage_fill",
        r,
        [`${Math.round(100 * r.fill)}% of the body box`],
        `the drawing spans under ${100 * STAGE_FILL}% of its box —`,
      );
    // An illustrated scene reads its picture first; its names are the shell's
    // 44-56px labels on the subjects (round 4), so it is not held to a 64px word.
    if ((r.maxType ?? 0) < KEY_TYPE_PX && !(r.subjects ?? 0))
      add(
        "type_hierarchy",
        r,
        [`the largest is ${(r.maxType ?? 0).toFixed(0)}px`],
        `no label reaches ${KEY_TYPE_PX}px, so nothing reads first —`,
      );
    const groups = r.groups ?? [];
    if (groups.length === 0)
      add(
        "cue_groups",
        r,
        ["none found"],
        'no <g data-cue="N"> groups: what each cue introduces is undeclared —',
      );
    const beyond = groups.filter((g) => !Number.isInteger(g) || g < 1 || g > starts.length);
    if (starts.length && beyond.length)
      add(
        "cue_groups",
        r,
        beyond.map((g) => `data-cue="${g}"`),
        `names a cue the scene does not have (it has ${starts.length}) —`,
      );
  }
  return out;
}

/**
 * What the page did that a scene must not, pinned to the scenes it implicates.
 * A bespoke script that throws is caught by the shell and logged with its scene
 * id (`bespokeCall`), so it lands on that scene alone. A request, a navigation
 * or a CSP refusal names no scene, so it fails every scene probed with it —
 * none of them can be shown to be innocent from inside one page.
 */
/**
 * Console errors the MACHINE raises, not the page: no scene can cause or fix
 * them. MEASURED 2026-10-09: "The AudioContext encountered an error from the
 * audio device or the WebAudio renderer" appeared on one probe deck in three
 * and failed all five of its scenes — five critique calls, two fallbacks.
 * Round 1 saw the same line once on bytes that had passed an hour earlier.
 */
export const ENVIRONMENT_ERRORS = [/AudioContext encountered an error from the audio device/];

export function gradeErrors(errors: readonly string[], sids: readonly string[]): Finding[] {
  const out: Finding[] = [];
  const loose: string[] = [];
  for (const e of new Set(errors)) {
    if (ENVIRONMENT_ERRORS.some((re) => re.test(e))) continue;
    const named = sids.find((sid) => e.includes(`bespoke #${sid}:`));
    if (named)
      out.push({
        severity: "error",
        gate: "runtime",
        rule: "scene_error",
        message: `#${named}: ${e}`,
      });
    else loose.push(e);
  }
  if (loose.length)
    for (const sid of sids)
      out.push({
        severity: "error",
        gate: "runtime",
        rule: "page_error",
        message: `#${sid}: the page ${loose.slice(0, 3).join(" | ")}`,
      });
  return out;
}

export interface SeekDiff {
  sid: string;
  key: string;
  t: number;
  /** Which comparison: `descending`, `scrambled`, `cold`. */
  order: string;
  px: number;
}

export function gradeSeekOrder(
  rows: readonly SeekDiff[],
  severity: Finding["severity"] = "error",
  tolerance = SEEK_TOLERANCE_PX,
): Finding[] {
  const bad = rows.filter((r) => r.px > tolerance);
  const bySid = new Map<string, SeekDiff[]>();
  for (const r of bad) bySid.set(r.sid, [...(bySid.get(r.sid) ?? []), r]);
  return [...bySid.entries()].map(([sid, list]) => ({
    severity,
    gate: "determinism",
    rule: "seek_order",
    message: `#${sid}: the frame depends on what was seeked before it — ${list
      .slice(0, 4)
      .map((r) => `${r.key} (${r.t.toFixed(2)}s) ${r.order} differs by ${r.px}px`)
      .join(
        ", ",
      )}. A from-state applied at build time (a fromTo without immediateRender:false after the first on its target) or a value written from outside the timeline.`,
  }));
}

/* ------------------------------------------------------------------- pixels */

/**
 * The share of a box's pixels that differ between two frames — with and without
 * a scene's drawing — i.e. how much of its stage the drawing actually paints.
 * `box` is in CSS px of a 1920-wide page; frames may be any scale of it.
 */
export function paintedShare(
  shown: Frame,
  hidden: Frame,
  box: { x: number; y: number; w: number; h: number },
  delta = 40,
): number {
  if (shown.width !== hidden.width || shown.height !== hidden.height) return 0;
  const k = shown.width / 1920;
  const x0 = Math.max(0, Math.round(box.x * k));
  const y0 = Math.max(0, Math.round(box.y * k));
  const x1 = Math.min(shown.width, Math.round((box.x + box.w) * k));
  const y1 = Math.min(shown.height, Math.round((box.y + box.h) * k));
  let n = 0;
  let total = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * shown.width + x) * shown.channels;
      const j = (y * hidden.width + x) * hidden.channels;
      const d =
        Math.abs((shown.pixels[i] as number) - (hidden.pixels[j] as number)) +
        Math.abs((shown.pixels[i + 1] as number) - (hidden.pixels[j + 1] as number)) +
        Math.abs((shown.pixels[i + 2] as number) - (hidden.pixels[j + 2] as number));
      if (d > delta) n++;
      total++;
    }
  return total ? n / total : 0;
}

/**
 * Changed pixels that are not on an EDGE of the change: a pixel counts only
 * when it and its 8 neighbours all changed. What `seek_order` compares with.
 *
 * WHY. A picture's first paint can be rasterised a hair differently from a
 * later one (MEASURED 2026-10-09: 12,698px on one illustrated scene's first
 * frame, 2 runs in 3, identical DOM, the difference a 1-2px outline round every
 * subject of the picture). That is the raster, not the scene's state, and it
 * is all edges. A state leak — a term left swollen, a part left lit — changes
 * AREAS, which survive this nearly whole (a 20x20 patch keeps 324 of 400).
 */
export function changedArea(a: Frame, b: Frame, delta = PIXEL_DELTA): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  const { width: w, height: h } = a;
  const mask = new Uint8Array(w * h);
  const ca = a.channels;
  const cb = b.channels;
  for (let p = 0; p < w * h; p++) {
    const i = p * ca;
    const j = p * cb;
    const d =
      Math.abs((a.pixels[i] as number) - (b.pixels[j] as number)) +
      Math.abs((a.pixels[i + 1] as number) - (b.pixels[j + 1] as number)) +
      Math.abs((a.pixels[i + 2] as number) - (b.pixels[j + 2] as number));
    if (d > delta) mask[p] = 1;
  }
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      if (
        mask[p - 1] &&
        mask[p + 1] &&
        mask[p - w] &&
        mask[p + w] &&
        mask[p - w - 1] &&
        mask[p - w + 1] &&
        mask[p + w - 1] &&
        mask[p + w + 1]
      )
        n++;
    }
  return n;
}

export function changedPixels(a: Frame, b: Frame, delta = PIXEL_DELTA): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let n = 0;
  const ca = a.channels;
  const cb = b.channels;
  for (let i = 0, j = 0; i < a.pixels.length; i += ca, j += cb) {
    const d =
      Math.abs((a.pixels[i] as number) - (b.pixels[j] as number)) +
      Math.abs((a.pixels[i + 1] as number) - (b.pixels[j + 1] as number)) +
      Math.abs((a.pixels[i + 2] as number) - (b.pixels[j + 2] as number));
    if (d > delta) n++;
  }
  return n;
}

/* ---------------------------------------------------------- the scene windows */

/**
 * Each scene's cues, scene-relative, from the manifest `build` wrote. Segment
 * cues are relative to their own audio; the segment's `start` is where that
 * audio sits on the composition clock (which is the output clock — nothing is
 * frozen, see `framePlan`).
 */
export function sceneWindows(timing: Timing, sids?: ReadonlySet<string>): SceneWindow[] {
  return timing.scenes
    .filter((s) => !sids || sids.has(s.id))
    .map((s) => ({
      sid: s.id,
      start: s.start,
      duration: s.duration,
      cues: timing.segments
        .filter((g) => g.scene === s.id)
        .flatMap((g) =>
          g.cues.map((c) => ({
            t0: round(g.start + c.start - s.start),
            t1: round(g.start + c.end - s.start),
            text: c.text,
          })),
        )
        .filter((c) => c.t1 > c.t0)
        .sort((a, b) => a.t0 - b.t0),
    }));
}

/**
 * The instants a scene is photographed at: just after each cue starts, 0.6s in,
 * just before it ends, and the settled end. `sparse` keeps the first cue's start,
 * the cue ends and the end — what `seek_order` on a deck's other scenes needs,
 * at about a third of the screenshots.
 */
export function probeTimes(
  w: SceneWindow,
  sparse = false,
): Array<{ key: string; t: number; cue?: number; edge?: "a" | "s" | "z" }> {
  const out: Array<{ key: string; t: number; cue?: number; edge?: "a" | "s" | "z" }> = [];
  w.cues.forEach((c, i) => {
    // The first cue's start stays in a sparse probe: a from-state written at
    // build time shows only before the tween that owns it, i.e. early.
    if (!sparse || i === 0) {
      out.push({ key: `c${i + 1}s`, t: round(c.t0 + 0.05), cue: i, edge: "s" });
      out.push({
        key: `c${i + 1}a`,
        t: round(Math.min(c.t0 + 0.6, c.t1 - 0.1)),
        cue: i,
        edge: "a",
      });
    }
    out.push({ key: `c${i + 1}z`, t: round(c.t1 - 0.05), cue: i, edge: "z" });
  });
  out.push({ key: "end", t: round(Math.max(0, w.duration - 0.5)) });
  return out;
}

/* -------------------------------------------------------------- the browser */

export interface ProbedFrame {
  sid: string;
  key: string;
  /** Scene-relative seconds. */
  t: number;
  png: Buffer;
}

export interface Probe {
  findings: Finding[];
  /** Ascending-pass frames, for a contact sheet. */
  frames: ProbedFrame[];
  cueChanges: CueChange[];
  layout: Layout[];
  seek: SeekDiff[];
  /** The shell's camera every `CAM_STEP` through each illustrated scene (`shot_variety`). */
  cams: CamSample[];
}

export interface ProbeOptions {
  /** Which gates. Default all three. `seek` alone is what `verify` runs on plain v2 scenes. */
  gates?: ReadonlyArray<"motion" | "layout" | "seek">;
  /** `seek_order` severity; `verify` passes `warning` for scenes nobody generated. */
  seekSeverity?: Finding["severity"];
  /** Keep the PNGs (the critique round needs them). */
  keepFrames?: boolean;
  /** Also compare a never-seeked page per scene. Default true; a fresh browser each. */
  cold?: boolean;
  /** Photograph cue ends only (see `probeTimes`). */
  sparse?: boolean;
  /** Measure the repair geometry at every graded frame (bespoke scenes). */
  geometry?: boolean;
  /** Opens a fresh page; injected so the graders' wiring is testable. */
  open: () => Promise<DeckPage>;
  /** The array `open` hands to `openDeck({ watch })`; read once the probe ends. */
  errors?: readonly string[];
}

/**
 * Photograph `windows` and grade them. One warm page for the ordered passes, one
 * cold page per scene for the first-seek comparison.
 */
export async function probeScenes(
  windows: readonly SceneWindow[],
  opts: ProbeOptions,
): Promise<Probe> {
  const gates = new Set(opts.gates ?? ["motion", "layout", "seek"]);
  const frames: ProbedFrame[] = [];
  const cueChanges: CueChange[] = [];
  const layout: Layout[] = [];
  const seek: SeekDiff[] = [];
  const cams: CamSample[] = [];
  const warm = new Map<string, Map<string, Buffer>>();
  const deck = await opts.open();
  try {
    for (const w of windows) {
      const times = probeTimes(w, opts.sparse);
      const shots = new Map<string, Buffer>();
      warm.set(w.sid, shots);
      // NO WARM-UP PASS, on purpose: scenes are probed in deck order, so the
      // first seek into each one is its first ever — which is the history that
      // exposes a from-state written at build time (v2's equation-walk showed
      // a swollen term only there). Fonts are the other thing a first paint
      // differs by, and `settle` waits for those instead.
      for (const p of times) {
        await deck.seek(w.start + p.t);
        await settle(deck);
        const png = await deck.shoot();
        shots.set(p.key, png);
        if (opts.keepFrames) frames.push({ sid: w.sid, key: p.key, t: p.t, png });
        if (gates.has("layout") && p.edge !== "s") {
          const m = (await deck.page.evaluate(
            `(${MEASURE})(${JSON.stringify(w.sid)}, ${opts.geometry === true})`,
          )) as Omit<Layout, "sid" | "key" | "t">;
          const mass = p.key === "end" ? await paintedOf(deck, w.sid, png) : undefined;
          layout.push({
            sid: w.sid,
            key: p.key,
            t: p.t,
            ...m,
            ...(mass === undefined ? {} : { mass }),
            cueStarts: w.cues.map((c) => c.t0),
          });
        }
      }
      if (opts.geometry) endState(layout.filter((l) => l.sid === w.sid));
      // The camera, densely: a shot is what it HOLDS, which cue-boundary frames
      // can miss (two shots inside one cue). A seek and a read, no screenshot.
      if (gates.has("layout") && layout.some((l) => l.sid === w.sid && (l.subjects ?? 0) > 0)) {
        const subjects = Math.max(
          ...layout.filter((l) => l.sid === w.sid).map((l) => l.subjects ?? 0),
        );
        for (let t = CAM_STEP / 2; t < w.duration; t += CAM_STEP) {
          await deck.seek(w.start + t);
          const got = (await deck.page.evaluate(`(${CAM})(${JSON.stringify(w.sid)})`)) as {
            shot: CamSample["shot"];
            grammar: string | null;
            plate: [number, number, number] | null;
            wipe: number | null;
          } | null;
          if (got)
            cams.push({
              sid: w.sid,
              t: round(t),
              shot: got.shot,
              subjects,
              ...(got.grammar ? { grammar: got.grammar } : {}),
              ...(got.plate ? { plate: got.plate } : {}),
              ...(got.wipe !== null ? { wipe: got.wipe } : {}),
            });
        }
      }
      if (gates.has("motion")) {
        for (const [i, c] of w.cues.entries()) {
          // Three instants per cue, and the LARGEST pairwise change: a looping
          // motion can be back where it started by the cue's end.
          const pngs = ["s", "a", "z"]
            .map((e) => shots.get(`c${i + 1}${e}`))
            .filter((b): b is Buffer => b !== undefined);
          if (pngs.length < 2) continue;
          const decoded = await Promise.all(pngs.map((b) => decodePng(b)));
          let changed = 0;
          for (let x = 0; x < decoded.length; x++)
            for (let y = x + 1; y < decoded.length; y++)
              changed = Math.max(changed, changedPixels(decoded[x] as Frame, decoded[y] as Frame));
          const first = decoded[0] as Frame;
          cueChanges.push({
            sid: w.sid,
            cue: i,
            t0: c.t0,
            t1: c.t1,
            changed,
            total: first.width * first.height,
          });
        }
      }
      if (gates.has("seek")) {
        const compare = async (order: string, list: typeof times) => {
          for (const p of list) {
            await deck.seek(w.start + w.duration + 3);
            await deck.seek(w.start + p.t);
            await settle(deck);
            const png = await deck.shoot();
            const ref = shots.get(p.key);
            if (!ref || png.equals(ref)) continue;
            const px = changedArea(await decodePng(png), await decodePng(ref));
            if (px > 0) seek.push({ sid: w.sid, key: p.key, t: p.t, order, px });
          }
        };
        await compare("descending", [...times].reverse());
        await compare(
          "scrambled",
          [...times].sort((a, b) => ((a.t * 7919) % 1) - ((b.t * 7919) % 1)),
        );
      }
    }
  } finally {
    await deck.close();
  }
  if (gates.has("seek") && opts.cold !== false) {
    // Cold: a page that has never seeked anything, asked for one late frame. A
    // page per scene, because seeking one scene seeks every scene's timeline.
    for (const w of windows) {
      const times = probeTimes(w, opts.sparse);
      const p = times[Math.max(0, times.length - 2)];
      const ref = p ? warm.get(w.sid)?.get(p.key) : undefined;
      if (!p || !ref) continue;
      const cold = await opts.open();
      try {
        await cold.seek(w.start + p.t);
        await settle(cold);
        const png = await cold.shoot();
        if (!png.equals(ref)) {
          const px = changedArea(await decodePng(png), await decodePng(ref));
          if (px > 0) seek.push({ sid: w.sid, key: p.key, t: p.t, order: "cold", px });
        }
      } finally {
        await cold.close();
      }
    }
  }
  const findings = [
    ...(opts.errors
      ? gradeErrors(
          opts.errors,
          windows.map((w) => w.sid),
        )
      : []),
    ...(gates.has("motion") ? gradeStillCues(cueChanges) : []),
    ...(gates.has("layout") ? gradeLayout(layout) : []),
    ...(gates.has("layout") && gates.has("motion")
      ? gradeShots(cams, new Map(windows.map((w) => [w.sid, w.cues[0]?.t0 ?? 0])))
      : []),
    ...(gates.has("seek") ? gradeSeekOrder(seek, opts.seekSeverity ?? "error") : []),
  ];
  return { findings, frames, cueChanges, layout, seek, cams };
}

/**
 * The end row's `litDimmed` and `relight`, from every graded frame of one
 * scene: a part lit (>= `LIT`) at some earlier frame and dimmed (< `DIM`, but
 * visible) at the end, and the elements above it that dim it. A part that was
 * never lit is drawn translucent on purpose and is left alone.
 */
export function endState(rows: Layout[]): void {
  const end = rows.find((r) => r.key === "end");
  if (!end?.geo) return;
  const lit = new Set<string>();
  for (const r of rows)
    if (r !== end) for (const p of r.geo?.parts ?? []) if (p.al >= LIT) lit.add(p.a);
  const parts = end.geo.parts;
  const ghosts = parts.filter((p) => p.al < DIM && lit.has(p.a));
  end.litDimmed = parts.length ? ghosts.length / parts.length : 0;
  end.relight = [...new Set(ghosts.flatMap((p) => p.dim))];
}

/**
 * Lay the frame out, then wait for any face that layout asked for. A glyph a
 * scene uses first (KaTeX, a CJK fallback) starts loading when the scene first
 * paints — after `document.fonts.ready` resolved at load — and a frame shot
 * before it arrives differs from one shot after by a few hundred pixels. That
 * is a font, not seek history: measured as a 413px `seek_order` on an equation
 * that vanished when the scene was probed alone.
 */
async function settle(deck: DeckPage): Promise<void> {
  await deck.page.evaluate(() => {
    void document.body.offsetHeight;
    return document.fonts.ready.then(() => undefined);
  });
}

/**
 * The settled frame's painted share of a bespoke scene's body box: the same
 * instant shot again with the body hidden, so a gradient or textured pack
 * background is subtracted exactly. Absent on a scene with no body box.
 */
async function paintedOf(deck: DeckPage, sid: string, shown: Buffer): Promise<number | undefined> {
  const id = JSON.stringify(`${sid}-g`);
  const box = (await deck.page.evaluate(
    `(() => { const e = document.getElementById(${id}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
  )) as { x: number; y: number; w: number; h: number } | null;
  if (!box) return undefined;
  // Whatever inline visibility it had is put back exactly, so later seeks see the page as it was.
  const was = (await deck.page.evaluate(
    `(() => { const s = document.getElementById(${id}).style; const v = s.visibility; s.visibility = "hidden"; return v; })()`,
  )) as string;
  try {
    await settle(deck);
    const hidden = await deck.shoot();
    return paintedShare(await decodePng(shown), await decodePng(hidden), box);
  } finally {
    await deck.page.evaluate(
      `document.getElementById(${id}).style.visibility = ${JSON.stringify(was)}`,
    );
    await settle(deck);
  }
}

/** `timing.json`, or nothing. */
export async function readTimingFile(dir: string): Promise<Timing | undefined> {
  const text = await readFile(join(dir, "timing.json"), "utf8").catch(() => null);
  return text ? (JSON.parse(text) as Timing) : undefined;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Serialised into the page: the shell's camera of one scene (scale, x, y, box
 * w, h), the grammar stamped on it, its backdrop's scale, x, y, and how much
 * of the box a wiped-on picture shows — or null.
 */
const CAM = `(sid) => {
  const cam = document.getElementById(sid + "-cam");
  if (!cam) return null;
  const tf = (el) => {
    const t = getComputedStyle(el).transform;
    const v = t && t !== "none" ? t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")).split(",").map(Number) : [1, 0, 0, 1, 0, 0];
    return [Math.round((v.length === 6 ? v[0] : 1) * 1000) / 1000, Math.round(v[4] || 0), Math.round(v[5] || 0)];
  };
  const box = document.getElementById(sid + "-g");
  const plate = document.getElementById(sid + "-plate");
  const wipe = document.getElementById(sid + "-wipe");
  const ww = wipe ? Number(wipe.getAttribute("width")) : NaN;
  return {
    shot: [...tf(cam), cam.offsetWidth, cam.offsetHeight],
    grammar: box ? box.getAttribute("data-ds-grammar") : null,
    plate: plate ? tf(plate) : null,
    wipe: wipe && cam.offsetWidth ? Math.round((1000 * (Number.isFinite(ww) ? ww : 0)) / cam.offsetWidth) / 1000 : null,
  };
}`;

/**
 * Serialised into the page: everything `gradeLayout` needs about one scene at
 * the instant just seeked. A string, so it carries no closure and no bundler
 * helper into the browser.
 */
const MEASURE = `(sid, wantGeo) => {
  const root = document.getElementById(sid);
  if (!root) return { crossings: [], occlusions: [], overlaps: [], small: [], off: [], strays: [] };
  const W = window.innerWidth, H = window.innerHeight;
  // A bespoke scene that moves the camera is clipped to its body box: what the
  // push-in leaves outside it is not drawn, so it is neither off the frame nor
  // crossing anything.
  const bodyEl = document.getElementById(sid + "-g");
  const bodyClip = bodyEl && getComputedStyle(bodyEl).overflow !== "visible" ? bodyEl.getBoundingClientRect() : null;
  const meet = (a, b) => {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  };
  const alpha = (el) => {
    let o = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") return 0;
      o *= Number(cs.opacity);
    }
    return o;
  };
  const name = (el) => el.id || (el.tagName.toLowerCase() + ":" + (el.textContent || "").trim().slice(0, 16));
  // What an element's box is after any clipping <svg> (overflow other than
  // visible) — a camera move zooms a viewBox, and what it leaves outside is
  // not drawn, so it is neither off the frame nor crossing anything.
  const clipOf = (el) => {
    const svg = el.ownerSVGElement || (el.closest && el.closest("svg"));
    let c = svg && getComputedStyle(svg).overflow !== "visible" ? svg.getBoundingClientRect() : null;
    if (bodyClip && bodyEl.contains(el)) c = c ? meet(c, bodyClip) : bodyClip;
    return c;
  };
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    const c = clipOf(el);
    if (!c) return { x: r.x, y: r.y, width: r.width, height: r.height, clip: null };
    const x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y);
    const x1 = Math.min(r.x + r.width, c.x + c.width), y1 = Math.min(r.y + r.height, c.y + c.height);
    // >=, not >: a horizontal line has no height and is still drawn.
    return x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0, clip: c } : { x: 0, y: 0, width: 0, height: 0, clip: c };
  };
  // Text boxes: SVG <text>, a KaTeX run, or an HTML element with its own text.
  const texts = [];
  // Where a label sits, in the body box's own px (= the scene's svg units when it
  // has no camera move): a fix round can act on "x 1210-1330" where it cannot on
  // "these two overlap" — round 2's drafts failed on overlaps it could not see.
  const origin = document.getElementById(sid + "-g");
  const o0 = origin ? origin.getBoundingClientRect() : { x: 0, y: 0 };
  const at = (t) => t.id + " [x " + Math.round(t.x - o0.x) + "-" + Math.round(t.x + t.w - o0.x) + ", y " + Math.round(t.y - o0.y) + "-" + Math.round(t.y + t.h - o0.y) + "]";
  const walk = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "defs") return;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const katex = el.classList && el.classList.contains("katex");
    if (tag === "text" || katex || (own && !(el instanceof SVGElement))) {
      const r = boxOf(el);
      const o = alpha(el);
      if (r.width > 0 && r.height > 0 && o > 0.15) {
        let fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (el instanceof SVGGraphicsElement && el.getScreenCTM) {
          const m = el.getScreenCTM();
          if (m) fs *= Math.hypot(m.a, m.b);
        }
        texts.push({ el, id: name(el), x: r.x, y: r.y, w: r.width, h: r.height, fs, o });
      }
      if (tag === "text" || katex) return;
    }
    for (const c of el.children) walk(c);
  };
  walk(root);

  const overlaps = [];
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 4 && iy > 4) overlaps.push(at(a) + " × " + at(b));
    }
  const small = texts.filter((t) => t.fs > 0 && t.fs < ${TYPE_FLOOR_PX}).map((t) => t.id + "@" + t.fs.toFixed(1) + "px");

  // Strokes and fills. Every shape that paints something at this instant is a
  // LEAF: what the stage-fill and early-reveal measures below are made of.
  const crossings = [], occlusions = [], off = [], strays = [], leaves = [];
  // <image> is a bespoke scene's illustration: it paints its whole box.
  const shapes = root.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect, image");
  // Repair geometry (bespoke scenes, on request): stroke points, filled boxes.
  const geoPoints = [], geoBoxes = [];
  const inset = 4;
  const inside = (p, t) => p.x > t.x + inset && p.x < t.x + t.w - inset && p.y > t.y + inset && p.y < t.y + t.h - inset;
  for (const g of shapes) {
    if (g.closest("defs, marker, clipPath, mask, pattern, symbol")) continue;
    const o = alpha(g);
    if (o <= 0.15) continue;
    const cs = getComputedStyle(g);
    const r = boxOf(g);
    if (r.width === 0 && r.height === 0) continue;
    if (r.x < -2 || r.y < -2 || r.x + r.width > W + 2 || r.y + r.height > H + 2) off.push(name(g));
    // A shape that wholly contains a text box is that label's plate, not a collision.
    const plate = (t) => r.x <= t.x + 1 && r.y <= t.y + 1 && r.x + r.width >= t.x + t.w - 1 && r.y + r.height >= t.y + t.h - 1;
    const sw = parseFloat(cs.strokeWidth) || 0;
    const stroked = cs.stroke && cs.stroke !== "none" && sw > 0 && Number(cs.strokeOpacity) * o > 0.15;
    // A <line> has no inside, and a shape scaled flat paints no area, whatever its fill says.
    const filled = cs.fill && cs.fill !== "none" && Number(cs.fillOpacity) * o > 0.15 &&
      g.tagName.toLowerCase() !== "line" && r.width >= 1 && r.height >= 1;
    // A marker paints with the element's opacity, not its stroke's, and DrawSVG
    // draws by dashing: an arrowhead stays where it is while its line is drawn
    // to 0%, or half way — the "stray arrowhead" of an undrawn line.
    const markerStart = cs.markerStart && cs.markerStart !== "none";
    const markerEnd = cs.markerEnd && cs.markerEnd !== "none";
    const picture = g.tagName.toLowerCase() === "image";
    let paints = filled;
    if (!stroked && (markerStart || markerEnd)) strays.push(name(g) + " (its arrowhead shows, its line does not)");
    if (stroked && typeof g.getTotalLength !== "function") paints = true;
    if (stroked && typeof g.getTotalLength === "function") {
      let len = 0;
      try { len = g.getTotalLength(); } catch (e) { len = 0; }
      const m = g.getScreenCTM();
      if (len > 0 && m) {
        const dash = (cs.strokeDasharray && cs.strokeDasharray !== "none")
          ? cs.strokeDasharray.split(/[ ,]+/).map(parseFloat).filter((v) => v >= 0)
          : [];
        const pattern = dash.length % 2 ? dash.concat(dash) : dash;
        const period = pattern.reduce((a, b) => a + b, 0);
        const offset = parseFloat(cs.strokeDashoffset) || 0;
        const visible = (d) => {
          if (!period) return true;
          let pos = ((d + offset) % period + period) % period;
          for (let k = 0; k < pattern.length; k++) {
            if (pos < pattern[k]) return k % 2 === 0;
            pos -= pattern[k];
          }
          return true;
        };
        const step = Math.max(4, len / 400);
        const hit = new Set();
        let drawn = 0;
        let kept = -1e9;
        for (let d = 0; d <= len; d += step) {
          if (!visible(d)) continue;
          drawn += step;
          const q = g.getPointAtLength(d);
          const p = { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
          if (r.clip && (p.x < r.clip.x || p.y < r.clip.y || p.x > r.clip.x + r.clip.width || p.y > r.clip.y + r.clip.height)) continue;
          if (wantGeo && d - kept >= 8 && geoPoints.length < 6000) { kept = d; geoPoints.push({ el: g, x: p.x, y: p.y }); }
          // No plate exemption here: a long curve's bounding box contains half
          // the labels on a chart, and its stroke still runs through them.
          for (const t of texts) if (!hit.has(t) && inside(p, t)) hit.add(t);
        }
        for (const t of hit) crossings.push(name(g) + " through " + at(t));
        if (drawn > 2) paints = true;
        const edge = Math.min(2, len / 100);
        if (markerEnd && !visible(len - edge)) strays.push(name(g) + " (an arrowhead at the end of a line not drawn that far)");
        else if (markerStart && !visible(edge)) strays.push(name(g) + " (an arrowhead at the start of a line not drawn from there)");
      } else if (len > 0) paints = true;
    }
    if (paints) leaves.push({ el: g, x: r.x, y: r.y, w: r.width, h: r.height, o });
    if (wantGeo && filled) geoBoxes.push({ el: g, x: r.x, y: r.y, w: r.width, h: r.height });
    if (filled) {
      for (const t of texts) {
        // A picture over a label is never its plate: it covers it.
        if (plate(t) && !picture) continue;
        // Only a shape painted AFTER the text can cover it.
        if (!(t.el.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const ix = Math.min(r.x + r.width, t.x + t.w) - Math.max(r.x, t.x);
        const iy = Math.min(r.y + r.height, t.y + t.h) - Math.max(r.y, t.y);
        if (ix > inset && iy > inset && ix * iy > 0.15 * t.w * t.h) occlusions.push(name(g) + " over " + at(t));
      }
    }
  }
  for (const t of texts)
    if (t.x < -1 || t.y < -1 || t.x + t.w > W + 1 || t.y + t.h > H + 1) off.push(t.id);

  // The body box a bespoke scene draws in. Absent on an archetype's scene, and
  // then there is no stage to fill and no cue group to reveal.
  const box = document.getElementById(sid + "-g");
  let fill, maxType, cells, groups, revealed, dimmed;
  if (box) {
    const b = box.getBoundingClientRect();
    const mine = texts.filter((t) => box.contains(t.el)).map((t) => ({ el: t.el, x: t.x, y: t.y, w: t.w, h: t.h }))
      .concat(leaves.filter((l) => box.contains(l.el)));
    // A backdrop the size of the box fills it by being there; it is not content.
    // A picture is content however big it is: it is what the stage shows.
    const content = mine.filter((l) => l.w * l.h < 0.85 * b.width * b.height || l.el.tagName.toLowerCase() === "image");
    const clip = (l) => {
      const x0 = Math.max(b.x, l.x), y0 = Math.max(b.y, l.y);
      const x1 = Math.min(b.x + b.width, l.x + l.w), y1 = Math.min(b.y + b.height, l.y + l.h);
      return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
    };
    const parts = content.map(clip).filter(Boolean);
    if (parts.length && b.width > 0 && b.height > 0) {
      const u = parts.reduce((a, p) => ({ x0: Math.min(a.x0, p.x0), y0: Math.min(a.y0, p.y0), x1: Math.max(a.x1, p.x1), y1: Math.max(a.y1, p.y1) }));
      fill = ((u.x1 - u.x0) * (u.y1 - u.y0)) / (b.width * b.height);
      // How many of a 6x4 grid's cells something is drawn in: a bbox can be
      // stretched by one stray dot, a grid cannot.
      let n = 0;
      for (let cx = 0; cx < 6; cx++)
        for (let cy = 0; cy < 4; cy++) {
          const gx0 = b.x + (cx * b.width) / 6, gx1 = b.x + ((cx + 1) * b.width) / 6;
          const gy0 = b.y + (cy * b.height) / 4, gy1 = b.y + ((cy + 1) * b.height) / 4;
          if (parts.some((p) => p.x0 < gx1 && p.x1 > gx0 && p.y0 < gy1 && p.y1 > gy0)) n++;
        }
      cells = n / 24;
    } else fill = 0;
    maxType = texts.filter((t) => box.contains(t.el)).reduce((a, t) => Math.max(a, t.fs), 0);
    // How much of what is drawn is drawn dimmed (focus): at the end, a summary
    // that is mostly ghosts is not one.
    const shown = texts.filter((t) => box.contains(t.el)).concat(leaves.filter((l) => box.contains(l.el)));
    dimmed = shown.length ? shown.filter((x) => x.o < 0.6).length / shown.length : 0;
    // Cue groups: what the scene says each cue introduces, and which are showing now.
    const tagged = [...box.querySelectorAll("[data-cue]")];
    groups = [...new Set(tagged.map((e) => Number(e.getAttribute("data-cue"))))].sort((a, c) => a - c);
    const showing = (e) => texts.some((t) => e === t.el || e.contains(t.el)) || leaves.some((l) => e === l.el || e.contains(l.el));
    revealed = tagged.filter(showing).map((e) => ({ id: name(e), cue: Number(e.getAttribute("data-cue")) }));
  }
  // Where the camera is, for \`camera_end\`: the shell's wrapper, and a viewBox camera.
  let camOff;
  const cam = document.getElementById(sid + "-cam");
  if (cam) {
    const t = getComputedStyle(cam).transform;
    if (t && t !== "none") {
      const v = t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")).split(",").map(Number);
      if (v.length === 6 && (Math.abs(v[0] - 1) > 0.01 || Math.abs(v[4]) > 2 || Math.abs(v[5]) > 2))
        camOff = "#" + sid + "-cam at scale " + v[0].toFixed(2) + ", x " + Math.round(v[4]) + ", y " + Math.round(v[5]);
    }
  }
  // Round 4: the shell's camera (scale, x, y and the box it moves), the
  // subjects of an illustrated scene, and how its labels sit on them.
  let shot, subjects, anchors, onPicture, labelPx, bandHits;
  if (cam && box) {
    const t = getComputedStyle(cam).transform;
    const v = t && t !== "none" ? t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")).split(",").map(Number) : [1, 0, 0, 1, 0, 0];
    const s = v.length === 6 ? v[0] : 1;
    shot = [Math.round(s * 1000) / 1000, Math.round(v[4] || 0), Math.round(v[5] || 0), cam.offsetWidth, cam.offsetHeight];
    const subs = [...cam.querySelectorAll("[data-ds-subject]")].map((e) => ({ k: Number(e.getAttribute("data-ds-subject")), r: e.getBoundingClientRect() }));
    subjects = subs.length;
    if (subs.length) {
      const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);
      anchors = [];
      for (const g of box.querySelectorAll("[data-subject]")) {
        const k = Number(g.getAttribute("data-subject"));
        const mine = texts.filter((x) => g === x.el || g.contains(x.el));
        if (!mine.length) continue;
        const x0 = Math.min(...mine.map((x) => x.x)), y0 = Math.min(...mine.map((x) => x.y));
        const x1 = Math.max(...mine.map((x) => x.x + x.w)), y1 = Math.max(...mine.map((x) => x.y + x.h));
        const lab = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        const own = subs.find((q) => q.k === k);
        // Gap between the label and its subject, in the box's own px (camera-free).
        const gap = own ? Math.hypot(Math.max(0, own.r.x - x1, x0 - (own.r.x + own.r.width)), Math.max(0, own.r.y - y1, y0 - (own.r.y + own.r.height))) / s : 1e9;
        // The most of the label any OTHER subject's box covers (the part not also its own).
        let over = 0;
        for (const q of subs) {
          if (q.k === k) continue;
          const m = meet(lab, q.r);
          let a = area(m);
          if (own) a -= area(meet(m, own.r));
          over = Math.max(over, a / Math.max(1, area(lab)));
        }
        anchors.push({ id: g.id || "g:" + k, k, d: Math.round(gap), o: Math.round(over * 100) / 100 });
      }
    }
    // Round 5: the shell's labels — the size they are rendered at, and whether
    // they keep out of the caption band and clear of the scene's own words —
    // in the box's own px (camera-free: screen = box + translate + scale * p).
    if (subs.length) {
      const ob = box.getBoundingClientRect();
      const free = (r) => ({ x: (r.x - ob.x - (v[4] || 0)) / s, y: (r.y - ob.y - (v[5] || 0)) / s, w: r.width / s, h: r.height / s });
      const tags = texts.filter((x) => box.contains(x.el) && x.el.closest(".ds-callouts"));
      // fs carries the SVG transforms (the label's own scale), not the camera's
      // CSS transform (MEASURED 2026-10-10: a 64px label held at 0.78 under a 1.66x
      // camera read 49.7): times the camera's scale, it is what the screen shows.
      if (tags.length) labelPx = Math.round(Math.min(...tags.map((x) => x.fs * s)) * 10) / 10;
      bandHits = [];
      const plates = [...box.querySelectorAll(".ds-callouts g[id$='-tag'] > rect")].filter((r) => alpha(r) > 0.15);
      const own = texts.filter((x) => box.contains(x.el) && !x.el.closest(".ds-callouts"));
      for (const pl of plates) {
        const p = free(pl.getBoundingClientRect());
        const tag = pl.parentElement && pl.parentElement.id ? pl.parentElement.id : "label";
        if (p.y < ${ART_BAND} - 1) bandHits.push(tag + " reaches into the caption band (y " + Math.round(p.y) + " < ${ART_BAND})");
        for (const t of own) {
          const q = free({ x: t.x, y: t.y, width: t.w, height: t.h });
          const gx = Math.max(p.x - (q.x + q.w), q.x - (p.x + p.w));
          const gy = Math.max(p.y - (q.y + q.h), q.y - (p.y + p.h));
          if (gx < 24 && gy < 24) bandHits.push(tag + " crowds the scene's own words " + t.id + " (" + Math.round(Math.max(gx, gy, 0)) + "px apart)");
        }
      }
    }
    // A table or chart painted over the picture: numbers sitting on the illustration.
    const pic = box.querySelector("image[data-art]");
    if (pic && alpha(pic) > 0.15) {
      const pr = boxOf(pic);
      onPicture = texts.filter((x) => box.contains(x.el) && /[0-9]/.test(x.el.textContent || "") &&
        x.x + x.w / 2 > pr.x && x.x + x.w / 2 < pr.x + pr.width && x.y + x.h / 2 > pr.y && x.y + x.h / 2 < pr.y + pr.height).length;
    }
  }
  const svg0 = document.getElementById(sid + "-svg");
  if (svg0 && !camOff) {
    // The contract's viewBox is "0 0 W H" with W, H the svg's own size.
    const vb = (svg0.getAttribute("viewBox") || "").trim().split(/[ ,]+/).map(Number);
    const w0 = Number(svg0.getAttribute("width")), h0 = Number(svg0.getAttribute("height"));
    if (vb.length === 4 && w0 > 0 && h0 > 0 && (Math.abs(vb[0]) > 1 || Math.abs(vb[1]) > 1 || Math.abs(vb[2] - w0) > 1 || Math.abs(vb[3] - h0) > 1))
      camOff = "#" + sid + "-svg viewBox " + vb.join(" ");
  }

  // What the repair pass needs (bespoke scenes only): every element of the body
  // addressed as tag:index in document order — the markup's own order, which
  // is how a fix finds it again in the fragment — the labels with the unit a
  // nudge would move (the text, or the smallest <g> that holds it and its
  // plate and no other label), what is painted, and each part's opacity.
  let geo;
  if (box && wantGeo) {
    const index = new Map(), order = new Map();
    const n = {};
    let k = 0;
    for (const e of box.querySelectorAll("*")) {
      // Not the markup's: KaTeX's rendered spans, and the shell's camera wrapper.
      if (e.closest(".katex") || e.id === sid + "-cam") continue;
      const t = e.tagName.toLowerCase();
      n[t] = n[t] || 0;
      index.set(e, t + ":" + n[t]++);
      order.set(e, k++);
    }
    const ob = box.getBoundingClientRect();
    const rel = (x, y, w, h) => [x - ob.x, y - ob.y, w, h].map((v) => Math.round(v * 10) / 10);
    const unitOf = (el) => {
      let u = el;
      const tb = el.getBoundingClientRect();
      const area = Math.max(1, tb.width * tb.height);
      for (let p = el.parentElement; p && p !== box && p.tagName.toLowerCase() === "g" && box.contains(p); p = p.parentElement) {
        if (p.querySelectorAll("text").length !== 1) break;
        const pb = p.getBoundingClientRect();
        if (pb.width * pb.height > 4 * area) break;
        u = p;
      }
      return u;
    };
    const scaleOf = (u) => {
      const par = u.parentElement;
      const m = par && par.getScreenCTM ? par.getScreenCTM() : null;
      return m ? Math.hypot(m.a, m.b) || 1 : 1;
    };
    const units = [];
    const labels = texts.filter((t) => box.contains(t.el)).map((t) => {
      // The shell's own labels (round 4) are not the scene's to move: obstacles.
      const movable = t.el.tagName.toLowerCase() === "text" && !t.el.closest(".ds-callouts");
      const u = movable ? unitOf(t.el) : null;
      if (u) units.push(u);
      return { a: index.get(t.el) || "", u: u ? index.get(u) : null, o: order.get(t.el) ?? -1, b: rel(t.x, t.y, t.w, t.h), s: u ? Math.round(scaleOf(u) * 1000) / 1000 : 1, fs: Math.round(t.fs), ...(t.el.closest(".ds-callouts") ? { c: 1 } : {}) };
    });
    const ownerOf = (el) => { for (const u of units) if (u === el || u.contains(el)) return index.get(u); return null; };
    const points = geoPoints.filter((p) => box.contains(p.el)).map((p) => [Math.round(p.x - ob.x), Math.round(p.y - ob.y), ownerOf(p.el)]);
    const boxes = geoBoxes.filter((b) => box.contains(b.el)).map((b) => ({ a: index.get(b.el) || "", u: ownerOf(b.el), o: order.get(b.el) ?? -1, b: rel(b.x, b.y, b.w, b.h) }));
    // Each visible part's opacity, and the elements above it (itself included)
    // that dim it: what a relight would have to bring back.
    const own = (e) => Number(getComputedStyle(e).opacity);
    const parts = texts.filter((t) => box.contains(t.el)).map((t) => ({ el: t.el, o: t.o }))
      .concat(leaves.filter((l) => box.contains(l.el)).map((l) => ({ el: l.el, o: l.o })))
      .map((p) => {
        const dim = [];
        if (p.o < 0.95)
          for (let e = p.el; e && e !== box; e = e.parentElement)
            if (index.has(e) && own(e) < 0.95) dim.push(index.get(e) + (e.id ? "#" + e.id : ""));
        return { a: index.get(p.el) || "", al: Math.round(p.o * 100) / 100, dim };
      });
    const camEl = document.getElementById(sid + "-cam");
    const ct = camEl ? getComputedStyle(camEl).transform : "none";
    const cs = ct && ct !== "none" ? Number(ct.slice(ct.indexOf("(") + 1).split(",")[0]) || 1 : 1;
    geo = { w: Math.round(ob.width), h: Math.round(ob.height), cs: Math.round(cs * 1000) / 1000, labels, boxes, points, parts };
  }
  return { crossings, occlusions, overlaps, small, off, strays, fill, cells, maxType, groups, revealed, dimmed, camOff, geo, shot, subjects, anchors, onPicture, labelPx, bandHits };
}`;
