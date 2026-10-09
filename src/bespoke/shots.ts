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

/** How a scene's shots are staged: `tour` establishes wide first; `close-open` opens close. */
export type Grammar = "tour" | "close-open";

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
  /** The subject framed (0 = the whole picture). */
  subject: number;
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
const CREEP = 1.03;
/** Seconds between a creep's end and the next move's start. */
const CREEP_GAP = 0.05;

/**
 * The band at the top of an illustrated scene's box that the picture leaves
 * clear: the subjects' labels go above them (src/bespoke/callouts.ts), and a
 * picture that covered the whole box put its subjects' heads at its top edge,
 * where the only room for a label was across the subject's face (round 4's
 * first full run, en s2: "observations" over a robot's eyes).
 */
export const ART_BAND = 120;

/** Where the picture sits in the body box: under the band, covering the rest. */
export function artPlacement(box: { width: number; height: number }): Box {
  return { x: 0, y: ART_BAND, w: box.width, h: Math.max(1, box.height - ART_BAND) };
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

/** The inverse of `subjectsInBox` for boxes inside the placement: box px back to shares of the picture. */
export function unitsInPicture(
  boxes: readonly Box[],
  art: { width: number; height: number },
  box: { width: number; height: number },
): UnitBox[] {
  const at = artPlacement(box);
  const k = Math.max(at.w / art.width, at.h / art.height);
  const ox = at.x + (at.w - art.width * k) / 2;
  const oy = at.y + (at.h - art.height * k) / 2;
  return boxes.map((b) => [
    (b.x - ox) / k / art.width,
    (b.y - oy) / k / art.height,
    b.w / k / art.width,
    b.h / k / art.height,
  ]);
}

/** The camera's scale and offset that frame `b` (origin 0 0), held to the box's edges. */
export function frameOn(b: Box, W: number, H: number): { s: number; x: number; y: number } {
  const padX = Math.max(40, 0.15 * b.w);
  const padY = Math.max(40, 0.15 * b.h);
  const fit = Math.min(W / (b.w + 2 * padX), H / (b.h + 2 * padY));
  const s = Math.min(CAMERA_MAX_SCALE, Math.max(CLOSE_MIN, fit));
  const cx = b.x + b.w / 2;
  // Too tall to frame whole at a close scale: frame its TOP — the label above a
  // subject and the head of a figure — not its middle.
  const cy = fit < CLOSE_MIN ? b.y - 12 + H / (2 * s) : b.y + b.h / 2;
  const clamp = (v: number, lo: number) => Math.min(0, Math.max(lo, v));
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    s: r(s),
    x: Math.round(clamp(W / 2 - cx * s, W - W * s)),
    y: Math.round(clamp(H / 2 - cy * s, H - H * s)),
  };
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
  for (let c = 2; c < cues; c++) out.push({ cue: c, at: 0, subject: ((c - 2) % subjects) + 1 });
  return out;
}

/**
 * The camera moves for one scene. `cues` on the scene's clock; `duration` the
 * scene's length (the end frame is photographed at `duration - 0.5`).
 */
export function compileShots(
  shots: readonly Shot[],
  cues: ReadonlyArray<{ t0: number; t1: number }>,
  duration: number,
  subjects: readonly Box[],
  W: number,
  H: number,
  grammar: Grammar = "tour",
): CamMove[] {
  const n = cues.length;
  if (n === 0 || subjects.length === 0) return [];
  const valid = shots.filter(
    (s) =>
      Number.isInteger(s.cue) &&
      s.cue >= 1 &&
      s.cue <= n &&
      Number.isInteger(s.subject) &&
      s.subject >= 0 &&
      s.subject <= subjects.length &&
      Number.isFinite(s.at),
  );
  const list = valid.some((s) => s.subject > 0) ? valid : defaultShots(n, subjects.length);
  const first = cues[0] as { t0: number; t1: number };
  const last = cues[n - 1] as { t0: number; t1: number };
  // Home, with the reveal finished, before the settled end frame.
  const latest = Math.max(0, duration - 0.6 - REVEAL);
  const timed = list
    .map((s) => {
      const c = cues[s.cue - 1] as { t0: number; t1: number };
      // "at" is a share of the cue; past 1 it was written in seconds into the cue.
      const share = s.at > 1 ? s.at / Math.max(0.1, c.t1 - c.t0) : s.at;
      const at = Math.min(0.85, Math.max(0, share));
      return { t: c.t0 + at * (c.t1 - c.t0), subject: s.subject };
    })
    .sort((a, b) => a.t - b.t);
  // 1. Establishing: nothing moves before it has been held.
  const earliest = Math.min(first.t0 + ESTABLISH, Math.max(first.t0, first.t1 - MOVE));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const moves: CamMove[] = [];
  let at = earliest;
  let current = 0;
  if (grammar === "close-open") {
    // The opening shot: close on the first subject a shot names, from t=0 (a
    // move of no duration, which `cameraScript` writes as the camera's set).
    const open = timed.find((s) => s.subject > 0)?.subject ?? 1;
    moves.push({
      t: 0,
      dur: 0,
      ...frameOn(subjects[open - 1] as Box, W, H),
      ease: "none",
      subject: open,
    });
    current = open;
    at = first.t0 + Math.max(MIN_HOLD, ESTABLISH);
  }
  for (const s of timed) {
    const t = Math.max(s.t, at);
    if (t > latest - MIN_HOLD) break;
    if (s.subject === current) continue;
    const f =
      s.subject === 0 ? { s: 1, x: 0, y: 0 } : frameOn(subjects[s.subject - 1] as Box, W, H);
    moves.push({ t: r2(t), dur: MOVE, ...f, ease: "power3.inOut", subject: s.subject });
    current = s.subject;
    at = t + Math.max(MIN_HOLD, MOVE + 0.5);
  }
  // 4. The reveal: at the last cue, or once the last push has been held.
  if (current !== 0) {
    const t = Math.min(latest, Math.max(last.t0, at));
    moves.push({ t: r2(t), dur: REVEAL, s: 1, x: 0, y: 0, ease: "power2.inOut", subject: 0 });
  }
  return moves;
}

