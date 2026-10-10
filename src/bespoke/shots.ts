/**
 * The camera of an illustrated scene, owned by the shell: STAGED SHOTS, not
 * pans. Round 3 let each scene move the camera itself and it mostly drifted at
 * 1.1-1.4x — a different gentle pan in every scene, and the founder's bar is
 * an explainer's camera: an establishing shot of the whole picture, a push in
 * on the subject the voice is naming, a cut-like move to the next, and a pull
 * back that reveals the whole again for the summary.
 *
 * So the scene names, per cue, WHICH subject the shot is on (its `shots`), and
 * this file turns that into the camera — one fixed grammar, the same in every
 * scene of every deck, which is also what makes two runs of a deck move alike:
 *
 *   1. ESTABLISHING: the whole picture at scale 1 from the start, for at least
 *      `ESTABLISH` seconds of the first cue (a slow 3% creep, so it is alive);
 *   2. PUSH IN on the subject a shot names, starting at its time, `MOVE`s,
 *      power3.inOut, framed on the subject's box (padded) at `CLOSE_MIN` to
 *      `CAMERA_MAX_SCALE`; a held shot creeps 3% further so it never freezes;
 *   3. a shot on another subject is a move straight there (no pull-out between);
 *   4. REVEAL: back to the whole picture at the start of the last cue (or after
 *      the last push has been held `MIN_HOLD`), home before the end frame.
 *
 * Shots closer than `MIN_HOLD` to the previous one are dropped: a shot the
 * audience cannot read is a shake.
 *
 * A SECOND GRAMMAR, `close-open` (2026-10-10): one grammar for every
 * illustrated scene made every one of them move alike — r1's three illustrated
 * scenes were the same tour of three subjects in a row, and read as a template.
 * `close-open` OPENS CLOSE on the subject of the first shot, held from t=0, moves
 * subject to subject, and opens out to the whole picture only at the reveal —
 * the picture is discovered rather than surveyed. The pass alternates the two
 * over a deck's illustrated beats in deck order.
 */

import type { Grammar } from "./grammar.js";
import type { UnitBox } from "./inspect.js";

/** One entry of a scene's shot list: on cue `cue` (1-based), `at` of the way in, frame `subject` (0 = the whole picture). */
export interface Shot {
  cue: number;
  at: number;
  subject: number;
}

/** A box in the body box's px. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One camera move: from the previous framing to this one, starting at `t`. */
export interface CamMove {
  t: number;
  dur: number;
  s: number;
  x: number;
  y: number;
  ease: string;
  /** The subject framed (0 = the whole picture, or a two-shot). */
  subject: number;
  /** What kind of move it is in its grammar (the report and the gates read it). */
  kind?: "push" | "whip" | "track" | "cut" | "pull" | "two-shot" | "creep" | "reveal";
}

/** The camera's largest push-in: past it a picture turns to mush. */
export const CAMERA_MAX_SCALE = 2.2;
/** The smallest scale that is a close shot: below it a push reads as a nudge (round 3's 1.1-1.4). */
export const CLOSE_MIN = 1.6;
/** Seconds a move takes. */
export const MOVE = 1.1;
/** The reveal is slower: the picture opens out. */
export const REVEAL = 1.3;
/** A shot is held at least this long before the next move. */
export const MIN_HOLD = 1.6;
/** The establishing shot holds at least this long into the first cue. */
export const ESTABLISH = 1.6;
/** A held shot creeps this much further in, so a hold is never a still frame. */
export const CREEP = 1.03;
/** The closest a push-in is ever framed at: over the gate's 1.5x close-up, with its creep. */
const PUSH_FLOOR = 1.55;
/** Seconds between a creep's end and the next move's start. */
const CREEP_GAP = 0.05;

/**
 * Where the picture sits in the box: covering all of it. Round 4 kept a 120px
 * band clear at the top for the shell's subject labels; round 6 draws no
 * labels (the narration and the subtitles name the subjects), so the band and
 * its labels are gone.
 */
export function artPlacement(box: { width: number; height: number }): Box {
  return { x: 0, y: 0, w: box.width, h: Math.max(1, box.height) };
}

/**
 * Where the picture's subjects sit in the body box, when the picture covers
 * its placement (`artPlacement`) with `preserveAspectRatio="xMidYMid slice"`
 * (the shell places it so): scaled to cover and centred, so a share of the
 * picture maps through that scale and offset. A subject cut off by more than
 * half is not pointed at; the rest are clipped to the placement.
 */
export function subjectsInBox(
  units: readonly UnitBox[],
  art: { width: number; height: number },
  box: { width: number; height: number },
): Box[] {
  const at = artPlacement(box);
  const k = Math.max(at.w / art.width, at.h / art.height);
  const ox = at.x + (at.w - art.width * k) / 2;
  const oy = at.y + (at.h - art.height * k) / 2;
  const out: Box[] = [];
  for (const [ux, uy, uw, uh] of units) {
    const x0 = ox + ux * art.width * k;
    const y0 = oy + uy * art.height * k;
    const x1 = x0 + uw * art.width * k;
    const y1 = y0 + uh * art.height * k;
    const cx0 = Math.max(at.x, x0);
    const cy0 = Math.max(at.y, y0);
    const cx1 = Math.min(at.x + at.w, x1);
    const cy1 = Math.min(at.y + at.h, y1);
    if (cx1 <= cx0 || cy1 <= cy0) continue;
    if ((cx1 - cx0) * (cy1 - cy0) < 0.5 * (x1 - x0) * (y1 - y0)) continue;
    out.push({
      x: Math.round(cx0),
      y: Math.round(cy0),
      w: Math.round(cx1 - cx0),
      h: Math.round(cy1 - cy0),
    });
  }
  return out;
}

/**
 * The camera's scale and offset that frame `b` (origin 0 0), held to the box's
 * edges. `sMax` is the picture's own ceiling (`sharpMax`): past it the push-in
 * shows the picture's pixels; `sMin` the closest a framing may be widened to.
 */
