/**
 * Deterministic repair of a generated scene the gates refused for a reason a
 * person would fix by hand in seconds — instead of throwing the scene away.
 *
 * ROUND 2 LOST 4 OF 21 BEATS to `text_overlap` / `graphic_crosses_text` after
 * the critique round: big type collides more, and a model fixing one collision
 * by rewriting coordinates makes the next one. Round 2 also kept three scenes
 * that ended on a frame of ghosts. None of that needs another model call:
 *
 *  - LABEL COLLISIONS are solved as constraint relaxation over the frames the
 *    probe measured. Each colliding label's unit — the `<text>`, or the
 *    smallest `<g>` holding it with its plate and no other label — gets ONE
 *    constant offset, the smallest (in rings of `STEP` px, sixteen directions
 *    in a fixed order) that clears every other label by `LABEL_GAP`, every
 *    stroke sample by `STROKE_GAP`, every shape painted over it, and stays in
 *    the box, at EVERY measured frame, with the camera's scale at each frame
 *    applied. The offset becomes a wrapping `<g transform="translate()">` in
 *    the markup, so the scene's own tweens on the unit are untouched.
 *  - A DIMMED END (`end_dimmed`): the elements dimming parts the scene had lit
 *    are tweened back to opacity 1 just before the scene ends.
 *  - A CAMERA LEFT ZOOMED (`camera_end`): the camera is tweened home.
 *
 * Every repair is appended as ordinary contract code (a `tl.to` with literal
 * vars at a literal second, or a wrapper `<g>`), goes through `checkFragment`
 * like a model's, and is gated again before it is used. Deterministic: the same
 * geometry gives the same bytes, so a repaired scene caches like any other.
 */
import type { Geo, Layout } from "../verify/scenes.js";
import { type Fragment, SID_TOKEN } from "./contract.js";
import { untangle } from "./untangle.js";

/** Error rules this module can fix. A scene failing anything else is not repaired. */
export const REPAIRABLE = new Set([
  "graphic_crosses_text",
  "text_overlap",
  // verify's own SVG-label overprint: the same collision, seen by another gate.
  "svg_text_overprint",
  "end_dimmed",
  "camera_end",
  // Two tweens on one property over overlapping time (src/bespoke/untangle.ts).
  "seek_order",
]);

/** Clearance a moved label keeps from every other label, px. */
export const LABEL_GAP = 16;
/** Clearance from every visible stroke sample, px. */
export const STROKE_GAP = 10;
/** Ring step, px. */
export const STEP = 8;
/**
 * The farthest a label may move: its own height times this, at least
 * `MIN_REACH` px. A nudge, not a relocation — MEASURED 2026-10-09 with a flat
 * 320px reach, the solver cleared a two-line label's overlap by carrying its
 * second line onto the illustration, away from its plate: every gate passed and
 * the label no longer read as one. A collision that needs more than this is the
 * critique round's to redesign.
 */
export const REACH = 0.8;
export const MIN_REACH = 32;

/** The `error <rule>:` lines of a gate's findings, by rule. */
export function errorRules(findings: readonly string[]): string[] {
  return [
    ...new Set(
      findings.map((f) => /^error ([\w-]+):/.exec(f)?.[1]).filter((r): r is string => !!r),
    ),
  ];
}

/** Whether every error in `findings` is one this module can fix (and there is one). */
export function repairable(findings: readonly string[]): boolean {
  const rules = errorRules(findings);
  return rules.length > 0 && rules.every((r) => REPAIRABLE.has(r));
}

/* ----------------------------------------------------------------- geometry */

type Box = [number, number, number, number];

/** One unit's offset, in the units of the unit's parent (screen px / its scale). */
export interface Move {
  u: string;
  dx: number;
  dy: number;
}

const overlapOf = (a: Box, b: Box): [number, number] => [
  Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]),
  Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]),
];
const contains = (outer: Box, inner: Box) =>
  outer[0] <= inner[0] + 1 &&
  outer[1] <= inner[1] + 1 &&
  outer[0] + outer[2] >= inner[0] + inner[2] - 1 &&
  outer[1] + outer[3] >= inner[1] + inner[3] - 1;