/**
 * The camera as GSAP source, for the shell to put before the scene's own
 * script. Every tween is a `fromTo` with explicit from-values and
 * `immediateRender:false`, so a frame never depends on seek history. Between
 * two moves the held shot creeps `CREEP` further in about the point at the
 * centre of the view (x' = W/2 - (W/2 - x)·k), so a hold is never a still
 * frame; the next move starts from where the creep ended. Nothing moves after
 * the reveal: the end frame is the whole picture, exactly home.
 */
export function cameraScript(sid: string, moves: readonly CamMove[], W: number, H: number): string {
  const cam = JSON.stringify(`#${sid}-cam`);
  // `close-open`: the opening shot is where the camera starts, not a move.
  const open = moves[0]?.dur === 0 ? moves[0] : undefined;
  const v = (f: { s: number; x: number; y: number }) => `scale: ${f.s}, x: ${f.x}, y: ${f.y}`;
  const lines = [
    "// The shell's camera (src/bespoke/shots.ts): establishing, push in, reveal.",
    `gsap.set(${cam}, { ${v(open ?? { s: 1, x: 0, y: 0 })}, transformOrigin: "0 0" });`,
  ];
  const crept = (f: { s: number; x: number; y: number }) => ({
    s: Math.round(f.s * CREEP * 1000) / 1000,
    x: Math.round(W / 2 - (W / 2 - f.x) * CREEP),
    y: Math.round(H / 2 - (H / 2 - f.y) * CREEP),
  });
  let from = open ? { s: open.s, x: open.x, y: open.y } : { s: 1, x: 0, y: 0 };
  let free = 0;
  for (const m of open ? moves.slice(1) : moves) {
    // The creep ENDS a beat before the move starts: two tweens on one property
    // that touch at an instant are an overlap the linter flags and a frame
    // whose value depends on which rendered last (MEASURED 2026-10-09: 1.5k-1.8k px
    // seek_order on four of five drafts while they touched).
    const start = Math.ceil((free + (free > 0 ? CREEP_GAP : 0)) * 100) / 100;
    const hold = Math.floor((m.t - CREEP_GAP - start) * 100) / 100;
    if (hold > 0.6) {
      const to = crept(from);
      lines.push(
        `tl.fromTo(${cam}, { ${v(from)} }, { ${v(to)}, duration: ${hold}, ease: "sine.inOut", immediateRender: false }, ${start});`,
      );
      from = to;
    }
    lines.push(
      `tl.fromTo(${cam}, { ${v(from)} }, { ${v(m)}, duration: ${m.dur}, ease: "${m.ease}", immediateRender: false }, ${m.t});`,
    );
    from = { s: m.s, x: m.x, y: m.y };
    free = m.t + m.dur;
  }
  return lines.join("\n");
}

/** What a scene's camera does, for the report and the prompt: one word per move. */
export function shotSummary(moves: readonly CamMove[]): string {
  const shot = (m: CamMove) => (m.subject === 0 ? "wide" : `S${m.subject}@${m.s}`);
  return (moves[0]?.dur === 0 ? moves.map(shot) : ["wide", ...moves.map(shot)]).join(" → ");
}