export function frameOn(
  b: Box,
  W: number,
  H: number,
  sMax = CAMERA_MAX_SCALE,
  sMin = CLOSE_MIN,
): { s: number; x: number; y: number } {
  const padX = Math.max(40, 0.15 * b.w);
  const padY = Math.max(40, 0.15 * b.h);
  const fit = Math.min(W / (b.w + 2 * padX), H / (b.h + 2 * padY));
  const top = Math.max(1, Math.min(CAMERA_MAX_SCALE, sMax));
  const s = Math.min(top, Math.max(Math.min(sMin, top), fit));
  const cx = b.x + b.w / 2;
  // Too tall to frame whole at a close scale: frame its TOP — the label above a
  // subject and the head of a figure — not its middle.
  const cy = fit < s ? b.y - 12 + H / (2 * s) : b.y + b.h / 2;
  return frameAt(cx, cy, s, W, H);
}

/** The camera that puts point (cx, cy) of the box at the centre of the view at scale `s`, held to the box. */
export function frameAt(
  cx: number,
  cy: number,
  s: number,
  W: number,
  H: number,
): { s: number; x: number; y: number } {
  const clamp = (v: number, lo: number) => Math.min(0, Math.max(lo, v));
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    s: r(s),
    x: Math.round(clamp(W / 2 - cx * s, W - W * s)),
    y: Math.round(clamp(H / 2 - cy * s, H - H * s)),
  };
}

/**
 * EFFECTIVE RESOLUTION. The image tool draws ~1.57 megapixels whatever it is
 * asked (MEASURED 2026-10-10: 1672x941, 1774x887, 1915x821 — no size control
 * exists on the tool). Covering a ~1730px-wide box, one picture pixel already
 * spans ~0.9-1.0 output pixels, so a 2.2x push-in shows each picture pixel
 * over ~2.2 output pixels: round 4's push-ins looked soft. The shell now caps
 * every push-in at the scale where a picture pixel spans at most 1/`EFF_MIN`
 * output pixels (`sharpMax`), and the report and the gate read the effective
 * resolution at the closest shot (`effectiveAt`).
 *
 * ROUND 6 raises the bar from 0.6 to 0.85: pictures are upscaled 2x before they
 * are cut into planes (src/bespoke/depth.ts), so a 1.55x push-in can be sharp.
 * A picture that could not be upscaled is still pushed in at `PUSH_FLOOR` (the
 * staging wins) and the report says how soft it was.
 */
export const EFF_MIN = 0.85;

/** Picture px per box px at rest: the depth planes' own scale (after any upscale), else the drawn picture's. */
function restDensity(
  art: { width: number; height: number; depth?: { scale: number } },
  box: { width: number; height: number },
): number {
  if (art.depth) return art.depth.scale;
  const at = artPlacement(box);
  return 1 / Math.max(at.w / art.width, at.h / art.height);
}

/** Picture pixels per output pixel when the picture covers `box`'s placement at camera scale `s`. */
export function effectiveAt(
  art: { width: number; height: number; depth?: { scale: number } },
  box: { width: number; height: number },
  s: number,
): number {
  return Math.round((1000 * restDensity(art, box)) / Math.max(1, s)) / 1000;
}

/** The closest the camera may push in on this picture and stay at `EFF_MIN` or sharper. */
export function sharpMax(
  art: { width: number; height: number; depth?: { scale: number } } | undefined,
  box: { width: number; height: number },
): number {
  if (!art) return CAMERA_MAX_SCALE;
  const cap = restDensity(art, box) / EFF_MIN;
  // Never under 1: a picture too coarse to push in on is staged wide, never zoomed
  // out of. But a picture the tool drew, at its own size, is still pushed in on at
  // `PUSH_FLOOR`: the staging wins over the last hundredths of sharpness (round 6
  // raised `EFF_MIN`, which a picture that could not be upscaled cannot meet).
  const top = cap < 1 ? 1 : Math.max(PUSH_FLOOR, Math.min(CAMERA_MAX_SCALE, cap));
  return Math.round(top * 1000) / 1000;
}

/**
 * The default shot list, for a scene whose own is missing or unusable: the
 * subjects in order, one per cue after the first (the first cue is the
 * establishing shot), so every subject the picture has is pointed at once.
 */
export function defaultShots(cues: number, subjects: number): Shot[] {
  if (subjects === 0 || cues === 0) return [];
  const out: Shot[] = [];
  if (cues <= 2) {
    // Too few cues for a shot each: the first cue's second half and the last cue's first.
    out.push({ cue: 1, at: 0.5, subject: 1 });
    if (subjects > 1 && cues === 2) out.push({ cue: 2, at: 0, subject: 2 });
    return out;
  }
  // The middle cues carry the shots; at least two when there are two subjects,
  // spread through them (three cues used to give one shot: one push-in).
  const m = cues - 2;
  const k = Math.min(subjects, Math.max(2, m));
  for (let i = 0; i < k; i++) {
    const pos = (i * m) / k;
    out.push({
      cue: 2 + Math.floor(pos),
      at: Math.round((pos - Math.floor(pos)) * 100) / 100,
      subject: i + 1,
    });
  }
  return out;
}

/** One step of a wiped-on picture: from `t`, over `dur`, the picture shows up to `share` of the box's width. */
export interface WipeStep {
  t: number;
  dur: number;
  share: number;
  /** The subject this step uncovers (0: the rest of the picture). */
  subject: number;
}

/** Everything the shell's camera does in one illustrated scene (src/bespoke/grammar.ts). */
export interface Staging {
  grammar: Grammar;
  /** Where the camera is at t=0: home, except a zoom-out, which opens close on `subject`. */
  open: { s: number; x: number; y: number; subject?: number };
  moves: CamMove[];
  /** A wiped-on picture's steps (grammar "wipe"); empty otherwise. */
  wipes: WipeStep[];
}

/** How long a push is held after it lands, at least: two 0.5s camera samples. */
const HELD = 1.1;
/** A whip between two subjects of a rack. */
const WHIP = 0.6;
/**
 * A cutaway's cut: instantaneous, as an editor's cut is. A 0.12s "cut" was
 * caught mid-move by the camera's 0.5s samples a quarter of the time, and then
 * looked like a fast push.
 */