const shifted = (b: Box, dx: number, dy: number): Box => [b[0] + dx, b[1] + dy, b[2], b[3]];

/** Directions tried at each ring, in this order: vertical first (labels sit in rows), then sideways, then between. */
const ANGLES = [
  -90, 90, 180, 0, -135, -45, 135, 45, -112.5, -67.5, 112.5, 67.5, -157.5, -22.5, 157.5, 22.5,
];

/**
 * Offsets that clear every collision in `frames`, or the units it could not
 * clear. Pure: the probe measured `frames` (src/verify/scenes.ts, `geo`).
 */
export function solveNudges(frames: readonly Geo[]): { moves: Move[]; unresolved: string[] } {
  const moves = new Map<string, [number, number]>();
  const scaleIn = frames.map((f) => {
    const m = new Map<string, number>();
    for (const l of f.labels) if (l.u) m.set(l.u, l.s);
    return m;
  });
  const off = (fi: number, u: string | null): [number, number] => {
    if (!u) return [0, 0];
    const d = moves.get(u);
    if (!d) return [0, 0];
    const s = scaleIn[fi]?.get(u) ?? 1;
    return [d[0] * s, d[1] * s];
  };

  /** What `label` (at frame fi, offset by its unit's move, or by `trial`) collides with. */
  const clashes = (
    fi: number,
    li: number,
    trial?: [number, number],
  ): Array<{ kind: "label" | "stroke" | "shape"; other?: number }> => {
    const f = frames[fi] as Geo;
    const L = f.labels[li] as Geo["labels"][number];
    const strict = trial === undefined;
    const [ox, oy] = trial ?? off(fi, L.u);
    const box = shifted(L.b, ox, oy);
    const out: Array<{ kind: "label" | "stroke" | "shape"; other?: number }> = [];
    f.labels.forEach((M, mi) => {
      if (mi === li || (L.u !== null && M.u === L.u)) return;
      const [mx, my] = off(fi, M.u);
      const [ix, iy] = overlapOf(box, shifted(M.b, mx, my));
      if (strict ? ix > 4 && iy > 4 : ix > -LABEL_GAP && iy > -LABEL_GAP)
        out.push({ kind: "label", other: mi });
    });
    const inset = strict ? 4 : -STROKE_GAP;
    for (const [px, py, pu] of f.points) {
      if (L.u !== null && pu === L.u) continue;
      const [qx, qy] = off(fi, pu);
      const x = px + qx;
      const y = py + qy;
      if (
        x > box[0] + inset &&
        x < box[0] + box[2] - inset &&
        y > box[1] + inset &&
        y < box[1] + box[3] - inset
      ) {
        out.push({ kind: "stroke" });
        break;
      }
    }
    for (const B of f.boxes) {
      if ((L.u !== null && B.u === L.u) || B.o <= L.o) continue;
      const [bx, by] = off(fi, B.u);
      const bb = shifted(B.b, bx, by);
      if (contains(bb, box)) continue; // its plate
      const [ix, iy] = overlapOf(bb, box);
      if (strict ? ix > 4 && iy > 4 && ix * iy > 0.15 * box[2] * box[3] : ix > 0 && iy > 0) {
        out.push({ kind: "shape" });
        break;
      }
    }
    return out;
  };

  /** A unit's own strokes and shapes, moved by `d`, must not land on another label either. */
  const carried = (fi: number, u: string, d: [number, number]): boolean => {
    const f = frames[fi] as Geo;
    const s = scaleIn[fi]?.get(u) ?? 1;
    const [dx, dy] = [d[0] * s, d[1] * s];
    for (const M of f.labels) {
      if (M.u === u) continue;
      const [mx, my] = off(fi, M.u);
      const mb = shifted(M.b, mx, my);
      for (const [px, py, pu] of f.points)
        if (pu === u) {
          const x = px + dx;
          const y = py + dy;
          if (x > mb[0] + 4 && x < mb[0] + mb[2] - 4 && y > mb[1] + 4 && y < mb[1] + mb[3] - 4)
            return true;
        }
      for (const B of f.boxes)
        if (B.u === u && B.o > M.o) {
          const bb = shifted(B.b, dx, dy);
          if (contains(bb, mb)) continue;
          const [ix, iy] = overlapOf(bb, mb);
          if (ix > 0 && iy > 0) return true;
        }
    }
    return false;
  };

  /** Every (frame, label index) belonging to unit `u`. */
  const ofUnit = (u: string) =>
    frames.flatMap((f, fi) =>
      f.labels.flatMap((l, li) => (l.u === u ? [[fi, li] as [number, number]] : [])),
    );

  /** Whether moving `u` by `d` (parent units) is clear at every frame. */
  const clear = (u: string, d: [number, number]): boolean => {
    for (const [fi, li] of ofUnit(u)) {
      const f = frames[fi] as Geo;
      const L = f.labels[li] as Geo["labels"][number];
      const s = L.s || 1;
      const t: [number, number] = [d[0] * s, d[1] * s];
      const was = L.b;
      const inBox = was[0] >= 0 && was[1] >= 0 && was[0] + was[2] <= f.w && was[1] + was[3] <= f.h;
      const nb = shifted(was, t[0], t[1]);
      if (inBox && (nb[0] < 4 || nb[1] < 4 || nb[0] + nb[2] > f.w - 4 || nb[1] + nb[3] > f.h - 4))
        return false;
      if (clashes(fi, li, t).length) return false;
      if (carried(fi, u, d)) return false;
    }
    return true;
  };

  // Who moves: per collision, the label that can; between two labels, the
  // smaller one (it reads second), then the later-painted.
  const movers: string[] = [];
  const unresolved: string[] = [];
  const partner = new Map<string, string>();
  frames.forEach((f, fi) => {
    f.labels.forEach((L, li) => {
      for (const c of clashes(fi, li)) {
        let mover = L.u;
        if (c.kind === "label" && c.other !== undefined) {
          const M = f.labels[c.other] as Geo["labels"][number];
          const firstL = L.fs < M.fs || (L.fs === M.fs && L.o > M.o);
          const pick = firstL ? [L, M] : [M, L];
          mover = pick[0]?.u ?? pick[1]?.u ?? null;
          const other = mover === L.u ? M.u : L.u;
          if (mover && other && !partner.has(mover)) partner.set(mover, other);
        }
        if (!mover) unresolved.push(`${L.a} (cannot move)`);
        else if (!movers.includes(mover)) movers.push(mover);
      }
    });
  });

  const stillClashing = (u: string) =>
    frames.some((f, fi) =>
      f.labels.some(
        (l, li) =>
          (l.u === u ||
            clashes(fi, li).some((c) => c.other !== undefined && f.labels[c.other]?.u === u)) &&
          clashes(fi, li).length > 0,
      ),
    );

  const reach = (u: string) =>
    Math.max(
      MIN_REACH,
      ...ofUnit(u).map(([fi, li]) => {
        const L = frames[fi]?.labels[li] as Geo["labels"][number];
        return (REACH * L.b[3]) / (L.s || 1);
      }),
    );
  const place = (u: string): boolean => {
    for (let r = STEP; r <= reach(u); r += STEP)
      for (const a of ANGLES) {
        const rad = (a * Math.PI) / 180;
        const d: [number, number] = [
          Math.round(r * Math.cos(rad) * 10) / 10,
          Math.round(r * Math.sin(rad) * 10) / 10,
        ];
        if (clear(u, d)) {
          moves.set(u, d);
          return true;
        }
      }
    return false;
  };

  for (const u of movers) {
    if (!stillClashing(u)) continue;
    if (place(u)) continue;
    const p = partner.get(u);
    if (p && !moves.has(p) && place(p)) continue;
    unresolved.push(u);
  }
  // Whatever still collides after every move is unresolved.
  frames.forEach((f, fi) => {
    f.labels.forEach((L, li) => {
      if (clashes(fi, li).length && !unresolved.includes(L.u ?? L.a)) unresolved.push(L.u ?? L.a);
    });
  });
  return {
    moves: [...moves].map(([u, [dx, dy]]) => ({ u, dx, dy })),
    unresolved: [...new Set(unresolved)],
  };
}

/* ------------------------------------------------------------------- markup */

interface Tag {
  name: string;
  start: number;
  end: number;
  close: boolean;
  self: boolean;
}

/** Start and end tags in document order, comments skipped — the order the probe's `tag:index` counts. */
function tags(markup: string): Tag[] {
  const out: Tag[] = [];
  for (const m of markup.matchAll(/<!--[\s\S]*?-->|<(\/?)\s*([A-Za-z][\w:.-]*)([^>]*)>/g)) {
    if (m[0].startsWith("<!--")) continue;
    out.push({
      name: (m[2] ?? "").toLowerCase(),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      close: m[1] === "/",
      self: /\/\s*$/.test(m[3] ?? ""),
    });
  }
  return out;
}

/** The start tag `tag:index` addresses, and where its element ends. */
function locate(markup: string, address: string): { open: Tag; end: number } | undefined {
  const [name, n] = address.split("#")[0]?.split(":") ?? [];
  const k = Number(n);
  if (!name || !Number.isInteger(k)) return undefined;
  const all = tags(markup);
  let seen = 0;
  for (let i = 0; i < all.length; i++) {
    const t = all[i] as Tag;
    if (t.close || t.name !== name) continue;
    if (seen++ !== k) continue;
    if (t.self) return { open: t, end: t.end };
    let depth = 1;
    for (let j = i + 1; j < all.length; j++) {
      const u = all[j] as Tag;
      if (u.name !== name || u.self) continue;
      depth += u.close ? -1 : 1;
      if (depth === 0) return { open: t, end: u.end };
    }
    return undefined;
  }
  return undefined;
}