const CUT = 0;
/** A follow's track from one subject to the next, and the shortest one (2s and more of travel: longer than any push). */
const TRACK = 2.6;
const TRACK_MIN = 2.4;
/** A rack's holds when the scene is short, and how long its two-shot holds. */
const RACK_HOLD_MIN = 1.1;
/** A two-shot's closest scale: a medium shot, under the gate's 1.5x close-up. */
const TWO_SHOT_MAX = 1.4;
const TWO_HOLD = 1.6;
/** A zoom-out's pull back to the two-shot. */
const PULL = 1.6;
/** A wipe step. */
const WIPE_STEP = 0.9;
/** The parallax truck's scale: a medium shot, sharp on any picture. */
const TRUCK_SCALE = 1.32;
interface Timed {
  t: number;
  subject: number;
}

interface Ctx {
  cues: ReadonlyArray<{ t0: number; t1: number }>;
  subjects: readonly Box[];
  W: number;
  H: number;
  sMax: number;
  first: { t0: number; t1: number };
  last: { t0: number; t1: number };
  /** Home, with the reveal finished, before the settled end frame. */
  latest: number;
  /** Nothing moves before the establishing shot has been held. */
  earliest: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const HOME = { s: 1, x: 0, y: 0 };

/** The scene's shots on its clock, sorted; the default list when its own names no subject. */
function timedShots(
  shots: readonly Shot[],
  cues: ReadonlyArray<{ t0: number; t1: number }>,
  subjects: number,
): Timed[] {
  const n = cues.length;
  const valid = shots.filter(
    (s) =>
      Number.isInteger(s.cue) &&
      s.cue >= 1 &&
      s.cue <= n &&
      Number.isInteger(s.subject) &&
      s.subject >= 0 &&
      s.subject <= subjects &&
      Number.isFinite(s.at),
  );
  const list = valid.some((s) => s.subject > 0) ? valid : defaultShots(n, subjects);
  return list
    .map((s) => {
      const c = cues[s.cue - 1] as { t0: number; t1: number };
      // "at" is a share of the cue; past 1 it was written in seconds into the cue.
      const share = s.at > 1 ? s.at / Math.max(0.1, c.t1 - c.t0) : s.at;
      const at = Math.min(0.85, Math.max(0, share));
      return { t: c.t0 + at * (c.t1 - c.t0), subject: s.subject };
    })
    .sort((a, b) => a.t - b.t);
}

/** Each subject the shots name, once, in the order first named, with when. */
function named(timed: readonly Timed[]): Timed[] {
  const seen = new Set<number>();
  const out: Timed[] = [];
  for (const s of timed)
    if (s.subject > 0 && !seen.has(s.subject)) {
      seen.add(s.subject);
      out.push(s);
    }
  return out;
}

/** Where a framing points: the point at the centre of the view, as shares of the box (as the gate reads it). */
function aimOf(f: { s: number; x: number; y: number }, W: number, H: number): [number, number] {
  return [(W / 2 - f.x) / f.s / W, (H / 2 - f.y) / f.s / H];
}

/**
 * Two held shots whose aims are closer than this are one shot to the gate
 * (`SAME_SHOT` in src/verify/scenes.ts): a subject by the box's edge, framed
 * close, is held to the edge, and its neighbour's framing lands almost where
 * its own did.
 */
const APART = 0.13;

/**
 * The framings of subjects shot one after another (`keys`, 1-based), each
 * apart from the one before by `APART` where the box allows: two neighbours
 * whose close-ups land on nearly one view (a subject by the box's edge is held
 * to the edge) are each aimed off their centre, AWAY from the other, by up to
 * 0.45 of their width — the subject stays in view, and the move is one a viewer
 * sees. `sMin`/`sMax` as `frameOn`'s.
 */
function framesApart(
  keys: readonly number[],
  c: Ctx,
  sMin = CLOSE_MIN,
  sMax = c.sMax,
): Array<{ s: number; x: number; y: number }> {
  const box = (k: number) => c.subjects[k - 1] as Box;
  const out = keys.map((k) => frameOn(box(k), c.W, c.H, sMax, sMin));
  const dist = (f: { s: number; x: number; y: number }, g: { s: number; x: number; y: number }) => {
    const a = aimOf(f, c.W, c.H);
    const b = aimOf(g, c.W, c.H);
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  for (let i = 1; i < keys.length; i++) {
    const p = out[i - 1] as { s: number; x: number; y: number };
    const q = out[i] as { s: number; x: number; y: number };
    if (dist(p, q) >= APART) continue;
    const A = box(keys[i - 1] as number);
    const B = box(keys[i] as number);
    const dir = B.x + B.w / 2 >= A.x + A.w / 2 ? 1 : -1;
    for (const k of [0.15, 0.25, 0.35, 0.45]) {
      const pa = frameAt(A.x + A.w / 2 - dir * k * A.w, A.y + A.h / 2, p.s, c.W, c.H);
      const qa = frameAt(B.x + B.w / 2 + dir * k * B.w, B.y + B.h / 2, q.s, c.W, c.H);
      // The first of the pair moves only when it is not itself the one before's neighbour.
      if (i === 1 || dist(out[i - 2] as { s: number; x: number; y: number }, pa) >= APART)
        out[i - 1] = pa;
      out[i] = qa;
      if (dist(out[i - 1] as { s: number; x: number; y: number }, qa) >= APART) break;
    }
  }
  return out;
}

/** The subject whose centre is nearest `k`'s, left or right. */
function neighbour(k: number, subjects: readonly Box[]): number {
  const c = (b: Box) => b.x + b.w / 2;
  const me = subjects[k - 1] as Box;
  let best = 0;
  let d = Infinity;
  subjects.forEach((b, i) => {
    if (i + 1 === k) return;
    const dd = Math.abs(c(b) - c(me));
    if (dd < d) {
      d = dd;
      best = i + 1;
    }
  });
  return best;
}

function union(a: Box, b: Box): Box {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return {
    x: x0,
    y: y0,
    w: Math.max(a.x + a.w, b.x + b.w) - x0,
    h: Math.max(a.y + a.h, b.y + b.h) - y0,
  };
}

function move(
  t: number,
  dur: number,
  f: { s: number; x: number; y: number },
  ease: string,
  subject: number,
  kind: CamMove["kind"],
): CamMove {
  return { t: r2(t), dur, ...f, ease, subject, kind };
}

/** The reveal: back to the whole picture at the last cue, or once the last shot has been held. */
function reveal(moves: CamMove[], at: number, c: Ctx, dur = REVEAL, ease = "power2.inOut"): void {
  const cur = moves[moves.length - 1];
  if (!cur || (cur.s === 1 && cur.x === 0 && cur.y === 0)) return;
  const t = Math.min(c.latest, Math.max(c.last.t0, at));
  moves.push(move(t, dur, HOME, ease, 0, dur <= CUT ? "cut" : "reveal"));
}

/**
 * The named subjects' shot times, fitted to the scene: each as the voice names
 * it, but no earlier than the establishing shot or `gap` after the one before,
 * and early enough that every later one still fits before the reveal — a
 * subject named in the last second is shot a little early rather than not at
 * all (MEASURED 2026-10-10: short scenes naming their second subject late held
 * one push-in, and `shot_variety` sent them back). Subjects that cannot fit
 * even so are dropped from the end.
 */
export function scheduled(
  list: readonly Timed[],
  c: Pick<Ctx, "earliest" | "latest">,
  gap: number,
): Timed[] {
  for (let n = list.length; n > 0; n--) {
    const out: Timed[] = [];
    let lo = c.earliest;
    for (let i = 0; i < n; i++) {
      const hi = c.latest - gap * (n - i);
      if (hi < lo) break;
      const t = Math.min(hi, Math.max(lo, (list[i] as Timed).t));
      out.push({ t, subject: (list[i] as Timed).subject });
      lo = t + gap;
    }
    if (out.length === n) return out;
  }
  return [];
}

/** TOUR (round 4): establishing, a push in on each subject named, the reveal. */
function tour(timed: readonly Timed[], c: Ctx): CamMove[] {
  const moves: CamMove[] = [];
  let at = c.earliest;
  let current = 0;
  // A push is held a second after it lands: two of the camera's samples, which is what a shot is.
  const plan = scheduled(named(timed), c, MOVE + HELD);
  const frames = framesApart(
    plan.map((p) => p.subject),
    c,
  );
  for (const [i, s] of plan.entries()) {
    const t = Math.max(s.t, at);
    if (t > c.latest - MIN_HOLD) break;
    if (s.subject === current) continue;
    const f = frames[i] as { s: number; x: number; y: number };
    moves.push(move(t, MOVE, f, "power3.inOut", s.subject, s.subject === 0 ? "reveal" : "push"));
    current = s.subject;
    at = t + MOVE + HELD;
  }
  reveal(moves, at, c);
  return moves;
}

/**
 * FOLLOW: a push in on the first subject, then a slow track along the others at
 * one scale, each arriving as the voice names it. The track is the grammar, so
 * one is always made: when the voice names the next subject too late (or not
 * at all), the track starts early enough to arrive before the reveal.
 */
function follow(timed: readonly Timed[], c: Ctx): CamMove[] {
  const list = named(timed);
  if (list.length === 0) return tour(timed, c);
  if (list.length === 1 && c.subjects.length > 1) {
    const k = neighbour((list[0] as Timed).subject, c.subjects);
    list.push({ t: (list[0] as Timed).t + TRACK + 1, subject: k });
  }
  if (list.length < 2) return tour(timed, c);
  // One scale for the whole track: the closest every subject can be framed at.
  const s = Math.min(
    ...list.map((n) => frameOn(c.subjects[n.subject - 1] as Box, c.W, c.H, c.sMax).s),
  );
  const at0 = Math.min(c.first.t0 + 1.2, Math.max(c.first.t0, c.first.t1 - MOVE));
  // The push must leave room for one whole track and its hold before the reveal.
  const tPush = Math.min(
    Math.max((list[0] as Timed).t, at0),
    c.latest - 0.6 - TRACK_MIN - 0.6 - MOVE,
  );
  if (tPush < c.first.t0) return tour(timed, c);
  const moves: CamMove[] = [];
  const fr = framesApart(
    list.map((n) => n.subject),
    c,
    s,
    s,
  );
  const frame = (k: number) =>
    fr[list.findIndex((n) => n.subject === k)] as { s: number; x: number; y: number };
  moves.push(
    move(
      tPush,
      MOVE,
      frame((list[0] as Timed).subject),
      "power3.inOut",
      (list[0] as Timed).subject,
      "push",
    ),
  );
  let at = tPush + MOVE + 0.6;
  for (const n of list.slice(1)) {
    const tracked = moves.length > 1;
    // Arrive as the voice names it, never before a whole track, never after the reveal's room.
    const arrive = Math.min(c.latest - 0.6, Math.max(n.t + 0.3, at + TRACK_MIN));
    const start = Math.max(at, arrive - TRACK);
    if (arrive - start < TRACK_MIN - 1e-6) {
      if (tracked) break;
      continue;
    }
    moves.push(move(start, r2(arrive - start), frame(n.subject), "sine.inOut", n.subject, "track"));
    at = arrive + 0.6;
  }
  reveal(moves, at, c);
  return moves;
}

/**
 * RACK: A, a whip to B, back to A when there is time, then a two-shot holding
 * both, the reveal. The two-shot is what makes it a rack, so the holds shorten
 * (to `RACK_HOLD_MIN`) and B comes earlier before the two-shot is dropped.
 */
function rack(timed: readonly Timed[], c: Ctx): CamMove[] {
  const list = named(timed);
  if (list.length === 0 || c.subjects.length < 2) return tour(timed, c);
  const a = list[0] as Timed;
  const bk = list[1]?.subject ?? neighbour(a.subject, c.subjects);
  const A = c.subjects[a.subject - 1] as Box;
  const B = c.subjects[bk - 1] as Box;
  const [fa, fb] = framesApart([a.subject, bk], c) as [
    { s: number; x: number; y: number },
    { s: number; x: number; y: number },
  ];
  // The two-shot is a MEDIUM shot holding both: under the close-up scale.
  const both = frameOn(union(A, B), c.W, c.H, Math.min(c.sMax, TWO_SHOT_MAX), 1.12);
  const two = both.s < Math.min(fa.s, fb.s) - 0.05;
  // The room the sequence needs: push, hold, whip, hold, two-shot, its hold.
  const need = (h: number) => MOVE + h + WHIP + h + (two ? MOVE + TWO_HOLD : 0);
  const room = c.latest - c.earliest;
  const h = room >= need(MIN_HOLD) ? MIN_HOLD : RACK_HOLD_MIN;
  if (room < need(h)) return tour(timed, c);
  const ta = Math.min(Math.max(a.t, c.earliest), c.latest - need(h));
  const moves: CamMove[] = [move(ta, MOVE, fa, "power3.inOut", a.subject, "push")];
  const tb = Math.min(
    Math.max(list[1]?.t ?? ta + MOVE + h, ta + MOVE + h),
    c.latest - (need(h) - MOVE - h),
  );
  moves.push(move(tb, WHIP, fb, "power4.inOut", bk, "whip"));
  let at = tb + WHIP + h;
  const end = Math.min(c.latest, Math.max(c.last.t0, at));
  // Back to A, when it leaves the two-shot its room.
  if (end - at >= WHIP + h + (two ? MOVE + TWO_HOLD : 0)) {
    moves.push(move(at, WHIP, fa, "power4.inOut", a.subject, "whip"));
    at += WHIP + h;
  }
  if (two) {
    moves.push(
      move(Math.min(at, c.latest - MOVE - TWO_HOLD), MOVE, both, "power3.inOut", 0, "two-shot"),
    );
    at = Math.min(at, c.latest - MOVE - TWO_HOLD) + MOVE + TWO_HOLD;
  }
  reveal(moves, at, c);
  return moves;
}

/** ZOOM-OUT: opens close on the detail, pulls back to it and its neighbour, then to the whole. */
function zoomOut(timed: readonly Timed[], c: Ctx): { open: Staging["open"]; moves: CamMove[] } {
  const list = named(timed);
  const k = list[0]?.subject ?? 1;
  const K = c.subjects[k - 1] as Box;
  const open = { ...frameOn(K, c.W, c.H, c.sMax), subject: k };
  const moves: CamMove[] = [];
  const second = c.cues[1]?.t0 ?? c.first.t0 + (c.first.t1 - c.first.t0) / 2;
  const t1 = Math.max(second, c.first.t0 + 2.4);
  const nk = list[1]?.subject ?? neighbour(k, c.subjects);
  if (nk > 0 && t1 + PULL + MIN_HOLD <= c.latest) {
    const mid = frameOn(
      union(K, c.subjects[nk - 1] as Box),
      c.W,
      c.H,
      Math.max(1.12, Math.min(c.sMax, open.s - 0.3)),
      1.12,
    );
    if (mid.s < open.s - 0.1) moves.push(move(t1, PULL, mid, "power2.inOut", 0, "pull"));
  }
  const at = moves.length ? t1 + PULL + MIN_HOLD : c.first.t0 + 2.4;
  const t2 = Math.min(c.latest, Math.max(c.last.t0, at));
  moves.push(move(t2, PULL, HOME, "power2.inOut", 0, "reveal"));
  return { open, moves };
}

/** WIPE: the camera wide and creeping; the picture wiped on, subject by subject, as each is named. */
function wipe(timed: readonly Timed[], c: Ctx): { moves: CamMove[]; wipes: WipeStep[] } {
  const list = named(timed);
  const right = (k: number) => {
    const b = c.subjects[k - 1] as Box;
    return Math.min(1, (b.x + b.w) / c.W + 0.03);
  };
  const wipes: WipeStep[] = [];
  let share = 0;
  // The first subject comes on at the first cue, whenever the voice names it:
  // the picture is never blank for a whole cue.
  let at = c.first.t0 + 0.2;
  list.forEach((n, i) => {
    const t = i === 0 ? at : Math.max(n.t, at);
    if (t > c.last.t0 - WIPE_STEP) return;
    const target = Math.max(share, right(n.subject));
    if (target - share < 0.05) return;
    wipes.push({
      t: r2(t),
      dur: WIPE_STEP,
      share: Math.round(target * 1000) / 1000,
      subject: n.subject,
    });
    share = target;
    at = t + WIPE_STEP + 0.4;
  });
  if (share < 1)
    wipes.push({
      t: r2(Math.min(c.last.t0, Math.max(at, c.first.t0 + 0.2))),
      dur: WIPE_STEP,
      share: 1,
      subject: 0,
    });
  // A slow creep toward the middle of the subjects across the scene, home for the end.
  const t0 = c.first.t0 + 0.3;
  const tEnd = Math.min(c.latest, Math.max(c.last.t0, t0 + 2));
  const xs = c.subjects.map((b) => b.x + b.w / 2);
  const ys = c.subjects.map((b) => b.y + b.h / 2);
  const mid = frameAt(
    xs.reduce((a, v) => a + v, 0) / xs.length,
    ys.reduce((a, v) => a + v, 0) / ys.length,
    1.06,
    c.W,
    c.H,
  );
  const moves: CamMove[] = [];
  if (tEnd - t0 > 2) {
    moves.push(move(t0, r2(tEnd - t0 - 0.1), mid, "sine.inOut", 0, "creep"));
    moves.push(move(tEnd, REVEAL, HOME, "power2.inOut", 0, "reveal"));
  }
  return { moves, wipes };
}

/** CUTAWAY: wide, and a hard cut to a close insert on each subject named, back to the wide between. */
function cutaway(timed: readonly Timed[], c: Ctx): CamMove[] {
  const moves: CamMove[] = [];
  let at = c.earliest;
  let current = 0;
  let cutIn = 0;
  const plan = scheduled(named(timed), c, MIN_HOLD);
  const frames = framesApart(
    plan.map((p) => p.subject),
    c,
  );
  for (const [i, s] of plan.entries()) {
    const t = Math.max(s.t, at);
    if (t > c.latest - MIN_HOLD) break;
    // A long insert goes back to the wide before the next one: an insert, not a stay.
    if (current !== 0 && t - cutIn > 3.2 && cutIn + 2.2 <= t - 1.0) {
      moves.push(move(cutIn + 2.2, CUT, HOME, "none", 0, "cut"));
      current = 0;
    }
    const f = frames[i] as { s: number; x: number; y: number };
    moves.push(move(t, CUT, f, "none", s.subject, "cut"));
    current = s.subject;
    cutIn = t;
    at = t + MIN_HOLD;
  }
  if (current !== 0) reveal(moves, Math.max(at, cutIn + 2.2), c, CUT, "none");
  return moves;
}

/**
 * PARALLAX: a slow, continuous lateral truck at a medium scale across the
 * subjects, in one direction — from the side of the first one named — the
 * backdrop sliding slower behind them; then the whole picture at the last cue.
 */
function parallax(timed: readonly Timed[], c: Ctx): CamMove[] {
  const s = Math.min(c.sMax, TRUCK_SCALE);
  const cx = (b: Box) => b.x + b.w / 2;
  const list = named(timed);
  const xs = list.map((n) => cx(c.subjects[n.subject - 1] as Box));
  // The named subjects when they are spread out; else every subject, so the truck travels.
  const keys =
    list.length >= 2 && Math.max(...xs) - Math.min(...xs) >= 0.4 * c.W
      ? list.map((n) => n.subject)
      : c.subjects.map((_, i) => i + 1);
  const order = [...keys].sort(
    (a, b) => cx(c.subjects[a - 1] as Box) - cx(c.subjects[b - 1] as Box),
  );
  const first = c.subjects[(list[0]?.subject ?? order[0] ?? 1) - 1] as Box;
  if (cx(first) > c.W / 2) order.reverse();
  const cy = c.subjects.reduce((a, b) => a + b.y + b.h / 2, 0) / c.subjects.length;
  // The truck starts once the whole picture has been seen for a second, and ends at the reveal.
  const start = c.first.t0 + 1.0;
  const end = Math.min(c.latest, Math.max(c.last.t0, start + 3));
  if (end - start < 2.4 || order.length < 2) return tour(timed, c);
  const moves: CamMove[] = [];
  const legs = order.length;
  let from = start;
  order.forEach((k, i) => {
    const b = c.subjects[k - 1] as Box;
    const arrive = start + ((end - 0.1 - start) * (i + 1)) / legs;
    moves.push(
      move(
        from,
        r2(arrive - from),
        frameAt(cx(b), cy, s, c.W, c.H),
        i === 0 ? "sine.in" : i === legs - 1 ? "sine.out" : "none",
        k,
        "track",
      ),
    );
    from = r2(arrive + 0.05);
  });
  moves.push(move(end, REVEAL, HOME, "power2.inOut", 0, "reveal"));
  return moves;
}

/**
 * The camera of one illustrated scene in its grammar. `cues` on the scene's
 * clock; `duration` the scene's length (the end frame is photographed at
 * `duration - 0.5`); `sMax` the picture's sharpness ceiling (`sharpMax`).
 */
export function compileStaging(
  grammar: Grammar,
  shots: readonly Shot[],
  cues: ReadonlyArray<{ t0: number; t1: number }>,
  duration: number,
  subjects: readonly Box[],
  W: number,
  H: number,
  sMax = CAMERA_MAX_SCALE,
): Staging {
  const empty: Staging = { grammar, open: HOME, moves: [], wipes: [] };
  const n = cues.length;
  if (n === 0 || subjects.length === 0) return empty;
  const first = cues[0] as { t0: number; t1: number };
  const c: Ctx = {
    cues,
    subjects,
    W,
    H,
    // A held shot creeps 3% closer (`cameraScript`): its framing leaves that room
    // under the sharpness ceiling (MEASURED 2026-10-10: one scene's creep took it
    // to 0.58 picture px per output px against the 0.6 bar). But a push-in is
    // never framed under `PUSH_FLOOR`: on a picture too coarse for a sharp 1.5x
    // (a 1536x1024 one, k 1.1) the staging wins over the last few hundredths of
    // sharpness, and the report says how sharp it was (`effectiveAt`).
    sMax: sMax <= 1 ? 1 : Math.max(Math.min(PUSH_FLOOR, sMax), sMax / CREEP),
    first,
    last: cues[n - 1] as { t0: number; t1: number },
    latest: Math.max(0, duration - 0.6 - REVEAL),
    earliest: Math.min(first.t0 + ESTABLISH, Math.max(first.t0, first.t1 - MOVE)),
  };
  const timed = timedShots(shots, cues, subjects.length);
  switch (grammar) {
    case "follow":
      return { ...empty, moves: follow(timed, c) };
    case "rack":
      return { ...empty, moves: rack(timed, c) };
    case "zoom-out":
      return { ...empty, ...zoomOut(timed, c) };
    case "wipe":
      return { ...empty, ...wipe(timed, c) };
    case "cutaway":
      return { ...empty, moves: cutaway(timed, c) };
    case "parallax":
      return { ...empty, moves: parallax(timed, c) };
    default:
      return { ...empty, moves: tour(timed, c) };
  }
}

/** Round 4's one grammar, `tour`: the moves alone. */
export function compileShots(
  shots: readonly Shot[],
  cues: ReadonlyArray<{ t0: number; t1: number }>,
  duration: number,
  subjects: readonly Box[],
  W: number,
  H: number,
  sMax = CAMERA_MAX_SCALE,
): CamMove[] {
  return compileStaging("tour", shots, cues, duration, subjects, W, H, sMax).moves;
}

/** The closest the camera gets in a staging (the open frame included). */
export function closest(st: Pick<Staging, "open" | "moves">): number {
  return Math.max(st.open.s, ...st.moves.map((m) => m.s));
}

/**
 * ROUND 6: a depth plane's framing for a camera framing (src/bespoke/depth.ts).
 *
 * The camera's framing `f` is of the subjects' plane (distance 1): scale `s`
 * and offset `x, y` with origin 0 0, which is what `#sid-cam` is given. Read as
 * a pinhole camera looking at the frame's centre `c`, that framing is a dolly
 * `tz = 1 - 1/s` and a truck `f·t = (c(1-s) - x) / s`. A plane at distance `z`
 * then projects EXACTLY to scale `s_z = z / (z - tz)` and offset
 * `c(1 - s_z) - f·t·s_z / z` — so a farther plane zooms and slides less, a
 * nearer one more: parallax with no approximation (a multiplane image is a
 * stack of homographies, and for fronto-parallel planes those are scale +
 * offset). `z = 1` returns `f` itself.
 *
 * NO PLANE EVER NEEDS ENLARGING TO COVER THE FRAME. A plane's left edge lands
 * at or left of the frame's exactly when `x <= 0` — the camera's own framing
 * covers the box — whatever the plane's distance: substituting `s_z` and `f·t`,
 * `x_z <= 0` reduces to `x / (s·z) <= 0`. The same holds at every edge, so the
 * shell's framings (held to the box by `frameAt`) cover with every plane.
 * (Round 6's first cut carried an overscan search; it never returned more than
 * 1, and a reversed copy of it was caught by nothing — so it is gone, and the
 * test holds this property instead.)
 */
export function planeFrame(
  f: { s: number; x: number; y: number },
  z: number,
  W: number,
  H: number,
): { s: number; x: number; y: number } {
  const s = Math.max(1e-3, f.s);
  const tz = 1 - 1 / s;
  const sz = z / Math.max(1e-3, z - tz);
  const cx = W / 2;
  const cy = H / 2;
  const ftx = (cx * (1 - s) - f.x) / s;
  const fty = (cy * (1 - s) - f.y) / s;
  const x = cx * (1 - sz) - (ftx * sz) / z;
  const y = cy * (1 - sz) - (fty * sz) / z;
  return {
    s: Math.round(sz * 10000) / 10000,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
  };
}

/**
 * RACK FOCUS (round 6): what tells the audience where to look, instead of a
 * label plate. A plane at distance `z` is blurred by how far it sits from the
 * plane in focus, in dioptres (|1/z - 1/zf|, as a lens's circle of confusion
 * grows), more in a close shot than in the whole view (a longer lens has less
 * depth of field). px at the plane's own scale.
 */
export const BLUR_WIDE = 3.5;
export const BLUR_CLOSE = 5;
export const BLUR_MAX = 6;

export function blurAt(z: number, focusZ: number, s: number): number {
  const k = BLUR_WIDE + BLUR_CLOSE * Math.min(1, Math.max(0, (s - 1) / 0.6));
  const b = Math.abs(1 / z - 1 / focusZ) * k;
  return Math.round(Math.min(BLUR_MAX, b) * 100) / 100;
}

/**
 * The blur as the deck draws it: the opacity of the plane's out-of-focus twin
 * (src/bespoke/sheet.ts, blurred `BLUR_MAX`px) over the sharp plane. A CSS
 * blur tween cost ~1.5s a frame in the gates' browser; a cross-fade costs
 * nothing measurable.
 */
export function softAt(z: number, focusZ: number, s: number): number {
  return Math.round(Math.min(1, blurAt(z, focusZ, s) / BLUR_MAX) * 1000) / 1000;
}

/** What `cameraScript` moves besides the camera in a depth-staged scene (round 6). */
export interface DepthStage {
  /** Backdrop planes, far to near: `#sid-plate` is the farthest, `#sid-planeN` the rest. */
  planes: ReadonlyArray<{ z: number }>;
  /** The subjects' planes `#sid-subjK` (K 1-based), with their distances. */
  subjects: ReadonlyArray<{ subject: number; z: number; box: Box }>;
  /** The scene's length: the light's sweep and the subjects' breathing end before it. */
  duration: number;
}

/** The element id of backdrop plane `i` (far to near). The farthest keeps round 5's `-plate`. */
export function planeId(sid: string, i: number): string {
  return i === 0 ? `${sid}-plate` : `${sid}-plane${i}`;
}

/** The element id of subject `k`'s plane (1-based). Not `-sK`: a scene's own ids use that. */
export function subjectId(sid: string, k: number): string {
  return `${sid}-subj${k}`;
}

/**
 * The camera as GSAP source, for the shell to put before the scene's own
 * script. Every tween is a `fromTo` with explicit from-values and
 * `immediateRender:false`, so a frame never depends on seek history. Between
 * two moves the held shot creeps `CREEP` further in about the point at the
 * centre of the view (x' = W/2 - (W/2 - x)·k), so a hold is never a still
 * frame; the next move starts from where the creep ended. Nothing moves after
 * the reveal: the end frame is the whole picture, exactly home.
 *
 * ROUND 6, with depth planes (`depth`): every camera tween has a twin on each
 * plane at `planeFrame` of its values for the plane's distance — the
 * parallax — with the plane's blur racked to the subject framed (`blurAt`);
 * the light sweeps once; the subjects breathe; and wipe steps light the
 * subjects in turn instead of uncovering a clip.
 */
export function cameraScript(
  sid: string,
  moves: readonly CamMove[],
  W: number,
  H: number,
  opts: {
    open?: { s: number; x: number; y: number; subject?: number };
    wipes?: readonly WipeStep[];
    /** Round 6: the depth planes that move with the camera, each at its own distance. */
    depth?: DepthStage;
  } = {},
): string {
  const cam = JSON.stringify(`#${sid}-cam`);
  const open: { s: number; x: number; y: number; subject?: number } = opts.open ?? HOME;
  const depth = opts.depth;
  const v = (f: { s: number; x: number; y: number }) => `scale: ${f.s}, x: ${f.x}, y: ${f.y}`;
  const lines: string[] = [
    "// The shell's camera (src/bespoke/shots.ts, grammar in src/bespoke/grammar.ts).",
    `gsap.set(${cam}, { ${v(open)}, transformOrigin: "0 0" });`,
  ];
  const crept = (f: { s: number; x: number; y: number }) => ({
    s: Math.round(f.s * CREEP * 1000) / 1000,
    x: Math.round(W / 2 - (W / 2 - f.x) * CREEP),
    y: Math.round(H / 2 - (H / 2 - f.y) * CREEP),
  });
  type Leg = {
    from: { s: number; x: number; y: number };
    to: { s: number; x: number; y: number };
    dur: number;
    ease: string;
    at: number;
    /** The subject in focus before and after: 0 is the whole picture (the subjects' plane). */
    f0: number;
    f1: number;
  };
  const legs: Leg[] = [];
  {
    let from = { s: open.s, x: open.x, y: open.y };
    let focus = open.subject ?? 0;
    let free = 0;
    for (const m of moves) {
      // The creep ENDS a beat before the move starts: two tweens on one property
      // that touch at an instant are an overlap the linter flags and a frame
      // whose value depends on which rendered last (MEASURED 2026-10-09: 1.5k-1.8k px
      // seek_order on four of five drafts while they touched).
      const start = Math.ceil((free + (free > 0 ? CREEP_GAP : 0)) * 100) / 100;
      const hold = Math.floor((m.t - CREEP_GAP - start) * 100) / 100;
      if (hold > 0.6) {
        const to = crept(from);
        legs.push({ from, to, dur: hold, ease: "sine.inOut", at: start, f0: focus, f1: focus });
        from = to;
      }
      legs.push({ from, to: m, dur: m.dur, ease: m.ease, at: m.t, f0: focus, f1: m.subject });
      from = { s: m.s, x: m.x, y: m.y };
      focus = m.subject;
      free = m.t + m.dur;
    }
  }
  for (const l of legs)
    lines.push(
      `tl.fromTo(${cam}, { ${v(l.from)} }, { ${v({ s: l.to.s, x: l.to.x, y: l.to.y })}, duration: ${l.dur}, ease: "${l.ease}", immediateRender: false }, ${l.at});`,
    );
  if (depth) {
    const zOfSubject = (k: number) => depth.subjects.find((s) => s.subject === k)?.z ?? 1;
    const layers = [
      ...depth.planes.map((p, i) => ({ id: planeId(sid, i), z: p.z })),
      ...depth.subjects.map((p) => ({ id: subjectId(sid, p.subject), z: p.z })),
    ];
    const soft = (z: number, focus: number, s: number) =>
      softAt(z, focus ? zOfSubject(focus) : 1, s);
    lines.push(
      "// Round 6: the picture's depth planes, each moved as the camera sees it at its own distance (planeFrame), focus racked to the subject framed (softAt: each plane's out-of-focus twin fades in by its distance from the plane in focus).",
    );
    for (const L of layers) {
      lines.push(
        `gsap.set(${JSON.stringify(`#${L.id}`)}, { ${v(planeFrame(open, L.z, W, H))}, transformOrigin: "0 0" });`,
      );
      lines.push(
        `gsap.set(${JSON.stringify(`#${L.id}-soft`)}, { opacity: ${soft(L.z, open.subject ?? 0, open.s)} });`,
      );
    }
    for (const l of legs)
      for (const L of layers) {
        lines.push(
          `tl.fromTo(${JSON.stringify(`#${L.id}`)}, { ${v(planeFrame(l.from, L.z, W, H))} }, { ${v(planeFrame(l.to, L.z, W, H))}, duration: ${l.dur}, ease: "${l.ease}", immediateRender: false }, ${l.at});`,
        );
        const a = soft(L.z, l.f0, l.from.s);
        const b = soft(L.z, l.f1, l.to.s);
        if (a !== b)
          lines.push(
            `tl.fromTo(${JSON.stringify(`#${L.id}-soft`)}, { opacity: ${a} }, { opacity: ${b}, duration: ${l.dur}, ease: "${l.ease}", immediateRender: false }, ${l.at});`,
          );
      }
    // THE LIGHT: one slow sweep across the frame, over the whole scene, ending
    // where it rests for the settled frame.
    const end = Math.max(1, Math.round((depth.duration - 0.6) * 100) / 100);
    lines.push(
      `tl.fromTo(${JSON.stringify(`#${sid}-light`)}, { x: ${Math.round(-0.45 * W)} }, { x: ${Math.round(0.55 * W)}, duration: ${end}, ease: "none", immediateRender: false }, 0);`,
    );
    // THE SUBJECTS BREATHE: each drifts a few px up and back at its own period,
    // an even number of legs so it is home again before the settled frame.
    for (const [i, p] of depth.subjects.entries()) {
      const period = Math.round((2.2 + 0.45 * i) * 100) / 100;
      const legsN = 2 * Math.floor(end / (2 * period));
      if (legsN < 2) continue;
      const lift = Math.max(3, Math.min(9, Math.round(p.box.h * 0.012)));
      lines.push(
        `tl.fromTo(${JSON.stringify(`#${subjectId(sid, p.subject)} > .ds-life`)}, { y: 0 }, { y: ${-lift}, duration: ${period}, ease: "sine.inOut", repeat: ${legsN - 1}, yoyo: true, immediateRender: false }, 0);`,
      );
    }
  }
  if (opts.wipes?.length && depth) {
    // A "wipe" in depth is a REVEAL BY LIGHT: the subjects stand in the
    // backdrop as dim shapes from the first frame — the scene is never empty —
    // and each is lit in turn as the voice reaches it.
    const dark = 0.18;
    for (const p of depth.subjects)
      lines.push(
        `gsap.set(${JSON.stringify(`#${subjectId(sid, p.subject)} > .ds-life`)}, { opacity: ${dark} });`,
      );
    // A step reaches `share` of the box from the left, as round 5's wipe did:
    // it lights every subject it has reached, so the last step (share 1) lights
    // them all. MEASURED 2026-10-10: lighting only the subject a step named left
    // half of one picture's subjects dark at the end (en r6a s4, 50% lit).
    const done = new Set<number>();
    for (const st of opts.wipes) {
      const lit = depth.subjects.filter(
        (p) =>
          !done.has(p.subject) &&
          (p.subject === st.subject || (p.box.x + p.box.w) / W <= st.share + 0.031),
      );
      for (const p of lit) done.add(p.subject);
      for (const p of lit)
        lines.push(
          `tl.fromTo(${JSON.stringify(`#${subjectId(sid, p.subject)} > .ds-life`)}, { opacity: ${dark} }, { opacity: 1, duration: ${st.dur}, ease: "power2.inOut", immediateRender: false }, ${st.t});`,
        );
    }
  }
  return lines.join("\n");
}

/** What a scene's camera does, for the report and the prompt: one word per move. */
export function shotSummary(
  moves: readonly CamMove[],
  grammar?: string,
  open?: { s: number },
): string {
  const head = open && open.s > 1 ? `close@${open.s}` : "wide";
  const body = [
    head,
    ...moves.map((m) =>
      m.subject === 0
        ? m.kind === "two-shot" || m.kind === "pull"
          ? `${m.kind}@${m.s}`
          : m.kind === "creep"
            ? "creep"
            : "wide"
        : `${m.kind ?? "push"} S${m.subject}@${m.s}`,
    ),
  ].join(" → ");
  return grammar ? `${grammar}: ${body}` : body;
}