/** Each move as a wrapping `<g transform="translate(dx dy)">`, applied from the end so positions hold. */
export function applyMoves(markup: string, moves: readonly Move[]): string {
  const spots = moves
    .map((m) => ({ m, at: locate(markup, m.u) }))
    .filter((x): x is { m: Move; at: { open: Tag; end: number } } => x.at !== undefined)
    .sort((a, b) => b.at.open.start - a.at.open.start);
  let out = markup;
  for (const { m, at } of spots)
    out = `${out.slice(0, at.open.start)}<g transform="translate(${m.dx} ${m.dy})">${out.slice(at.open.start, at.end)}</g>${out.slice(at.end)}`;
  return out;
}

/** When the end-state repairs land: after the last cue starts, finished before the end frame. */
export function settleAt(duration: number, lastCueStart: number): number {
  const t = Math.min(Math.max(duration - 1.8, lastCueStart + 0.2), duration - 1.4);
  return Math.max(0, Math.round(t * 100) / 100);
}

/**
 * Bring the elements dimming lit parts back to full strength at `at`. Targets
 * are the probe's `tag:index[#id]`, ids in the probe deck's form (`sid-…`);
 * an element without an id gets one (`SCENEID-lit<k>`).
 */
export function relight(
  f: Fragment,
  targets: readonly string[],
  at: number,
  sid: string,
): Fragment {
  let markup = f.markup;
  const selectors: string[] = [];
  const unnamed: Array<{ address: string; k: number }> = [];
  targets.forEach((t, k) => {
    const id = t.split("#")[1];
    if (id) selectors.push(`#${id.startsWith(`${sid}-`) ? SID_TOKEN + id.slice(sid.length) : id}`);
    else unnamed.push({ address: t, k });
  });
  // Ids are injected from the last start tag back, so earlier positions hold.
  const spots = unnamed
    .map((x) => ({ ...x, at: locate(markup, x.address) }))
    .filter((x) => x.at !== undefined)
    .sort((a, b) => (b.at?.open.start ?? 0) - (a.at?.open.start ?? 0));
  for (const s of spots) {
    const open = s.at?.open as Tag;
    const head = markup.slice(open.start, open.end);
    const named = head.replace(/^<\s*([A-Za-z][\w:.-]*)/, `$& id="${SID_TOKEN}-lit${s.k}"`);
    markup = markup.slice(0, open.start) + named + markup.slice(open.end);
    selectors.push(`#${SID_TOKEN}-lit${s.k}`);
  }
  if (!selectors.length) return f;
  const list = [...new Set(selectors)].sort().map((s) => JSON.stringify(s));
  return {
    ...f,
    markup,
    script: `${f.script}
// End-state repair (the shell's, not the model's): the last cue ends with what the scene lit at full strength.
tl.to([${list.join(", ")}], { opacity: 1, duration: 0.5, ease: "power2.out" }, ${at});`,
  };
}

/** Send the camera home at `at`: the shell's wrapper, or the svg's viewBox. */
export function homeCamera(f: Fragment, camOff: string, at: number): Fragment {
  if (/-cam at /.test(camOff))
    return {
      ...f,
      script: `${f.script}
// End-state repair: the camera returns to the whole scene before it ends.
tl.to("#${SID_TOKEN}-cam", { scale: 1, x: 0, y: 0, duration: 0.8, ease: "power3.inOut" }, ${at});`,
    };
  const svg = /<svg\b[^>]*\bid\s*=\s*["']SCENEID-svg["'][^>]*>/i.exec(f.markup)?.[0] ?? "";
  const w = /\swidth\s*=\s*["']?([\d.]+)/.exec(svg)?.[1];
  const h = /\sheight\s*=\s*["']?([\d.]+)/.exec(svg)?.[1];
  if (!w || !h) return f;
  return {
    ...f,
    script: `${f.script}
// End-state repair: the camera returns to the whole scene before it ends.
tl.to("#${SID_TOKEN}-svg", { attr: { viewBox: "0 0 ${w} ${h}" }, duration: 0.8, ease: "power3.inOut" }, ${at});`,
  };
}

/** What a repair did, for the report. */
export interface RepairNote {
  /** Overlapping tweens on one property were untangled (`seek_order`). */
  untangled?: boolean;
  moved: number;
  relit: number;
  camera: boolean;
  rules: string[];
}

/**
 * The repaired scene, or undefined when the findings include something this
 * cannot fix or the solver cannot clear every collision. Never a model call.
 */
export function repairScene(
  f: Fragment,
  g: { findings: readonly string[]; layout?: readonly Layout[]; sid?: string },
  scene: { duration: number; lastCueStart: number },
): { fragment: Fragment; note: RepairNote } | undefined {
  if (!repairable(g.findings)) return undefined;
  const rules = errorRules(g.findings);
  const layout = g.layout ?? [];
  const sid = g.sid ?? "";
  let out = f;
  const note: RepairNote = { moved: 0, relit: 0, camera: false, rules };
  if (
    ["graphic_crosses_text", "text_overlap", "svg_text_overprint"].some((r) => rules.includes(r))
  ) {
    const frames = layout.map((l) => l.geo).filter((x): x is Geo => x !== undefined);
    if (!frames.length) return undefined;
    const { moves, unresolved } = solveNudges(frames);
    if (unresolved.length || !moves.length) return undefined;
    out = { ...out, markup: applyMoves(out.markup, moves) };
    note.moved = moves.length;
  }
  if (rules.includes("seek_order")) {
    const script = untangle(out.script);
    if (!script) return undefined;
    out = { ...out, script };
    note.untangled = true;
  }
  const end = layout.find((l) => l.key === "end");
  const at = settleAt(scene.duration, scene.lastCueStart);
  if (rules.includes("end_dimmed")) {
    const targets = end?.relight ?? [];
    if (!targets.length || !sid) return undefined;
    out = relight(out, targets, at, sid);
    note.relit = targets.length;
  }
  if (rules.includes("camera_end")) {
    if (!end?.camOff) return undefined;
    const homed = homeCamera(out, end.camOff, at);
    if (homed === out) return undefined;
    out = homed;
    note.camera = true;
  }
  return { fragment: out, note };
}
